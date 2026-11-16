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

/* Per-class talent trees: every class has its own, and the class-specific mechanics actually fire. */
test('each class has its own four tiers of three talents', () => {
  const seen = {};
  for (const role of Object.keys(Sim.KITS)) {
    for (const slot of Sim.SLOTS) {
      const list = Sim.talentList(slot, role);
      assert.strictEqual(list.length, 3, `${role} ${slot}`);
      assert.deepStrictEqual(list.map((t) => t.style), ['aggressive', 'steady', 'squad']);
      list.forEach((t) => { seen[t.name] = (seen[t.name] || 0) + 1; });
    }
  }
  assert.ok(Object.values(seen).every((n) => n === 1), 'talent names repeat across classes');
});

function solo(role, gear) {
  const S = Sim.create({ humanRole: role, gear, humanAuto: false, seed: 3 });
  S.countdown = 0;
  return { S, p: Sim.ent(S, S.humanId), boss: Sim.ent(S, S.bossId) };
}
function run(S, secs, inp) { for (let i = 0; i < secs * 30; i++) { Sim.step(S, 1 / 30, i === 0 && inp ? inp : {}); } }

test('Riot Charge closes the gap to the target', () => {
  const { S, p, boss } = solo('tank', { boots: 'charge' });
  const before = Math.hypot(p.x - boss.x, p.z - boss.z);
  run(S, 0.1, { target: boss.id, jump: true });
  assert.ok(Math.hypot(p.x - boss.x, p.z - boss.z) < before - 5);
  assert.ok(p.cds.leap > 9);
});

test('Medevac leaps to the most hurt ally and shields them', () => {
  const { S, p } = solo('healer', { boots: 'medevac' });
  const hurt = Sim.players(S).find((q) => q !== p);
  hurt.hp = Math.round(hurt.maxHp * 0.3);
  run(S, 0.1, { jump: true });
  assert.ok(Math.hypot(p.x - hurt.x, p.z - hurt.z) < 3);
  assert.ok(hurt.armor > 0);
});

test('Defibrillator brings the first downed player back once', () => {
  const { S, p } = solo('healer', { util: 'defib' });
  const ally = Sim.players(S).find((q) => q !== p && q.role !== 'tank');
  ally.hp = 1; ally.armor = 0;
  Sim.damagePlayer(S, S.bossId, ally, 5000, 'Test', true);
  assert.strictEqual(ally.alive, false);
  run(S, 3.5);
  assert.strictEqual(ally.alive, true);
  assert.ok(p.defibUsed);
});

test('Rampage stacks while the Wrecker keeps swinging', () => {
  const { S, p, boss } = solo('melee', { implant: 'rampage' });
  for (let i = 0; i < 9; i++) Sim.damageEnemy(S, p, boss, 10, 0, 'Test');
  assert.strictEqual(p.rampage, 8);
});

test('Killing Spree stacks on highlights and fades', () => {
  const { S, p, boss } = solo('dps', { util: 'spree' });
  Sim.damageEnemy(S, p, boss, 10, 0, 'Headshot!');
  Sim.damageEnemy(S, p, boss, 10, 0, 'Combo!');
  assert.strictEqual(p.spree, 2);
  assert.ok(S.events.some((e) => e.type === 'proc' && e.text === 'KILLING SPREE'));
  run(S, 16);
  assert.strictEqual(p.spree, 0);
});

test('bot hands hold a direction for a beat instead of re-aiming every frame', () => {
  const S = Sim.create({ seed: 9 }); S.countdown = 0;
  let changes = 0, last = null, movingFrames = 0;
  for (let i = 0; i < 30 * 60; i++) {
    Sim.step(S, 1 / 30, {});
    const p = Sim.players(S).find((q) => q.role === 'melee');
    if (p.moving && p.hand) {
      movingFrames++;
      const a = Math.round(Math.atan2(p.inMx, p.inMz) * 100);
      if (a !== last) { changes++; last = a; }
    }
    S.events.length = 0;
  }
  // Held for at least 4 frames (~0.13s) on average, where the raw brain would re-aim every frame.
  assert.ok(changes > 5 && movingFrames / changes >= 4, `${changes} changes in ${movingFrames} moving frames`);
});

test('fight records keep movement measures and stats compare people with bots', () => {
  const { cleanRun, aggregate } = require('../lib/stats');
  const r = runFight({ role: 'dps', seed: 5 });
  r.mode = 'solo';
  const clean = cleanRun(r);
  assert.ok(clean.players.every((p) => p.move && p.move.hold > 0));
  const a = aggregate([clean]);
  assert.strictEqual(a.movement.people.n, 1);
  assert.strictEqual(a.movement.bots.n, 3);
});

/* v0.10: rotations, the overcharge shield, ultimates and hero moments. */
function arena(role, gear) {
  const S = Sim.create({ humanRole: role, gear, humanAuto: false, seed: 4 }); S.countdown = 0;
  return { S, p: Sim.ent(S, S.humanId), boss: Sim.ent(S, S.bossId) };
}
const press = (S, i, extra) => Sim.step(S, 1 / 30, Object.assign({ ability: i }, extra || {}));
const idle = (S, secs) => { for (let i = 0; i < secs * 30; i++) Sim.step(S, 1 / 30, {}); };

test('builders add pips, spenders cash them all in, and a spender with no pips is refused', () => {
  const { S, p, boss } = arena('dps', { weapon: 'rockets' });
  p.x = boss.x; p.z = boss.z - 15;
  press(S, 1, { target: boss.id });
  assert.ok(S.events.some((e) => e.type === 'error' && /pips/i.test(e.text)));
  for (let n = 0; n < 3; n++) { p.gcd = 0; press(S, 0, { target: boss.id }); }
  assert.strictEqual(p.pips, 3);
  S.events.length = 0; p.gcd = 0; press(S, 1, { target: boss.id });
  assert.strictEqual(p.pips, 0);
  assert.strictEqual(S.events.filter((e) => e.type === 'dmg' && e.label === 'Volley').length, 3);
});

test('a proc lights the third button for a while and using it spends the proc', () => {
  const { S, p, boss } = arena('melee', { weapon: 'chainsaw' });
  p.x = boss.x; p.z = boss.z - 5;
  press(S, 2, { target: boss.id });
  assert.ok(S.events.some((e) => e.type === 'error' && /procced/.test(e.text)));
  p.procT = Sim.PROC_WINDOW; S.events.length = 0;
  press(S, 2, { target: boss.id });
  assert.ok(S.events.some((e) => e.type === 'dmg' && e.label === 'Overdrive!'));
  assert.strictEqual(p.procT, 0);
});

test('every hit varies, and crits are flagged', () => {
  const { S, p, boss } = arena('dps');
  const seen = new Set(); let crits = 0;
  for (let i = 0; i < 300; i++) { const before = S.events.length; Sim.damageEnemy(S, p, boss, 100, 1, 'Test'); const e = S.events[before]; seen.add(e.amt); if (e.crit) crits++; }
  assert.ok(seen.size > 20, 'damage should vary');
  assert.ok(crits > 10 && crits < 70, `crits: ${crits} of 300`);
});

test('breaking the overcharge shield staggers the Foreman; letting it run shocks everyone', () => {
  const { S, p, boss } = arena('dps');
  boss.oshield = { hp: 300, max: 300, t: 0, dur: 9 };
  for (let i = 0; i < 10 && boss.oshield; i++) Sim.damageEnemy(S, p, boss, 100, 1, 'Test');
  assert.strictEqual(boss.oshield, null);
  assert.ok(boss.stagger > 0);
  const b = arena('dps');
  b.boss.oshield = { hp: 9999, max: 9999, t: 8.9, dur: 9 };
  const soft = Sim.players(b.S).filter((q) => q.role !== 'tank'), hp = soft.map((q) => q.hp);   // the tank's plating may soak it
  idle(b.S, 0.2);
  assert.ok(soft.every((q, i) => q.hp < hp[i]), 'everyone takes the pulse');
});

test('Riot Wall: standing behind the Juggernaut blocks the Demolition Blast', () => {
  const { S, p, boss } = arena('tank');
  p.ult = 100; p.x = boss.x; p.z = boss.z - 8;
  const safe = Sim.players(S).find((q) => q.role === 'healer'), exposed = Sim.players(S).find((q) => q.role === 'dps');
  safe.x = p.x; safe.z = p.z - 5; exposed.x = boss.x + 12; exposed.z = boss.z;
  press(S, 5);
  assert.ok(p.wall > 0);
  const h0 = safe.hp, e0 = exposed.hp;
  Sim.damagePlayer(S, S.bossId, safe, 500, 'Demolition Blast');
  Sim.damagePlayer(S, S.bossId, exposed, 500, 'Demolition Blast');
  assert.strictEqual(safe.hp, h0);
  assert.ok(exposed.hp < e0);
});

test('Counter-Slam during a Haymaker cancels it and staggers the Foreman', () => {
  const { S, p, boss } = arena('melee');
  p.ult = 100; p.x = boss.x; p.z = boss.z - 5;
  S.hero = { role: 'melee', t: 0 };
  boss.cast = { name: 'Haymaker', t: 1, dur: 5, done: () => {} };
  press(S, 5, { target: boss.id });
  assert.strictEqual(boss.cast, null);
  assert.ok(boss.stagger > 0);
  assert.strictEqual(S.m.heroes.melee[1], 1);
});

test('Deadeye shoots the Heavy Rocket down; Field Hospital clears radiation', () => {
  const a = arena('dps');
  a.p.ult = 100;
  a.S.missile = { x: 0, z: 0, x0: 0, z0: 0, tgt: Sim.players(a.S)[1].id, t: 2, dur: 7 };
  a.S.hero = { role: 'dps', t: 0 };
  press(a.S, 5);
  assert.strictEqual(a.S.missile, null);
  assert.strictEqual(a.S.m.heroes.dps[1], 1);
  const b = arena('healer');
  b.p.ult = 100; b.S.hero = { role: 'healer', t: 0, melt: true };
  Sim.players(b.S).forEach((q) => { q.rad = 5; });
  press(b.S, 5);
  assert.ok(Sim.players(b.S).every((q) => !(q.rad > 0)));
  assert.strictEqual(b.S.m.heroes.healer[1], 1);
});

test('collapsing floor sections only catch people standing on them', () => {
  const g = { shape: 'sector', a0: 0, a1: Math.PI / 3, r0: 7, r1: 30 };
  assert.ok(Sim.inTele(g, { x: Math.sin(0.5) * 15, z: Math.cos(0.5) * 15 }));
  assert.ok(!Sim.inTele(g, { x: Math.sin(2) * 15, z: Math.cos(2) * 15 }));
  assert.ok(!Sim.inTele(g, { x: Math.sin(0.5) * 4, z: Math.cos(0.5) * 4 }));
});

test('bots answer every kind of hero moment over a fight', () => {
  const r = runFight({ seed: 5 });
  for (const role of ['tank', 'healer', 'dps', 'melee']) assert.ok(r.heroes[role][0] >= 1, role + ' was never called');
  assert.ok(Object.values(r.heroes).every(([called, done]) => done >= 1 || called === 0));
});
