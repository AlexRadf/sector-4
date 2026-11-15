'use strict';
/* Admin watching: a second server with ADMIN_KEY set. */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'test-admin-key-123';
let server, dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 's4a-'));
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dataDir, ADMIN_KEY: KEY });
  delete env.DATABASE_URL;
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
test.after(() => { if (server) server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function sock(peer) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.msgs = [];
    ws.on('message', (m) => ws.msgs.push(JSON.parse(m)));
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', peer })); resolve(ws); });
  });
}
const until = async (fn) => { for (let i = 0; i < 50; i++) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timed out'); };

test('the admin page and room list need the key', async () => {
  assert.ok((await fetch(BASE + '/admin')).ok);
  assert.strictEqual((await fetch(BASE + '/api/admin/rooms')).status, 403);
  assert.strictEqual((await fetch(BASE + '/api/admin/rooms', { headers: { 'x-admin-key': 'wrong-key-here' } })).status, 403);
  const ok = await fetch(BASE + '/api/admin/rooms', { headers: { 'x-admin-key': KEY } });
  assert.strictEqual(ok.status, 200);
});

test('an admin watches a squad mid-fight without appearing in it', async () => {
  const host = await sock('hhhhhhhh01'), mate = await sock('mmmmmmmm02');
  host.send(JSON.stringify({ t: 'join', room: 's4-abc', presence: { host: 1, role: 'tank', nick: 'Alex', st: 'lobby' } }));
  mate.send(JSON.stringify({ t: 'join', room: 's4-abc', presence: { host: 0, role: 'healer', nick: 'Katie' } }));
  await until(() => mate.msgs.some((m) => m.t === 'joined'));
  // The fight starts before the admin arrives.
  host.send(JSON.stringify({ t: 'emit', room: 's4-abc', topic: 'start', data: { id: 'f1', seed: 7, roster: [] } }));
  host.send(JSON.stringify({ t: 'pres', room: 's4-abc', presence: { host: 1, role: 'tank', nick: 'Alex', st: 'f1' } }));

  const rooms = await (await fetch(BASE + '/api/admin/rooms', { headers: { 'x-admin-key': KEY } })).json();
  const abc = rooms.rooms.find((r) => r.code === 'abc');
  assert.ok(abc);
  assert.deepStrictEqual(abc.people.map((p) => p.nick).sort(), ['Alex', 'Katie']);

  const bad = await sock('aaaaaaaa03');
  bad.send(JSON.stringify({ t: 'spy', room: 's4-abc', key: 'nope-nope-nope' }));
  await until(() => bad.msgs.some((m) => m.code === 'forbidden'));

  const admin = await sock('aaaaaaaa04');
  admin.send(JSON.stringify({ t: 'spy', room: 's4-abc', key: KEY }));
  const spying = await until(() => admin.msgs.find((m) => m.t === 'spying'));
  assert.strictEqual(spying.start.data.id, 'f1', 'a late watcher gets the fight already under way');

  host.send(JSON.stringify({ t: 'emit', room: 's4-abc', topic: 'snap', data: { sid: 'f1' } }));
  await until(() => admin.msgs.some((m) => m.t === 'msg' && m.topic === 'snap'));
  // Invisible: nobody got a peer message about the admin, and the admin can't send into the room.
  assert.ok(!mate.msgs.some((m) => m.t === 'peer' && m.peer === 'aaaaaaaa04'));
  admin.send(JSON.stringify({ t: 'emit', room: 's4-abc', topic: 'act', data: { a: 1 } }));
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!host.msgs.some((m) => m.t === 'msg' && m.topic === 'act'));
  [host, mate, bad, admin].forEach((w) => w.close());
});
