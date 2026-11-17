# Sector-4 design pillars

The rules every change is checked against. If a feature breaks one of these, change the feature or
change this file on purpose, never by drift. Last revised: v0.21.0 (2026-11-17).

## What the game is

A shared co-op raid for two to four friends (bots fill the gaps), with an Unreal Tournament 99 look
and Deus Ex / Anarchy Online megacorp tone. MMO raid structure (roles, bosses, phases, talents),
action-game controls. No stat or gear progression: mechanics, positioning and mastery decide fights.

## The three pillars

### 1. Everything is aimed
No tab-targeting for any role. You act on what is in front of you: the mouse (or right stick) aims,
the mouse buttons are your weapon, Q / E / F are abilities, R is your ultimate, Space is movement.
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
- **No twitch reactions.** Telegraphs are long and readable. Mistakes hurt, a single one never wipes.
- **Bosses are built for verbs, not damage.** Every mechanic should ask some role to do its job:
  hits from a direction to block, enemies that need to be somewhere else, things only precision answers.
- **General verbs.** Talents and abilities use general mechanics (stun, knock back, shield) rather than
  boss-specific ones, so they still mean something on the next boss.
- **Each weapon has pros and cons** that shine in parts of a fight; none is ever required for a boss.
- **Original, not on-the-nose.** Draw on Overwatch, WoW, UT, Deus Ex for feel; don't copy heroes.
- **Ultimates are a pumped-up version of the weapon's core gimmick**, free to use, never a scripted counter.

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
3. **Aimed healer prototype**: the Link Gun (v0.21.0), to be played. Then a Medic talent pass themed to it.
4. One aimed DPS weapon.
5. Only then convert the remaining weapons (Flak Cannon, Minigun, other Medic and Striker weapons),
   or cut weapons if one good one per role is enough.
