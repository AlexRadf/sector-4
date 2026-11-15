'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { runFight } = require('../lib/simrun');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let server, dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 's4-'));
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dataDir });
  delete env.DATABASE_URL;
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
test.after(() => { if (server) server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('serves the game, the stats page and a build id', async () => {
  const page = await (await fetch(BASE + '/')).text();
  const { build } = await (await fetch(BASE + '/version.json')).json();
  assert.ok(build && page.includes(`window.S4_BUILD = "${build}"`), 'the page is not stamped with the build');
  assert.ok(page.includes(`game.js?v=${build}`));
  assert.ok((await fetch(BASE + '/stats')).ok);
});

test('the relay passes a message between two players in a squad room', async () => {
  const open = (peer) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', peer })); ws.send(JSON.stringify({ t: 'join', room: 's4-test', presence: { role: 'tank' } })); });
    ws.on('message', (m) => { const d = JSON.parse(m); if (d.t === 'joined') resolve(ws); });
  });
  const a = await open('aaaaaaaa11'), b = await open('bbbbbbbb22');
  const got = new Promise((resolve) => b.on('message', (m) => { const d = JSON.parse(m); if (d.t === 'msg' && d.topic === 'snap') resolve(d); }));
  a.send(JSON.stringify({ t: 'emit', room: 's4-test', topic: 'snap', data: { hello: 1 } }));
  const msg = await got;
  assert.strictEqual(msg.peer, 'aaaaaaaa11');
  assert.deepStrictEqual(msg.data, { hello: 1 });
  a.close(); b.close();
});

test('records a fight and reports it in the stats', async () => {
  const run = runFight({ role: 'tank', seed: 5 });
  run.mode = 'solo';
  const res = await fetch(BASE + '/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run) });
  assert.strictEqual(res.status, 201);
  const bad = await fetch(BASE + '/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"players":[]}' });
  assert.strictEqual(bad.status, 400);
  const stats = await (await fetch(BASE + '/api/stats')).json();
  assert.strictEqual(stats.runs, 1);
  assert.strictEqual(stats.storage, 'file');
  assert.ok(stats.byRole.find((r) => r.role === 'tank').n === 1, 'the person-played tank seat is counted');
});

test('version matches package.json and has a changelog entry', async () => {
  const Sim = require('../public/sim.js');
  const pkg = require('../package.json');
  assert.strictEqual(pkg.version, Sim.VERSION, 'bump VERSION in public/sim.js and package.json together');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8').includes(`## ${Sim.VERSION} `), 'add a CHANGELOG.md entry for this version');
  const v = await (await fetch(BASE + '/version.json')).json();
  assert.strictEqual(v.version, Sim.VERSION);
});

test('admin is off without ADMIN_KEY', async () => {
  const res = await fetch(BASE + '/api/admin/rooms', { headers: { 'x-admin-key': 'anything-at-all' } });
  assert.strictEqual(res.status, 503);
});
