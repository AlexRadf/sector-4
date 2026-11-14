'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runFight, seeds, summarise, Sim } = require('../lib/simrun');

/* Quick check that no weapon or talent is broken. The nightly report runs the same thing with far more fights. */
const N = 10;
for (const role of Object.keys(Sim.KITS)) {
  const items = [];
  Sim.KITS[role].weapons.forEach((w) => items.push(['weapon', w.id, w.name]));
  Sim.GEAR.boots.forEach((g) => items.push(['boots', g.id, g.name]));
  Sim.GEAR.rig.forEach((g) => items.push(['rig', g.id, g.name]));
  Sim.GEAR.implant[role].forEach((g) => items.push(['implant', g.id, g.name]));
  for (const [slot, id, name] of items) {
    test(`${Sim.KITS[role].title} with ${name} can win`, () => {
      const gear = Object.assign({}, Sim.BOT_GEAR[role], { [slot]: id });
      const s = summarise(seeds(N, 11).map((seed) => runFight({ role, gear, seed })));
      assert.ok(s.winRate >= 30, `${name} on the ${role} only wins ${s.winRate}% of ${N}: probably broken`);
    });
  }
}
