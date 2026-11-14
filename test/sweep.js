const Sim = require('../public/sim.js');
const T = Sim.TUNE, base = { ...T };
function run(role, slow, seed, stats) {
  const S = Sim.create({ humanRole: role, humanAuto: true, seed });
  if (role) { const h = Sim.ent(S, S.humanId); h.bot.slow = slow; h.bot.intDelay *= slow; }
  let n = 0;
  while (!S.result && n < 30 * 600) {
    Sim.step(S, 1 / 30, {});
    if (stats) for (const e of S.events) {
      if (e.type === 'dmg') { const s = Sim.ent(S, e.src); const d = Sim.ent(S, e.dst); if (s && s.kind === 'player' && d && d.kind==='enemy') stats.dmg[s.role] = (stats.dmg[s.role] || 0) + e.amt; if (d && d.kind === 'player') stats.taken[e.label] = (stats.taken[e.label] || 0) + e.amt; }
      if (e.type === 'kicked') stats.swaps++;
      if (e.type === 'pickup') stats.pick[e.kind] = (stats.pick[e.kind] || 0) + 1;
      if (e.type === 'death') { const d = Sim.ent(S, e.id); if (d && d.kind === 'player') stats.deaths[d.role] = (stats.deaths[d.role] || 0) + 1; }
    }
    S.events.length = 0; n++;
  }
  return { win: S.result === 'win', t: S.t, alive: Sim.players(S, true).length };
}
const configs = JSON.parse(process.argv[2] || '[{}]');
for (const c of configs) {
  Object.assign(T, base, c);
  const out = [];
  const stats = { dmg: {}, taken: {}, swaps: 0, pick: {}, deaths: {} };
  for (const [role, slow] of [[null, 1], ['dps', 2.2], ['melee', 2.2], ['tank', 2.2], ['healer', 2.2]]) {
    const rs = []; for (let s = 1; s <= 24; s++) rs.push(run(role, slow, s * 7919, role ? null : stats));
    const w = rs.filter(r => r.win);
    out.push(`${(role || 'bots').padEnd(6)} ${String(w.length).padStart(2)}/24 ${Math.round(w.reduce((a, r) => a + r.t, 0) / (w.length || 1))}s`);
  }
  console.log(JSON.stringify(c), '\n   ', out.join(' | '));
  const per = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v / 24)]));
  console.log('    per bot-run: dmg', JSON.stringify(per(stats.dmg)), 'taken', JSON.stringify(per(stats.taken)), 'swaps', Math.round(stats.swaps / 24), 'pickups', JSON.stringify(stats.pick), 'deaths', JSON.stringify(stats.deaths));
}
