/* What one role actually does in a fight: damage on the boss and healing per second, broken down by ability.
   Usage: node scripts/output.js <role> <weapon> [fights, default 8] */
'use strict';
const { Sim } = require('../lib/simrun');
const role = process.argv[2] || 'dps', weapon = process.argv[3], N = +process.argv[4] || 8;
const heal = {}, dmg = {}; let T = 0, wins = 0;
for (let seed = 1; seed <= N; seed++) {
  const S = Sim.create({ humanRole: role, gear: Object.assign({}, Sim.BOT_GEAR[role], weapon ? { weapon } : {}), humanAuto: true, seed });
  S.countdown = 0; const me = S.humanId; let t = 0;
  while (!S.result && t < 480) {
    Sim.step(S, 1 / 30, {}); t += 1 / 30;
    for (const e of S.events) {
      if (e.type === 'heal' && e.src === me) heal[e.label] = (heal[e.label] || 0) + e.amt;
      if (e.type === 'dmg' && e.src === me && e.dst === S.bossId) dmg[e.label] = (dmg[e.label] || 0) + e.amt;
    }
    S.events.length = 0;
  }
  T += t; if (S.result === 'win') wins++;
}
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + Math.round(v / T)).join(', ');
const sum = (o) => Math.round(Object.values(o).reduce((a, b) => a + b, 0) / T);
console.log(`${role} ${weapon || 'default'}: won ${wins}/${N}, ${Math.round(T / N)}s average`);
console.log(`  damage on the boss/s ${sum(dmg)}  (${fmt(dmg)})`);
console.log(`  healing/s ${sum(heal)}  (${fmt(heal)})`);
