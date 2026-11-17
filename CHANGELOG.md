# Changelog

What changed in each version. The version shows on the briefing screen, in the corner of the HUD,
on /stats and in every fight record. Bump it in `public/sim.js` (VERSION) and `package.json` together:
the middle number for new things, the last number for fixes.

## 0.13.0 (2026-11-17) Tank pass
- The Foreman winds up a Crusher (2.5s cast) on the tank every 15s: a telegraphed tank buster you have to mitigate.
- The three Juggernaut weapons now play differently, each with its own resource and key 3 defensive:
  - Flak Cannon: active mitigation. Blasts load Ammo; spend it on Shells (threat, pulls) or a 3s Flak Screen that cuts hits by 60%.
  - Impact Hammer: heal after the fact. Hits store Kinetic; Recoil Strike heals 35% of recent damage; Ground Pound is the AoE and weakens.
  - Minigun: wild card. Heat makes it fire faster; Vent turns heat into a shield (Perfect Vent above 85), and 100 jams the gun.
- Challenge is now a single-target taunt (8s). AoE threat comes from each weapon's area attack.
- A Juggernaut pressing only key 1 now loses most fights (15% in sims).
- The end screen says what took you down, and when.
- Drones hit harder, so the phase two adds can't be ignored.

## 0.12.0 (2026-11-16)
- Every weapon has its own rotation mechanic: Flak airburst, Hammer self-heal, Minigun ramp; Link tether, Bio Bloom scaling,
  Shield refunds; Shock combo, Rocket lock-on, Sniper Steady Aim; Chainsaw bleed, Ripper returning blades, Enforcer Trick Shot.
- Retuned: the Foreman's barrage, leap, overcharge and floor collapse hit harder; the overcharge shield is tougher (7,000).

## 0.11.0 (2026-11-16)
- Ultimates are free-use: big buttons you press when you judge it right, not answers to a scripted call.
  Wrecking Slam staggers any target for 3s; Deadeye is 700 damage, five pips and a lit proc; Riot Wall and Field Hospital as before.
- The Foreman no longer calls class-specific hero moments. The system stays in the code (TUNE.heroMoments) for a future boss.
- /stats shows ultimates used per fight.
- Each class has its own resource: Juggernaut Heat (with a Redline), Medic Nanite Reserve (heals cost it, shooting harvests it),
  Striker Capacitor (recharges itself, pool and dump), Wrecker Revs (combo points).
- The Foreman has more health and hits harder to make up for the free-use ultimates.

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
