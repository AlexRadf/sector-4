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

test('Medevac leaps to the most hurt ally and shields them', () => {
  const { S, p } = solo('healer', { boots: 'medevac' });
  const hurt = Sim.players(S).find((q) => q.role === 'dps');
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

test('Striker Capacitor: recharges by itself, the heavy shot drains 50', () => {
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
  assert.ok(!S.events.some((e) => e.type === 'dmg' && e.dst === boss.id), 'facing away misses');
});

test('Impact Hammer: Kinetic Shockwave hits everything down a lane in front of you', () => {
  const { S, p, boss } = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
  p.x = boss.x; p.z = boss.z - 15; p.pips = 50;
  const drone = { id: 998, kind: 'enemy', type: 'drone', x: p.x, z: p.z + 6, radius: 1, hp: 900, maxHp: 900, alive: true, threat: {}, target: null };
  const aside = { id: 999, kind: 'enemy', type: 'drone', x: p.x + 9, z: p.z + 6, radius: 1, hp: 900, maxHp: 900, alive: true, threat: {}, target: null };
  S.ents.push(drone, aside); S.events.length = 0;
  press(S, 2, { aim: 0 });
  const hit = new Set(S.events.filter((e) => e.type === 'dmg' && e.label === 'Shockwave').map((e) => e.dst));
  assert.ok(hit.has(boss.id) && hit.has(998) && !hit.has(999));
  assert.ok(p.pips <= 10.5);
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

test('Iron Roar pulls nearby enemies onto the Hammer and cuts the damage it takes', () => {
  const { S, p, boss } = arena('tank', { weapon: 'hammer', rig: 'vengeance' });
  p.x = boss.x; p.z = boss.z - 6;
  const drone = { id: 997, kind: 'enemy', type: 'drone', x: p.x + 4, z: p.z, radius: 1, hp: 900, maxHp: 900, alive: true, threat: {}, target: null };
  const far = { id: 996, kind: 'enemy', type: 'drone', x: p.x + 25, z: p.z, radius: 1, hp: 900, maxHp: 900, alive: true, threat: {}, target: null };
  S.ents.push(drone, far);
  press(S, Sim.abilitiesOf(p).findIndex((ab) => ab.id === 'roar'));
  assert.ok(drone.fixate && drone.fixate.id === p.id && !far.fixate);
  assert.ok(p.roared > 0);
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

test('weapon signatures: Trick Shot every third tap, Steady Aim crit, Chainsaw bleed, Link tether', () => {
  const a = arena('melee', { weapon: 'enforcers' });
  a.p.x = a.boss.x; a.p.z = a.boss.z - 8;
  for (let n = 0; n < 3; n++) { a.p.gcd = 0; press(a.S, 0, { target: a.boss.id }); }
  const taps = a.S.events.filter((e) => e.type === 'dmg' && /Tap|Trick/.test(e.label));
  assert.ok(taps[2].label === 'Trick Shot!' && taps[2].crit === 1);

  const c = arena('melee', { weapon: 'chainsaw' });
  c.p.x = c.boss.x; c.p.z = c.boss.z - 5; c.p.pips = 5;
  press(c.S, 1, { target: c.boss.id });
  assert.ok(c.boss.bleed > 8);

  const l = arena('healer', { weapon: 'link' });
  const ally = Sim.players(l.S).find((q) => q.role === 'tank');
  l.p.x = l.boss.x; l.p.z = l.boss.z - 15; ally.hp = 500;
  l.S.events.length = 0;
  press(l.S, 1, { target: ally.id }); idle(l.S, 1.2);
  assert.ok(l.p.tether && l.p.tether.id === ally.id);
  ally.hp = 1000; l.p.gcd = 0; l.S.events.length = 0; press(l.S, 0, { target: l.boss.id });
  assert.ok(l.S.events.some((e) => e.type === 'heal' && e.label === 'Tether'));
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

test('the Hammer has six buttons and talents never add one, they change them', () => {
  const ids = (gear) => Sim.abilitiesOf(arena('tank', Object.assign({ weapon: 'hammer' }, gear)).p).map((a) => a.id);
  assert.deepStrictEqual(ids({}), ['combo', 'ebarrier', 'shockwave', 'roar', 'belt', 'aegis']);
  for (const slot of Sim.SLOTS) for (const t of Sim.talentList(slot, 'tank')) assert.strictEqual(ids({ [slot]: t.id }).length, 6, t.name);
});

test('Enforcement talents change the taunt: Tremor hits, Iron Hide toughens, Hold the Line covers the squad', () => {
  const roarIn = (gear) => {
    const a = arena('tank', Object.assign({ weapon: 'hammer' }, gear));
    a.p.x = a.boss.x; a.p.z = a.boss.z - 6; a.S.events.length = 0;
    press(a.S, Sim.abilitiesOf(a.p).findIndex((ab) => ab.id === 'roar'));
    return a;
  };
  const tr = roarIn({ implant: 'tremor' });
  assert.ok(tr.S.events.some((e) => e.type === 'dmg' && e.label === 'Tremor'));
  const ih = roarIn({ implant: 'ironhide' });
  ih.p.armor = 0; const h = ih.p.hp; Sim.damagePlayer(ih.S, ih.S.bossId, ih.p, 300, 'Rocket');
  assert.ok(h - ih.p.hp <= 200, 'iron hide cuts 35%');
  const hl = roarIn({ implant: 'rally' });
  assert.ok(Sim.players(hl.S).filter((q) => q.rallied > 0).length >= 2);
});

test('Command talents change the barrier: Hardened has more health, Spiked hits back, Wide covers further', () => {
  const up = (gear) => {
    const a = arena('tank', Object.assign({ weapon: 'hammer' }, gear));
    a.p.x = a.boss.x; a.p.z = a.boss.z - 8;
    Sim.step(a.S, 1 / 30, { aim: Math.atan2(a.boss.x - a.p.x, a.boss.z - a.p.z), hold: [false, true] });
    return a;
  };
  assert.strictEqual(Sim.barrierMax(up({ util: 'hardened' }).p), 2500);
  const sp = up({ util: 'spikes' }); sp.S.events.length = 0;
  Sim.damagePlayer(sp.S, sp.S.bossId, sp.p, 500, 'Crusher');
  assert.ok(sp.S.events.some((e) => e.type === 'dmg' && e.label === 'Spiked Barrier'));
  const wide = up({ util: 'wideguard' }), narrow = up({ util: 'spikes' });
  for (const a of [wide, narrow]) { const al = Sim.players(a.S).find((q) => q.role === 'healer'); al.x = a.p.x + 5; al.z = a.p.z - 11; }
  const covered = (a) => !!Sim.barrierFor(a.S, Sim.players(a.S).find((q) => q.role === 'healer'), a.boss);
  assert.ok(covered(wide) && !covered(narrow));
});
