/* Sector-4 server: serves the game and relays squad traffic.
   The fight itself runs in the host player's browser, so this server only forwards messages.
   Restarting it (to deploy) costs players a few seconds of reconnecting, not their fight. */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const makeStore = require('./lib/store');
const { cleanRun, aggregate } = require('./lib/stats');

const PORT = Number(process.env.PORT) || 8080;
const PUB = path.join(__dirname, 'public');
const GRACE_MS = 15000;          // a dropped player keeps their slot this long
const MAX_PEERS = 8;             // per squad room
const MAX_DATA = 4096;           // bytes per emitted message, same as the claude.ai room
const RATE = 80, BURST = 160;    // messages per second per connection
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;
const PEER_RE = /^[a-z0-9]{8,32}$/;

/* ---------- static files ----------
   The build id is a hash of the game files, so every deploy gets a new one without anyone remembering to bump it.
   index.html is never cached; the scripts are requested as file.js?v=BUILD and cached for good. */
const stampIndex = require('./scripts/stamp');
const GAME_FILES = ['index.html', 'sim.js', 'game.js', 'net-ws.js', 'config.js'];
const BUILD = process.env.BUILD || crypto.createHash('sha1')
  .update(GAME_FILES.map((f) => fs.readFileSync(path.join(PUB, f))).join('\n')).digest('hex').slice(0, 10);

const indexHtml = stampIndex(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'), BUILD);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);   // Render and Cloudflare sit in front; use the real client address for rate limits
const store = makeStore();
store.init().then(() => console.log('Fight records: ' + store.kind)).catch((e) => console.error('Fight records unavailable:', e.message));

/* ---------- fight records ----------
   The host (or a solo player) sends one summary when a fight ends. No names are stored. */
const posts = new Map();
app.post('/api/runs', express.json({ limit: '16kb' }), async (req, res) => {
  const ip = req.ip || 'x', now = Date.now(), hour = 3600e3;
  const recent = (posts.get(ip) || []).filter((t) => now - t < hour);
  if (recent.length >= 60) return res.status(429).json({ error: 'Too many fights recorded from here this hour.' });
  recent.push(now); posts.set(ip, recent);
  const run = cleanRun(req.body);
  if (!run) return res.status(400).json({ error: 'That doesn\'t look like a fight record.' });
  try { await store.add(run); res.status(201).json({ ok: true }); }
  catch (e) { console.error('Could not save a fight:', e.message); res.status(503).json({ error: 'Could not save right now.' }); }
});
let statsCache = { at: 0, key: '', body: null };
app.get('/api/stats', async (req, res) => {
  const build = typeof req.query.build === 'string' ? req.query.build.slice(0, 40) : '';
  const mode = typeof req.query.mode === 'string' ? req.query.mode.slice(0, 10) : '';
  const key = build + '|' + mode;
  if (statsCache.key === key && Date.now() - statsCache.at < 15000) return res.json(statsCache.body);
  try {
    let runs = (await store.recent(5000)).map(cleanRun).filter(Boolean);
    const builds = [...new Set(runs.map((r) => r.build))];
    if (build) runs = runs.filter((r) => r.build === build);
    if (mode) runs = runs.filter((r) => r.mode === mode);
    const body = Object.assign({ build: BUILD, storage: store.kind, builds }, aggregate(runs));
    statsCache = { at: Date.now(), key, body };
    res.set('Cache-Control', 'no-store').json(body);
  } catch (e) { res.status(503).json({ error: 'Stats are unavailable right now.' }); }
});
app.get('/stats', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(PUB, 'stats.html')); });
app.get(['/', '/index.html'], (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(indexHtml); });
app.get('/version.json', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ build: BUILD }); });
app.get('/healthz', (req, res) => res.json({ ok: true, build: BUILD, rooms: rooms.size, sockets: wss ? wss.clients.size : 0 }));
app.use(express.static(PUB, {
  index: false,
  setHeaders(res, file) { res.set('Cache-Control', 'public, max-age=31536000, immutable'); }
}));

const server = http.createServer(app);

/* ---------- squad relay ----------
   rooms: name -> Map(peerId -> { ws, presence, away: timer|null })
   Client -> server: hello {peer} | join {room, presence} | leave {room} | pres {room, presence} | emit {room, topic, data}
   Server -> client: welcome {peer, build} | joined {room, peers} | peer {room, peer, presence, away, gone} | msg {room, topic, data, peer} | restarting */
const rooms = new Map();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, except) {
  const r = rooms.get(room); if (!r) return;
  const text = JSON.stringify(obj);
  for (const [id, m] of r) if (id !== except && m.ws && m.ws.readyState === 1) m.ws.send(text);
}
function peerList(room) {
  const r = rooms.get(room); if (!r) return [];
  return [...r].map(([id, m]) => ({ peer: id, presence: m.presence, away: !!m.away }));
}
function dropPeer(room, id) {
  const r = rooms.get(room); if (!r) return;
  const m = r.get(id); if (!m) return;
  if (m.away) clearTimeout(m.away);
  r.delete(id);
  if (!r.size) rooms.delete(room);
  broadcast(room, { t: 'peer', room, peer: id, gone: true });
}

wss.on('connection', (ws) => {
  let peer = null;
  const joined = new Set();
  let tokens = BURST, last = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    const now = Date.now();
    tokens = Math.min(BURST, tokens + (now - last) / 1000 * RATE); last = now;
    if (tokens < 1) return;               // over budget: drop, like the claude.ai room
    tokens -= 1;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'hello') {
      // The browser keeps its peer id across reconnects, so a restart doesn't turn players into strangers.
      peer = typeof m.peer === 'string' && PEER_RE.test(m.peer) ? m.peer : crypto.randomBytes(8).toString('hex');
      send(ws, { t: 'welcome', peer, build: BUILD });
      return;
    }
    if (!peer) return;
    const room = typeof m.room === 'string' && ROOM_RE.test(m.room) ? m.room : null;
    if (!room) return;

    if (m.t === 'join') {
      let r = rooms.get(room);
      if (!r) { r = new Map(); rooms.set(room, r); }
      const existing = r.get(peer);
      if (!existing && r.size >= MAX_PEERS) { send(ws, { t: 'error', room, code: 'room_full' }); return; }
      const presence = m.presence && typeof m.presence === 'object' ? m.presence : (existing ? existing.presence : {});
      if (existing) {
        if (existing.away) clearTimeout(existing.away);
        if (existing.ws && existing.ws !== ws) { try { existing.ws.close(4000, 'replaced'); } catch (e) {} }
      }
      r.set(peer, { ws, presence, away: null });
      joined.add(room);
      send(ws, { t: 'joined', room, peers: peerList(room) });
      broadcast(room, { t: 'peer', room, peer, presence, away: false }, peer);
      return;
    }
    if (!joined.has(room)) return;
    const r = rooms.get(room); if (!r || !r.has(peer)) return;

    if (m.t === 'leave') { joined.delete(room); dropPeer(room, peer); return; }
    if (m.t === 'pres') {
      if (!m.presence || typeof m.presence !== 'object' || JSON.stringify(m.presence).length > MAX_DATA) return;
      r.get(peer).presence = m.presence;
      broadcast(room, { t: 'peer', room, peer, presence: m.presence, away: false }, peer);
      return;
    }
    if (m.t === 'emit') {
      if (typeof m.topic !== 'string' || !TOPIC_RE.test(m.topic)) return;
      if (JSON.stringify(m.data === undefined ? null : m.data).length > MAX_DATA) return;
      broadcast(room, { t: 'msg', room, topic: m.topic, data: m.data, peer });   // sender included, like the claude.ai room
    }
  });

  ws.on('close', () => {
    if (!peer) return;
    for (const room of joined) {
      const r = rooms.get(room); const m = r && r.get(peer);
      if (!m || m.ws !== ws) continue;
      m.ws = null;
      broadcast(room, { t: 'peer', room, peer, presence: m.presence, away: true });
      m.away = setTimeout(() => dropPeer(room, peer), GRACE_MS);
    }
  });
});

// Drop sockets that stopped answering (laptop lid closed, network gone).
const beat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; try { ws.ping(); } catch (e) {}
  }
}, 20000);

/* On a deploy, tell everyone the server is restarting so their screens say "reconnecting" instead of looking broken. */
function shutdown() {
  for (const ws of wss.clients) send(ws, { t: 'restarting' });
  clearInterval(beat);
  setTimeout(() => { server.close(); process.exit(0); }, 400);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`Sector-4 build ${BUILD} on :${PORT}`));
