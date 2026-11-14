/* Nightly balance report. Simulates a lot of fights and writes a readable markdown report:
   - the squad baseline (all bots) and how much a slower player in each role hurts it
   - every weapon and talent compared with that role's default loadout
   - if SITE_URL is set, the real-player numbers from the live /api/stats next to the sims
   Anything outside the expected range is marked CHECK. Writes report.md and report.json. */
'use strict';
const fs = require('fs');
const { runFight, seeds, summarise, Sim } = require('../lib/simrun');

const N = Number(process.env.SEEDS) || 100;
const BUILD = (process.env.GITHUB_SHA || 'local').slice(0, 10);
const checks = [];
const out = [];
const line = (s) => out.push(s == null ? '' : s);
const t0 = Date.now();

function batch(opts) { return summarise(seeds(N, opts.offset || 0).map((seed) => runFight(Object.assign({ build: BUILD, seed }, opts)))); }
const fmt = (s) => (s == null ? '-' : Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2));

line(`# Sector-4 balance report`);
line(`Build \`${BUILD}\`, ${N} simulated fights per row. Seats marked "player" are driven by the bot brain; "slower" means it reacts and acts 2.2 times slower, standing in for a less practised person.`);
line();

const base = batch({});
line(`## Squad baseline`);
line(`| Squad | Win rate | Average clear |`);
line(`|---|---:|---:|`);
const baseFlag = base.winRate < 60 || base.winRate > 95;
if (baseFlag) checks.push(`All-bot win rate is ${base.winRate}% (expected 60 to 95%).`);
line(`| Four bots | ${base.winRate}%${baseFlag ? ' **CHECK**' : ''} | ${fmt(base.avgWinSecs)} |`);
const report = { build: BUILD, seeds: N, baseline: base, roles: {}, items: [] };
for (const role of Object.keys(Sim.KITS)) {
  const slow = batch({ role, slow: 2.2, offset: 3 });
  report.roles[role] = slow;
  const drop = Math.round((base.winRate - slow.winRate) * 10) / 10;
  line(`| Slower ${Sim.KITS[role].title} | ${slow.winRate}% | ${fmt(slow.avgWinSecs)} |`);
  if (drop < 0) checks.push(`A slower ${Sim.KITS[role].title} doesn't lower the win rate at all: that role may not matter enough.`);
}
line();

line(`## Weapons and talents`);
// A gap only counts when it is bigger than chance would produce at this many fights (about 2.5 standard errors).
const noise = (a, b) => 100 * 2.5 * Math.sqrt(((a / 100) * (1 - a / 100) + (b / 100) * (1 - b / 100)) / N);
line(`Each row swaps one pick into the role's default loadout. Gap is the win rate compared with that default. A gap gets a CHECK when it is at least 10 points and bigger than chance would explain at ${N} fights a row (roughly ±${Math.round(noise(80, 80))} points here). Run more fights from the Actions tab to sharpen it.`);
line();
line(`| Role | Slot | Pick | Win rate | Gap | Average clear |`);
line(`|---|---|---|---:|---:|---:|`);
for (const role of Object.keys(Sim.KITS)) {
  const def = Sim.BOT_GEAR[role];
  const ref = batch({ role, gear: def, offset: 11 });
  const items = [];
  Sim.KITS[role].weapons.forEach((w) => items.push(['weapon', w.id, w.name]));
  Sim.SLOTS.forEach((slot) => Sim.talentList(slot, role).forEach((g) => items.push([slot, g.id, g.name])));
  for (const [slot, id, name] of items) {
    const isDefault = def[slot] === id;
    const s = isDefault ? ref : batch({ role, gear: Object.assign({}, def, { [slot]: id }), offset: 11 });
    const gap = Math.round((s.winRate - ref.winRate) * 10) / 10;
    const flag = !isDefault && Math.abs(gap) >= 10 && Math.abs(gap) > noise(s.winRate, ref.winRate);
    if (flag) checks.push(`${Sim.KITS[role].title} ${slot} "${name}": ${s.winRate}% against ${ref.winRate}% for the default.`);
    report.items.push({ role, slot, id, name, default: isDefault, ...s, gap });
    line(`| ${Sim.KITS[role].title} | ${slot} | ${name}${isDefault ? ' (default)' : ''} | ${s.winRate}% | ${isDefault ? '-' : (gap > 0 ? '+' : '') + gap}${flag ? ' **CHECK**' : ''} | ${fmt(s.avgWinSecs)} |`);
  }
}
line();

async function realPlayers() {
  const site = (process.env.SITE_URL || '').replace(/\/+$/, '');
  if (!site) { line(`## Real players`); line(`Set the repository variable SITE_URL to your live site to include real fights here.`); return; }
  try {
    const res = await fetch(site + '/api/stats');
    const d = await res.json();
    report.live = d;
    line(`## Real players (${site})`);
    line(`${d.finished} finished fights, ${d.winRate == null ? '-' : d.winRate + '%'} won, average clear ${fmt(d.avgWinSecs)}. Rows under 10 fights are too thin to judge.`);
    line();
    line(`| Role | Fights | Win rate | Died in | Interrupts missed |`);
    line(`|---|---:|---:|---:|---:|`);
    d.byRole.forEach((r) => line(`| ${r.title} | ${r.n} | ${r.winRate == null ? '-' : r.winRate + '%'} | ${r.deathRate == null ? '-' : r.deathRate + '%'} | ${r.interruptMiss == null ? '-' : r.interruptMiss + '%'} |`));
    line();
    if (d.killedBy.length) line(`What finishes people off: ${d.killedBy.slice(0, 4).map((k) => `${k.label} ${k.share}%`).join(', ')}.`);
  } catch (e) {
    line(`## Real players`); line(`Couldn't reach ${site}/api/stats (${e.message}). A free Render site may have been asleep.`);
  }
}

realPlayers().then(() => {
  const head = [`**${checks.length ? checks.length + ' thing' + (checks.length > 1 ? 's' : '') + ' to look at' : 'Nothing out of range'}.** Ran in ${Math.round((Date.now() - t0) / 1000)}s.`, ''];
  checks.forEach((c) => head.push(`- ${c}`));
  head.push('');
  const md = [out[0], out[1], '', ...head, ...out.slice(2)].join('\n');
  fs.writeFileSync('report.md', md);
  fs.writeFileSync('report.json', JSON.stringify(Object.assign(report, { checks }), null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(md);
});
