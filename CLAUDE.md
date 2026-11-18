# Notes for Claude

Sector-4: Skyscraper Ascent, a co-op raid game for Alex and his wife Katie (plus bots). Browser game: three.js r128
client, a Node relay server, deployed on Render.

## Before any design or gameplay change
- Read `DESIGN.md`: the pillars (everything aimed, read the world not the UI, each role owns a physical job), the
  supporting rules (one defensive per role on F, talents never add buttons, no talent makes a resource free, crowd
  cleanses cost something) and the current order of work.
- Alex wants Claude to lead, set limits and keep scope tight. Build what was agreed, then say what's next.

## Layout
- `public/sim.js`: all game logic, pure and deterministic (no DOM). `step(S, dt, inputs)`. Kits, talents, boss, bots.
- `public/game.js`: rendering, input, HUD, networking. `public/index.html`: markup, CSS, help text.
- `server.js`: static site, squad relay, fight records (`/api/runs`, `/api/stats`), admin spectating.
- `test/*.test.js`: node:test. `lib/simrun.js`: headless fights for tests and sims.

## Shipping a change
1. Bump `VERSION` in `public/sim.js` and `version` in `package.json` together (middle number for new things, last for fixes).
2. Add a `CHANGELOG.md` entry (a test checks it exists for the version).
3. `npm test` (about 3 minutes; it runs many simulated fights).
4. Sims for anything that touches balance:
   - `node scripts/role-sims.js <role> [n]`: baseline and every weapon and talent for a role.
   - `node scripts/output.js <role> <weapon>`: damage and healing per second by ability.
   - `npm run report`: the full balance report.
   The all-bot baseline should sit around 70 to 90% wins.
5. Commit to `main` with the attribution trailer and push. Render deploys every push to `main` automatically;
   GitHub Actions runs the checks (`gh api repos/AlexRadf/sector-4/actions/runs`). No other publishing step.

## Aimed weapons (the direction for every weapon)
- A weapon with `aim: true` uses mouse aim; abilities carry a `key` (LMB, RMB, L+R, Q, E, F, R) and the bar, keyboard
  and controller map by key. Both mouse buttons together is the weapon's chord.
- Soft targeting: `softTarget(S, p, opt)` picks whatever is nearest the crosshair in a cone.
- Held inputs: `hammerHold`, `medicHold` and friends in `applyInput`. Bots set `inp.aim`, `inp.hold`, `inp.ad`.
- Thrown things (`lob: true` on the ability) are held to aim with a preview arc; distance comes from camera pitch (`inp.ad`).
- Converted so far: Impact Hammer (tank), Link Gun (medic), Shock Rifle (striker). Everything else is still tab-target.
