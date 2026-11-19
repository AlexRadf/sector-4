/* Quick balance check for one role: the all-bot baseline, then each weapon and talent for that role swapped into
   the bot's default loadout. Usage: node scripts/role-sims.js <tank|healer|dps|melee> [fights per row, default 40]
   Win rates within about +/-15 points of each other at 40 fights are noise. */
'use strict';
const { runFight, seeds, summarise, Sim } = require('../lib/simrun');
const role = process.argv[2] || 'tank', N = +process.argv[3] || 40;
const row = (o) => { const s = summarise(seeds(N, o.offset || 0).map((seed) => runFight(Object.assign({ seed }, o)))); return s.winRate + '%  ' + Math.round(s.avgWinSecs || 0) + 's'; };
const def = Sim.BOT_GEAR[role];
console.log('baseline (all bots)'.padEnd(28), row({}));
for (const w of Sim.KITS[role].weapons) console.log(('weapon ' + w.id).padEnd(28), row({ role, gear: Object.assign({}, def, { weapon: w.id }), offset: 11 }));
for (const slot of Sim.SLOTS) for (const t of Sim.talentList(slot, role)) console.log((slot + ' ' + t.id).padEnd(28), row({ role, gear: Object.assign({}, def, { [slot]: t.id }), offset: 11 }));
