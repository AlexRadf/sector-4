# Sector-4 design pillars

The rules every change is checked against. If a feature breaks one of these, change the feature or
change this file on purpose, never by drift. Last revised: v0.32.0 (2026-11-19).

## What the game is

A shared co-op raid for two to four friends (bots fill the gaps), with an Unreal Tournament 99 look
and Deus Ex / Anarchy Online megacorp tone. MMO raid structure (roles, bosses, phases, talents),
action-game controls. No stat or gear progression: mechanics, positioning and mastery decide fights.

## The three pillars

### 1. Everything is aimed
No tab-targeting for any role. You act on what is in front of you: the mouse (or right stick) aims,
the mouse buttons are your weapon, Q / E / F are abilities, R is your ultimate, Shift is your movement ability
and Space jumps.
- It must work on a controller. Aimed help (soft lock-on to whatever is near your crosshair) is
  allowed and expected, especially for anything aimed at allies.
- Few buttons, each with one job. Talents never add a button; they change one you already have.

### 2. If it matters, you can see it in the world
The game is read from the arena, not from panels. Who is hurt, who the boss is about to hit, how
charged you are, where it's safe: all of it on the characters and the floor first.
- The HUD is a backup and a summary, never the only place information lives.
- A new mechanic isn't finished until a player can read it without looking at the UI.

### 3. Each role owns a physical job
| Role | Owns | What that means in play |
|---|---|---|
| Juggernaut (tank) | **Space** | Where enemies are, where the squad stands, what gets blocked. Barrier, Shove, Riot Charge. |
| Medic (healer) | **Coverage** | Where you stand decides who you can reach. Healing is aimed at allies, never picked from party frames. |
| Striker / Wrecker (DPS) | **Precision** | Hitting the right thing at the right moment: weak points, shield generators, the drone the tank set up. |

Roles should depend on each other: the tank creates openings, DPS cash them in, the healer keeps the
people who are out of position alive.

## Supporting rules
- **Every role has a single-target tool and an area tool, easy to learn and hard to master.** The floor is pressing
  the buttons at the right thing; the ceiling is aim, timing and cashing in. Borrow from esports shooters: skill shots,
  resources you earn by playing well, and rewards that chain (a good play readies the next one). The Shock Rifle is the
  template: beam (single target), core plus combo (area), ports (aim), Shock Charges and Capacitor (rhythm), multi-combo
  reset and Surge (chain).
- **DPS have a rotation, not one trick.** Borrow the MMO shapes: a stacking builder that makes your filler stronger and
  costlier (Arcane Charges), a spender that cashes the stacks in for resource (Barrage), a debuff to keep up, a proc
  to react to, and a burn window to line up with the fight. Every one of them shows on the body or the target.
- **Ranged roles aren't rewarded for standing behind the boss.** Their precision reward comes from aim (weak points that
  move and open), not from position. Behind-the-boss bonuses belong to melee.
- **Spec visuals are personal.** Rotation state (stacks, procs, debuff clocks, weak points) is drawn only for the player
  whose spec it is. Anything the whole squad must react to (telegraphs, status that needs cleansing) is drawn for everyone.
- **Healing is a choice, not a by-product.** Damage doesn't heal; it earns the resource heals cost.
- **Every ability should mean the same thing against a player.** No forced taunts: tanks hold attention with big-threat
  attacks (Hammer Throw), which in PvP are simply hits. Keeps the kits ready for a PvP mode later.
- **Jumping only clears things that move along the floor** (a shockwave). Anything lying on the floor (pools, debuffs,
  fallen sections) still gets you in the air.
- **No twitch reactions.** Telegraphs are long and readable. Mistakes hurt, a single one never wipes.
- **Bosses are built for verbs, not damage.** Every mechanic should ask some role to do its job:
  hits from a direction to block, enemies that need to be somewhere else, things only precision answers.
- **General verbs.** Talents and abilities use general mechanics (stun, knock back, shield) rather than
  boss-specific ones, so they still mean something on the next boss.
- **Each weapon has pros and cons** that shine in parts of a fight; none is ever required for a boss.
- **Original, not on-the-nose.** Draw on Overwatch, WoW, UT, Deus Ex for feel; don't copy heroes.
- **Ultimates are a pumped-up version of the weapon's core gimmick**, free to use, never a scripted counter.
  They must *feel* like an ultimate: an instant, visible payoff first, then the sustained effect.
- **Every role has one personal defensive, always on F.** Same key, flavoured per weapon (Shield Belt, Nanite Cloak,
  and one for each DPS weapon when they're converted). It's what keeps "one mistake never wipes" true without the healer.
- **Thrown things are held to aim.** Hold the key to see the arc and where it lands, let go to throw. Look further up
  the room to throw further.
- **Status shows on the nameplate.** Purple needs cleansing, red is in trouble.
- **Cleansing a crowd always costs something** (cooldown, Nanites, a once-per-person rule), so a boss that stacks debuffs
  can't be solved with one button. Single-target cleanses are cheap and smart-targeted.
- **No talent may make a resource free.** Every talent that touches Nanites, Shield Energy and so on must still leave a cost.

## Healing (the riskiest pillar, prototype first)
Aimed healing removes the party-frame split focus but can create a new one (aiming at moving allies
while dodging). Rules for the healer prototype:
- Generous lock-on: point roughly at an ally and it latches.
- Position is the skill, aim is the means: ground-placed heals, beams that stay attached once locked.
- Health must be readable on the bodies (pillar 2) so the healer looks at the fight, not at frames.
- Look at Mercy, Moira, Ana and Lúcio (Overwatch) before any MMO healer.

## Order of work (as of v0.21.0)
1. Impact Hammer tuned (done, v0.19.0) and played by Alex and Katie.
2. Open items: death log, boss targeting the dead, phase 3 floor, keybinds (v0.20.0).
3. **Aimed healer prototype**: the Link Gun (v0.21.0) and its talent tree (v0.23.0), being played.
4. One aimed DPS weapon: the Shock Rifle (v0.25.0), reworked around Shock Cores, combos and coolant ports (v0.26.0),
   with Shift/Space movement and the ramping overcharge pulse, and its talent tree (v0.27.0). To be played. The Ground
   Pound is built but off for the Foreman. The Striker's Arcane-style rotation (v0.28.0) and the Juggernaut's Protection
   rotation (Bulwark, Riposte, Sunder; v0.29.0), the Medic's rotation (Tags, Flux; v0.30.0, Atonement removed in v0.34.0).
   One aimed weapon per role: the tab-target weapons are cut (v0.32.0).
5. The Wrecker's aimed Ripsaw with its Rogue rotation, and the over-the-shoulder camera (v0.31.0). To be played.
6. One good weapon per role (v0.32.0). A second weapon for a role only when the first is played out and there's a
   clear, different job for it.
