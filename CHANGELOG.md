# Changelog

What changed in each version. The version shows on the briefing screen, in the corner of the HUD,
on /stats and in every fight record. Bump it in `public/sim.js` (VERSION) and `package.json` together:
the middle number for new things, the last number for fixes.

## 0.10.0 (2026-11-16) "The Fight"
- The interrupt is gone. The Foreman raises an overcharge shield instead: break it with damage in 9s and he staggers, miss it and the room is shocked.
- Every weapon is a rotation: 1 builds pips, 2 spends them, 3 lights up on a proc. Hits vary by 15% and can crit.
- The Medic's builders shoot the Foreman and heal or shield allies as they do. Battle Medic and Live Fire talents lean into damage.
- Ultimates on key 6 or R, and hero moments that call on one class at a time: Riot Wall, Counter-Slam, Field Hospital, Deadeye.
- The Foreman leaps around the arena, and below 25% health sections of the floor give way (phase three).
- Interrupt talents replaced with shield-breaking ones; Team Uplink now adds crit chance.

## 0.9.0 (2026-11-15)
- Version number on the briefing, the HUD and /stats, and stored with every fight.
- Admin page at /admin: see live squads and watch any fight invisibly (needs ADMIN_KEY on the server).

## 0.8 (2026-11-14)
- Bots move like people: eight-way key presses, held directions, a little aim error.
- Movement measures for every seat; /stats compares people with bots; `npm run fit` tunes the bots to you.
- Per-class talent trees: each class has its own four tiers, mechanics, callouts and colours.

## 0.7 (2026-11-14)
- Talents rebuilt around three playstyles: Aggressive, Steady, Squad.
- A third weapon per role and a fourth talent tier.

## 0.6 (2026-11-14)
- Fight records, the /stats page, automated tests and a nightly balance report.

## 0.5 (2026-11-14)
- Hosted on Render with a squad relay; updates never interrupt a fight in progress.

## 0.1 to 0.4
- The raid prototype: the Foreman fight, four roles, weapons, the armory, squads and spectating bots.
