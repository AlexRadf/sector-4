'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runFight, seeds, summarise, Sim } = require('../lib/simrun');
const { cleanRun } = require('../lib/stats');

test('every fight ends, win or lose', () => {
  const runs = seeds(20).map((seed) => runFight({ role: 'healer', seed }));
  assert.strictEqual(summarise(runs).unfinished, 0, 'a fight ran past the end of the shift');
});

test('a full bot squad usually clears, but not every time', () => {
  const s = summarise(seeds(30).map((seed) => runFight({ seed })));
  assert.ok(s.winRate >= 55, `bots win ${s.winRate}%: the Foreman is too hard`);
  assert.ok(s.winRate <= 97, `bots win ${s.winRate}%: the Foreman is too easy`);
});

for (const role of Object.keys(Sim.KITS)) {
  test(`a ${Sim.KITS[role].title} who does nothing gets the squad killed`, () => {
    const s = summarise(seeds(12).map((seed) => runFight({ role, idle: true, seed })));
    assert.ok(s.winRate <= 20, `the squad still wins ${s.winRate}% with an idle ${role}: that role doesn't matter enough`);
  });
}

test('fight records pass the server\'s checks', () => {
  const run = runFight({ role: 'dps', seed: 3 });
  const clean = cleanRun(run);
  assert.ok(clean, 'cleanRun rejected a real record');
  assert.strictEqual(clean.players.length, 4);
  assert.ok(JSON.stringify(run).length < 4000, 'records should stay small');
  assert.strictEqual(cleanRun({ junk: true }), null);
});

test('network snapshots stay under the 4 KiB message limit and the mirror keeps up', () => {
  const roster = [{ role: 'tank', name: 'A', key: 'pa' }, { role: 'healer', name: 'B', key: 'pb' }];
  const H = Sim.create({ humans: roster, seed: 9 }); H.ents.forEach((p) => { if (p.human) p.auto = true; });
  const M = Sim.create({ humans: roster, seed: 9 });
  let buf = [], max = 0, n = 0;
  while (!H.result && n < 30 * 400) {
    Sim.step(H, 1 / 30, {}); buf = buf.concat(H.events); H.events.length = 0; n++;
    if (n % 3 === 0) {
      const snap = Sim.snapshot(H, buf), json = JSON.stringify(snap);
      max = Math.max(max, json.length); buf = buf.slice(snap.ev.length);
      Sim.applySnapshot(M, JSON.parse(json)); M.events.length = 0;
    }
  }
  Sim.applySnapshot(M, JSON.parse(JSON.stringify(Sim.snapshot(H, []))));
  assert.ok(max < 4096, `a snapshot reached ${max} bytes`);
  for (const p of Sim.players(H)) {
    const q = Sim.ent(M, p.id);
    assert.ok(Math.abs(p.x - q.x) < 0.05 && p.hp === q.hp, `mirror drifted for ${p.name}`);
  }
});
