# Changelog

What changed in each version. The version shows on the briefing screen, in the corner of the HUD,
on /stats and in every fight record. Bump it in `public/sim.js` (VERSION) and `package.json` together:
the middle number for new things, the last number for fixes.

## 0.21.0 (2026-11-17) The aimed Medic: Link Gun prototype
- The Link Gun is now an aimed weapon, the first healer built on the design pillars. No tab-targeting, no picking from party frames:
  - **LMB Link Bolt**: fires at whatever is nearest your crosshair, no precision needed. A hurt ally is healed for 70; an enemy takes 50 and gives you 7 Nanites. Allies at full health are skipped, so you can shoot past them.
  - **RMB Link Beam**: hold to latch onto the ally nearest your crosshair. Heals 160 a second for 5 Nanites a second and snaps past 25m.
  - **LMB + RMB Nanite Burst** (35 Nanites): heals everyone within 10m of you, you included, for 260.
  - **Q Nano Field** (25 Nanites, 10s): a 6m healing patch on the ally you're pointing at, or at your feet.
  - **E Purge**: cleanses the ally you're pointing at, or yourself if nobody's there.
  - **F Nanite Cloak**: 40% less damage for 4s.
  - **R Link Storm**: for 6s your beam reaches every ally within 25m, 150 a second each.
- Read the fight from the floor: a ring under your bolt's target (green heals, red hits), beam lines between Medics and their allies,
  Nano Fields glowing on the floor, and a pulsing red ring under anyone below 40% health.
- The Bio Rifle and Shield Gun stay tab-targeted for now, and bot Medics default to the Bio Rifle until the aimed bot is as good.
  Live Fire and Supply Drop do nothing on the Link Gun yet; Medic talents get their own pass after the Link Gun has been played.

## 0.20.0 (2026-11-17) Design pillars, death log, a shrinking phase three, keybinds
- `DESIGN.md` sets out the pillars every change is checked against: everything is aimed, if it matters you can
  see it in the world, and each role owns a physical job (tank: space, healer: coverage, DPS: precision).
  It also sets the order of work: an aimed healer next, then one aimed DPS weapon, then the rest.
- Death log: when you go down, and on the shift report, you see the last five hits you took, how big each was,
  and whether it was avoidable (step out of it), something to mitigate (block or shield it), or the squad's job.
- Phase three: floor sections now fall for good, one every 15s, until four of the six are gone and the room is a
  fraction of its size. Fallen floor is a black hole, not a red warning. Drones keep coming in phase three (every 40s),
  and a drone you Shove onto fallen floor goes down the shaft.
- Fixed: enemies could keep a dead player as their target while staggered, walking to the middle or charging.
  A Crusher on someone who drops is now called off, and a Heavy Rocket whose mark goes down picks someone standing.
- Keybinds: a Keybinds button under Controls on the main screen. Rebind movement, Space, Q, E, F and R; saved
  in your browser. Rebound keys show on the action bar.
- Bots treat fallen floor as a wall and step off it straight away.

## 0.19.0 (2026-11-17) Shield Energy and the Shove
- The Impact Hammer is built around one loop: swing and block to fill **Shield Energy**, then **Shove** (LMB + RMB together; RT + LT on a controller).
  - Each swing stores 6, the slam 12, and your barrier stores 1 for every 25 damage it blocks (yours or the squad's behind you). It never leaks.
  - Shove spends it all. Everything in the arc in front of you is thrown back up to 14m; anything slammed into the arena wall or another enemy is stunned for 2s and takes 150 more (and so does whatever it hit).
  - The Foreman won't move, but a full Shove hits him for 500. Damage climbs steeply with energy, so one full Shove is worth far more than two half ones.
- Q is Challenge again: an aimed single-target taunt (whatever you're pointing at, or your target).
- E is Piston Shot: 120 to the first enemy within 22m where you aim, very high threat, 4s cooldown. A miss only costs half a second.
- Removed: Kinetic, Kinetic Shockwave, Iron Roar. The combo now hits for 60, 60, 150 (the Shove carries the damage it lost).
- New Juggernaut talents, all changing a button you already have:
  - Shield: Spiked Barrier / Hardened Emitters / Firing Line (squad members behind your barrier deal 15% more).
  - Shove: Piledriver (40% harder, 3s stun) / Capacitor Bank (energy fills 50% faster) / Breathing Room (Shove shields everyone within 8m, 50 to 200).
  - Challenge: Brand (it takes 15% more from everyone for 6s) / Daze (stuns a drone 2s; the Foreman hits 25% softer for 4s) / Protector (shields whoever it was attacking for 250).
  Shove talents do nothing on the Flak Cannon and Minigun until their rework. Saved builds using removed talents fall back to the first pick in that row.
- Abilities carry their key, so the bar, keyboard and controller always agree.

## 0.18.0 (2026-11-17) Fewer, weightier buttons
- The Impact Hammer has six buttons and no number keys: left click swing combo, right click barrier,
  Q Kinetic Shockwave, E Iron Roar (now your taunt, 12s), F Shield Belt, R Aegis Dome, Space Riot Charge.
  Controller: RT, LT, X, RB, B, Y, A. The ranged single-target Challenge is gone from the Hammer.
- Talents never add buttons; Juggernaut rows 2 to 4 each change one you already have:
  - Shield Belt: Shield Bash / Rapid Recharge / Linked Belt.
  - Your taunt: Tremor (hits and knocks drones down) / Iron Hide (35% less damage for 6s) / Hold the Line (squad takes 20% less).
  - Your defensive: Spiked Barrier (hits on it are returned) / Hardened Emitters (2,500 health, faster recovery) / Wide Projection (covers more behind you).
  These also apply to the Flak Cannon's and Minigun's taunt, belt and defensive where it makes sense.
- Removed: Reactive Plating, Uppercut, Rally Cry, Ablative Plating, Vengeance, Guardian Link, Counterstrike. Saved builds fall back to the first pick in each row.

## 0.17.0 (2026-11-17) Juggernaut talents: Active, Passive or Modifier
- Juggernaut talent rows 2 to 4 each offer an Active (a new button), a Passive (always on) and a Modifier (changes a button you have).
  Pick passives for a simple bar, actives for a busy one: up to three extra buttons on Q, E and F (D-pad left, right, up).
  - Armor: Reactive Plating (Q, soak 40% for 4s then blast it back) / Ablative Plating / Linked Belt (Shield Belt covers nearby allies).
  - Enforcement: Uppercut (E, 260, knocks drones down, weakens the Foreman) / Vengeance / Guardian Link.
  - Command: Rally Cry (F, squad takes 20% less for 5s) / Counterstrike / Shield Bash.
- The armory shows how many extra buttons your build adds.
- Keyboard camera turning for aimed weapons moves from Q/E to the arrow keys.
- Saved Juggernaut builds that used Rapid Recharge, Bodyguard, Breach Protocol or Hold the Line fall back to the first pick in that row.

## 0.16.0 (2026-11-17) Mouse-aimed Hammer, boosted charge, planted shield phase
- Overcharge rework: the Foreman's energy bar fills; when full he walks to the middle, plants himself and channels the shield.
  No moving or swinging while it's up, a damage pulse on the whole room every 2s, 14s to break it, and a 7s stagger if you do.
- Impact Hammer on the mouse: click the arena to lock the mouse (Esc releases it). Left click swings, right click holds the barrier,
  the mouse aims. 1 Kinetic Shockwave, 2 Iron Roar (new), 3 Challenge (aimed), 4 Shield Belt, R Aegis Dome.
- Iron Roar: everything within 10m turns on you for 3s and you take 20% less for 5s (20s cooldown).
- Riot Charge is a boosted dash in the direction you aim, stopping at the first enemy (or ally, with Intercept).
- The combo resets after 2s without a swing, so a slam can't be held in reserve.
- Juggernaut plating: the tank takes 30% less from the Foreman's fists and Crusher, which hit harder, so losing the tank is now a disaster.
- Flak Screen cuts 70% for 3.5s. Fixed: an interrupted hero moment could stop all later ones (they're off for the Foreman).

## 0.15.0 (2026-11-17) The Hammer as the plate-wearing mitigator
- Impact Hammer reworked: no holding to charge, and no self-healing.
  - 1 Hammer Combo: swing, swing, slam (95, 95, then a wider 230) across the arc in front of you. Tap or hold to keep it going.
  - 2 Energy Barrier: unchanged, the answer to big hits and barrages.
  - 3 Kinetic Shockwave: 40 Kinetic, 200 to everything in a 20m lane in front of you.
  - Ultimate Aegis Dome: nobody inside the 9m dome takes damage for 5s.
- Riot Charge is now every Juggernaut's gap closer on Space (10s). Tier 1 talents change it:
  Battering Ram (damages everything you plough through), Twin Thrusters (two charges), Intercept (40m, can charge to an ally and shield them).
- Each Juggernaut weapon can have its own ultimate; the Flak Cannon and Minigun keep Riot Wall for now.
- The Crusher hits harder (1,300), so an unmitigated tank is in real trouble; the Minigun's Vent shield scaled up to match.

## 0.14.0 (2026-11-17) Aimed Impact Hammer prototype
- The Impact Hammer is aimed, not tab-targeted: it hits whatever is in front of where the camera faces.
  - Hold 1 to wind up a smash (up to 1.5s): 80 tapped, up to 330 fully charged, across a wide arc. A floor arc shows what it will hit.
  - Hold 2 to raise an Energy Barrier: blocks enemy hits on you and anyone behind you until its 1,800 health runs out;
    regenerates while lowered, breaks for 5s if emptied. No smashing while it's up, and you move at half speed.
  - 3 Recoil Strike: heals you for 35% of the damage you just took.
- Q and E turn the camera for aiming without the mouse.
- Basic controller support: left stick moves, right stick aims, RT/LT are weapon buttons 1 and 2 (held for the Hammer),
  X = 3, RB = 4, B = 5, Y = ultimate, A = Space, LB = next enemy.
- Fixed: the Medic's Shield Gun Barrier could be swallowed by another ability with the same name; a test now stops that.

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
