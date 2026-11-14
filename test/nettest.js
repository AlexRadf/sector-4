// Host runs a fight with two humans (one idle, one bot-driven); a mirror replays snapshots through JSON.
const Sim = require('../public/sim.js');
const roster = [{ role: 'tank', name: 'Alex', key: 'pA' }, { role: 'healer', name: 'Katie', key: 'pB', gear: { weapon: 'bio' } }];
const H = Sim.create({ humans: roster, seed: 99 });
H.ents.forEach(p => { if (p.human) p.auto = true; });   // let bots drive both humans for the test
const M = Sim.create({ humans: roster, seed: 99 });
let buf = [], maxSize = 0, n = 0, sends = 0, maxEv = 0, dropped = 0;
while (!H.result && n < 30 * 400) {
  Sim.step(H, 1 / 30, {});
  buf = buf.concat(H.events); H.events.length = 0; n++;
  if (n % 3 === 0 || H.result) {
    const snap = Sim.snapshot(H, buf); const j = JSON.stringify(snap);
    maxSize = Math.max(maxSize, j.length); maxEv = Math.max(maxEv, buf.length); dropped += buf.length - snap.ev.length; buf = [];
    Sim.applySnapshot(M, JSON.parse(j)); M.events.length = 0; sends++;
  }
}
const diff = H.ents.filter(e => e.kind === 'player').map(p => { const q = Sim.ent(M, p.id); return Math.abs(p.x - q.x) + Math.abs(p.hp - q.hp); });
console.log('result', H.result, 'host t', H.t.toFixed(0), 'mirror t', M.t, 'result', M.result);
console.log('snapshots', sends, 'max bytes', maxSize, 'max events per snap', maxEv, 'events dropped', dropped);
console.log('player drift', diff.map(d => d.toFixed(2)).join(','), 'names', Sim.players(M).map(p => p.name + (p.human ? '*' : '')).join(' '));
console.log('mirror usable(tank,1):', JSON.stringify(Sim.usable(M, Sim.ent(M, 1), 0).state));
