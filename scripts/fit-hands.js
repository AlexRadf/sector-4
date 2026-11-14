/* Fits the bots' hands to how people actually move.
   Reads the people row from the live /api/stats (SITE_URL) or a local runs file (RUNS=data/runs.jsonl),
   then tries a grid of hand settings in simulated fights and prints the one whose bots move most like you.
   It only prints: paste the winning values into TUNE.hands in public/sim.js, then run the tests and the report. */
'use strict';
const fs = require('fs');
const { runFight, seeds, Sim } = require('../lib/simrun');
const { aggregate, cleanRun } = require('../lib/stats');

async function target() {
  if (process.env.RUNS) {
    const runs = fs.readFileSync(process.env.RUNS, 'utf8').split('\n').filter(Boolean).map((l) => cleanRun(JSON.parse(l))).filter(Boolean);
    return aggregate(runs).movement.people;
  }
  const site = (process.env.SITE_URL || '').replace(/\/+$/, '');
  if (!site) throw new Error('Set SITE_URL to the live site, or RUNS to a runs.jsonl file.');
  return (await (await fetch(site + '/api/stats')).json()).movement.people;
}

function measure(hands, n) {
  Object.assign(Sim.TUNE.hands, hands);
  const seats = seeds(n, 101).flatMap((seed) => runFight({ seed }).players).filter((p) => p.move);
  const avg = (f) => seats.reduce((a, p) => a + p.move[f], 0) / seats.length;
  return { hold: avg('hold'), moving: avg('moving'), red: avg('red') };
}

(async () => {
  const want = await target();
  const MIN = Number(process.env.MIN_SEATS) || 10;
  if (!want || want.n < MIN) { console.log(`Only ${want ? want.n : 0} person-played seats with movement recorded. Need ${MIN}. Play some more fights first.`); return; }
  console.log(`People (${want.n} seats): hold ${want.hold}s, moving ${want.moving}%, red ${want.red}s`);
  const start = Object.assign({}, Sim.TUNE.hands);
  // Each measure is scaled by its own size so a 0.1s hold gap counts about as much as a 0.1s red gap.
  const score = (m) => Math.abs(m.hold - want.hold) / Math.max(0.1, want.hold) + Math.abs(m.red - want.red) / Math.max(0.1, want.red) + Math.abs(m.moving - want.moving) / Math.max(5, want.moving);
  let best = null;
  for (const holdMax of [0.2, 0.34, 0.5, 0.7]) for (const aim of [0.1, 0.22, 0.4]) for (const release of [0.04, 0.07, 0.15]) {
    const hands = Object.assign({}, start, { holdMin: Math.min(0.12, holdMax / 2), holdMax, aim, release });
    const m = measure(hands, Number(process.env.SEEDS) || 8);
    const s = score(m);
    if (!best || s < best.s) best = { s, hands, m };
  }
  Sim.TUNE.hands = start;
  const r = (v) => Math.round(v * 100) / 100;
  console.log(`Closest bots: hold ${r(best.m.hold)}s, moving ${Math.round(best.m.moving)}%, red ${r(best.m.red)}s`);
  console.log(`Paste into TUNE in public/sim.js:\n    hands: ${JSON.stringify(best.hands).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')},`);
})().catch((e) => { console.error(e.message); process.exit(1); });
