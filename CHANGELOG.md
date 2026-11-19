# Changelog

What changed in each version. The version shows on the briefing screen, in the corner of the HUD,
on /stats and in every fight record. Bump it in `public/sim.js` (VERSION) and `package.json` together:
the middle number for new things, the last number for fixes.

## 0.31.0 (2026-11-19) The Wrecker is playable, and an over-the-shoulder camera
- **The Ripsaw**, the Wrecker's aimed weapon, played like a Rogue:
  - **LMB Rip**: the enemy in front of you, 40 and a Rev; from behind 50% more and two Revs. Revs show as orange
    sparks round you, spinning white at five.
  - **RMB Saw Through**: spends all your Revs on the enemy in front of you (30 plus 32 a Rev, 50% more from behind)
    and Bleeds it, 2.4s a Rev added on to what's left (a red ring at its feet). Keep the Bleed rolling.
  - **L+R Shred**: spends all your Revs on everything within 5m (40 plus 45 a Rev each, and a short Bleed).
  - **Overdrive** (proc): a Rip on a bleeding target can light it (always on a crit); your next Saw counts as five
    Revs. The sparks go red.
  - **Shift Dash** along your aim (Afterburner and War Cry work on it), **Q Chain Hook** (yank a drone to you and
    stun it, or pull yourself onto the Foreman's back), **E Redline** (8s of faster, 20% harder Rips: your burn
    window), **F Iron Hide** (40% less damage for 5s), **R Wrecking Slam** on what's in front of you.
  - The rotation: get behind him, Rip to five, Saw to keep the Bleed up, Shred piles, cash in Overdrive at once,
    Redline into the windows.
  - Bot Wreckers play it too, about as hard as the old Chainsaw. An all-bot squad wins about 90% in roughly 4:40.
- **Over-the-shoulder camera.** With an aimed weapon the camera sits behind your right shoulder and looks along your
  aim, Marvel Rivals style: the middle of the screen is where your shots go (they line up at about 18m). The mouse
  wheel moves it in and out. **V** switches to the overhead view and back; it's remembered. Spectating stays overhead.

## 0.30.0 (2026-11-19) Medic rotation, and aimed weapons only
- **The Link Gun plays like a Discipline Priest:**
  - **Nanite Tag**: healing an ally with a Link Bolt Tags them for 10s (three green motes circling their feet, blinking
    as it runs out), with a small heal over time. The beam keeps whoever it's on Tagged.
  - **Atonement**: every Link Bolt that hits an enemy heals everyone you've Tagged for 20% of the damage. Tag the squad,
    then shoot the Foreman (or his shield) to heal them.
  - **Nanite Burst** Tags everyone it heals and heals the already-Tagged 30% more: the fastest way to Tag the group.
    Its button shows how many of the squad aren't Tagged.
  - **Flux** (like Infusion of Light): a crit or every fifth bolt on an enemy lights it. Your next bolt on an ally heals
    double and jumps to the next most hurt ally within 10m.
  - The rotation: Tag the squad, shoot the Foreman for Atonement and Nanites, spend Flux on whoever needs it, beam the
    tank through spikes, Burst to Tag (and save) the group.
- **Players only get aimed weapons.** The tab-target weapons (Flak Cannon, Minigun, Bio Rifle, Shield Gun, Rocket
  Launcher, Sniper Rifle) are switched off in the armory until they're converted; saved builds move to the aimed one.
  **The Wrecker is bots-only for now**: none of its weapons is aimed yet. The code is kept, and bots and tests still use it.
- The overcharge shield has 11,500 health (was 10,000): Atonement made the shield window much safer for the squad, so it
  lasts a little longer. An all-bot squad wins about 90% in roughly 4:40.
- Party frames show F1 to F4 only (Shift no longer targets).

## 0.29.0 (2026-11-19) Juggernaut rotation, and real models
- **The Impact Hammer has a Protection Warrior rotation:**
  - **Bulwark** (active mitigation, like Shield of the Righteous): every Shove gives a second of Bulwark for every 10
    Shield Energy it spends, stacking up to 12s: 15% less damage from everything. Spend often to keep it up, or hoard
    for a big Shove. A faint gold shell shows it, and the Shove button shows how much you'd add.
  - **Riposte** (a Revenge proc): block a Foreman hit of 100 or more with the barrier and your next swing is a Slam with
    50% more damage, and Hammer Throw is ready again.
  - **Sunder** (raid utility): Piston Shot Sunders what it hits for 12s, and the whole squad does 8% more to it. An
    orange ring at its feet shows it, blinking in the last 3s; the Piston Shot button lights when the Foreman needs it.
  - The rotation: keep Bulwark up and the Foreman Sundered, block his fists for Ripostes, Hammer Throw on cooldown,
    swing in between.
  - Bot Juggernauts keep both up too. The Foreman has 194,000 health (was 182,000) to make up for the Sunder; an
    all-bot squad wins about 89% in roughly 4:41.
- **Real models.** Put a binary glTF at `public/models/<slot>.glb` (tank, healer, dps, melee, boss, drone) and everyone
  gets it: the server lists them and they count towards the build, so a new model gets past the browser cache. Clips
  named idle, run, attack, hit and death play from what the character is doing. See `MODELS.md`.
- **The placeholder boxes moved into `public/placeholders.js`.** Delete it (and its script tag) once every slot has a
  model. Each "Swap in your own meshes" slot now has a **Clear** button.

## 0.28.0 (2026-11-19) The Striker plays like an Arcane Mage
The Shock Rifle now has a rotation rather than one combo to chase.
- **Shock Charges** (like Arcane Charges). Every Shock Beam that lands adds one, up to four (a coolant port adds two).
  Each charge makes your beams 20% stronger and 3 Capacitor costlier. They orbit you as sparks; at four they spin
  fast and glow white.
- **Capacitor is your mana.** It refills by itself (6 a second) and starts full. A beam costs 3 plus 3 per charge, so
  at four charges you burn through it: burn, then spend.
- **Overcharged Core (L+R) is your Arcane Barrage.** It spends all your Shock Charges (needs at least one) and gives
  8 Capacitor back for each. Popped: an 8m combo of 180 plus 100 per charge. Left alone: 60% of that to the first
  enemy it touches.
- **Charged is a debuff to keep up (8s).** A Shock Core that hits now Charges its target as well as the combo, so the
  core's job is keeping your target Charged (beams do 40% more to it). Let it fly at one target, pop it on a crowd.
- **Only a fresh click pops your own core.** Holding the beam fires past your cores, so letting one fly no longer
  costs you your beam.
- **Surge** (like Clearcasting): two coolant-port hits in a row and your next Shock Core is ready at once, flies twice
  as fast and hits 50% harder. The sparks turn gold.
- **E is now Overclock** (Arcane Surge, was Adrenaline): full Capacitor, four Shock Charges and 30% more damage for 8s,
  with Capacitor refilling twice as fast. Every 45s. Your burn window: line it up with open ports, the stagger or the
  shield.
- **Shock Nova** also gives you four Shock Charges.
- Talents follow: **Supercharge** needs all four charges (and still hits 30% harder); **Discharge Plating** shields
  75 per charge spent.
- The rotation, roughly: keep your target Charged, build to four charges on ports, burn, spend them on an Overcharged
  Core before you run dry, take every Surge, and save Overclock for a window.
- Bots play the same loop. Striker bot about 260 damage a second, spread across beams, ports, combos and direct core
  hits. An all-bot squad wins about 89% in roughly 4:40.

## 0.27.1 (2026-11-19) Striker fixes from playtest
- **Overload** keeps its stacks when you pop a core (only switching targets or missing resets it), and OVERLOADED is
  called out once when it fills instead of on every beam.
- **A Shock Core you don't pop still lands.** It hits the first enemy it touches for 220 (one target, no splash, no
  Charge), so firing a core and letting it fly is a real single-target play; the combo is the area option. An
  Overcharged Core that isn't popped hits for 60% of its combo. Volatile Core halves the unpopped hit instead of
  removing it.

## 0.27.0 (2026-11-18) Striker talents, Hammer Throw, no Ground Pound
- **Striker talent pass.** A new tree for the Shock Rifle. Like the Medic's, no talent adds a button; each row changes
  one you already have:
  - **Footwork (Shift):** Dodge Jump (7m, next shot +30%) / Kinetic Slide (8m, 30% less damage for 2s after) /
    Covering Dash (9m, a 120 shield on every squad member within 6m of where you land).
  - **Beam (LMB):** Overload (each beam on the same target +6%, up to 30%) / Precision Coils (coolant ports take 2.5x
    instead of 2x and are a little easier to hit) / Spotter (your hits mark the target: the squad does 6% more to it).
  - **Core (RMB):** Volatile Core (combos 8m and 15% harder, but an unpopped core does nothing) / Magnetic Core (cores
    curve towards the enemy under your crosshair) / Arc Link (Charged targets take 10% more from the whole squad).
  - **Overcharge (L+R):** Supercharge (needs 75, hits 30% harder) / Discharge Plating (shields you 3 per Capacitor put
    in) / EMP Burst (drones stunned 3s, and an overcharge shield takes 600 more).
  - Removed: Sniper's Perch, Covering Fire, Adrenaline Rush, Thigh Pads, Decoy Beacon, Point Blank, Marksman, Killing
    Spree, Shield Breaker, Team Uplink. Saved builds fall back to the first pick in each row. Rows 2 to 4 only work on
    the Shock Rifle until the other Striker weapons are converted.
- **Juggernaut: Challenge is now Hammer Throw (Q).** No forced taunt any more, so it means the same thing against a
  player: 180 and huge threat to what you aim at, then it bounces to the nearest other enemy within 10m for 120 and
  huge threat (both drones in one throw). Brand, Daze and Protector now work off the throw. Flak Cannon and Minigun
  get it too.
- **No Ground Pound for the Foreman.** He's a classic raid boss. The shockwave is still in the game for a future boss;
  Space still jumps.
- Bot Strikers take Dodge Jump, Spotter, Magnetic Core and EMP Burst. An all-bot squad wins about 85% in roughly 4:36.

## 0.26.0 (2026-11-18) Shock Rifle rework, coolant ports, jumping, a harder overcharge shield
- **The Shock Rifle plays like UT now.** No more standing still holding a stream. Each button is a skill shot:
  - **RMB Shock Core** (every 4s): a slow glowing ball fired along your aim.
  - **LMB Shock Beam**: an instant 80 to whatever is near your crosshair. It snaps onto your own core in the air, and
    beaming a core sets off the **Shock Combo**: 250 to everything within 6m, up to 50% more the further the core flew.
    Everything caught is **Charged** for 5s (purple glow), and your beams on a Charged target do 40% more.
    Catch two or more enemies and the core is ready again at once (MULTI-COMBO).
  - **Both buttons together, Overcharged Core**: spends all your Capacitor (50 or more). A big, very slow core whose combo
    is 8m and 340 to 590 depending on what you put in, plus the distance bonus. Shares the core's 4s.
  - **R Shock Nova**: an instant blast on the enemy you point at (600 to it, 300 within 8m, drones stunned), then five
    cores fan out and hang in the air for 8s for you to pop.
  - **Capacitor** no longer recharges on its own. Beam hits fill it: 5 a hit, 4 more on a Charged target, 15 for a
    coolant port, 10 for a crit.
- **Coolant ports replace the back vent.** Three glowing grilles drift slowly round the Foreman. One is lit at a time,
  and all three blow open for 3s after a Crusher, a charge, a leap or a Ground Pound, and while he's staggered.
  A Shock Beam on a lit port that faces you does double and fills the Capacitor. The Striker's reticle no longer snaps:
  it shows where you really aim, gold over a port and white over your own core. The Striker no longer gets a bonus
  for standing behind him.
- **Shift is the movement ability** (Riot Charge, Dodge Jump, Stim Leap, Nanite Skates, Medevac). **Space jumps.**
  On a controller, A jumps and LB (aimed weapons) or clicking the left stick is the movement ability.
  Shift+1 to 4 no longer targets the squad (F1 to F4 still do).
- **New: Ground Pound.** Every 21s (a bit more often in phase three) the Foreman rears up and slams the floor, and a
  shockwave rolls out to the walls: 300 if it catches you on the ground. Jump it. Only the moving wave can be jumped:
  sludge, fallen floor and rocket blasts still get you in the air.
- **The overcharge shield ramps.** Its pulses now hit for 30, 90, 180, 270, 360 and 450 (every 2.25s, was a flat 80
  every 2s), so a slow break puts real pressure on the Medic.
- Bots: Strikers stand off to the Foreman's side, fire a core, hold fire while it flies and pop it as it arrives,
  aim for lit ports with a person's wobble, and save the Overcharged Core for crowds and windows. Every bot jumps the
  shockwave, with its own timing (and sometimes gets it wrong).
- An all-bot squad wins about 90% in roughly 4:40 (the Striker bot does about 255 damage a second, was 240).

## 0.25.0 (2026-11-18) The aimed Striker: Shock Rifle, and the Foreman's back vent
- The Shock Rifle is now an aimed weapon, the DPS prototype for the design pillars:
  - **LMB Shock Beam**: an instant 80 at the enemy nearest your crosshair. It snaps tighter than the Medic's bolt: aim matters.
  - **RMB Shock Stream**: hold it on one enemy and it builds from 60 to 220 a second over 3s (12 Capacitor a second). Switch target and it starts again.
  - **LMB + RMB Shock Combo** (50 Capacitor): a core detonates on whatever you're pointing at: 420 to it and 240 to everything within 6m.
  - **Q EMP Grenade**: held to aim like the Nano Field. 200 damage, drones stunned 2.5s, and an overcharge shield takes 600 more.
  - **E Adrenaline** (40% more damage for 6s), **F Kinetic Shield** (350 for 4s), **R Shock Nova** (900 on the target, 450 within 10m, drones stunned 3s).
- **The vent**: a glowing grille on the Foreman's back. Aimed weapons hitting him from behind hit it for 30% more, and the number says VENT.
  The tank turns him; the DPS get round the back.
- Thrown abilities share one system: anything marked as a throw is held to aim with an arc and landing ring (green for heals, blue for the EMP).
- The reticle locks onto your Shock Beam or Stream target. The Stream draws a beam that whitens as it builds.
- Bot Strikers now play the aimed Shock Rifle (they stand behind the Foreman and let the tank open before streaming).
- Every bot now treats a live warning circle like a wall: no more stepping out of a rocket barrage and straight back in.
  Bots got much better at surviving, so the Foreman has 182,000 health (was 165,000). An all-bot squad wins about 90% in roughly 4:45.
- `CLAUDE.md` now covers the whole workflow for working on the game in Claude Code, and `scripts/role-sims.js` and
  `scripts/output.js` are the quick balance checks.

## 0.24.0 (2026-11-18) A reticle for aimed weapons
- Aimed weapons (Impact Hammer, Link Gun) show a reticle in the arena where your attack lands: a few metres ahead for the Hammer,
  further out for the Link Gun. When your weapon would lock onto something it snaps onto them, closes in and colours up:
  green for an ally you'll heal, red for an enemy you'll hit, purple for an ally who needs a Purge.

## 0.23.1 (2026-11-18) Medic talent fixes
- **Chain Link** reaches 12m from your beam target (was 8m), can jump back to you, and flashes a bright green bolt every time it jumps.
- **Siphon Link** no longer pays for the beam: it was infinite Nanites on the tank. The arc now hits for 70 a second instead of 50.
- **Purge** is smart: it takes a sludged ally roughly in front of you first, then yourself if you're sludged, then whoever you're pointing at.
  No more aiming at the floor to cleanse yourself.
- **Purging Field** costs you time: the Nano Field is ready every 16s instead of 10, and it cleanses each person once as they step in,
  so a fight with stacking debuffs can't be solved by one field.
- `DESIGN.md`: cleansing a crowd always costs something.

## 0.23.0 (2026-11-18) Medic talents for the aimed Link Gun
- A new Medic tree, themed to the Link Gun. Like the Juggernaut's, no talent adds a button; each row changes one you already have.
  - **Footwork (Space):** Stim Leap (leap 9m, heals 30% stronger for 3s after) / Nanite Skates (50% more speed for 3s, keep
    beaming and shooting) / Medevac (leap to the ally you're pointing at, or the most hurt, and shield them 150).
  - **Link (your beam):** Siphon Link (the beam arcs on to the nearest enemy for 50 a second and costs nothing while it bites) /
    Long Link (latches from 40m, drains 3 a second) / Chain Link (jumps on to the most hurt ally within 8m of your target at half strength).
  - **Burst (LMB + RMB):** Shock Burst (also blasts enemies within 10m for 200 and stuns drones) / Recycler (8 Nanites back
    for each hurt ally it heals) / Burst Shield (everyone it touches also gets a 200 shield).
  - **Field (Q):** Caustic Field (enemies in it take 80 a second) / Lingering Field (10s instead of 6) / Purging Field (cleanses Bio Sludge).
- Removed: Surgical Stance, Adrenaline Shot, Self-Repair Nanites, Lifeline, Battle Medic, Overflow, Chain Heal, Live Fire, Supply Drop,
  Defibrillator. Saved builds fall back to the first pick in each row. Rows 2 to 4 only work on the Link Gun until the Bio Rifle and
  Shield Gun are converted.
- The beam is a little stronger (185 a second) and Nano Field heals 70 a second.
- Bot Medics now play the aimed Link Gun (Medevac, Chain Link, Burst Shield, Lingering Field), and any bot pops its personal defensive
  if it's still under something about to land.

## 0.22.1 (2026-11-18) A death log that explains wipes
- Every hit in the death log is labelled: **Avoidable** (step out of it), **Tank buster** (block or shield it), **AoE** (hits the whole
  squad, heal through it), **Debuff** (get it purged), **Squad** (the shield wasn't broken), **Tanking** (the boss's fists on the tank),
  **Aggro** (the boss turned on you) and **Add** (a drone on you). Drone hits now read "Drone".
- Each recap has a one-line verdict, e.g. "68% avoidable".
- The shift report shows the recap for **everyone who went down**, not only you, so a wipe shows what happened to the tank too.
- The Nano Field aim preview only appears when you can actually throw it (off cooldown, enough Nanites).

## 0.22.0 (2026-11-18) Medic feedback: readable cleanses, a thrown Nano Field, a real Link Storm
- Nameplates show what a squad member needs: **purple** means Bio Sludge (Purge them), **red** means below 40% health.
  The Sludge glow on the body is purple to match.
- **Nano Field is a grenade.** Hold Q (X on a controller) to see a dashed arc and the 6m landing ring; look further up the room
  to throw further (3m to 25m), let go to throw. It flies for 0.6s and settles on any ally within 3m of where it lands.
- **Link Storm** now lands like an ultimate: everyone within 25m is instantly healed for 35% of their health with a big flash,
  then linked for 5s at 150 a second.
- While your beam is linked, the status strip says **LMB = Burst**: holding the beam and clicking is your Nanite Burst.
- `DESIGN.md`: every role has one personal defensive on F; thrown things are held to aim; status shows on nameplates.

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
