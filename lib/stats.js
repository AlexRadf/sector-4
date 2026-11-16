/* Fight records: checking what browsers send, and turning a pile of records into answers.
   Used by the server (/api/stats), the nightly balance report and the tests, so they all agree. */
'use strict';
const Sim = require('../public/sim.js');

const ROLES = Object.keys(Sim.KITS);
const MODES = ['solo', 'squad', 'watch', 'sim'];
const RESULTS = ['win', 'wipe', 'abandoned'];
const num = (v, max) => { v = Number(v); return Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0; };
const dec = (v, max) => { v = Number(v); return Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v * 100) / 100)) : 0; };
const label = (k) => String(k).replace(/[^\w !'-]/g, '').slice(0, 24);

/* Accepts only the fields we expect, with known ids and sane numbers. Returns null for junk. */
function cleanRun(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.players) || raw.players.length !== 4) return null;
  if (!RESULTS.includes(raw.result) || !MODES.includes(raw.mode)) return null;
  const players = [];
  for (const p of raw.players) {
    if (!p || !ROLES.includes(p.role)) return null;
    const g = Sim.validGear(p.role, p);
    players.push({
      role: p.role, human: p.human ? 1 : 0, weapon: g.weapon, boots: g.boots, rig: g.rig, implant: g.implant, util: g.util,
      dmg: num(p.dmg, 1e6), heal: num(p.heal, 1e6), taken: num(p.taken, 1e6),
      deaths: num(p.deaths, 20), crit: num(p.crit, 100), shieldDmg: num(p.shieldDmg, 1e6), ults: num(p.ults, 50), alive: p.alive ? 1 : 0,
      move: p.move && typeof p.move === 'object' ? { hold: dec(p.move.hold, 30), moving: num(p.move.moving, 100), red: dec(p.move.red, 30), reds: num(p.move.reds, 500) } : null
    });
  }
  const map = (o) => { const r = {}; if (o && typeof o === 'object') Object.keys(o).slice(0, 20).forEach((k) => { r[label(k)] = num(o[k], 1e7); }); return r; };
  return {
    v: 1, version: String(raw.version || '').replace(/[^\w.-]/g, '').slice(0, 16), build: String(raw.build || 'dev').replace(/[^\w.-]/g, '').slice(0, 40) || 'dev', mode: raw.mode, result: raw.result,
    secs: num(raw.secs, 3600), bossPct: num(raw.bossPct, 100), phase: num(raw.phase, 9), enraged: raw.enraged ? 1 : 0,
    players, taken: map(raw.taken), killers: map(raw.killers),
    shields: raw.shields && typeof raw.shields === 'object' ? { raised: num(raw.shields.raised, 99), broken: num(raw.shields.broken, 99) } : null,
    heroes: heroMap(raw.heroes)
  };
}

// Hero moments per class: [times called, times answered].
function heroMap(h) {
  if (!h || typeof h !== 'object') return null;
  const out = {};
  for (const r of ROLES) if (Array.isArray(h[r])) out[r] = [num(h[r][0], 99), Math.min(num(h[r][1], 99), num(h[r][0], 99))];
  return out;
}
const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
function group(list, keyFn) {
  const m = new Map();
  for (const x of list) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

/* runs: cleaned records. Rows for roles and picks only count players a person controlled,
   unless there are none (bot-only or simulated data), in which case every player counts. */
function aggregate(runs) {
  const finished = runs.filter((r) => r.result !== 'abandoned');
  const wins = finished.filter((r) => r.result === 'win');
  const seats = [];
  for (const r of finished) for (const p of r.players) seats.push(Object.assign({ win: r.result === 'win', secs: r.secs, build: r.build }, p));
  const human = seats.filter((s) => s.human);
  const pool = human.length ? human : seats;

  const perSeat = (list) => {
    const n = list.length;
    const avg = (f) => (n ? Math.round(list.reduce((a, s) => a + s[f], 0) / n) : 0);
    return { n, winRate: rate(list.filter((s) => s.win).length, n), dmg: avg('dmg'), heal: avg('heal'), taken: avg('taken'),
      deathRate: rate(list.filter((s) => s.deaths > 0).length, n), crit: n ? Math.round(list.reduce((a, s) => a + (s.crit || 0), 0) / n) : null,
      ults: n ? Math.round(list.reduce((a, s) => a + (s.ults || 0), 0) / n * 10) / 10 : null };
  };
  const byRole = ROLES.map((role) => Object.assign({ role, title: Sim.KITS[role].title }, perSeat(pool.filter((s) => s.role === role))));
  const pickRows = (slot) => {
    const rows = [];
    for (const [k, list] of group(pool, (s) => s.role + '|' + s[slot])) {
      const [role, id] = k.split('|');
      rows.push(Object.assign({ role, title: Sim.KITS[role].title, id, name: Sim.gearName(slot, id, role) }, perSeat(list)));
    }
    return rows.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || b.n - a.n);
  };
  const byBuild = [];
  for (const [build, list] of group(finished, (r) => r.build)) {
    const w = list.filter((r) => r.result === 'win');
    byBuild.push({ build, version: list[list.length - 1].version || '', n: list.length, winRate: rate(w.length, list.length), avgWinSecs: w.length ? Math.round(w.reduce((a, r) => a + r.secs, 0) / w.length) : null });
  }
  const sum = (key) => { const t = {}; for (const r of finished) for (const k in r[key]) t[k] = (t[k] || 0) + r[key][k]; return t; };
  const toShare = (t) => { const total = Object.values(t).reduce((a, b) => a + b, 0); return Object.entries(t).map(([label, v]) => ({ label, value: v, share: rate(v, total) })).sort((a, b) => b.value - a.value); };
  const lost = finished.filter((r) => r.result === 'wipe');
  const withShields = finished.filter((r) => r.shields);
  const raised = withShields.reduce((a, r) => a + r.shields.raised, 0), broken = withShields.reduce((a, r) => a + r.shields.broken, 0);
  const heroes = ROLES.map((role) => {
    let called = 0, done = 0;
    for (const r of finished) if (r.heroes && r.heroes[role]) { called += r.heroes[role][0]; done += r.heroes[role][1]; }
    return { role, title: Sim.KITS[role].title, called, done, rate: rate(done, called) };
  });
  // How people move compared with bots, from the same measures. This is what scripts/fit-hands.js fits the bots to.
  const moveOf = (list) => {
    const m = list.filter((s) => s.move);
    const avg = (f) => (m.length ? Math.round((m.reduce((a, s) => a + s.move[f], 0) / m.length) * 100) / 100 : null);
    return { n: m.length, hold: avg('hold'), moving: avg('moving'), red: avg('red') };
  };
  return {
    runs: runs.length, finished: finished.length, abandoned: runs.length - finished.length,
    wins: wins.length, winRate: rate(wins.length, finished.length),
    avgWinSecs: wins.length ? Math.round(wins.reduce((a, r) => a + r.secs, 0) / wins.length) : null,
    avgBossLeftOnWipe: lost.length ? Math.round(lost.reduce((a, r) => a + r.bossPct, 0) / lost.length) : null,
    reachedPhase2: rate(finished.filter((r) => r.phase >= 2).length, finished.length),
    seatsCounted: human.length ? 'people' : 'everyone',
    byRole, byWeapon: pickRows('weapon'), byBoots: pickRows('boots'), byRig: pickRows('rig'), byImplant: pickRows('implant'), byUtil: pickRows('util'),
    shieldsBroken: rate(broken, raised), heroes,
    movement: { people: moveOf(seats.filter((s) => s.human)), bots: moveOf(seats.filter((s) => !s.human)) },
    byBuild: byBuild.sort((a, b) => b.n - a.n), damageTaken: toShare(sum('taken')), killedBy: toShare(sum('killers'))
  };
}

module.exports = { cleanRun, aggregate };
