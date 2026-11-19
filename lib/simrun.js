/* Runs simulated fights for the tests and the nightly balance report.
   A "player" seat is driven by the same bot brain the squad bots use; slow > 1 makes it react and act that much slower,
   which stands in for a less practised person. idle leaves the seat doing nothing at all. */
'use strict';
const Sim = require('../public/sim.js');

function runFight(opts) {
  opts = opts || {};
  const role = opts.role || null;
  const S = Sim.create({ humanRole: role, gear: opts.gear, humanAuto: !opts.idle, seed: opts.seed || 1, allWeapons: true });
  if (role && opts.lazy) Sim.ent(S, S.humanId).bot.lazy = true;   // presses only key 1, never taunts or mitigates
  if (role && !opts.idle && opts.slow) {
    const h = Sim.ent(S, S.humanId);
    h.bot.slow = opts.slow; h.bot.intDelay *= opts.slow;
  }
  let steps = 0;
  const limit = 30 * (Sim.TUNE.shiftEnd + 30);
  while (!S.result && steps < limit) { Sim.step(S, 1 / 30, {}); S.events.length = 0; steps++; }
  return Sim.summary(S, { build: opts.build || 'sim', mode: 'sim' });
}

function seeds(n, offset) { const out = []; for (let i = 1; i <= n; i++) out.push(i * 7919 + (offset || 0)); return out; }

function summarise(runs) {
  const wins = runs.filter((r) => r.result === 'win');
  return {
    n: runs.length,
    winRate: Math.round((wins.length / runs.length) * 1000) / 10,
    avgWinSecs: wins.length ? Math.round(wins.reduce((a, r) => a + r.secs, 0) / wins.length) : null,
    unfinished: runs.filter((r) => r.result === 'abandoned').length
  };
}

module.exports = { runFight, seeds, summarise, Sim };
