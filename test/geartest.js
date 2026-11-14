const Sim = require('../public/sim.js');
function run(role, gear, seed) {
  const S = Sim.create({ humanRole: role, humanAuto: true, gear, seed }); let n = 0, dmg = 0, heal = 0;
  const id = S.humanId;
  while (!S.result && n < 30 * 600) { Sim.step(S, 1 / 30, {}); for (const e of S.events) { if (e.src === id && e.type === 'dmg') { const d = Sim.ent(S, e.dst); if (d && d.kind === 'enemy') dmg += e.amt; } if (e.src === id && e.type === 'heal') heal += e.amt; } S.events.length = 0; n++; }
  return { win: S.result === 'win', t: S.t, dmg, heal, alive: Sim.ent(S, id).alive };
}
const N = 20;
for (const role of ['tank', 'healer', 'dps', 'melee']) {
  const base = Sim.BOT_GEAR[role];
  const variants = [['bot default', base]];
  for (const w of Sim.KITS[role].weapons) variants.push(['weapon ' + w.id, { ...base, weapon: w.id }]);
  for (const b of Sim.GEAR.boots) variants.push(['boots ' + b.id, { ...base, boots: b.id }]);
  for (const r of Sim.GEAR.rig) variants.push(['rig ' + r.id, { ...base, rig: r.id }]);
  for (const i of Sim.GEAR.implant[role]) variants.push(['implant ' + i.id, { ...base, implant: i.id }]);
  for (const [label, gear] of variants) {
    const rs = []; for (let s = 1; s <= N; s++) rs.push(run(role, gear, s * 7919));
    const w = rs.filter(r => r.win).length, avg = k => Math.round(rs.reduce((a, r) => a + r[k], 0) / N);
    console.log(role.padEnd(7), label.padEnd(20), `wins ${String(w).padStart(2)}/${N}`, `time ${avg('t')}s`, `dmg ${avg('dmg')}`, `heal ${avg('heal')}`, `survived ${rs.filter(r => r.alive).length}`);
  }
}
