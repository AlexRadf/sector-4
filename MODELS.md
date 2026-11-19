# Models

The game draws every character from a model slot. Until a slot has a real model it shows the placeholder boxes.

## Slots

| Slot | File | Height in game |
|---|---|---|
| Juggernaut | `public/models/tank.glb` | 2.0m |
| Medic | `public/models/healer.glb` | 2.0m |
| Striker | `public/models/dps.glb` | 2.0m |
| Wrecker | `public/models/melee.glb` | 2.0m |
| The Foreman | `public/models/boss.glb` | 6.2m |
| Security drone | `public/models/drone.glb` | 1.6m |

## Shipping a model to everyone
1. Export a binary glTF (`.glb`) and save it under the slot's file name in `public/models/`.
2. Commit and push to `main`. The server lists the folder in `models/index.json`, and the model files count towards
   the build id, so everyone gets the new model on their next load despite the long browser cache.

Each player can still try a model out without shipping it: the briefing screen's "Swap in your own meshes" takes a
`.glb` per slot, kept in that browser only. **Clear** puts the slot back to the game's model (or the placeholder).
An upload beats a shipped model, which beats the placeholder.

## How a model is placed
- It's scaled so its height matches the slot's, centred, and stood on the floor. Any units work.
- **Face +Z** (glTF's "forward" for characters exported from Blender with +Y up is fine as long as the front points +Z).
- The game turns the whole model to face where the character is facing and tips it over on death, unless it has its
  own death clip.

## Animation clips
Name the clips and the game plays them from what the character is doing. The match is by name and isn't case
sensitive, so `Run_Loop` counts as run.

| Clip name contains | Plays when | Loops |
|---|---|---|
| `idle` or `stand` | standing still | yes |
| `run`, `walk` or `move` | moving | yes |
| `attack`, `fire`, `shoot`, `swing` or `cast` | the character lands a hit or a heal | once |
| `hit` or `hurt` | the character takes a hit of 100 or more | once |
| `death`, `die` or `dead` | down; holds the last frame | once |

A missing clip falls back to idle. A model with clips that match none of these names loops its first clip, and a
model with no clips stands still.

## Removing the placeholders
The placeholder boxes all live in `public/placeholders.js`. Once every slot has a model, delete that file and its
`<script src="placeholders.js">` line in `public/index.html`. A slot without a model then shows nothing.
