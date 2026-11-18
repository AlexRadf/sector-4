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
      assert.deepStrictEqual(list.map((t) => t.style), ['aggressive', 'steady', 'squad'], `${role} ${slot}`);
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
  const { S, p, boss } = solo('tank', { boots: 'ram' });
  const before = Math.hypot(p.x - boss.x, p.z - boss.z);
  run(S, 0.8, { target: boss.id, jump: true });   // the boosters take a moment to get you there
  assert.ok(Math.hypot(p.x - boss.x, p.z - boss.z) < before - 5);
  assert.ok(p.charges < 1);
});

test('Medevac leaps to the most hurt ally and shields them (or, aimed, to whoever you point at)', () => {
  const { S, p } = solo('healer', { weapon: 'bio', boots: 'medevac' });
  const hurt = Sim.players(S).find((q) => q.role === 'dps');
  hurt.hp = Math.round(hurt.maxHp * 0.3);
  run(S, 0.1, { jump: true });
  assert.ok(Math.hypot(p.x - hurt.x, p.z - hurt.z) < 3);
  assert.ok(hurt.armor > 0);
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

test('Wrecker Revs: key 1 builds, key 2 cashes them all in, and is refused with none', () => {
  const { S, p, boss } = arena('melee', { weapon: 'ripper' });
  p.x = boss.x; p.z = boss.z - 12;
  press(S, 1, { target: boss.id });
  assert.ok(S.events.some((e) => e.type === 'error' && /Revs/.test(e.text)));
  for (let n = 0; n < 3; n++) { p.gcd = 0; press(S, 0, { target: boss.id }); }
  assert.strictEqual(p.pips, 3);
  p.gcd = 0; press(S, 1, { target: boss.id });
  assert.strictEqual(p.pips, 0);
});

test('Striker Capacitor (tab-target Rockets): recharges by itself, the heavy shot drains 50', () => {
  const { S, p, boss } = arena('dps', { weapon: 'rockets' });
  p.x = boss.x; p.z = boss.z - 15; p.pips = 100;
  S.events.length = 0; press(S, 1, { target: boss.id });
  assert.ok(p.pips <= 60.5 && p.pips >= 49, String(p.pips));   // 50 spent, crits refund 10
  assert.strictEqual(S.events.filter((e) => e.type === 'dmg' && /^Volley/.test(e.label)).length, 2, 'two rockets with no Lock-on');
  p.pips = 100;
  for (let n = 0; n < 3; n++) { p.gcd = 0; press(S, 0, { target: boss.id }); }
  S.events.length = 0; p.gcd = 0; press(S, 1, { target: boss.id });
  assert.strictEqual(S.events.filter((e) => e.type === 'dmg' && /^Volley/.test(e.label)).length, 5, 'three Lock-ons add three rockets');
  p.pips = 0; idle(S, 2);
  assert.ok(p.pips > 12, 'recharges');
});

test('Medic Nanites: heals cost them, shooting harvests them', () => {
  const { S, p, boss } = arena('healer', { weapon: 'bio' });
  p.x = boss.x; p.z = boss.z - 15; p.pips = 30;
  press(S, 1);
  assert.ok(p.pips < 6);
  p.gcd = 0; press(S, 1);
  assert.ok(S.events.some((e) => e.type === 'error' && /Nanites/.test(e.text)));
  p.gcd = 0; const before = p.pips; press(S, 0, { target: boss.id });
  assert.ok(p.pips >= before + 11);
});

test('Flak Cannon: blasts load Ammo, Flak Screen spends it and cuts hits by 60%', () => {
  const { S, p, boss } = arena('tank', { weapon: 'flak' });
  p.x = boss.x; p.z = boss.z - 5; p.pips = 0;
  press(S, 0, { target: boss.id });
  assert.ok(p.pips >= 15);
  p.pips = 60; press(S, 2);
  assert.ok(p.screen > 2 && p.pips <= 10.5);
  p.armor = 0; const h = p.hp;
  Sim.damagePlayer(S, S.bossId, p, 1000, 'Crusher');
  assert.ok(h - p.hp <= 230 && h - p.hp >= 180, String(h - p.hp));   // plating 30%, then the screen 70%
});

test('Impact Hammer: swing, swing, slam, and holding key 1 keeps the chain going', () => {
  const { S, p, boss } = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
  p.x = boss.x; p.z = boss.z - 6;
  const face = Math.atan2(boss.x - p.x, boss.z - p.z);
  S.events.length = 0;
  for (let i = 0; i < 3 * 30; i++) Sim.step(S, 1 / 30, { aim: face, hold: [true, false] });
  const hits = S.events.filter((e) => e.type === 'dmg' && e.dst === boss.id && /^(Swing|Slam)/.test(e.label)).map((e) => e.label);
  assert.ok(hits.length >= 4, hits.join(','));
  assert.deepStrictEqual(hits.slice(0, 3), ['Swing', 'Swing', 'Slam!']);
  S.events.length = 0; p.gcd = 0; press(S, 0, { aim: face + Math.PI });
  assert.ok(!S.events.some((e) => e.type === 'dmg' && e.dst === boss.id && e.src === p.id), 'facing away misses');
});

test('Impact Hammer: swings and blocks fill Shield Energy, and both buttons together Shove', () => {
  const { S, p, boss } = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
  p.x = boss.x; p.z = boss.z - 6; p.pips = 0;
  const face = Math.atan2(boss.x - p.x, boss.z - p.z);
  press(S, 0, { aim: face });
  assert.ok(Math.abs(p.pips - 6) < 0.01, 'a swing stores 6: ' + p.pips);
  p.gcd = 0; Sim.step(S, 1 / 30, { aim: face, hold: [false, true] });
  const was = p.pips; Sim.damagePlayer(S, S.bossId, p, 500, 'Hit');
  assert.ok(Math.abs(p.pips - was - 20) < 0.01, 'blocking 500 stores 20: ' + (p.pips - was));
  // Not enough energy: nothing happens.
  p.pips = 10; Sim.step(S, 1 / 30, { aim: face, hold: [false, false] }); S.events.length = 0;
  Sim.step(S, 1 / 30, { aim: face, hold: [true, true] });
  assert.ok(!S.events.some((e) => e.type === 'dmg' && /^Shove/.test(e.label)));
  // Full bar: a big hit on the boss, and the bar empties. Holding both doesn't fire it again.
  p.pips = 100; Sim.step(S, 1 / 30, { aim: face, hold: [false, false] }); S.events.length = 0;
  Sim.step(S, 1 / 30, { aim: face, hold: [true, true] });
  const big = S.events.filter((e) => e.type === 'dmg' && e.dst === boss.id && e.label === 'Shove!');
  assert.strictEqual(big.length, 1); assert.ok(big[0].amt >= 400, String(big[0].amt));
  assert.strictEqual(p.pips, 0);
  p.pips = 100; for (let i = 0; i < 9; i++) Sim.step(S, 1 / 30, { aim: face, hold: [true, true] });
  assert.strictEqual(p.pips, 100, 'held, not pressed again');
});

test('Shove: a full bar beats two half ones, drones fly, and a slam into the wall or a friend stuns', () => {
  const shoveAt = (pips) => {
    const a = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
    a.p.x = a.boss.x; a.p.z = a.boss.z - 6; a.p.pips = pips; a.S.events.length = 0;
    a.S.rng = () => 0.5;
    press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'shove'), { aim: Math.atan2(a.boss.x - a.p.x, a.boss.z - a.p.z) });
    return a.S.events.filter((e) => e.type === 'dmg' && e.dst === a.boss.id).reduce((n, e) => n + e.amt, 0);
  };
  assert.ok(shoveAt(100) > 2 * shoveAt(50), 'save it up');
  const { S, p } = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
  const bossE = Sim.ent(S, S.bossId); bossE.x = 0; bossE.z = 20;
  p.x = 0; p.z = 0; p.pips = 100;
  const mk = (id, x, z) => ({ id, kind: 'enemy', type: 'drone', x, z, facing: 0, speed: 6, radius: 1, hp: 1600, maxHp: 1600, alive: true, threat: {}, target: null, fixate: null, swing: 1, melee: 90, swingInt: 1.5, cast: null });
  const free = mk(990, -4, 3), pinned = mk(991, 3, 3), wall = mk(992, 4.5, 5.5);
  S.ents.push(free, pinned, wall); S.events.length = 0;
  press(S, Sim.abilitiesOf(p).findIndex((ab) => ab.id === 'shove'), { aim: 0 });
  assert.ok(Math.hypot(free.x, free.z) > 12, 'thrown back: ' + free.x + ',' + free.z);
  assert.ok(!(free.stagger > 0), 'nothing to hit, no stun');
  assert.ok(pinned.stagger >= 2 && wall.stagger >= 2, 'slammed into a friend: both stunned');
  assert.ok(S.events.some((e) => e.type === 'dmg' && e.label === 'Slammed!' && e.dst === 991));
  const edge = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
  const eb = Sim.ent(edge.S, edge.S.bossId); eb.x = -20; eb.z = 0;
  edge.p.x = 0; edge.p.z = 20; edge.p.pips = 100;
  const d = mk(993, 0, 23); edge.S.ents.push(d);
  press(edge.S, Sim.abilitiesOf(edge.p).findIndex((ab) => ab.id === 'shove'), { aim: 0 });
  assert.ok(d.stagger >= 2, 'slammed into the wall');
});

test('Piston Shot: a cheap ranged poke where you aim, on a short cooldown', () => {
  const { S, p, boss } = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
  p.x = boss.x; p.z = boss.z - 18; S.events.length = 0;
  const i = Sim.abilitiesOf(p).findIndex((ab) => ab.id === 'piston');
  press(S, i, { aim: Math.atan2(boss.x - p.x, boss.z - p.z) });
  assert.ok(S.events.some((e) => e.type === 'dmg' && e.dst === boss.id && e.label === 'Piston Shot'));
  assert.ok(p.cds.piston > 3);
  p.cds.piston = 0; S.events.length = 0;
  press(S, i, { aim: Math.atan2(boss.x - p.x, boss.z - p.z) + Math.PI });
  assert.ok(!S.events.some((e) => e.type === 'dmg' && e.label === 'Piston Shot') && p.cds.piston <= 0.5, 'a miss barely costs you');
});

test('Aegis Dome: nobody inside takes damage while it lasts', () => {
  const { S, p, boss } = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
  p.ult = 100; p.x = 0; p.z = -10;
  const ULT = Sim.abilitiesOf(p).findIndex((a) => a.role === 'ult');
  const inside = Sim.players(S).find((q) => q.role === 'healer'), outside = Sim.players(S).find((q) => q.role === 'dps');
  inside.x = 3; inside.z = -10; outside.x = 20; outside.z = -10; inside.armor = 0; outside.armor = 0;
  press(S, ULT);
  const h = [inside.hp, outside.hp];
  Sim.damagePlayer(S, S.bossId, inside, 400, 'Rocket'); Sim.damagePlayer(S, S.bossId, outside, 400, 'Rocket');
  assert.strictEqual(inside.hp, h[0]); assert.ok(outside.hp < h[1]);
  idle(S, 5.5);
  assert.strictEqual(S.domes.length, 0);
});

test('Riot Charge: an aimed boosted dash, Twin Thrusters holds two, Intercept shields an ally', () => {
  const a = arena('tank', { weapon: 'flak', boots: 'twincharge' });
  const toBoss = () => Math.atan2(a.boss.x - a.p.x, a.boss.z - a.p.z);
  a.p.x = a.boss.x; a.p.z = a.boss.z - 22;
  Sim.step(a.S, 1 / 30, { aim: toBoss(), jump: true });
  assert.ok(a.p.dash, 'flying, not teleported');
  idle(a.S, 1);
  assert.ok(!a.p.dash && Math.hypot(a.p.x - a.boss.x, a.p.z - a.boss.z) < 6, 'stops at the first enemy');
  a.p.x = a.boss.x; a.p.z = a.boss.z - 22;
  Sim.step(a.S, 1 / 30, { aim: toBoss(), jump: true });
  assert.ok(a.p.charges < 1, 'used the second charge');
  const b = arena('tank', { weapon: 'flak', boots: 'intercept' });
  const ally = Sim.players(b.S).find((q) => q.role === 'healer');
  Sim.players(b.S).forEach((q) => { if (q !== b.p && q !== ally) { q.x = 0; q.z = 20; } });   // a clear lane
  b.p.x = -10; b.p.z = -20; ally.x = 20; ally.z = -20; ally.armor = 0;
  ally.human = true; ally.auto = false;   // hold still so the test is about the charge, not the bot
  Sim.step(b.S, 1 / 30, { aim: Math.PI / 2, jump: true });
  idle(b.S, 1.2);
  assert.ok(Math.hypot(b.p.x - ally.x, b.p.z - ally.z) < 3.5 && ally.armor >= 200, `${b.p.x},${b.p.z} armor ${ally.armor}`);
});

test('the Foreman walks to the middle to channel his shield, and stands still while it is up', () => {
  const { S, boss } = arena('dps');
  boss.x = 10; boss.z = 8; boss.energy = 100;
  idle(S, 2.5);
  assert.ok(boss.oshield, 'shield up');
  assert.ok(Math.hypot(boss.x, boss.z) < 1, 'in the middle');
  const x = boss.x, z = boss.z;
  idle(S, 2);
  assert.ok(Math.hypot(boss.x - x, boss.z - z) < 0.01, 'planted');
});

test('Impact Hammer: the barrier covers you and whoever is behind you, then breaks', () => {
  const { S, p, boss } = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
  p.x = boss.x; p.z = boss.z - 8; p.armor = 0;
  const face = Math.atan2(boss.x - p.x, boss.z - p.z);
  const behindAlly = Sim.players(S).find((q) => q.role === 'healer'), sideAlly = Sim.players(S).find((q) => q.role === 'dps');
  behindAlly.x = p.x; behindAlly.z = p.z - 4; behindAlly.armor = 0;
  sideAlly.x = boss.x + 10; sideAlly.z = boss.z; sideAlly.armor = 0;
  Sim.step(S, 1 / 30, { aim: face, hold: [false, true] });
  assert.ok(p.barrierUp);
  const h = [p.hp, behindAlly.hp, sideAlly.hp];
  Sim.damagePlayer(S, S.bossId, p, 500, 'Crusher');
  Sim.damagePlayer(S, S.bossId, behindAlly, 500, 'Rocket');
  Sim.damagePlayer(S, S.bossId, sideAlly, 500, 'Rocket');
  assert.strictEqual(p.hp, h[0]); assert.strictEqual(behindAlly.hp, h[1]);
  assert.ok(sideAlly.hp < h[2], 'someone off to the side is not covered');
  Sim.damagePlayer(S, S.bossId, p, 2000, 'Crusher');
  assert.ok(!p.barrierUp && p.barrierBroken > 0);
});

test('Minigun: heat speeds it up, Perfect Vent shields big, 100 jams it', () => {
  const { S, p, boss } = arena('tank', { weapon: 'minigun', rig: 'vengeance' });
  p.x = boss.x; p.z = boss.z - 10;
  p.pips = 0; press(S, 0, { target: boss.id }); const cold = p.gcd;
  p.pips = 80; p.gcd = 0; press(S, 0, { target: boss.id });
  assert.ok(p.gcd < cold * 0.7, 'hot barrels fire faster');
  p.pips = 90; p.armor = 0; press(S, 2);
  assert.ok(p.armor >= 800 && p.pips > 43 && p.pips <= 45, 'perfect vent');
  p.pips = 95; p.gcd = 0; press(S, 0, { target: boss.id });
  assert.ok(p.jam > 0);
  p.gcd = 0; press(S, 0, { target: boss.id });
  assert.ok(S.events.some((e) => e.type === 'error' && /jammed/i.test(e.text)));
});

test('Challenge taunts one target, not the room', () => {
  const { S, p, boss } = arena('tank', { weapon: 'flak' });
  p.x = boss.x; p.z = boss.z - 5;
  const drone = { id: 999, kind: 'enemy', type: 'drone', x: p.x + 3, z: p.z, radius: 1, hp: 100, maxHp: 100, alive: true, threat: {}, target: null };
  S.ents.push(drone);
  press(S, 3, { target: boss.id });
  assert.ok(boss.fixate && boss.fixate.id === p.id);
  assert.ok(!drone.fixate);
});

test('the Foreman winds up a Crusher on his target, and a one-button tank loses', () => {
  const S = Sim.create({ seed: 4 }); S.countdown = 0;
  let seen = false;
  for (let i = 0; i < 30 * 40 && !seen; i++) { Sim.step(S, 1 / 30, {}); const b = Sim.ent(S, S.bossId); if (b.cast && b.cast.name === 'Crusher') seen = true; S.events.length = 0; }
  assert.ok(seen);
  const lazy = summarise(seeds(10, 11).map((seed) => runFight({ role: 'tank', seed, lazy: true })));
  const good = summarise(seeds(10, 11).map((seed) => runFight({ role: 'tank', seed })));
  assert.ok(lazy.winRate + 30 <= good.winRate, `lazy ${lazy.winRate} vs good ${good.winRate}`);
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
  const a = arena('dps', { weapon: 'rockets' });
  a.p.ult = 100;
  a.S.missile = { x: 0, z: 0, x0: 0, z0: 0, tgt: Sim.players(a.S)[1].id, t: 2, dur: 7 };
  a.S.hero = { role: 'dps', t: 0 };
  press(a.S, 5);
  assert.strictEqual(a.S.missile, null);
  assert.strictEqual(a.S.m.heroes.dps[1], 1);
  const b = arena('healer', { weapon: 'bio' });
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

test('ultimates are free-use against the Foreman: no hero calls, and bots still use them', () => {
  const r = runFight({ seed: 5 });
  assert.ok(Object.values(r.heroes).every(([called]) => called === 0));
  assert.ok(r.players.filter((p) => p.ults >= 1).length >= 3, JSON.stringify(r.players.map((p) => [p.role, p.ults])));
});

test('Wrecking Slam staggers its target at any time', () => {
  const { S, p, boss } = arena('melee');
  p.ult = 100; p.x = boss.x; p.z = boss.z - 5;
  press(S, 5, { target: boss.id });
  assert.ok(boss.stagger > 2);
});

test('scripted hero moments still work when a boss switches them on', () => {
  Sim.TUNE.heroMoments = true;
  try {
    const hp = Sim.TUNE.bossHp; Sim.TUNE.bossHp = hp * 1.6;   // long enough for the rotation to come round
    const called = { tank: 0, healer: 0, dps: 0, melee: 0 };
    try { for (const seed of [5, 6, 7]) { const r = runFight({ seed }); for (const k in called) called[k] += r.heroes[k][0]; } } finally { Sim.TUNE.bossHp = hp; }
    for (const role of Object.keys(called)) assert.ok(called[role] >= 1, role + ' was never called');
  } finally { Sim.TUNE.heroMoments = false; }
});

test('weapon signatures: Trick Shot every third tap, Steady Aim crit, Chainsaw bleed', () => {
  const a = arena('melee', { weapon: 'enforcers' });
  a.p.x = a.boss.x; a.p.z = a.boss.z - 8;
  for (let n = 0; n < 3; n++) { a.p.gcd = 0; press(a.S, 0, { target: a.boss.id }); }
  const taps = a.S.events.filter((e) => e.type === 'dmg' && /Tap|Trick/.test(e.label));
  assert.ok(taps[2].label === 'Trick Shot!' && taps[2].crit === 1);

  const c = arena('melee', { weapon: 'chainsaw' });
  c.p.x = c.boss.x; c.p.z = c.boss.z - 5; c.p.pips = 5;
  press(c.S, 1, { target: c.boss.id });
  assert.ok(c.boss.bleed > 8);

});

test('no two abilities share an id across classes (Adrenaline is shared on purpose)', () => {
  const seen = {};
  for (const r of Object.keys(Sim.KITS)) {
    const k = Sim.KITS[r];
    k.weapons.forEach((w) => w.abilities.forEach((a) => { (seen[a.id] = seen[a.id] || []).push(r + '/' + w.id); }));
    k.utils.concat([k.ult]).forEach((a) => { (seen[a.id] = seen[a.id] || []).push(r); });
  }
  const dups = Object.entries(seen).filter(([id, at]) => at.length > 1 && id !== 'adren');
  assert.deepStrictEqual(dups, []);
});

test('the Hammer has seven buttons, one per key, and talents never add one, they change them', () => {
  const kit = (gear) => Sim.abilitiesOf(arena('tank', Object.assign({ weapon: 'hammer' }, gear)).p);
  assert.deepStrictEqual(kit({}).map((a) => a.id), ['combo', 'ebarrier', 'shove', 'challenge', 'piston', 'belt', 'aegis']);
  assert.deepStrictEqual(kit({}).map((a) => a.key), ['LMB', 'RMB', 'L+R', 'Q', 'E', 'F', 'R']);
  for (const slot of Sim.SLOTS) for (const t of Sim.talentList(slot, 'tank')) assert.strictEqual(kit({ [slot]: t.id }).length, 7, t.name);
});

test('Shield talents: Hardened has more health, Spiked hits back, Firing Line powers up whoever is behind it', () => {
  const up = (gear) => {
    const a = arena('tank', Object.assign({ weapon: 'hammer' }, gear));
    a.p.x = a.boss.x; a.p.z = a.boss.z - 8;
    Sim.step(a.S, 1 / 30, { aim: Math.atan2(a.boss.x - a.p.x, a.boss.z - a.p.z), hold: [false, true] });
    return a;
  };
  assert.strictEqual(Sim.barrierMax(up({ rig: 'hardened' }).p), 2500);
  const sp = up({ rig: 'spikes' }); sp.S.events.length = 0;
  Sim.damagePlayer(sp.S, sp.S.bossId, sp.p, 500, 'Crusher');
  assert.ok(sp.S.events.some((e) => e.type === 'dmg' && e.label === 'Spiked Barrier'));
  const hit = (a) => {
    const dps = Sim.players(a.S).find((q) => q.role === 'dps'); dps.x = a.p.x; dps.z = a.p.z - 4;
    a.S.rng = () => 0.5; a.boss.oshield = null;
    return Sim.damageEnemy(a.S, dps, a.boss, 1000, 1, 'Test');
  };
  const fl = hit(up({ rig: 'firingline' })), plain = hit(up({ rig: 'spikes' }));
  assert.ok(fl > plain * 1.1, fl + ' vs ' + plain);
});

test('Shove talents: Piledriver hits harder, Capacitor Bank fills faster, Breathing Room shields the squad', () => {
  const go = (gear, pips) => {
    const a = arena('tank', Object.assign({ weapon: 'hammer' }, gear));
    a.p.x = a.boss.x; a.p.z = a.boss.z - 6; a.p.pips = pips; a.S.rng = () => 0.5; a.S.events.length = 0;
    Sim.players(a.S).forEach((q) => { q.armor = 0; if (q !== a.p) { q.x = a.p.x + 2; q.z = a.p.z - 2; } });
    press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'shove'), { aim: Math.atan2(a.boss.x - a.p.x, a.boss.z - a.p.z) });
    return a;
  };
  const dmg = (a) => a.S.events.filter((e) => e.type === 'dmg' && e.dst === a.boss.id).reduce((n, e) => n + e.amt, 0);
  assert.ok(dmg(go({ implant: 'piledriver' }, 100)) > dmg(go({ implant: 'breathing' }, 100)) * 1.3);
  const br = go({ implant: 'breathing' }, 100);
  assert.ok(Sim.players(br.S).filter((q) => q.armor >= 150).length >= 3, 'squad shielded');
  const cap = arena('tank', { weapon: 'hammer', implant: 'capacitor' });
  cap.p.x = cap.boss.x; cap.p.z = cap.boss.z - 6; cap.p.pips = 0;
  press(cap.S, 0, { aim: Math.atan2(cap.boss.x - cap.p.x, cap.boss.z - cap.p.z) });
  assert.ok(Math.abs(cap.p.pips - 9) < 0.01, String(cap.p.pips));
});

test('Challenge talents: Brand marks it, Daze stuns a drone and softens the boss, Protector shields its victim', () => {
  const chal = (gear, setup) => {
    const a = arena('tank', Object.assign({ weapon: 'hammer' }, gear));
    a.p.x = a.boss.x; a.p.z = a.boss.z - 10;
    const d = { id: 980, kind: 'enemy', type: 'drone', x: a.p.x, z: a.p.z - 5, radius: 1, hp: 1600, maxHp: 1600, alive: true, threat: {}, target: null };
    a.S.ents.push(d); if (setup) setup(a, d);
    press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'challenge'), { aim: Math.PI });
    return Object.assign(a, { d });
  };
  const br = chal({ util: 'brand' });
  assert.ok(br.d.fixate && br.d.fixate.id === br.p.id && br.d.branded > 0);
  const dz = chal({ util: 'daze' });
  assert.ok(dz.d.stagger >= 1.9);
  let ally;
  chal({ util: 'protector' }, (a, d) => { ally = Sim.players(a.S).find((q) => q.role === 'healer'); ally.armor = 0; d.target = ally.id; });
  assert.ok(ally.armor >= 250, String(ally.armor));
  const bz = arena('tank', { weapon: 'hammer', util: 'daze' });
  bz.p.x = bz.boss.x; bz.p.z = bz.boss.z - 10;
  press(bz.S, Sim.abilitiesOf(bz.p).findIndex((ab) => ab.id === 'challenge'), { aim: 0 });
  assert.ok(bz.boss.weak > 0 && !(bz.boss.stagger > 0), 'the Foreman softens, never stuns');
});

test('nothing keeps a dead player as its target, and a Crusher on someone who drops is called off', () => {
  const { S, p, boss } = arena('dps');
  const tank = Sim.players(S).find((q) => q.role === 'tank');
  boss.target = tank.id; boss.stagger = 3;
  boss.cast = { name: 'Crusher', t: 0, dur: 2.5, target: tank.id, done() {} };
  tank.hp = 1; Sim.damagePlayer(S, S.bossId, tank, 5000, 'Hit');
  Sim.step(S, 1 / 30, {});
  const t = Sim.ent(S, boss.target);
  assert.ok(t && t.alive, 'retargets even while staggered');
  assert.ok(!boss.cast, 'the Crusher on a body is called off');
});

test('the death log keeps the last five hits, how big they were, and what kind of hit each was', () => {
  const { S, p } = arena('dps');
  p.armor = 0;
  ['Hit', 'Crusher', 'Leap', 'Sludge', 'Overcharge Pulse'].forEach((l) => Sim.damagePlayer(S, S.bossId, p, 100, l));
  p.hp = 50; Sim.damagePlayer(S, S.bossId, p, 300, 'Charge');
  assert.ok(!p.alive);
  const log = p.lastDeath.log;
  assert.strictEqual(log.length, 5);
  assert.deepStrictEqual(log.map((h) => h[0]), ['Crusher', 'Leap', 'Sludge', 'Overcharge Pulse', 'Charge']);
  assert.deepStrictEqual(log.map((h) => h[2]), ['buster', 'avoid', 'debuff', 'aoe', 'avoid']);
  const snap = Sim.snapshot ? Sim.snapshot(S) : null;
  if (snap) assert.ok(JSON.stringify(snap).includes('Charge'));
});

test('phase three: the floor falls for good, and a drone shoved onto it goes down the shaft', () => {
  const { S, p, boss } = arena('tank', { weapon: 'hammer' });
  S.phase = 3; boss.hp = boss.maxHp * 0.2; S.timers.collapse = 0;
  for (let i = 0; i < 30 * 70; i++) { Sim.step(S, 1 / 30, {}); boss.hp = boss.maxHp * 0.2; Sim.players(S).forEach((q) => { q.hp = q.maxHp; q.alive = true; }); }
  const down = S.telegraphs.filter((g) => g.shape === 'sector' && g.down);
  assert.ok(down.length === Sim.TUNE.collapseMax, String(down.length));
  const g = down[0], mid = (g.a0 + g.a1) / 2;
  boss.x = 0; boss.z = 0; S.telegraphs = S.telegraphs.filter((x) => x === g);
  p.x = Math.sin(mid) * 4; p.z = Math.cos(mid) * 4; p.pips = 100; p.alive = true;
  const d = { id: 970, kind: 'enemy', type: 'drone', name: 'SECURITY DRONE', x: Math.sin(mid) * 7.5, z: Math.cos(mid) * 7.5, facing: 0, speed: 6, radius: 1, hp: 1600, maxHp: 1600, alive: true, threat: {}, target: null, fixate: null, swing: 1, melee: 90, swingInt: 1.5, cast: null };
  S.ents.push(d); S.events.length = 0;
  Sim.step(S, 1 / 30, { aim: mid, ability: Sim.abilitiesOf(p).findIndex((ab) => ab.id === 'shove') });
  assert.ok(!d.alive, 'down the shaft');
  assert.ok(S.events.some((e) => e.type === 'dmg' && e.label === 'Down the Shaft!'));
});

/* The aimed Link Gun: a Medic in a clear space, everyone else frozen so the test is about the gun. */
function medic() {
  const a = arena('healer', { weapon: 'link', rig: 'chainlink' });
  Sim.players(a.S).forEach((q) => { if (q !== a.p) { q.human = true; q.auto = false; } q.armor = 0; });
  a.p.x = 0; a.p.z = 0; a.boss.x = 0; a.boss.z = 25;
  const tank = Sim.players(a.S).find((q) => q.role === 'tank'), dps = Sim.players(a.S).find((q) => q.role === 'dps');
  return Object.assign(a, { tank, dps });
}
const toward = (p, t) => Math.atan2(t.x - p.x, t.z - p.z);

test('Link Gun: the bolt snaps to what is nearest the crosshair, heals the hurt, skips the full, hits enemies for Nanites', () => {
  const a = medic();
  a.tank.x = 3; a.tank.z = 10; a.tank.hp = 800;
  a.S.events.length = 0; a.p.pips = 50;
  press(a.S, 0, { aim: toward(a.p, a.tank) + 0.3 });   // well off, still snaps
  assert.ok(a.S.events.some((e) => e.type === 'heal' && e.dst === a.tank.id && e.label === 'Link Bolt'));
  a.tank.hp = a.tank.maxHp; a.p.gcd = 0; a.S.events.length = 0;
  press(a.S, 0, { aim: toward(a.p, a.boss) });
  assert.ok(a.S.events.some((e) => e.type === 'dmg' && e.dst === a.boss.id && e.label === 'Link Bolt'), 'a full-health ally in the way is skipped');
  assert.ok(a.p.pips >= 56, 'harvested Nanites: ' + a.p.pips);
});

test('Link Gun: the beam latches, heals and drains, and snaps when they get too far away', () => {
  const a = medic();
  a.tank.x = 0; a.tank.z = 10; a.tank.hp = 400; a.p.pips = 100;
  const face = toward(a.p, a.tank);
  for (let i = 0; i < 30; i++) Sim.step(a.S, 1 / 30, { aim: face + 0.4, hold: [false, true] });
  assert.strictEqual(a.p.beamTo, a.tank.id, 'latched from a loose aim');
  assert.ok(a.tank.hp > 500 && a.p.pips < 99, a.tank.hp + ' / ' + a.p.pips);
  a.tank.z = 40; Sim.step(a.S, 1 / 30, { aim: face, hold: [false, true] });
  assert.ok(!a.p.beamTo, 'snapped at range');
});

test('Link Gun: Nanite Burst heals everyone close to you, Nano Field heals whoever stands in it, Purge falls back to you', () => {
  const a = medic();
  a.tank.x = 3; a.tank.z = 3; a.tank.hp = 500; a.dps.x = 30; a.dps.z = 0; a.dps.hp = 300; a.p.hp = 400; a.p.pips = 60;
  Sim.step(a.S, 1 / 30, { aim: 0, hold: [true, true] });
  assert.ok(a.tank.hp >= 700 && a.p.hp >= 600 && a.dps.hp === 300, [a.tank.hp, a.p.hp, a.dps.hp].join(','));
  assert.ok(Math.abs(a.p.pips - 25) < 1);
  a.p.pips = 60; a.tank.hp = 500; a.p.gcd = 0;
  press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'field'), { aim: toward(a.p, a.tank) + 0.2, ad: 5 });   // a bit off: it settles on them
  assert.strictEqual(a.S.fields.length, 1);
  idle(a.S, 2);
  assert.ok(a.tank.hp >= 540, String(a.tank.hp));
  a.p.sludge = 5; a.p.gcd = 0;
  Sim.players(a.S).forEach((q) => { if (q !== a.p) { q.x = 0; q.z = 20; } });
  press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'purge'), { aim: Math.PI });
  assert.ok(!(a.p.sludge > 0), 'nobody under the crosshair: purged yourself');
});

test('Link Gun: Link Storm beams the whole squad in reach', () => {
  const a = medic();
  a.tank.x = 5; a.tank.z = 5; a.tank.hp = 500; a.dps.x = 40; a.dps.z = 0; a.dps.hp = 300; a.p.ult = 100;
  press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.role === 'ult'));
  idle(a.S, 2);
  assert.ok(a.tank.hp >= 700 && a.dps.hp === 300, a.tank.hp + ',' + a.dps.hp);
});

test('Nano Field is a grenade: thrown as far as you aim, in the air for a moment, then heals', () => {
  const a = medic();
  a.p.pips = 60; a.tank.x = 0; a.tank.z = 30; a.tank.hp = 500;
  press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'field'), { aim: 0, ad: 18 });
  const f = a.S.fields[0];
  assert.ok(Math.abs(f.z - 18) < 0.5 && Math.abs(f.x) < 0.5, f.x + ',' + f.z);
  const dps = a.dps; dps.x = 0; dps.z = 18; dps.hp = 300;
  Sim.step(a.S, 1 / 30, {});
  assert.strictEqual(dps.hp, 300, 'still in the air');
  idle(a.S, 1.5);
  assert.ok(dps.hp > 300);
});

test('Medevac, aimed: leaps to the ally you point at, not the most hurt', () => {
  const a = medic();
  a.p.gear.boots = 'medevac';
  a.tank.x = 15; a.tank.z = 0; a.tank.hp = a.tank.maxHp - 100;
  a.dps.x = -15; a.dps.z = 0; a.dps.hp = 100;
  Sim.step(a.S, 1 / 30, { aim: Math.PI / 2, jump: true });
  assert.ok(Math.hypot(a.p.x - a.tank.x, a.p.z - a.tank.z) < 3, a.p.x + ',' + a.p.z);
});

test('Medic beam talents: Siphon Link bites an enemy (and still costs Nanites), Long Link reaches 40m, Chain Link jumps on', () => {
  const beam = (rig, setup) => {
    const a = medic(); a.p.gear.rig = rig; a.p.pips = 50;
    a.tank.x = 0; a.tank.z = 10; a.tank.hp = 400;
    if (setup) setup(a);
    a.S.events.length = 0;
    for (let i = 0; i < 45; i++) Sim.step(a.S, 1 / 30, { aim: toward(a.p, a.tank), hold: [false, true] });
    return a;
  };
  const si = beam('siphon', (a) => { a.boss.x = 0; a.boss.z = 16; });
  assert.ok(si.S.events.some((e) => e.type === 'dmg' && e.label === 'Siphon'));
  assert.ok(si.p.pips < 50, 'still drains: ' + si.p.pips);
  const ll = beam('longlink', (a) => { a.tank.z = 35; });
  assert.strictEqual(ll.p.beamTo, ll.tank.id);
  const cl = beam('chainlink', (a) => { a.dps.x = 3; a.dps.z = 12; a.dps.hp = 300; });
  assert.ok(cl.S.events.some((e) => e.type === 'heal' && e.dst === cl.dps.id && e.label === 'Chain Link'));
});

test('Medic burst and field talents: Shock Burst hits, Burst Shield shields, Recycler refunds; Caustic burns, Lingering lasts, Purging cleanses', () => {
  const burst = (implant) => {
    const a = medic(); a.p.gear.implant = implant; a.p.pips = 60;
    a.tank.x = 3; a.tank.z = 3; a.tank.hp = 500; a.boss.x = 0; a.boss.z = 9;
    a.S.events.length = 0; a.S.rng = () => 0.5;
    Sim.step(a.S, 1 / 30, { aim: 0, hold: [true, true] });
    return a;
  };
  assert.ok(burst('shockburst').S.events.some((e) => e.type === 'dmg' && e.label === 'Shock Burst'));
  assert.ok(burst('burstshield').tank.armor >= 200);
  assert.ok(burst('recycler').p.pips >= 60 - 35 + 8);
  const field = (util) => {
    const a = medic(); a.p.gear.util = util; a.p.pips = 60;
    a.tank.x = 0; a.tank.z = 6; a.tank.sludge = 8; a.boss.x = 0; a.boss.z = 9;
    press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'field'), { aim: 0, ad: 6 });
    a.S.events.length = 0; idle(a.S, 1.5);
    return a;
  };
  assert.ok(field('caustic').S.events.some((e) => e.type === 'dmg' && e.label === 'Caustic Field'));
  assert.ok(field('lingering').S.fields[0].t > 8);
  const pf = field('purgefield');
  assert.ok(!(pf.tank.sludge > 0));
  assert.ok(pf.p.cds.field > 13, 'Purging Field costs cooldown: ' + pf.p.cds.field);
});

test('Purge is smart: a sludged ally roughly in front first, then yourself, without aiming away', () => {
  const a = medic(); a.p.gear.util = 'caustic';
  a.tank.x = 6; a.tank.z = 10; a.tank.sludge = 8; a.dps.x = 0; a.dps.z = 12; a.p.sludge = 8;
  const i = Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'purge');
  press(a.S, i, { aim: 0 });   // pointing at the clean dps
  assert.ok(!(a.tank.sludge > 0), 'the sludged ally in front got it');
  a.p.cds.purge = 0; a.p.gcd = 0;
  press(a.S, i, { aim: 0 });   // still pointing at the dps, nobody else sludged
  assert.ok(!(a.p.sludge > 0), 'then yourself, no aiming away needed');
});

/* The aimed Shock Rifle: a Striker with everyone else frozen, the Foreman 20m ahead facing away (an open coolant port facing us). */
function striker() {
  const a = arena('dps', { weapon: 'shock' });
  Sim.players(a.S).forEach((q) => { if (q !== a.p) { q.human = true; q.auto = false; q.x = 30; q.z = -20; } });
  a.p.x = 0; a.p.z = 0; a.boss.x = 0; a.boss.z = 20; a.boss.facing = 0; a.boss.speed = 0; a.p.pips = 100;
  a.S.rng = () => 0.5;
  return a;
}
const drone = (id, x, z) => ({ id, kind: 'enemy', type: 'drone', name: 'SECURITY DRONE', x, z, facing: 0, speed: 0, radius: 1, hp: 1600, maxHp: 1600, alive: true, threat: {}, target: null, fixate: null, swing: 9, melee: 0, swingInt: 9, cast: null });

const hold = (a, h, aim, n) => { for (let i = 0; i < (n || 1); i++) Sim.step(a.S, 1 / 30, { aim: aim || 0, hold: h }); };

test('Shock Beam: snaps onto the enemy near the crosshair, but a coolant port needs real aim, doubles and fills the Capacitor', () => {
  const a = striker(); a.p.pips = 0;
  hold(a, [true, false], 0);   // straight at the open port on his back
  const port = a.S.events.find((e) => e.type === 'dmg' && e.src === a.p.id);
  assert.ok(port && port.label === 'Weak Point!' && port.vent === 1, JSON.stringify(port));
  assert.ok(a.p.pips >= Sim.TUNE.sbeamCap + Sim.TUNE.portCap, 'the port fills the Capacitor');
  const b = striker(); hold(b, [true, false], 0.12);   // still on him (the snap), but off the port
  const body = b.S.events.find((e) => e.type === 'dmg' && e.src === b.p.id);
  assert.ok(body && body.label === 'Shock Beam' && port.amt > body.amt * 1.8, port.amt + ' vs ' + (body && body.amt));
  const c = striker(); hold(c, [true, false], 0.6);
  assert.ok(!c.S.events.some((e) => e.type === 'dmg' && e.src === c.p.id), 'too far off: no snap');
  const d = striker(); d.S.t = 3;   // between ports: nothing open
  hold(d, [true, false], 0);
  assert.strictEqual(d.S.events.find((e) => e.type === 'dmg' && e.src === d.p.id).label, 'Shock Beam');
});

test('Shock Core: right click fires a slow core on a 4s timer, the beam detonates it, and the combo Charges what it catches', () => {
  const a = striker();
  hold(a, [false, true]); hold(a, [false, false], 0, 4);
  assert.strictEqual(a.S.cores.length, 1, 'a core is in the air');
  assert.ok(a.p.cds.score > 3.5, 'on its timer');
  hold(a, [false, true]); hold(a, [false, false], 0, 4);
  assert.strictEqual(a.S.cores.length, 1, 'no spamming it');
  hold(a, [false, false], 0, 26);   // let it fly about 12m
  a.S.events.length = 0; hold(a, [true, false]);
  const combo = a.S.events.find((e) => e.type === 'dmg' && e.label === 'Shock Combo!' && e.dst === a.boss.id);
  assert.ok(combo && combo.amt > Sim.TUNE.comboDmg * 1.25, 'flown far, hits harder: ' + (combo && combo.amt));
  assert.strictEqual(a.S.cores.length, 0); assert.ok(a.boss.charged > 0, 'Charged');
  a.p.gcd = 0; a.S.events.length = 0; hold(a, [false, false], 0.12); hold(a, [true, false], 0.12);
  const beam = a.S.events.find((e) => e.type === 'dmg' && e.label === 'Shock Beam');
  assert.ok(beam.amt >= Sim.TUNE.sbeamDmg * 1.35, 'beams on a Charged target hit harder: ' + beam.amt);
  const b = striker();   // left alone, it fizzles on the first enemy it touches
  hold(b, [false, true]); hold(b, [false, false], 0, 60);
  assert.ok(b.S.events.some((e) => e.type === 'dmg' && e.label === 'Shock Core' && e.dst === b.boss.id) && b.S.cores.length === 0);
});

test('Shock Combo on two or more enemies readies the core again; both buttons together is the Overcharged Core', () => {
  const a = striker();
  a.S.ents.push(drone(961, 1, 9), drone(962, -1.5, 10));
  hold(a, [false, true]); hold(a, [false, false], 0, 18);
  a.S.events.length = 0; hold(a, [true, false]);
  const hit = new Set(a.S.events.filter((e) => e.type === 'dmg' && e.label === 'Shock Combo!').map((e) => e.dst));
  assert.ok(hit.has(961) && hit.has(962), [...hit].join(','));
  assert.strictEqual(a.p.cds.score, 0, 'multi-combo: core ready again');
  const b = striker(); b.p.pips = 80;
  hold(b, [true, true]); hold(b, [false, false]);
  assert.ok(b.S.cores.length === 1 && b.S.cores[0].big === 1 && b.S.cores[0].spent === 80, 'an Overcharged Core with all 80');
  assert.ok(b.p.pips === 0 && b.p.cds.score > 3.5, 'spends it all, shares the timer');
  const c = striker(); c.p.pips = 80;   // beaming, then tapping right: a normal core, not the chord
  hold(c, [true, false], 0.6, 10); hold(c, [true, true], 0.6, 6);
  assert.ok(c.S.cores.length === 1 && !c.S.cores[0].big && c.p.pips >= 80, 'a normal core');
  const d = striker(); d.p.pips = 30;
  hold(d, [true, true]);
  assert.ok(!d.S.cores.length, 'needs 50');
});

test('Overcharge pulses ramp up the longer the shield holds', () => {
  const a = striker();
  const med = Sim.players(a.S).find((q) => q.role === 'healer');
  a.boss.oshield = { hp: 99999, max: 99999, t: 0, dur: 14 }; a.S.timers.pulse = Sim.TUNE.pulseEvery;
  const hits = [];
  for (let i = 0; i < 30 * 8; i++) { Sim.step(a.S, 1 / 30, {}); a.S.events.forEach((e) => { if (e.type === 'dmg' && e.dst === med.id && e.label === 'Overcharge Pulse') hits.push(e.amt); }); a.S.events.length = 0; med.hp = med.maxHp; }
  assert.ok(hits.length >= 3 && hits[0] <= 35 && hits[1] > hits[0] * 2 && hits[2] > hits[1] * 1.5, hits.join(','));
});

test('Space jumps the Ground Pound shockwave; Shift is still the movement ability', () => {
  const run2 = (jumpAt) => {
    const a = striker();   // the wave reaches us about 1.45s after it starts
    a.S.waves.push({ id: 990, x: 0, z: 20, r: 3.5, hit: {} });
    const hp = a.p.hp;
    for (let i = 0; i < 60; i++) Sim.step(a.S, 1 / 30, i === jumpAt ? { hop: true } : {});
    return { hit: a.p.hp < hp, a };
  };
  assert.ok(run2(-1).hit, 'standing still: the wave hits');
  assert.ok(!run2(34).hit, 'jumped as it arrived: it goes under you');
  assert.ok(run2(0).hit, 'jumped far too early: landed before it got there');
  const b = arena('dps', { weapon: 'shock', boots: 'dodge' });
  const x0 = b.p.x; Sim.step(b.S, 1 / 30, { jump: true, aim: Math.PI / 2, mx: 1, mz: 0 });
  assert.ok(b.p.x - x0 > 6, 'Dodge Jump on the movement key');
});

test('EMP Grenade: thrown where you aim, stuns drones and hits an overcharge shield hard', () => {
  const a = striker();
  const d = drone(963, 0, 10); a.S.ents.push(d);
  a.boss.x = 0; a.boss.z = 14; a.boss.oshield = { hp: 5000, max: 10000, t: 0, dur: 14 };
  press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'emp'), { aim: 0, ad: 11 });
  idle(a.S, 0.8);
  assert.ok(d.stagger >= 2, 'drone stunned');
  assert.ok(a.boss.oshield ? a.boss.oshield.hp <= 4400 : true, 'shield took the EMP');
});
