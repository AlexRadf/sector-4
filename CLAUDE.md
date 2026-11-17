# Notes for Claude

- Read `DESIGN.md` before any design or gameplay change. It holds the pillars (everything aimed,
  read the world not the UI, each role owns a physical job) and the current order of work.
- Alex wants Claude to lead, set limits and keep scope tight.
- Every shipped change: bump VERSION in `public/sim.js` and `package.json`, add a `CHANGELOG.md`
  entry, run `npm test` (node:test) and the sims (`npm run report` or a smaller batch).
- `public/sim.js` is pure logic (no DOM); `public/game.js` renders with three.js r128.
