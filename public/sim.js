/* Sector-4 combat simulation.
   Pure logic, no rendering. Runs the same in the browser and in Node, and is written as an
   authoritative step(dt, inputs) loop so it can move onto a server later without a rewrite. */
(function (root) {
  'use strict';

  var ARENA_R = 28;
  var GCD = 1.5;

  /* ---------- kits: two weapons own slots 1-2, the role's utilities own slots 3-4 ---------- */
  function A(o) { o.cast = o.cast || 0; o.cd = o.cd || 0; if (o.gcd === undefined) o.gcd = true; return o; }

  /* Every weapon plays on keys 1 to 3, but each class pays for key 2 in its own way (see KITS[role].res):
       Juggernaut  Heat       - swings and taking hits build it; venting spends it all; above 80 is the Redline.
       Medic       Nanites    - heals cost them; shooting the Foreman harvests them back.
       Striker     Capacitor  - recharges on its own; the heavy shot drains half a cell.
       Wrecker     Revs       - classic combo points: build to five, cash them in.
       1 basic  - your filler, with a chance to proc. A crit always procs.
       2 heavy  - spends the class resource.
       3 proc   - only lights up after a proc, for 10s. Off the global cooldown, so weave it in.
     Keys 4 and 5 are the class's two utilities. Every hit and heal rolls 85% to 115%, and 10% of them crit for 80% more. */
  var PIP_MAX = 5, PROC_WINDOW = 10, CRIT_CHANCE = 0.10, CRIT_MULT = 1.8;
  /* Juggernaut weapons: their own resource, and key 2 and 3 are skills paid for with a cost or gated by a minimum. */
  function TW(id, name, pitch, res, abs, extra) {
    abs[0].role = 'build';
    abs.forEach(function (a) { if (!a.role) a.role = 'skill'; });
    var w = { id: id, name: name, pitch: pitch, res: res, abilities: abs.map(A) };
    for (var k in extra || {}) w[k] = extra[k];
    return w;
  }
  /* Aimed weapons ignore your target: they hit what is in front of you, within range and a cone (dot of the angle). */
  function inCone(S, p, range, dot) {
    var fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    return enemies(S).filter(function (e) {
      var dx = e.x - p.x, dz = e.z - p.z, l = Math.sqrt(dx * dx + dz * dz);
      if (l > range + (e.radius || 0)) return false;
      if (l <= (e.radius || 0) + 0.5) return true;
      return (dx * fx + dz * fz) / l >= dot;
    }).sort(function (a, c) { return dist(p, a) - dist(p, c); });
  }
  /* Soft targeting for aimed weapons: whatever is nearest the crosshair (angle measured to the edge of big
     targets) inside a generous cone. opt: { range, dot, ally, enemy, hurt (allies below full only) }. */
  function softTarget(S, p, opt) {
    var fx = Math.sin(p.facing), fz = Math.cos(p.facing), best = null, bs = -2;
    var list = [];
    if (opt.ally) players(S, true).forEach(function (q) { if (q !== p && (!opt.hurt || q.hp < q.maxHp - 1)) list.push(q); });
    if (opt.enemy) enemies(S).forEach(function (e) { list.push(e); });
    list.forEach(function (c) {
      var dx = c.x - p.x, dz = c.z - p.z, l = Math.sqrt(dx * dx + dz * dz), r = c.kind === 'enemy' ? (c.radius || 0) : 0.6;
      if (l > opt.range + r) return;
      var cs = l < 0.5 ? 1 : (dx * fx + dz * fz) / l;
      var ang = Math.max(0, Math.acos(Math.max(-1, Math.min(1, cs))) - Math.atan2(r, Math.max(l, 0.5)));
      var eff = Math.cos(ang);
      if (eff < opt.dot) return;
      var sc = eff - l * 0.002;
      if (sc > bs) { bs = sc; best = c; }
    });
    return best;
  }
  /* Where a Nano Field grenade thrown now would land: along your aim, as far as you're aiming, pulled onto a nearby ally. */
  function fieldSpot(S, p) {
    var d = p.aimDist == null ? 10 : p.aimDist;
    var spot = { x: p.x + Math.sin(p.facing) * d, z: p.z + Math.cos(p.facing) * d };
    var near = players(S, true).filter(function (q) { return Math.hypot(q.x - spot.x, q.z - spot.z) <= 3; })
      .sort(function (a, c) { return Math.hypot(a.x - spot.x, a.z - spot.z) - Math.hypot(c.x - spot.x, c.z - spot.z); })[0];
    if (near) { spot.x = near.x; spot.z = near.z; }
    clampArena(spot, 2);
    return spot;
  }
  var BOLT_AIM = { range: 35, dot: 0.9, ally: true, enemy: true, hurt: true };
  function aimWeapon(p) { var w = p.kit && p.kit.weapons[p.weapon]; return !!(w && w.aim); }
  function W(id, name, pitch, b, sp, pr) {
    b.role = 'build'; sp.role = 'spend'; pr.role = 'proc'; pr.gcd = false;
    return { id: id, name: name, pitch: pitch, abilities: [A(b), A(sp), A(pr)] };
  }

  var KITS = {
    tank: {
      role: 'tank', title: 'Juggernaut', hp: 1700,
      // Each Juggernaut weapon brings its own resource and its own way of surviving (see TW and resOf).
      res: { id: 'ammo', name: 'Ammo', max: 100, start: 40, regen: 3, build: 15, how: '' },
      blurb: 'Hold the Foreman, pick up the drones, and survive the Crusher your own way. Your plating takes 30% off his fists; nobody else has it.',
      weapons: [
        TW('flak', 'Flak Cannon', 'Active mitigation. Blasts load Ammo; spend it on long-range Shells for threat, or on a Flak Screen timed for the big hit.',
          { id: 'ammo', name: 'Ammo', max: 100, start: 40, regen: 3, build: 15,
            how: 'Ammo. Flak Blast loads 15, plus 10 for every extra enemy it catches. Spend it on Shells (30) or a Flak Screen (50). Shield or sword: you can\'t afford both.' },
          [{ id: 'flak', name: 'Flak Blast', kind: 'enemy', range: 8, desc: '75 to every enemy within 8m. Loads 15 Ammo, plus 10 per extra enemy.' },
           { id: 'shell', name: 'Flak Shell', kind: 'enemy', range: 25, cost: 30, desc: '30 Ammo. 190 at up to 25m and very high threat. Slows the target 4s. Pulls drones from range.' },
           { id: 'screen', name: 'Flak Screen', kind: 'self', range: 0, cost: 50, gcd: false, desc: '50 Ammo. For 3.5s every hit on you is cut by 70%, and each one sprays 100 shrapnel back. Time it for the Crusher.' }]),
        TW('hammer', 'Impact Hammer', 'The plate-wearing mitigator. Swing the hammer and hold the barrier to fill Shield Energy, then press both to Shove: everything in front of you is thrown back, and whatever you slam into a wall or another enemy is stunned. No self-healing: you block, the Medic heals.',
          { id: 'senergy', name: 'Shield Energy', max: 100, start: 0, regen: 0, build: 0,
            how: 'Shield Energy. Each swing stores 6, the slam 12, and your barrier stores 1 for every 25 damage it blocks. It never leaks. Spend all of it on a Shove (LMB + RMB): the fuller the bar, the harder it lands, so a full one is worth waiting for.' },
          [{ id: 'combo', key: 'LMB', name: 'Hammer Combo', kind: 'aim', range: 6, hold: 'repeat', desc: 'Swing, swing, slam. Hits everything in an arc in front of you: 60, 60, then a wider 150 slam. Hold or tap to keep the chain going; a 2s pause resets it.' },
           { id: 'ebarrier', key: 'RMB', name: 'Energy Barrier', kind: 'aim', range: 0, hold: 'channel', gcd: false, desc: 'Hold to raise a barrier facing where you aim. It blocks enemy hits on you and anyone behind you until its 1,800 health runs out, and what it blocks fills Shield Energy. Regenerates while lowered; breaks for 5s if emptied. No swinging while it\'s up.' },
           { id: 'shove', key: 'L+R', name: 'Shove', kind: 'aim', range: 8, needs: 20, gcd: false, desc: 'Press both mouse buttons (needs 20 Shield Energy). Spends it all: everything in the arc in front of you is thrown back up to 14m, and anything slammed into a wall or another enemy is stunned for 2s and takes 150 more. The Foreman won\'t budge, but a full Shove hits him for 500.' }],
          { aim: true,
            utils: [A({ id: 'challenge', key: 'Q', name: 'Challenge', kind: 'enemy', range: 30, cd: 8, gcd: false, desc: 'Taunt whatever you aim at (or your target): it attacks you for 3s and you jump to the top of its threat.' }),
                    A({ id: 'piston', key: 'E', name: 'Piston Shot', kind: 'aim', range: 22, cd: 4, desc: 'The hammer head fires a compressed-air round where you aim: 120 to the first enemy within 22m and very high threat. For pulling a drone or poking from range.' }),
                    A({ id: 'belt', key: 'F', name: 'Shield Belt', kind: 'self', range: 0, cd: 30, gcd: false, desc: 'Take half damage for 6s. Your big emergency button.' })],
            ult: A({ id: 'aegis', key: 'R', name: 'Aegis Dome', kind: 'self', range: 0, gcd: false, role: 'ult', desc: 'Ultimate. A dome 9m across forms around you: nobody inside takes any damage for 5s. Buy the squad time.' }) }),
        TW('minigun', 'Minigun', 'Wild card. The hotter the barrels, the faster it fires. Vent the heat into a shield at the right moment: past 85 is a Perfect Vent, 100 jams the gun.',
          { id: 'spin', name: 'Barrel Heat', max: 100, start: 0, regen: -5, build: 12,
            how: 'Barrel Heat. Every burst adds 12 and fires faster the hotter you are. Vent turns heat into a shield; vent at 85 or more for a Perfect Vent (half again, and you keep half your heat). At 100 the gun jams for 3s.' },
          [{ id: 'spin', name: 'Minigun Burst', kind: 'enemy', range: 20, desc: 'Up to 80 depending on heat, high threat. Adds 12 heat and fires faster the hotter you are.' },
           { id: 'sweep', name: 'Barrel Sweep', kind: 'enemy', range: 20, cd: 8, desc: '120 to every enemy in a wide arc in front of you, high threat. Adds 20 heat.' },
           { id: 'vent', name: 'Vent', kind: 'self', range: 8, needs: 30, gcd: false, desc: 'Needs 30 heat. Dumps it all into a shield of 8 per point (Perfect Vent above 85: half again) and scalds everything within 8m.' }])
      ],
      utils: [
        A({ id: 'challenge', name: 'Challenge', kind: 'enemy', range: 30, cd: 8, gcd: false, desc: 'Taunt your target: it attacks you for 3s and you jump to the top of its threat.' }),
        A({ id: 'belt', name: 'Shield Belt', kind: 'self', range: 0, cd: 30, gcd: false, desc: 'Take half damage for 6s. Your big emergency button.' })
      ],
      ult: A({ id: 'wall', name: 'Riot Wall', kind: 'self', range: 0, gcd: false, role: 'ult', desc: 'Ultimate. For 6s an energy wall faces the Foreman: everyone standing behind you takes nothing from him, and you take half. Raise it before anything big lands.' })
    },
    healer: {
      role: 'healer', title: 'Medic', hp: 900,
      res: { id: 'nanites', name: 'Nanites', max: 100, start: 100, regen: 2.5, build: 12, spend: 25, min: 25, power: 3,
        how: 'Nanite Reserve. Heals on key 2 cost 25 and it barely refills on its own. Shooting the Foreman with key 1 harvests 12 a shot.' },
      blurb: 'Keep four health bars up. Your builder shoots the Foreman, and every shot patches someone up.',
      weapons: [
        TW('link', 'Link Gun', 'Aimed healing. Your shot snaps to whatever is nearest your crosshair: it heals a hurt ally or hits an enemy, and hitting enemies refills the Nanites your beam and burst spend. Where you stand decides who you can reach.',
          { id: 'nanites', name: 'Nanites', max: 100, start: 100, regen: 2.5, build: 0,
            how: 'Nanites. Every Link Bolt that hits an enemy harvests 7. The Link Beam drains 5 a second, Nanite Burst costs 35 and a Nano Field 25. They barely refill on their own: shoot to heal.' },
          [{ id: 'lbolt', key: 'LMB', name: 'Link Bolt', kind: 'aim', range: 35, hold: 'repeat', desc: 'Fires at whatever is nearest your crosshair, no precision needed. A hurt ally is healed for 70; an enemy takes 50 and gives you 7 Nanites. Allies at full health are skipped.' },
           { id: 'lbeam', key: 'RMB', name: 'Link Beam', kind: 'aim', range: 25, hold: 'channel', gcd: false, desc: 'Hold to latch onto the ally nearest your crosshair. The beam stays attached and heals 185 a second for 5 Nanites a second. It snaps if they get more than 25m away. No bolts while it\'s on.' },
           { id: 'lburst', key: 'L+R', name: 'Nanite Burst', kind: 'aim', range: 10, needs: 35, gcd: false, desc: 'Press both mouse buttons (35 Nanites). Heals everyone within 10m of you, you included, for 260. Get into the group, then pop it.' }],
          { aim: true,
            utils: [A({ id: 'field', key: 'Q', name: 'Nano Field', kind: 'aim', range: 25, cd: 10, cost: 25, desc: '25 Nanites. Hold to aim a healing grenade (look further up or down the room to throw it further or nearer), let go to throw. It lands as a 6m field, settling on any ally within 3m of where it lands. Anyone standing in it heals 70 a second for 6s.' }),
                    A({ id: 'purge', key: 'E', name: 'Purge', kind: 'friend', range: 30, cd: 6, gcd: false, desc: 'Cleanses Bio Sludge and heals for 60. Smart: it takes a sludged ally roughly in front of you first, then you if you have it, then whoever you point at.' }),
                    A({ id: 'cloak', key: 'F', name: 'Nanite Cloak', kind: 'self', range: 0, cd: 25, gcd: false, desc: 'You take 40% less damage for 4s. For when you had to stand somewhere dangerous to reach someone.' })],
            ult: A({ id: 'storm', key: 'R', name: 'Link Storm', kind: 'self', range: 25, gcd: false, role: 'ult', desc: 'Ultimate. Every ally within 25m of you is instantly healed for 35% of their health, then your beam links to all of them for 5s, healing each 150 a second. Free.' }) }),
        W('bio', 'Bio Rifle', 'Heals over time, all instant. Keep Sprays rolling on the squad: Bio Bloom heals 20% more for each one.',
          { id: 'acid', name: 'Corrosive Glob', kind: 'enemy', range: 30, procChance: 0.25, desc: '45 damage plus 90 more over 6s. The two most hurt allies get 35. Harvests 12 Nanites.' },
          { id: 'spray', name: 'Bio Spray', kind: 'friend', range: 30, desc: '25 Nanites. Instant 175, then 150 over 6s. With half your reserve left, everyone within 7m gets the 150.' },
          { id: 'glob', name: 'Bio Bloom', kind: 'friend', range: 30, desc: 'Proc. Heals everyone within 8m of the target for 200.' }),
        W('shield', 'Shield Gun', 'Shield before the hit. A shield that gets fully used gives you 10 Nanites back, so read the fight.',
          { id: 'pulse', name: 'Kinetic Pulse', kind: 'enemy', range: 30, procChance: 0.2, desc: '60 damage, and a 60 shield on the most hurt ally. Harvests 12 Nanites.' },
          { id: 'barrier', name: 'Barrier', kind: 'friend', range: 35, desc: '25 Nanites. Heals 50 and shields 280, up to 450.' },
          { id: 'bulwark', name: 'Bulwark', kind: 'friend', range: 35, desc: 'Proc. Everyone within 8m of the target gets a 250 shield.' })
      ],
      utils: [
        A({ id: 'keg', name: 'Health Keg', kind: 'self', range: 40, cd: 20, desc: 'Heals the whole squad within 40m.' }),
        A({ id: 'purge', name: 'Purge', kind: 'friend', range: 40, cd: 6, desc: 'Removes Bio Sludge and heals a little.' })
      ],
      ult: A({ id: 'hospital', name: 'Field Hospital', kind: 'self', range: 40, gcd: false, role: 'ult', desc: 'Ultimate. Everyone within 40m is cleansed, healed for half their health and takes half damage for 4s.' })
    },
    dps: {
      role: 'dps', title: 'Striker', hp: 900,
      res: { id: 'cap', name: 'Capacitor', max: 100, start: 60, regen: 8, build: 0, spend: 50, min: 50, power: 4,
        how: 'Capacitor. Recharges on its own. Key 1 is free, key 2 drains 50. Fire as it fills, or pool to 100 and dump two in a row. Crits give 10 back.' },
      blurb: 'Ranged damage from a safe distance.',
      weapons: [
        W('shock', 'Shock Rifle', 'The combo rifle. Beam marks, Core within 3s detonates the mark for 40% more.',
          { id: 'beam', name: 'Shock Beam', kind: 'enemy', range: 35, procChance: 0.2, desc: 'Free. Instant 70. Marks the target for 3s.' },
          { id: 'core', name: 'Shock Core', kind: 'enemy', range: 35, cast: 1.2, desc: '50 Capacitor. 390, 1.2s cast. 40% more on a marked target: the Shock Combo.' },
          { id: 'gib', name: 'Instagib', kind: 'enemy', range: 50, desc: 'Proc. Instant 380.' }),
        W('rockets', 'Rocket Launcher', 'Lock-on. Each Rocket on a target adds a rocket to your next Volley, up to five in the salvo. All instant.',
          { id: 'rocket', name: 'Rocket', kind: 'enemy', range: 30, procChance: 0.2, desc: 'Free. 85, splashing 55 within 4m. Adds a Lock-on.' },
          { id: 'volley', name: 'Rocket Volley', kind: 'enemy', range: 30, desc: '50 Capacitor. Two rockets of 110 plus one for each Lock-on (up to 3), each splashing 45.' },
          { id: 'seeker', name: 'Seeker Swarm', kind: 'enemy', range: 40, desc: 'Proc. Three homing rockets of 110, spread over nearby enemies.' }),
        W('sniper', 'Sniper Rifle', 'Steady Aim. Each second you stand still adds 5% crit, up to 15%. Executes low and staggered targets.',
          { id: 'scope', name: 'Quick Scope', kind: 'enemy', range: 50, procChance: 0.2, desc: 'Free. Instant 65. Always procs on a target below 35% or staggered.' },
          { id: 'snipe', name: 'Snipe', kind: 'enemy', range: 50, cast: 1.8, desc: '50 Capacitor. 390, 1.8s cast, stand still.' },
          { id: 'headshot', name: 'Headshot', kind: 'enemy', range: 50, desc: 'Proc. Instant 420.' })
      ],
      utils: [
        A({ id: 'adren', name: 'Adrenaline', kind: 'self', range: 0, cd: 45, gcd: false, desc: '40% more damage for 8s.' }),
        A({ id: 'trans', name: 'Translocator', kind: 'self', range: 0, cd: 10, gcd: false, desc: 'Jump 12m the way you are moving, or away from your target.' })
      ],
      ult: A({ id: 'deadeye', name: 'Deadeye', kind: 'self', range: 0, gcd: false, role: 'ult', desc: 'Ultimate. One perfect shot from any range: 700 to your target, a full Capacitor and your proc lit.' })
    },
    melee: {
      role: 'melee', title: 'Wrecker', hp: 1100,
      res: { id: 'revs', name: 'Revs', max: 5, start: 0, regen: 0, build: 1, spend: 'all', min: 1, per: 1,
        how: 'Revs. Key 1 revs the engine up to 5, key 2 cashes every rev in at once.' },
      blurb: 'Melee damage. Stay out of the Foreman\'s front.',
      weapons: [
        W('chainsaw', 'Chainsaw', 'Positional bleeder. Double Revs from behind; Saw Through leaves a Bleed, and Rips on a bleeding target proc more.',
          { id: 'rip', name: 'Rip', kind: 'enemy', range: 4, procChance: 0.15, desc: 'Melee 80 and a Rev. From behind: 50% more and two Revs.' },
          { id: 'saw', name: 'Saw Through', kind: 'enemy', range: 4, desc: 'Spends all Revs. 80 + 70 a Rev, 50% more from behind. Leaves a Bleed for 2s a Rev.' },
          { id: 'overdrive', name: 'Overdrive', kind: 'enemy', range: 4, desc: 'Proc. 300, 50% more from behind.' }),
        W('ripper', 'Ripper', 'Returning blades at mid range. Ricochet bounces to nearby enemies, or comes back through a lone target, and makes your next two Razors return.',
          { id: 'razor', name: 'Razor', kind: 'enemy', range: 18, procChance: 0.2, desc: 'Thrown blade for 120 at 18m. One Rev.' },
          { id: 'bounce', name: 'Ricochet', kind: 'enemy', range: 18, desc: 'Spends all Revs. 95 + 80 a Rev, bouncing half of that to two more enemies.' },
          { id: 'storm', name: 'Blade Storm', kind: 'self', range: 18, desc: 'Proc. 320 to every enemy within 18m of you.' }),
        W('enforcers', 'Dual Enforcers', 'Run and gun. 35% harder while moving, and every third Double Tap is a Trick Shot that always crits.',
          { id: 'tap', name: 'Double Tap', kind: 'enemy', range: 10, procChance: 0.2, desc: '88, 35% more while moving. One Rev.' },
          { id: 'fan', name: 'Fan the Hammer', kind: 'enemy', range: 10, desc: 'Spends all Revs. One shot a Rev plus one: 64 each, 35% more while moving.' },
          { id: 'draw', name: 'Quick Draw', kind: 'enemy', range: 10, desc: 'Proc. Instant 330, 35% more while moving.' })
      ],
      utils: [
        A({ id: 'dash', name: 'Dash', kind: 'enemy', range: 20, cd: 10, gcd: false, desc: 'Rush to your target, behind it if it is the Foreman.' }),
        A({ id: 'adren', name: 'Adrenaline', kind: 'self', range: 0, cd: 45, gcd: false, desc: '40% more damage for 8s.' })
      ],
      ult: A({ id: 'slam', name: 'Wrecking Slam', kind: 'enemy', range: 8, gcd: false, role: 'ult', desc: 'Ultimate. 450 to your target and it staggers for 3s: it stops attacking and the whole squad hits it 30% harder.' })
    }
  };
  var BACKSTAB = { rip: 1, saw: 1, overdrive: 1 };

  /* ---------- talents ----------
     Each class has its own tree: four tiers, three picks a tier, always in the same order:
       aggressive - takes risks for bursts of power
       steady     - holds ground and stays consistent
       squad      - makes the people around you stronger
     Ids are unique within a class. A few mechanics appear in more than one class under that class's name. */
  var STYLES = { aggressive: 'Aggressive', steady: 'Steady', squad: 'Squad', active: 'Active', passive: 'Passive', modifier: 'Modifier' };
  var SLOTS = ['boots', 'rig', 'implant', 'util'];
  function t(id, style, name, play, desc) { return { id: id, style: style, name: name, play: play, desc: desc }; }
  var TALENTS = {
    tank: {
      theme: 'Riot enforcer in a walking bulkhead. Plant the shield, swing the hammer, shove the room where you want it.',
      tiers: ['Charge', 'Shield', 'Shove', 'Challenge'],
      boots: [
        t('ram', 'aggressive', 'Battering Ram', 'Through them, not around them.', 'Riot Charge hits everything you plough past for 200 and high threat.'),
        t('twincharge', 'steady', 'Twin Thrusters', 'Always have a way in.', 'Riot Charge holds two charges.'),
        t('intercept', 'squad', 'Intercept', 'Go to whoever needs you.', 'Riot Charge flies 34m instead of 22, and if you reach a squad member it stops and gives them a 250 shield.')
      ],
      // Rows 2 to 4 never add a button: each changes one you already have (your shield, your spender, your taunt).
      rig: [
        t('spikes', 'aggressive', 'Spiked Barrier', 'Shield: make them pay.', 'Whatever hits your barrier takes 30% of the blocked damage back (the Flak Screen\'s shrapnel doubles).'),
        t('hardened', 'steady', 'Hardened Emitters', 'Shield: hold longer.', 'Your barrier has 2,500 health instead of 1,800 and recovers twice as fast (Flak Screen lasts 1s longer, Vent shields 25% more).'),
        t('firingline', 'squad', 'Firing Line', 'Shield: shoot from behind me.', 'Squad members your barrier is covering deal 15% more damage.')
      ],
      implant: [
        t('piledriver', 'aggressive', 'Piledriver', 'Shove: hit like a wrecking ball.', 'Shove hits 40% harder, and anything you slam is stunned for 3s instead of 2.'),
        t('capacitor', 'steady', 'Capacitor Bank', 'Shove: more often.', 'Everything that fills Shield Energy fills it 50% faster.'),
        t('breathing', 'squad', 'Breathing Room', 'Shove: clear space for them.', 'Shove also shields every squad member within 8m of you for 50, up to 200 with a full bar.')
      ],
      util: [
        t('brand', 'aggressive', 'Brand', 'Challenge: mark it for the squad.', 'Whatever you Challenge takes 15% more damage from everyone for 6s.'),
        t('daze', 'steady', 'Daze', 'Challenge: ring its bell.', 'Challenge stuns a drone for 2s. The Foreman hits 25% softer for 4s instead.'),
        t('protector', 'squad', 'Protector', 'Challenge: step in front.', 'Challenge also shields whoever it was attacking for 250.')
      ]
    },
    healer: {
      theme: 'Field surgeon on a nanite link. Reach the squad wherever they stand: link them, burst them, drop a field under them.',
      tiers: ['Footwork', 'Link', 'Burst', 'Field'],
      // Space changes on every Medic weapon. Rows 2 to 4 change the Link Gun's beam, Nanite Burst and Nano Field; the Bio Rifle
      // and Shield Gun get their own versions when they're converted to aimed weapons.
      boots: [
        t('stim', 'aggressive', 'Stim Leap', 'Leap in, heal hot.', 'Space leaps 9m the way you are moving (8s). For 3s after you land, your heals are 30% stronger.'),
        t('skates', 'steady', 'Nanite Skates', 'Always in reach.', 'Space gives you 50% more speed for 3s (8s), and you can keep beaming and shooting the whole time.'),
        t('medevac', 'squad', 'Medevac', 'Go to them.', 'Space leaps to the ally nearest your crosshair (or the most hurt) within 25m and gives them a 150 shield (12s).')
      ],
      rig: [
        t('siphon', 'aggressive', 'Siphon Link', 'Beam: heal one, hurt another.', 'Your beam also arcs from your ally to the nearest enemy within 10m of them for 70 a second. Heal and hurt at once.'),
        t('longlink', 'steady', 'Long Link', 'Beam: never let go.', 'Your beam latches from 40m instead of 25, only snaps past 42m, and drains 3 Nanites a second instead of 5.'),
        t('chainlink', 'squad', 'Chain Link', 'Beam: two at once.', 'Your beam jumps on to the most hurt ally within 12m of your target (you included) and heals them for half as much. A second green line shows the jump.')
      ],
      implant: [
        t('shockburst', 'aggressive', 'Shock Burst', 'Burst: clear them off.', 'Nanite Burst also blasts every enemy within 10m for 200 and stuns drones for 1.5s.'),
        t('recycler', 'steady', 'Recycler', 'Burst: little and often.', 'Nanite Burst gives back 8 Nanites for every hurt ally it heals: catch four and it costs 3.'),
        t('burstshield', 'squad', 'Burst Shield', 'Burst: get ahead of the hit.', 'Nanite Burst also leaves everyone it touches with a 200 shield.')
      ],
      util: [
        t('caustic', 'aggressive', 'Caustic Field', 'Field: it bites.', 'Enemies standing in your Nano Field take 80 a second.'),
        t('lingering', 'steady', 'Lingering Field', 'Field: lasts longer.', 'Your Nano Field lasts 10s instead of 6.'),
        t('purgefield', 'squad', 'Purging Field', 'Field: wash it off.', 'Your Nano Field cleanses Bio Sludge from each person once as they step in, but it\'s ready every 16s instead of 10.')
      ]
    },
    dps: {
      theme: 'Tournament champion. Showboat for the crowd: dodge, combo, headshot, go on a spree.',
      tiers: ['Footwork', 'Kit', 'Marksmanship', 'Showmanship'],
      boots: [
        t('dodge', 'aggressive', 'Dodge Jump', 'Never stand still.', 'Space dodges 7m the way you are moving (4s). Your next shot within 2s does 30% more.'),
        t('mag', 'steady', 'Sniper\'s Perch', 'Find a spot and hold it.', 'Stand still for 2s to Brace: casts 25% faster, 15% less damage taken, and charges can\'t knock you back. Moving breaks it.'),
        t('cover', 'squad', 'Covering Fire', 'Watch their backs.', 'While you stand still, squad members within 10m of you take 10% less damage.')
      ],
      rig: [
        t('pump', 'aggressive', 'Adrenaline Rush', 'Play on the edge.', 'Drop below 30% health and for 6s you deal and heal 40% more and take 25% less. Once a minute.'),
        t('plate', 'steady', 'Thigh Pads', 'Shrug off the big hit.', 'Ignore the first hit of 100 or more every 20s.'),
        t('decoy', 'squad', 'Decoy Beacon', 'Draw fire off a friend.', 'When the Foreman drops a squad member below 25%, he turns on you for 3s instead. Every 45s.')
      ],
      implant: [
        t('pointblank', 'aggressive', 'Point Blank', 'Get in close.', '30% more damage to anything within 10m of you. The cleave and the charge live there too.'),
        t('marksman', 'steady', 'Marksman', 'Hang back, stay safe.', '30% more damage to anything 18m or more away.'),
        t('spotter', 'squad', 'Spotter', 'Mark targets for the squad.', 'Your hits mark the target for 5s. The whole squad deals 6% more damage to it.')
      ],
      util: [
        t('spree', 'aggressive', 'Killing Spree', 'Chain the highlights.', 'Each Combo, proc hit or kill adds a Spree stack: 8% more damage each, up to 5, for 15s.'),
        t('breaker', 'steady', 'Shield Breaker', 'Call the shield and crack it.', 'Your hits do 40% more to the overcharge shield. When it breaks, your proc lights up.'),
        t('uplink', 'squad', 'Team Uplink', 'Stay close, crit together.', 'You and every squad member within 12m crit 8% more often.')
      ]
    },
    melee: {
      theme: 'Demolition berserker. Momentum, mess and noise. The longer you keep swinging, the worse it gets for them.',
      tiers: ['Momentum', 'Hide', 'Butchery', 'Mayhem'],
      boots: [
        t('afterburner', 'aggressive', 'Afterburner', 'Dash in constantly.', 'Dash is ready every 5s. For 3s after a Dash, every hit counts as from behind.'),
        t('clamps', 'steady', 'Mag-Clamps', 'Bolt yourself to the floor.', 'Charges can\'t knock you back and the Foreman\'s cleave does half damage to you.'),
        t('escort', 'squad', 'Breach Team', 'Bring them with you.', 'You and every squad member within 8m of you move 20% faster.')
      ],
      rig: [
        t('pump', 'aggressive', 'Bloodrush', 'Fight harder when hurt.', 'Drop below 30% health and for 6s you deal and heal 40% more and take 25% less. Once a minute.'),
        t('plate', 'steady', 'Riveted Hide', 'Shrug off the big hit.', 'Ignore the first hit of 100 or more every 20s.'),
        t('meatshield', 'squad', 'Meat Shield', 'Take the hit for them.', 'When a squad member below 25% health is about to be hit, you take it instead. Every 45s.')
      ],
      implant: [
        t('rampage', 'aggressive', 'Rampage', 'Never stop swinging.', 'Each hit within 4s of your last adds 5% damage, up to 40%. A 4s gap resets it.'),
        t('flanker', 'steady', 'Flanker', 'Hold the back line.', 'Key 1 gives an extra Rev when it hits from behind.'),
        t('hamstring', 'squad', 'Hamstring', 'Blunt his hits for the tank.', 'Your hits from behind make the target deal 15% less damage for 4s.')
      ],
      util: [
        t('opportunist', 'aggressive', 'Thrill Seeker', 'Dodge late, strike hard.', 'Leave a red zone in its last second and you deal and heal 30% more for 6s.'),
        t('breaker', 'steady', 'Can Opener', 'Rip the shield open.', 'Your hits do 40% more to the overcharge shield. When it breaks, your Revs are full.'),
        t('warcry', 'squad', 'War Cry', 'Lead the charge.', 'Dash gives every squad member within 10m 15% more damage for 5s.')
      ]
    }
  };
  function talentList(slot, role) { return (TALENTS[role] && TALENTS[role][slot]) || []; }
  /* Kept for the armory, stats and reports: GEAR[slot][role] lists a class's picks for one tier. */
  var GEAR = {};
  SLOTS.forEach(function (slot) { GEAR[slot] = {}; Object.keys(TALENTS).forEach(function (r) { GEAR[slot][r] = TALENTS[r][slot]; }); });
  /* What the bots take: a mix of styles, close to an average person's build. */
  var BOT_GEAR = {
    tank: { weapon: 'hammer', boots: 'twincharge', rig: 'hardened', implant: 'breathing', util: 'brand' },
    healer: { weapon: 'link', boots: 'medevac', rig: 'chainlink', implant: 'burstshield', util: 'lingering' },
    dps: { weapon: 'rockets', boots: 'dodge', rig: 'pump', implant: 'spotter', util: 'breaker' },
    melee: { weapon: 'chainsaw', boots: 'escort', rig: 'pump', implant: 'flanker', util: 'breaker' }
  };
  function validGear(role, g) {
    var out = {}, has = function (list, id) { return list.some(function (x) { return x.id === id; }); };
    g = g || {};
    out.weapon = has(KITS[role].weapons, g.weapon) ? g.weapon : KITS[role].weapons[0].id;
    SLOTS.forEach(function (slot) { var list = talentList(slot, role); out[slot] = has(list, g[slot]) ? g[slot] : list[0].id; });
    return out;
  }
  function gearName(slot, id, role) {
    var list = slot === 'weapon' ? KITS[role].weapons : talentList(slot, role);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return id;
  }

  var TUNE = {
    /* Bot "hands": how a person drives a keyboard. Fitted later from real movement (see moveStats in summary).
       hold: seconds a key direction is held before re-deciding. aim: radians of error on a new direction.
       eightWay: WASD gives eight directions relative to the camera, not any angle. */
    hands: { holdMin: 0.12, holdMax: 0.34, aim: 0.22, release: 0.07, eightWay: true },
    bossHp: 165000, bossMelee: 515, bossSwing: 2.0, cleaveMult: 0.5,
    barrageEvery: 12, barrageDelay: 2.6, barrageR: 6, barrageDmg: 660,
    // Overcharge shield: break it inside the window or the whole room takes the pulse. Breaking it staggers him.
    // Overcharge: energy fills over overEvery seconds, then he walks to the middle, channels a shield and pulses the room.
    overEvery: 34, overShield: 10000, overWindow: 14, overDmg: 600, staggerDur: 7, staggerBonus: 1.3,
    pulseEvery: 2, pulseDmg: 80, centreSpeed: 10,
    // The Foreman leaps onto someone (long warning), and in phase three tears up sections of floor.
    leapEvery: 24, leapDelay: 2.6, leapR: 7, leapDmg: 520, p3At: 0.25,
    // Ultimates fill in about a minute. Hero moments call on one class at a time; missing one hurts, it never wipes.
    // Scripted hero moments (the boss calls one class to answer with its ultimate) are built but switched off for
    // the Foreman: ultimates are free-use here. A future boss turns them on.
    heroMoments: false, slamStagger: 3,
    ultRate: 1.7, ultStart: 40, heroFirst: 35, heroEvery: 38, wallDur: 6,
    blastCast: 6, blastDmg: 520, meltCast: 3, radDur: 8, rocketDur: 7, rocketDmg: 520, haymakerCast: 5, haymakerDmg: 900,
    collapseEvery: 15, collapseDelay: 3.0, collapseMax: 4, collapseDps: 240, collapseR0: 7, droneEveryP3: 40,
    chargeEvery: 19, chargeDelay: 1.8, chargeW: 4.5, chargeDmg: 380,
    // Crusher: a telegraphed tank buster on whoever the Foreman is fighting. Mitigate it or eat most of your health.
    // Impact Hammer: combo pacing, Aegis Dome size, Riot Charge recharge, and how the barrier holds and recovers.
    boltGcd: 0.6, lobTime: 0.6, swingGcd: 0.6, slamGcd: 0.9, comboReset: 2, aegisR: 9, aegisDur: 5, chargeCd: 10,
    barrierHp: 1800, barrierRegen: 180, barrierRest: 1.5, barrierBreak: 5,
    busterEvery: 15, busterCast: 2.5, busterDmg: 1860,
    droneEvery: 32, droneHp: 1600, droneMelee: 90, droneSwing: 1.5,
    sludgeEvery: 15, sludgeDur: 12, sludgeTick: 75,
    enrageAt: 300, shiftEnd: 420
  };

  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function dist(a, b) { var dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }
  function clampArena(e, pad) {
    var r = Math.sqrt(e.x * e.x + e.z * e.z), max = ARENA_R - (pad || 1);
    if (r > max) { e.x *= max / r; e.z *= max / r; }
  }
  /* A player's resource: their weapon's own if it has one (the Juggernaut's do), otherwise their class's. */
  function resOf(p) { var w = p.kit.weapons[p.weapon]; return (w && w.res) || p.kit.res; }
  /* A raised Energy Barrier that covers p from a hit coming from src: src in front of it, p behind or level with it. */
  function barrierMax(p) { return T(p, 'hardened') ? 2500 : TUNE.barrierHp; }
  /* Impact Hammer Shield Energy: swings and blocks fill it (Capacitor Bank: half as fast again). */
  function addEnergy(p, n) {
    if (!p.alive || p.kit.weapons[p.weapon].id !== 'hammer') return;
    p.pips = Math.min(resOf(p).max, (p.pips || 0) + n * (T(p, 'capacitor') ? 1.5 : 1));
  }
  function barrierFor(S, p, src) {
    return players(S, true).filter(function (q) {
      if (!q.barrierUp) return false;
      var fx = Math.sin(q.facing), fz = Math.cos(q.facing);
      var sx = src.x - q.x, sz = src.z - q.z, sl = Math.sqrt(sx * sx + sz * sz) || 1;
      if ((sx * fx + sz * fz) / sl < 0.2) return false;            // the hit has to come from in front
      if (q === p) return true;
      var rx = p.x - q.x, rz = p.z - q.z, along = rx * fx + rz * fz, lat = Math.abs(rx * fz - rz * fx);
      return along <= 0.5 && along >= -9 && lat <= 4;
    })[0] || null;
  }
  function abilitiesOf(p) {
    var w = p.kit.weapons[p.weapon];
    return w.abilities.concat(w.utils || p.kit.utils, [w.ult || p.kit.ult]);
  }
  /* Riot Wall: standing in the Juggernaut's shadow (behind them, away from the Foreman, within 14m) blocks his damage. */
  function sheltered(S, q) {
    var boss = ent(S, S.bossId);
    if (!boss || !boss.alive) return false;
    return players(S, true).some(function (t) {
      if (t === q || !(t.wall > 0)) return false;
      var bx = t.x - boss.x, bz = t.z - boss.z, bl = Math.sqrt(bx * bx + bz * bz) || 1;
      var qx = q.x - t.x, qz = q.z - t.z, ql = Math.sqrt(qx * qx + qz * qz);
      if (ql > 14) return false;
      if (ql < 1.5) return true;
      return (qx * bx + qz * bz) / (ql * bl) > 0.7;
    });
  }
  function critChance(S, p) {
    var c = CRIT_CHANCE + (T(p, 'livefire') ? 0.05 : 0) + (nearby(S, p, 'uplink', 12) ? 0.08 : 0);
    if (p.kit.weapons[p.weapon].id === 'sniper') c += 0.05 * Math.min(3, Math.floor(p.still || 0));   // Steady Aim
    if (p.trick) c = 1;                                                                              // Enforcers: every third Double Tap
    return c;
  }
  function braced(p) { return T(p, 'mag') && p.alive && (p.still || 0) >= 2; }
  /* Does this player have talent id, in whichever tier their class keeps it? */
  function T(p, id) { var g = p.gear; return !!g && (g.boots === id || g.rig === id || g.implant === id || g.util === id); }
  function nearby(S, p, id, range) {
    return players(S, true).some(function (q) { return T(q, id) && dist(q, p) <= range; });
  }
  function isWeaponAbility(p, ab) { return p.kit.weapons[p.weapon].abilities.indexOf(ab) >= 0; }
  function reach(p, ab) { return ab.range; }
  /* A talent going off. scope 'all' is called out to the whole squad, 'self' only to its owner. */
  function proc(S, p, talent, text, scope) { S.events.push({ type: 'proc', id: p.id, role: p.role, talent: talent, text: text, scope: scope || 'self' }); }
  function behind(p, e) {
    var fx = Math.sin(e.facing), fz = Math.cos(e.facing), dx = p.x - e.x, dz = p.z - e.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
    return (fx * dx + fz * dz) / l < -0.3;
  }
  /* telegraph geometry */
  function segDist(px, pz, g) {
    var vx = g.x2 - g.x1, vz = g.z2 - g.z1, l2 = vx * vx + vz * vz || 1;
    var t = Math.max(0, Math.min(1, ((px - g.x1) * vx + (pz - g.z1) * vz) / l2));
    var cx = g.x1 + vx * t, cz = g.z1 + vz * t;
    return { d: Math.sqrt((px - cx) * (px - cx) + (pz - cz) * (pz - cz)), cx: cx, cz: cz };
  }
  function inTele(g, p, pad) {
    pad = pad || 0;
    if (g.shape === 'line') return segDist(p.x, p.z, g).d <= g.w / 2 + pad;
    if (g.shape === 'sector') {
      var r = Math.sqrt(p.x * p.x + p.z * p.z);
      if (r < g.r0 - pad || r > g.r1 + pad) return false;
      var pa = pad / Math.max(r, 1), a = angleIn(Math.atan2(p.x, p.z), g.a0 - pa);
      return a <= g.a1 + pa;
    }
    return dist(p, g) <= g.r + pad;
  }
  /* Angle a moved into the turn that starts at from, so sector checks never trip over the wrap at 2 pi. */
  function angleIn(a, from) { while (a < from) a += Math.PI * 2; while (a >= from + Math.PI * 2) a -= Math.PI * 2; return a; }
  function escapeDir(g, p) {
    var dx, dz;
    if (g.shape === 'sector') {
      // Off a collapsing floor section: whichever is nearest, inward or round either edge.
      var r = Math.sqrt(p.x * p.x + p.z * p.z) || 1, a = angleIn(Math.atan2(p.x, p.z), g.a0);
      var dIn = r - g.r0, d0 = (a - g.a0) * r, d1 = (g.a1 - a) * r, m = Math.min(dIn, d0, d1);
      if (m === dIn) { dx = -p.x / r; dz = -p.z / r; }
      else { var sgn = m === d0 ? -1 : 1; dx = Math.cos(a) * sgn; dz = -Math.sin(a) * sgn; }
      return { x: dx, z: dz };
    }
    if (g.shape === 'line') { var s = segDist(p.x, p.z, g); dx = p.x - s.cx; dz = p.z - s.cz; if (Math.abs(dx) + Math.abs(dz) < 0.2) { dx = -(g.z2 - g.z1); dz = g.x2 - g.x1; } }
    else { dx = p.x - g.x; dz = p.z - g.z; if (Math.abs(dx) + Math.abs(dz) < 0.2) { dx = -p.x || 1; dz = -p.z; } }
    var l = Math.sqrt(dx * dx + dz * dz) || 1; dx /= l; dz /= l;
    // Running into the wall leaves you stuck in the red: turn along it instead.
    if (Math.sqrt(Math.pow(p.x + dx * 4, 2) + Math.pow(p.z + dz * 4, 2)) > ARENA_R - 1.5) { var t = dx; dx = -dz; dz = t; }
    return { x: dx, z: dz };
  }

  /* opts: { humans: [{ role, gear, name, key }], seed, humanAuto }
     Solo shorthand: { humanRole, gear }. Slots without a human are bots. */
  function create(opts) {
    opts = opts || {};
    var humans = opts.humans || (opts.humanRole ? [{ role: opts.humanRole, gear: opts.gear, name: 'YOU' }] : []);
    var S = {
      t: 0, phase: 1, result: null, enraged: false, countdown: 4,
      ents: [], telegraphs: [], events: [], revives: [], domes: [], fields: [], nextId: 1,
      m: { p: {}, taken: {}, killers: {}, shields: { raised: 0, broken: 0 }, heroes: { tank: [0, 0], healer: [0, 0], dps: [0, 0], melee: [0, 0] } },
      rng: makeRng(opts.seed || 12345),
      timers: { buster: 11, barrage: 8, over: 22, drone: 4, sludge: 7, charge: 13, leap: 30, collapse: 6, hero: 0 },
      hero: null, heroIdx: 0, missile: null,
      humanId: null
    };
    var slots = [
      { role: 'tank', name: 'BRICK', x: 0, z: -9 },
      { role: 'healer', name: 'SUTURE', x: -5, z: -20 },
      { role: 'dps', name: 'VOLT', x: 9, z: -18 },
      { role: 'melee', name: 'GRINDER', x: -9, z: -12 }
    ];
    slots.forEach(function (sl) {
      var kit = KITS[sl.role];
      var h = humans.filter(function (x) { return x.role === sl.role; })[0];
      var isHuman = !!h;
      var p = {
        id: S.nextId++, kind: 'player', role: sl.role, kit: kit,
        name: isHuman ? String(h.name || 'YOU').slice(0, 14).toUpperCase() : sl.name, human: isHuman, key: isHuman ? (h.key || null) : null,
        auto: !isHuman || !!opts.humanAuto,
        x: sl.x, z: sl.z, facing: 0, moving: false, speed: 7, inMx: 0, inMz: 0,
        hp: kit.hp, maxHp: kit.hp, alive: true, target: null,
        weapon: 0, gear: validGear(sl.role, isHuman ? h.gear : BOT_GEAR[sl.role]), pump: 0, afterburn: 0, mark: null,
        cast: null, gcd: 0, cds: {}, queued: null,
        belt: 0, adren: 0, amp: 0, armor: 0, hot: 0, sludge: 0, sludgeAcc: 0,
        pips: 0, procT: 0, ult: TUNE.ultStart,
        bot: { danger: 0, react: 0.35 + S.rng() * 0.3, think: S.rng() * 0.5, slow: 1 }
      };
      p.weapon = Math.max(0, kit.weapons.map(function (w) { return w.id; }).indexOf(p.gear.weapon));
      p.pips = resOf(p).start;
      if (p.role === 'tank') p.charges = T(p, 'twincharge') ? 2 : 1;
      if (isHuman && S.humanId == null) S.humanId = p.id;
      S.ents.push(p);
    });
    var boss = {
      id: S.nextId++, kind: 'enemy', type: 'boss', name: 'THE FOREMAN',
      x: 0, z: 6, facing: Math.PI, speed: 5, radius: 3.5,
      hp: TUNE.bossHp, maxHp: TUNE.bossHp, alive: true,
      threat: {}, target: null, fixate: null, swing: 1.5,
      melee: TUNE.bossMelee, swingInt: TUNE.bossSwing, cast: null, charging: null
    };
    S.ents.push(boss);
    S.bossId = boss.id;
    boss.threat[S.ents[0].id] = 50;
    return S;
  }

  function ent(S, id) {
    for (var i = 0; i < S.ents.length; i++) if (S.ents[i].id === id) return S.ents[i];
    return null;
  }
  function players(S, aliveOnly) {
    return S.ents.filter(function (e) { return e.kind === 'player' && (!aliveOnly || e.alive); });
  }
  function enemies(S) {
    return S.ents.filter(function (e) { return e.kind === 'enemy' && e.alive; });
  }
  function emit(S, ev) { S.events.push(ev); }
  function addThreat(S, enemy, pid, amt) { enemy.threat[pid] = (enemy.threat[pid] || 0) + amt; }

  /* Fight metrics: what each player did and what hurt the squad. summary() turns them into one record per fight. */
  function met(S, id) {
    S.m = S.m || { p: {}, taken: {}, killers: {}, shields: { raised: 0, broken: 0 } };
    return S.m.p[id] || (S.m.p[id] = { dmg: 0, heal: 0, taken: 0, deaths: 0, hits: 0, crits: 0, shield: 0, ults: 0, mvT: 0, liveT: 0, holdSum: 0, holdN: 0, redSum: 0, redN: 0 });
  }
  function damageEnemy(S, src, tgt, amt, threatMult, label) {
    if (!tgt.alive) return 0;
    var crit = false;
    if (src.kind === 'player') {
      amt *= (src.adren > 0 ? 1.4 : 1) * (src.amp > 0 ? 1.5 : 1) * (src.pump > 0 ? 1.4 : 1);
      amt *= (src.boostNow || 1) * (src.opp > 0 ? 1.3 : 1) * (src.counter > 0 ? 1.4 : 1) * (src.stimmed > 0 ? 1.25 : 1) * (src.warcry > 0 ? 1.15 : 1);
      amt *= 1 + 0.08 * (src.spree || 0);
      if (T(src, 'rampage')) {
        // Wrecker: keep swinging and it keeps climbing.
        var was = src.rampage || 0;
        src.rampage = S.t - (src.lastHitT === undefined ? -99 : src.lastHitT) <= 4 ? Math.min(8, was + 1) : 0;
        src.lastHitT = S.t;
        if (src.rampage === 8 && was < 8) proc(S, src, 'rampage', 'RAMPAGE');
        amt *= 1 + 0.05 * src.rampage;
      }
      var range = dist(src, tgt) - (tgt.radius || 0);
      // Firing Line: shooting from behind a Juggernaut's barrier.
      if (src.role !== 'tank' && players(S, true).some(function (q) { return T(q, 'firingline') && barrierFor(S, src, tgt) === q; })) amt *= 1.15;
      if (T(src, 'marksman') && range >= 18) amt *= 1.3;
      if (T(src, 'pointblank') && range <= 10) amt *= 1.3;
      if (T(src, 'spotter')) tgt.spotted = 5;   // squad-wide, so it stays small
      if (T(src, 'hamstring') && behind(src, tgt)) tgt.hamstrung = 4;
      // Every hit rolls 85% to 115%, and some crit.
      amt *= 0.85 + S.rng() * 0.3;
      var q0 = met(S, src.id); q0.hits++;
      if (S.rng() < critChance(S, src)) {
        amt *= CRIT_MULT; crit = true; src.critThis = true; q0.crits++;
        if (src.role === 'dps') src.pips = Math.min(resOf(src).max, (src.pips || 0) + 10);
      }
    }
    if (tgt.spotted > 0) amt *= 1.06;
    if (tgt.branded > 0) amt *= 1.15;
    if (tgt.stagger > 0) amt *= TUNE.staggerBonus;
    amt = Math.round(amt);
    var shown = amt, soaked = 0;
    if (tgt.oshield && tgt.oshield.hp > 0) {
      // The overcharge shield soaks hits first. Breaker talents hit it 40% harder.
      var bx = src.kind === 'player' && T(src, 'breaker') ? 1.4 : 1;
      soaked = Math.min(tgt.oshield.hp, amt * bx);
      tgt.oshield.hp -= soaked;
      if (src.kind === 'player') met(S, src.id).shield += soaked;
      amt = Math.max(0, Math.round(amt - soaked / bx));
      if (tgt.oshield.hp <= 0) breakShield(S, tgt, src);
    }
    var dealt = Math.min(amt, tgt.hp);
    if (src.kind === 'player') met(S, src.id).dmg += dealt;
    tgt.hp -= amt;
    addThreat(S, tgt, src.id, shown * (threatMult || 1));
    emit(S, { type: 'dmg', src: src.id, dst: tgt.id, amt: shown, label: label, crit: crit ? 1 : 0, sh: soaked > 0 ? 1 : 0 });
    var killed = tgt.hp <= 0;
    if (killed) {
      tgt.hp = 0; tgt.alive = false; tgt.cast = null; tgt.charging = null;
      emit(S, { type: 'death', id: tgt.id });
    }
    if (src.kind === 'player' && T(src, 'spree') && (killed || /!$/.test(label))) {
      // Striker: the crowd loves a highlight.
      src.spree = Math.min(5, (src.spree || 0) + 1); src.spreeT = 15;
      proc(S, src, 'spree', ['SPREE', 'KILLING SPREE', 'DOMINATING', 'UNSTOPPABLE', 'GODLIKE'][src.spree - 1]);
    }
    return dealt;
  }
  /* The squad cracked the overcharge shield: the Foreman staggers and takes extra damage. */
  function breakShield(S, boss, by) {
    if (boss.cast && boss.cast.hero) S.hero = null;   // a hero moment interrupted by the stagger is over
    boss.oshield = null; boss.stagger = TUNE.staggerDur; boss.cast = null;
    S.m.shields.broken++;
    emit(S, { type: 'announce', text: 'SHIELD BROKEN', tone: 'good' });
    emit(S, { type: 'fx', fx: 'shieldbreak', src: boss.id });
    emit(S, { type: 'log', text: (by && by.name ? by.name + ' cracks' : 'The squad cracks') + ' the overcharge shield. The Foreman staggers: ' + Math.round((TUNE.staggerBonus - 1) * 100) + '% more damage for ' + TUNE.staggerDur + 's.' });
    players(S, true).forEach(function (q) {
      if (!T(q, 'breaker')) return;
      if (q.role === 'tank') { q.cds.challenge = 0; q.cds.belt = 0; }
      else if (q.role === 'melee') q.pips = resOf(q).max;
      else procUp(S, q);
    });
  }
  function damagePlayer(S, srcId, p, amt, label, guarded) {
    if (!p.alive) return;
    if (!guarded && p.hp < p.maxHp * 0.25) {
      // Wrecker Meat Shield: throw yourself in front of a friend who is about to drop.
      var meat = players(S, true).filter(function (q) { return q !== p && T(q, 'meatshield') && (q.cds.meatshield || 0) <= 0; })[0];
      if (meat) {
        meat.cds.meatshield = 45;
        proc(S, meat, 'meatshield', 'MEAT SHIELD', 'all');
        emit(S, { type: 'log', id: meat.id, text: meat.name + ' takes the hit for ' + p.name + '.', you: 'You take the hit for ' + p.name + '.' });
        damagePlayer(S, srcId, meat, amt, label, true);
        return;
      }
    }
    if (!guarded && p.role !== 'tank') {
      // Bodyguard: a Juggernaut nearby soaks a fifth of the hit.
      var guard = players(S, true).filter(function (g) { return g !== p && T(g, 'bodyguard') && dist(g, p) <= 6; })[0];
      if (guard) { var share = amt * 0.2; amt -= share; damagePlayer(S, srcId, guard, share, 'Bodyguard', true); }
    }
    if (p.belt > 0) amt = amt * 0.5;
    if (p.pump > 0) amt = amt * 0.75;
    if (braced(p)) amt = amt * 0.85;
    if (srcId !== p.id && S.domes.some(function (d) { return Math.hypot(p.x - d.x, p.z - d.z) <= d.r; })) {
      // Aegis Dome: nothing gets through while it lasts.
      emit(S, { type: 'absorb', id: p.id, amt: Math.round(amt), barrier: 1 });
      return;
    }
    var BLOCKABLE = label !== 'Sludge' && label !== 'Collapse' && label !== 'Radiation';
    var bsrc = !guarded && BLOCKABLE ? ent(S, srcId) : null;
    var wallBy = bsrc ? barrierFor(S, p, bsrc) : null;
    if (wallBy) {
      // Impact Hammer barrier: it soaks the hit for whoever it covers until it runs dry.
      var soakB = Math.min(wallBy.barrier, amt);
      wallBy.barrier -= soakB; amt -= soakB;
      addEnergy(wallBy, soakB / 25);
      if (T(wallBy, 'spikes') && bsrc.kind === 'enemy' && bsrc.alive && soakB > 0) damageEnemy(S, wallBy, bsrc, soakB * 0.3, 4, 'Spiked Barrier');
      emit(S, { type: 'absorb', id: p.id, amt: Math.round(soakB), barrier: 1, by: wallBy.id });
      if (wallBy.barrier <= 0) {
        wallBy.barrier = 0; wallBy.barrierUp = 0; wallBy.barrierBroken = TUNE.barrierBreak; wallBy.barrierRestT = 0;
        emit(S, { type: 'fx', fx: 'barrierbreak', src: wallBy.id });
        proc(S, wallBy, 'barrier', 'BARRIER BROKEN');
      }
      if (amt <= 0) return;
    }
    if (srcId === S.bossId && !guarded && sheltered(S, p)) {
      emit(S, { type: 'absorb', id: p.id, amt: Math.round(amt), wall: 1 });
      return;
    }
    // Juggernaut plating: the Foreman's fists are tuned for the tank. Anyone else he catches gets flattened.
    if (p.role === 'tank' && (label === 'Hit' || label === 'Crusher' || label === 'Cleave')) amt = amt * 0.7;
    if (p.wall > 0) amt = amt * 0.5;
    if (p.cloak > 0) amt = amt * 0.6;

    var hitter = ent(S, srcId);
    if (p.screen > 0 && hitter && hitter.kind === 'enemy' && label !== 'Radiation') {
      // Flak Screen: cut the hit and spray shrapnel back at whoever threw it.
      amt = amt * 0.3;
      if (hitter.alive) damageEnemy(S, p, hitter, T(p, 'spikes') ? 200 : 100, 8, 'Shrapnel');
    }
    if (p.dome > 0) amt = amt * 0.5;
    if (p.rallied > 0) amt = amt * 0.8;
    if (label === 'Cleave' && T(p, 'clamps')) amt = amt * 0.5;
    if (players(S, true).some(function (q) { return q !== p && T(q, 'cover') && (q.still || 0) >= 1 && dist(q, p) <= 10; })) amt = amt * 0.9;
    amt = Math.round(amt);
    if (T(p, 'plate') && amt >= 100 && (p.cds.plate || 0) <= 0) {
      p.cds.plate = 20;
      emit(S, { type: 'absorb', id: p.id, amt: amt, label: label });
      return;
    }
    if (p.armor > 0) {
      var soak = Math.min(p.armor, amt); p.armor -= soak; amt -= soak;
      if (p.armorSrc) {
        var shieldBy = ent(S, p.armorSrc);
        if (shieldBy) {
          met(S, shieldBy.id).heal += soak;
          // Shield Gun: a shield of yours that gets used up completely gives Nanites back.
          if (p.armor <= 0 && shieldBy.alive && shieldBy.role === 'healer' && shieldBy.kit.weapons[shieldBy.weapon].id === 'shield') shieldBy.pips = Math.min(resOf(shieldBy).max, (shieldBy.pips || 0) + 10);
        }
      }
    }
    met(S, p.id).taken += amt; S.m.taken[label] = (S.m.taken[label] || 0) + amt;
    if (amt > 0) {
      var hsrc = ent(S, srcId), shown = label === 'Hit' && hsrc && hsrc.type === 'drone' ? 'Drone' : label;
      (p.recent || (p.recent = [])).push([shown, amt, hitKind(p, label, hsrc), Math.round(S.t * 10) / 10]);
      if (p.recent.length > 5) p.recent.shift();
    }
    p.recoil = (p.recoil || 0) + amt;   // recent damage, for Recoil Strike
    if (T(p, 'vengeance')) p.rage = Math.min(500, (p.rage || 0) + amt * 0.2);
    p.hp -= amt;
    emit(S, { type: 'dmg', src: srcId, dst: p.id, amt: amt, label: label });
    if (p.hp > 0 && T(p, 'pump') && p.hp < p.maxHp * 0.3 && (p.cds.pump || 0) <= 0) {
      p.pump = 6; p.cds.pump = 60;
      emit(S, { type: 'fx', fx: 'pump', src: p.id });
    }
    if (p.hp > 0 && srcId === S.bossId && label === 'Hit') {
      // Counterstrike: getting hit can light you up.
      if (T(p, 'counter') && S.rng() < 0.25) { p.counter = 6; p.cds.challenge = 0; proc(S, p, 'counter', 'COUNTERSTRIKE'); }
    }
    if (p.hp > 0 && p.hp < p.maxHp * 0.25 && srcId === S.bossId) {
      // Striker Decoy Beacon: pull the Foreman off a friend in trouble.
      var decoy = players(S, true).filter(function (q) { return q !== p && T(q, 'decoy') && (q.cds.decoy || 0) <= 0; })[0];
      var boss0 = ent(S, S.bossId);
      if (decoy && boss0 && boss0.alive) {
        decoy.cds.decoy = 45; boss0.fixate = { id: decoy.id, t: 3 };
        proc(S, decoy, 'decoy', 'DECOY', 'all');
        emit(S, { type: 'log', id: decoy.id, text: decoy.name + ' draws the Foreman off ' + p.name + '.', you: 'You draw the Foreman off ' + p.name + '.' });
      }
    }
    if (p.hp > 0 && p.hp < p.maxHp * 0.2) {
      var saver = players(S, true).filter(function (q) { return T(q, 'lifeline') && (q.cds.lifeline || 0) <= 0; })[0];
      if (saver) {
        saver.cds.lifeline = 90;
        heal(S, saver, p, p.maxHp * 0.35, 'Lifeline');
        emit(S, { type: 'fx', fx: 'lifeline', src: p.id });
        emit(S, { type: 'log', id: p.id, text: saver.name + "'s Lifeline catches " + p.name + '.', you: saver.name + "'s Lifeline catches you." });
      }
    }
    if (p.hp <= 0) {
      met(S, p.id).deaths++; S.m.killers[label] = (S.m.killers[label] || 0) + 1;
      p.lastDeath = { label: label, t: Math.round(S.t), log: (p.recent || []).slice() };
      p.hp = 0; p.alive = false; p.cast = null; p.queued = null; p.sludge = 0; p.hot = 0;
      emit(S, { type: 'death', id: p.id });
      emit(S, { type: 'log', id: p.id, text: p.name + ' is down.', you: "You're down." });
      // Medic Defibrillator: the first one down this raid gets shocked back up.
      var medic = players(S, true).filter(function (q) { return T(q, 'defib') && !q.defibUsed; })[0];
      if (medic) {
        medic.defibUsed = true; S.revives.push({ id: p.id, by: medic.id, t: 3 });
        emit(S, { type: 'log', id: p.id, text: medic.name + "'s Defibrillator is charging for " + p.name + '.', you: medic.name + "'s Defibrillator is charging. Hold on." });
      }
    }
  }
  /* For the death log: what kind of hit was it? avoid = step out of it, buster = the tank's big hit to mitigate,
     aoe = hits the whole squad (heal through it), debuff = on you until it's purged, squad = the shield wasn't broken,
     tank = the boss's fists on the tank (the job), aggro = the boss's fists on someone else, add = a drone on you. */
  var AVOID = { Charge: 1, Collapse: 1, Leap: 1, Rocket: 1, 'Heavy Rocket': 1, 'Demolition Blast': 1, Haymaker: 1 };
  function hitKind(p, label, src) {
    if (AVOID[label]) return 'avoid';
    if (label === 'Cleave') return p.role === 'tank' ? 'tank' : 'avoid';
    if (label === 'Crusher') return 'buster';
    if (label === 'Sludge' || label === 'Radiation') return 'debuff';
    if (label === 'Overcharge Pulse') return 'aoe';
    if (label === 'Overcharge') return 'squad';
    if (label === 'Hit') return src && src.type === 'drone' ? 'add' : p.role === 'tank' ? 'tank' : 'aggro';
    return '';
  }
  function heal(S, src, p, amt, label) {
    if (!p.alive) return;
    if (src.kind === 'player' && src.momentum > 0 && T(src, 'stim') && aimWeapon(src)) amt *= 1.3;   // Stim Leap window
    if (src.kind === 'player') {
      if (src.pump > 0) amt *= 1.4;
      amt *= (src.boostNow || 1) * (src.opp > 0 ? 1.3 : 1);
      if (!src.repairing && !src.chaining) {
        amt *= 0.85 + S.rng() * 0.3;
        if (S.rng() < critChance(S, src)) { amt *= CRIT_MULT; src.critThis = true; var hc = true; met(S, src.id).crits++; }
        met(S, src.id).hits++;
      }
    }
    amt = Math.round(amt);   // whole points, so a squad client's copy matches the host exactly
    var before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amt);
    var eff = p.hp - before;
    if (src.kind === 'player') met(S, src.id).heal += eff;
    if (src.kind === 'player' && T(src, 'selfrepair') && p !== src && !src.repairing && eff > 0) {
      // Medic Self-Repair: a little of every heal comes back to you.
      src.repairing = true; heal(S, src, src, eff * 0.15, 'Self-Repair'); src.repairing = false;
    }
    if (src.kind === 'player' && T(src, 'chain') && !src.chaining && label !== 'Spray') {
      var next = players(S, true).filter(function (q) { return q !== p && q.hp < q.maxHp && dist(q, p) <= 8; }).sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; })[0];
      if (next) { src.chaining = true; heal(S, src, next, amt * 0.3, 'Chain'); src.chaining = false; }
    }
    if (src.kind === 'player' && T(src, 'overflow') && amt - eff > 1) {
      p.armor = Math.min(300, Math.max(p.armor, 0) + (amt - eff)); p.armorSrc = src.id;
    }
    emit(S, { type: 'heal', src: src.id, dst: p.id, amt: Math.round(eff), label: label, crit: hc ? 1 : 0 });
    enemies(S).forEach(function (e) { addThreat(S, e, src.id, eff * 0.5); });
  }

  /* ---------- abilities ---------- */


  function shieldUp(q, src, amt, cap) { q.armor = Math.min(cap, Math.max(q.armor, 0) + amt); q.armorSrc = src.id; }
  function resolveTarget(S, p, ab) {
    if (ab.kind === 'aim') return p;
    if (ab.id === 'challenge' && aimWeapon(p)) {
      // Aimed tanks taunt whatever is in front of them, falling back to their target.
      var front = inCone(S, p, ab.range, 0.85)[0];
      if (front) return front;
    }
    if (ab.id === 'purge' && aimWeapon(p)) {
      // Purge is smart: a sludged ally anywhere in a wide cone first, then yourself if you need it, then whoever you point at.
      var dirty = players(S, true).filter(function (q) { return q !== p && q.sludge > 0; });
      var pick = null, best = -2, fx = Math.sin(p.facing), fz = Math.cos(p.facing);
      dirty.forEach(function (q) { var dx = q.x - p.x, dz = q.z - p.z, l = Math.sqrt(dx * dx + dz * dz) || 1, c = (dx * fx + dz * fz) / l; if (l <= ab.range && c >= 0.3 && c > best) { best = c; pick = q; } });
      return pick || (p.sludge > 0 ? p : null) || softTarget(S, p, { range: ab.range, dot: 0.75, ally: true }) || p;
    }
    if (ab.kind === 'friend' && aimWeapon(p)) return softTarget(S, p, { range: ab.range, dot: 0.75, ally: true }) || p;   // nobody there: yourself
    var t = p.target != null ? ent(S, p.target) : null;
    if (ab.kind === 'enemy') {
      if (t && t.kind === 'enemy' && t.alive) return t;
      var best = null, bd = 1e9;
      enemies(S).forEach(function (e) { var d = dist(p, e); if (d < bd) { bd = d; best = e; } });
      return best;
    }
    if (ab.kind === 'friend') {
      if (t && t.kind === 'player' && t.alive) return t;
      if (t && t.kind === 'enemy' && t.alive && t.target != null) {
        var tt = ent(S, t.target);
        if (tt && tt.kind === 'player' && tt.alive) return tt;
      }
      return p;
    }
    return p;
  }

  /* What the action bar shows: can this ability go off right now, and at whom. */
  function usable(S, p, idx) {
    var ab = abilitiesOf(p)[idx];
    if (!ab || !p.alive) return { state: 'dead', tgt: null };
    var tgt = resolveTarget(S, p, ab);
    if (!tgt) return { state: 'notarget', tgt: null };
    var out = { tgt: tgt, behind: BACKSTAB[ab.id] && tgt.kind === 'enemy' && (behind(p, tgt) || p.afterburn > 0), role: ab.role || null };
    if (ab.role === 'proc' && !(p.procT > 0)) out.state = 'locked';
    else if (ab.role === 'ult' && (p.ult || 0) < 100) out.state = 'locked';
    else if (ab.role === 'spend' && (p.pips || 0) < resOf(p).min) out.state = 'locked';
    else if ((ab.cost && (p.pips || 0) < ab.cost) || (ab.needs && (p.pips || 0) < ab.needs)) out.state = 'locked';
    else if (p.jam > 0 && (ab.id === 'spin' || ab.id === 'sweep')) out.state = 'locked';
    else if (ab.id === 'ebarrier' && p.barrierBroken > 0) out.state = 'locked';
    else if (ab.id === 'combo' && p.barrierUp) out.state = 'locked';
    else if (ab.kind !== 'self' && ab.kind !== 'aim' && dist(p, tgt) > reach(p, ab) + (tgt.radius || 0)) out.state = 'range';
    else if ((p.cds[ab.id] || 0) > 0) out.state = 'cd';
    else out.state = 'ok';
    return out;
  }

  function fail(S, p, text) {
    if (p.human && !p.auto) emit(S, { type: 'error', id: p.id, text: text });
    return false;
  }

  function tryUse(S, p, idx) {
    var ab = abilitiesOf(p)[idx];
    if (!ab || !p.alive) return false;
    if (p.cast) return false;
    if ((p.cds[ab.id] || 0) > 0) return fail(S, p, ab.name + ' is not ready');
    if (ab.role === 'proc' && !(p.procT > 0)) return fail(S, p, ab.name + ' has not procced');
    if (ab.role === 'ult' && (p.ult || 0) < 100) return fail(S, p, ab.name + ' is still charging');
    if (ab.role === 'spend' && (p.pips || 0) < resOf(p).min) return fail(S, p, 'Not enough ' + resOf(p).name);
    if ((ab.cost && (p.pips || 0) < ab.cost) || (ab.needs && (p.pips || 0) < ab.needs)) return fail(S, p, 'Not enough ' + resOf(p).name);
    if (p.jam > 0 && (ab.id === 'spin' || ab.id === 'sweep')) return fail(S, p, 'Minigun jammed');
    if (ab.id === 'ebarrier' && p.barrierBroken > 0) return fail(S, p, 'Barrier is broken');
    if (ab.id === 'combo' && p.barrierUp) return fail(S, p, 'Lower the barrier first');
    if (ab.gcd && p.gcd > 0) return false;
    var tgt = resolveTarget(S, p, ab);
    if (!tgt) return fail(S, p, 'No target');
    if (ab.kind !== 'self' && ab.kind !== 'aim') {
      if (dist(p, tgt) > reach(p, ab) + (tgt.radius || 0)) return fail(S, p, 'Out of range');
    }
    var instant = ab.cast > 0 && p.momentum > 0 && T(p, 'stim');
    if (ab.cast > 0 && p.moving && !instant) return fail(S, p, 'Stand still to cast ' + ab.name);
    if (ab.gcd) p.gcd = GCD;
    if (ab.cast > 0 && !instant) { p.cast = { ab: ab, t: 0, dur: ab.cast, targetId: tgt.id }; return true; }
    fire(S, p, ab, tgt);
    return true;
  }

  function fire(S, p, ab, tgt) {
    var G = p.gear;
    p.cds[ab.id] = ab.cd;
    if (T(p, 'afterburner') && ab.id === 'dash') p.cds.dash = 5;
    if (T(p, 'purgefield') && ab.id === 'field') p.cds.field = 16;   // a cleanse for a crowd costs you time
    if (T(p, 'supply') && ab.id === 'keg') p.cds.keg = 12;
    if (tgt && tgt !== p && !p.moving) p.facing = Math.atan2(tgt.x - p.x, tgt.z - p.z);
    var back = BACKSTAB[ab.id] && tgt.kind === 'enemy' && (behind(p, tgt) || p.afterburn > 0) ? 1.5 : 1;
    // Jump Boots: the first ability that targets something after a leap gets the Momentum bonus.
    p.boostNow = p.momentum > 0 && ab.kind !== 'self' && ab.kind !== 'aim' && (!T(p, 'stim') || ab.kind === 'friend') ? 1.3 : 1;
    if (p.boostNow > 1) { p.momentum = 0; emit(S, { type: 'fx', fx: 'adren', src: p.id }); }
    // Spenders take every pip before they fire, so the effect knows how many it got. Procs use up the proc.
    var R = resOf(p);
    // Key 2 pays in the class resource. p.spent is its power in "pips" (0 to 5) so every weapon's maths reads the same.
    if (ab.role === 'spend') {
      if (R.spend === 'all') { p.spent = (p.pips || 0) / R.per; p.pips = 0; }
      else { p.spent = R.power; p.pips -= R.spend; }
    }
    if (ab.role === 'proc') p.procT = 0;
    if (ab.cost) p.pips = (p.pips || 0) - ab.cost;
    if (ab.role === 'ult') { p.ult = 0; met(S, p.id).ults++; }
    var jamCheck = ab.id === 'spin' || ab.id === 'sweep';
    p.critThis = false;
    fireAbility(S, p, ab, tgt, G, back);
    if (ab.id === 'spin') p.gcd = GCD * (1 - 0.5 * Math.min(1, (p.pips || 0) / 100));   // hotter barrels, faster bursts
    if (ab.role === 'build' && !aimWeapon(p)) {
      p.pips = Math.min(R.max, (p.pips || 0) + (p.kit.weapons[p.weapon].build || R.build) + (T(p, 'flanker') && tgt.kind === 'enemy' && behind(p, tgt) ? 1 : 0));
      if (p.critThis || S.rng() < (ab.procChance || 0)) procUp(S, p);
    }
    if (ab.role === 'spend' && p.spent > 0 && T(p, 'livefire')) {
      // Medic Live Fire: every pip spent is also a shot at the enemy you have targeted.
      var foe = p.target != null ? ent(S, p.target) : null;
      if (!foe || foe.kind !== 'enemy' || !foe.alive) foe = ent(S, S.bossId);
      if (foe && foe.alive) { emit(S, { type: 'beam', src: p.id, dst: foe.id, fx: 'link' }); damageEnemy(S, p, foe, 35 * p.spent, 1, 'Live Fire'); }
    }
    p.spent = 0;
    if (jamCheck && (p.pips || 0) >= 100) {
      // Overheat: the gun jams. No shield, no shots, and it's still hot when it comes back.
      p.jam = 3; p.pips = 70;
      emit(S, { type: 'fx', fx: 'sludge', src: p.id });
      emit(S, { type: 'log', id: p.id, text: p.name + "'s Minigun overheats and jams.", you: 'Overheated. Jammed for 3s.' });
      proc(S, p, 'jam', 'JAMMED');
    }
    if (tgt && tgt.kind === 'enemy' && tgt.alive !== undefined && isWeaponAbility(p, ab)) {
      if (T(p, 'vengeance') && p.rage >= 1 && tgt.alive) {
        var rage = Math.round(p.rage); p.rage = 0;
        emit(S, { type: 'fx', fx: 'challenge', src: p.id });
        damageEnemy(S, p, tgt, rage, 4, 'Vengeance');
      }
    }
    p.boostNow = 1;
  }

  /* Is this spot on floor that has already fallen in phase three? */
  function fallen(S, e) { return S.telegraphs.some(function (g) { return g.shape === 'sector' && g.t >= g.dur && inTele(g, e); }); }
  /* Bots treat fallen floor like a wall: off it straight away (towards the middle, which never falls),
     and steer round it rather than walking in. */
  function avoidFallen(S, p, inp) {
    if (!S.telegraphs.some(function (g) { return g.down; })) return inp;
    var r = Math.sqrt(p.x * p.x + p.z * p.z) || 1;
    if (fallen(S, p)) { inp.mx = -p.x / r; inp.mz = -p.z / r; return inp; }
    var mx = inp.mx || 0, mz = inp.mz || 0, len = Math.sqrt(mx * mx + mz * mz);
    if (len < 0.01) return inp;
    var a0 = Math.atan2(mx, mz), tries = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2];
    for (var i = 0; i < tries.length; i++) {
      var a = a0 + tries[i];
      if (!fallen(S, { x: p.x + Math.sin(a) * 2.5, z: p.z + Math.cos(a) * 2.5 })) { inp.mx = Math.sin(a); inp.mz = Math.cos(a); return inp; }
    }
    inp.mx = 0; inp.mz = 0; return inp;
  }
  /* Shove: throw an enemy straight back from the Juggernaut. Hitting the arena wall or another enemy stops it dead:
     it's stunned and takes extra damage, and a drone it lands on is stunned too. */
  function shoveBack(S, p, e, push, pd) {
    var dx = e.x - p.x, dz = e.z - p.z, l = Math.sqrt(dx * dx + dz * dz) || 1, ux = dx / l, uz = dz / l;
    var hit = null, moved = 0;
    while (moved < push && !hit) {
      var st = Math.min(0.5, push - moved), nx = e.x + ux * st, nz = e.z + uz * st;
      if (Math.sqrt(nx * nx + nz * nz) > ARENA_R - 1.5) { hit = 'wall'; break; }
      hit = enemies(S).filter(function (o) { return o !== e && Math.hypot(o.x - nx, o.z - nz) < (o.radius || 0.6) + (e.radius || 0.6) + 0.3; })[0] || null;
      if (hit) break;
      e.x = nx; e.z = nz; moved += st;
    }
    if (fallen(S, e)) {
      emit(S, { type: 'fx', fx: 'shaft', src: e.id });
      emit(S, { type: 'log', id: p.id, text: p.name + ' throws a ' + (e.name || 'drone').toLowerCase() + ' down the shaft.', you: 'Down the shaft.' });
      damageEnemy(S, p, e, Math.ceil(e.hp / 0.85) + 1, 2, 'Down the Shaft!');
      return;
    }
    if (!hit) return;
    var stun = pd > 1 ? 3 : 2;
    damageEnemy(S, p, e, 150 * pd, 4, 'Slammed!');
    if (e.alive) e.stagger = Math.max(e.stagger || 0, stun);
    if (hit !== 'wall' && hit.alive) {
      damageEnemy(S, p, hit, 150 * pd, 4, 'Slammed!');
      if (hit.type !== 'boss' && hit.alive) hit.stagger = Math.max(hit.stagger || 0, stun);
    }
    emit(S, { type: 'fx', fx: 'slammed', src: e.id });
  }
  /* Challenge talents: Brand marks it, Daze rings its bell, Protector shields whoever it was hitting. */
  function onTaunt(S, p, list) {
    list.forEach(function (e) {
      if (!e.alive) return;
      if (T(p, 'brand')) e.branded = 6;
      if (T(p, 'daze')) { if (e.type === 'boss') e.weak = Math.max(e.weak || 0, 4); else e.stagger = Math.max(e.stagger || 0, 2); }
      if (T(p, 'protector')) {
        var was = e.prevTarget != null ? ent(S, e.prevTarget) : null;
        if (was && was.kind === 'player' && was.alive && was !== p) { shieldUp(was, p, 250, 600); emit(S, { type: 'fx', fx: 'guard', src: was.id }); }
      }
    });
    if (T(p, 'brand')) proc(S, p, 'brand', 'BRANDED');
  }
  /* Allies sorted most hurt first (by share of health), optionally only those still below full. */
  function mostHurt(S, n, range, from) {
    return players(S, true).filter(function (q) { return q.hp < q.maxHp && (!from || dist(q, from) <= range); })
      .sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; }).slice(0, n);
  }
  /* Light this player's proc button for PROC_WINDOW seconds. */
  function procUp(S, p) {
    if (!p.alive || p.kit.weapons[p.weapon].abilities[2].role !== 'proc') return;   // Juggernaut weapons have no proc
    var fresh = !(p.procT > 0);
    p.procT = PROC_WINDOW;
    if (fresh) emit(S, { type: 'procready', id: p.id, role: p.role, name: p.kit.weapons[p.weapon].abilities[2].name });
  }

  function fireAbility(S, p, ab, tgt, G, back) {
    var n = p.spent || 0, mv = p.moving ? 1.35 : 1, medic = T(p, 'battlemedic');
    var splash = function (centre, amt, r, label, skip) {
      enemies(S).forEach(function (e) { if (e !== skip && dist(e, centre) <= r + (e.radius || 0)) damageEnemy(S, p, e, amt, 1, label); });
    };
    switch (ab.id) {
      /* ---- ultimates ---- */
      case 'wall':
        p.wall = TUNE.wallDur;
        emit(S, { type: 'fx', fx: 'wall', src: p.id });
        proc(S, p, 'wall', 'RIOT WALL', 'all');
        emit(S, { type: 'log', id: p.id, text: p.name + ' raises a Riot Wall. Get behind them.', you: 'Riot Wall up. The squad can hide behind you.' });
        heroDone(S, 'tank', S.hero && S.hero.role === 'tank');
        break;
      case 'hospital':
        emit(S, { type: 'fx', fx: 'hospital', src: p.id });
        proc(S, p, 'hospital', 'FIELD HOSPITAL', 'all');
        var cleansed = false;
        players(S, true).forEach(function (q) {
          if (dist(p, q) > ab.range) return;
          if (q.rad > 0 || q.sludge > 0) cleansed = true;
          q.rad = 0; q.sludge = 0; q.dome = 4;
          heal(S, p, q, q.maxHp * 0.5, 'Field Hospital');
        });
        heroDone(S, 'healer', cleansed && S.hero && S.hero.role === 'healer');
        break;
      case 'deadeye':
        var bossD = ent(S, S.bossId);
        proc(S, p, 'deadeye', 'DEADEYE', 'all');
        if (S.missile) {
          emit(S, { type: 'missiledown', x: S.missile.x, z: S.missile.z, src: p.id });
          S.telegraphs = S.telegraphs.filter(function (g) { return !g.missile; });
          S.missile = null;
          emit(S, { type: 'log', id: p.id, text: p.name + ' shoots the Heavy Rocket out of the air.', you: 'You shoot the Heavy Rocket out of the air.' });
          heroDone(S, 'dps', true);
          if (bossD && bossD.alive) { emit(S, { type: 'beam', src: p.id, dst: bossD.id, fx: 'core' }); damageEnemy(S, p, bossD, 700, 1, 'Deadeye!'); }
        } else {
          var de = p.target != null ? ent(S, p.target) : null;
          if (!de || de.kind !== 'enemy' || !de.alive) de = bossD;
          if (de && de.alive) { emit(S, { type: 'beam', src: p.id, dst: de.id, fx: 'core' }); damageEnemy(S, p, de, 700, 1, 'Deadeye!'); }
        }
        p.pips = resOf(p).max; procUp(S, p);
        break;
      case 'slam':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'sawbig' });
        emit(S, { type: 'fx', fx: 'flak', src: p.id });
        proc(S, p, 'slam', 'WRECKING SLAM', 'all');
        if (tgt.alive && !(tgt.cast && tgt.cast.name === 'Haymaker')) {
          tgt.stagger = Math.max(tgt.stagger || 0, TUNE.slamStagger);
          emit(S, { type: 'log', id: p.id, text: p.name + ' staggers ' + (tgt.type === 'boss' ? 'the Foreman' : 'a drone') + '. Everything you have.', you: 'Staggered for ' + TUNE.slamStagger + 's. Everything you have.' });
        }
        if (tgt.type === 'boss' && tgt.cast && tgt.cast.name === 'Haymaker') {
          heroDone(S, 'melee', true);
          tgt.cast = null; tgt.stagger = 5; S.hero = null;
          emit(S, { type: 'announce', text: 'COUNTERED', tone: 'good' });
          emit(S, { type: 'log', id: p.id, text: p.name + ' slams the Foreman mid-swing. He staggers.', you: 'Countered. The Foreman staggers for 5s.' });
        }
        damageEnemy(S, p, tgt, 450, 2, 'Counter-Slam!');
        break;

      /* ---- Juggernaut ---- */
      case 'flak':
        emit(S, { type: 'fx', fx: 'flak', src: p.id });
        var flakHits = 0;
        enemies(S).forEach(function (e) { if (dist(p, e) <= ab.range + (e.radius || 0)) { damageEnemy(S, p, e, 75, 5, 'Flak'); flakHits++; } });
        if (flakHits > 1) p.pips = Math.min(resOf(p).max, (p.pips || 0) + 10 * (flakHits - 1));   // crowd control loads more Ammo
        break;
      case 'shell':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shell' });
        tgt.slowed = Math.max(tgt.slowed || 0, 4);
        damageEnemy(S, p, tgt, 190, 12, 'Shell'); break;
      case 'screen':
        p.screen = T(p, 'hardened') ? 4.5 : 3.5;
        emit(S, { type: 'fx', fx: 'guard', src: p.id });
        proc(S, p, 'screen', 'FLAK SCREEN');
        break;
      case 'combo':
        // Swing, swing, slam. The chain resets after a pause.
        if (S.t - (p.comboT == null ? -99 : p.comboT) > TUNE.comboReset) p.comboStep = 0;
        var step = p.comboStep || 0, slam = step === 2;
        var hitList = inCone(S, p, ab.range + (slam ? 1 : 0), slam ? 0.25 : 0.5);
        emit(S, { type: 'fx', fx: 'smash', src: p.id, pw: slam ? 1 : 0.3 });
        var rageAdd = T(p, 'vengeance') && p.rage >= 1 && hitList.length ? Math.round(p.rage) : 0;
        if (rageAdd) p.rage = 0;
        hitList.forEach(function (e, i) { damageEnemy(S, p, e, (slam ? 150 : 60) + (i === 0 ? rageAdd : 0), slam ? 8 : 6, slam ? 'Slam!' : 'Swing'); });
        addEnergy(p, slam ? 12 : 6);
        p.comboStep = (step + 1) % 3; p.comboT = S.t;
        p.gcd = slam ? TUNE.slamGcd : TUNE.swingGcd;
        break;
      case 'ebarrier':
        p.barrierHoldT = 1.2;   // a tap (bar click, bot) raises it briefly; holding the key keeps it up
        break;
      case 'shove':
        // Spend every drop. Energy scales it steeply, so a full bar is worth far more than two half ones.
        var en = Math.min(1, (p.pips || 0) / 100), pd = T(p, 'piledriver') ? 1.4 : 1, full = en >= 0.99;
        p.pips = 0;
        emit(S, { type: 'fx', fx: 'shove', src: p.id, pw: Math.round(en * 100) / 100 });
        if (full) proc(S, p, 'shove', 'FULL SHOVE');
        inCone(S, p, ab.range, 0.4).forEach(function (e) {
          if (!e.alive) return;
          if (e.type === 'boss') { damageEnemy(S, p, e, (40 + 460 * en * en) * pd, 8, full ? 'Shove!' : 'Shove'); return; }
          damageEnemy(S, p, e, (40 + 260 * en * en) * pd, 8, 'Shove');
          if (e.alive) shoveBack(S, p, e, 4 + 10 * en, pd);
        });
        if (T(p, 'breathing')) players(S, true).forEach(function (q) {
          if (dist(q, p) <= 8) { shieldUp(q, p, 50 + 150 * en, 600); emit(S, { type: 'fx', fx: 'guard', src: q.id }); }
        });
        p.gcd = TUNE.slamGcd;
        break;
      case 'piston':
        var pt = inCone(S, p, ab.range, 0.93)[0];
        if (!pt) { p.cds.piston = 0.5; emit(S, { type: 'fx', fx: 'piston', src: p.id, miss: 1 }); break; }
        emit(S, { type: 'beam', src: p.id, dst: pt.id, fx: 'shell' });
        damageEnemy(S, p, pt, 120, 14, 'Piston Shot');
        break;
      /* ---- Medic, aimed Link Gun ---- */
      case 'lbolt':
        var lt = softTarget(S, p, BOLT_AIM);
        p.gcd = TUNE.boltGcd;
        if (!lt) { emit(S, { type: 'fx', fx: 'boltmiss', src: p.id }); break; }
        emit(S, { type: 'beam', src: p.id, dst: lt.id, fx: 'link' });
        if (lt.kind === 'player') heal(S, p, lt, 70, 'Link Bolt');
        else {
          damageEnemy(S, p, lt, 50 * (T(p, 'battlemedic') ? 1.6 : 1), 1, 'Link Bolt');
          p.pips = Math.min(resOf(p).max, (p.pips || 0) + 7);
          if (p.critThis || S.rng() < 0.08) procUp(S, p);
        }
        break;
      case 'lbeam':
        p.beamHoldT = 1.2;   // a tap (bar click, bot) latches briefly; holding keeps it on
        break;
      case 'lburst':
        p.pips = Math.max(0, (p.pips || 0) - 35);
        emit(S, { type: 'fx', fx: 'burst', src: p.id });
        players(S, true).forEach(function (q) {
          if (dist(q, p) > ab.range) return;
          if (T(p, 'recycler') && q.hp < q.maxHp) p.pips = Math.min(resOf(p).max, p.pips + 8);
          heal(S, p, q, 260, 'Nanite Burst');
          if (T(p, 'burstshield')) shieldUp(q, p, 200, 400);
        });
        if (T(p, 'shockburst')) enemies(S).forEach(function (e) {
          if (dist(e, p) > ab.range + (e.radius || 0)) return;
          damageEnemy(S, p, e, 200, 4, 'Shock Burst');
          if (e.alive && e.type !== 'boss') e.stagger = Math.max(e.stagger || 0, 1.5);
        });
        p.gcd = TUNE.boltGcd;
        break;
      case 'field':
        // A grenade: lobbed where you aim, as far as you were aiming (p.aimDist). It settles on an ally within 3m of where it lands.
        var fpos = fieldSpot(S, p);
        S.fields.push({ id: S.nextId++, x: fpos.x, z: fpos.z, r: 6, t: (T(p, 'lingering') ? 10 : 6) + TUNE.lobTime, life: T(p, 'lingering') ? 10 : 6, by: p.id, acc: 0 });
        emit(S, { type: 'fx', fx: 'lob', src: p.id, x2: Math.round(fpos.x * 10) / 10, z2: Math.round(fpos.z * 10) / 10 });
        break;
      case 'cloak':
        p.cloak = 4; emit(S, { type: 'fx', fx: 'guard', src: p.id });
        break;
      case 'storm':
        // The pop: everyone in reach gets a third of their health back at once, then the links hold for 5s.
        emit(S, { type: 'fx', fx: 'storm', src: p.id });
        players(S, true).forEach(function (a) { if (dist(a, p) <= 25) heal(S, p, a, a.maxHp * 0.35, 'Link Storm'); });
        p.storm = 5;
        proc(S, p, 'storm', 'LINK STORM', 'all');
        emit(S, { type: 'log', id: p.id, text: p.name + "'s Link Storm reaches the whole squad.", you: 'Link Storm: everyone within 25m patched up and linked for 5s.' });
        break;
      case 'aegis':
        S.domes.push({ id: S.nextId++, x: p.x, z: p.z, r: TUNE.aegisR, t: TUNE.aegisDur, by: p.id });
        emit(S, { type: 'fx', fx: 'aegis', src: p.id });
        proc(S, p, 'aegis', 'AEGIS DOME', 'all');
        emit(S, { type: 'log', id: p.id, text: p.name + ' throws up an Aegis Dome. Get inside.', you: 'Aegis Dome up for 5s. Get the squad inside.' });
        break;
      case 'spin':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'spin' });
        damageEnemy(S, p, tgt, 40 + 40 * Math.min(1, (p.pips || 0) / 100), 7, 'Minigun');
        break;
      case 'sweep':
        var fx0 = Math.sin(p.facing), fz0 = Math.cos(p.facing);
        emit(S, { type: 'fx', fx: 'flak', src: p.id });
        enemies(S).forEach(function (e) {
          var ex = e.x - p.x, ez = e.z - p.z, el = Math.sqrt(ex * ex + ez * ez) || 1;
          if (el > ab.range + (e.radius || 0) || (ex * fx0 + ez * fz0) / el < 0.5) return;
          emit(S, { type: 'beam', src: p.id, dst: e.id, fx: 'spin' });
          damageEnemy(S, p, e, 120, 8, 'Sweep');
        });
        p.pips = (p.pips || 0) + 20;
        break;
      case 'vent':
        var heatNow = p.pips || 0, perfect = heatNow >= 85;
        shieldUp(p, p, heatNow * 8 * (perfect ? 1.5 : 1) * (T(p, 'hardened') ? 1.25 : 1), 1500);
        emit(S, { type: 'fx', fx: 'guard', src: p.id }); emit(S, { type: 'fx', fx: 'flak', src: p.id });
        enemies(S).forEach(function (e) { if (dist(p, e) <= ab.range + (e.radius || 0)) damageEnemy(S, p, e, heatNow * 2, 6, perfect ? 'Perfect Vent!' : 'Vent'); });
        p.pips = perfect ? heatNow / 2 : 0;
        proc(S, p, 'vent', perfect ? 'PERFECT VENT' : 'VENTED');
        break;
      case 'challenge':
        emit(S, { type: 'fx', fx: 'challenge', src: p.id });
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'kick' });
        var top = 0; for (var k in tgt.threat) top = Math.max(top, tgt.threat[k]);
        tgt.threat[p.id] = Math.max(tgt.threat[p.id] || 0, top * 1.1 + 200);
        tgt.prevTarget = tgt.target;
        tgt.fixate = { id: p.id, t: 3 };
        onTaunt(S, p, [tgt]);
        if (T(p, 'guardian')) {
          var ward = players(S, true).filter(function (q) { return q !== p; }).sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; })[0];
          if (ward) { shieldUp(ward, p, 200, 450); emit(S, { type: 'fx', fx: 'guard', src: ward.id }); }
        }
        break;
      case 'belt':
        p.belt = 6; emit(S, { type: 'fx', fx: 'belt', src: p.id });
        break;

      /* ---- Medic: builders shoot, and every shot looks after somebody ---- */
      case 'bolt':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'link' });
        var dealt = damageEnemy(S, p, tgt, 70 * (medic ? 1.6 : 1), 1, 'Link Bolt') || 0;
        mostHurt(S, medic ? 2 : 1, 40, p).forEach(function (q) { emit(S, { type: 'beam', src: p.id, dst: q.id, fx: 'link' }); heal(S, p, q, dealt * 0.7, 'Link'); });
        // Tether: whoever you last Link Beamed also gets half of every bolt for 10s.
        var teth = p.tether && S.t - p.tether.t <= 10 ? ent(S, p.tether.id) : null;
        if (teth && teth.alive && teth.hp < teth.maxHp) { emit(S, { type: 'beam', src: p.id, dst: teth.id, fx: 'link' }); heal(S, p, teth, dealt * 0.5, 'Tether'); }
        break;
      case 'link':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'link' });
        heal(S, p, tgt, 170 + 70 * n, 'Link Beam'); p.tether = { id: tgt.id, t: S.t }; break;
      case 'surge':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'surge' });
        heal(S, p, tgt, 480, 'Nano Surge'); break;
      case 'acid':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'bio' });
        tgt.acid = 6; tgt.acidSrc = p.id; tgt.acidDps = 15 * (medic ? 1.6 : 1);
        damageEnemy(S, p, tgt, 45 * (medic ? 1.6 : 1), 1, 'Acid');
        mostHurt(S, medic ? 3 : 2, 40, p).forEach(function (q) { heal(S, p, q, 35, 'Fumes'); });
        break;
      case 'spray':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'bio' });
        heal(S, p, tgt, 70 + 35 * n, 'Spray');
        var flush = (p.pips || 0) >= resOf(p).max / 2;
        (flush ? players(S, true).filter(function (q) { return dist(q, tgt) <= 7; }) : [tgt]).forEach(function (q) { q.hot = 6; q.hotSrc = p.id; });
        if (flush) emit(S, { type: 'fx', fx: 'glob', src: tgt.id });
        break;
      case 'glob':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'bio' });
        emit(S, { type: 'fx', fx: 'glob', src: tgt.id });
        // Bloom feeds on your Sprays: 20% more for each ally still carrying one.
        var blooms = players(S, true).filter(function (q) { return q.hot > 0 && q.hotSrc === p.id; }).length;
        players(S, true).forEach(function (q) { if (dist(q, tgt) <= 8) heal(S, p, q, 200 * (1 + 0.2 * blooms), 'Bio Bloom'); });
        break;
      case 'pulse':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shield' });
        damageEnemy(S, p, tgt, 60 * (medic ? 1.6 : 1), 1, 'Pulse');
        players(S, true).sort(function (a, c) { return (a.hp + a.armor) / a.maxHp - (c.hp + c.armor) / c.maxHp; }).slice(0, medic ? 2 : 1)
          .forEach(function (q) { shieldUp(q, p, 60, 450); emit(S, { type: 'fx', fx: 'guard', src: q.id }); });
        break;
      case 'barrier':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shield' });
        heal(S, p, tgt, 50, 'Barrier'); shieldUp(tgt, p, 130 + 50 * n, 450); break;
      case 'bulwark':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shield' });
        emit(S, { type: 'fx', fx: 'guard', src: tgt.id });
        players(S, true).forEach(function (q) { if (dist(q, tgt) <= 8) shieldUp(q, p, 250, 450); }); break;
      case 'keg':
        emit(S, { type: 'fx', fx: 'keg', src: p.id });
        players(S, true).forEach(function (q) { if (dist(p, q) <= ab.range) heal(S, p, q, T(p, 'supply') ? 143 : 190, 'Keg'); });
        break;
      case 'purge':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'purge' });
        if (tgt.sludge > 0) { tgt.sludge = 0; emit(S, { type: 'log', text: p.name + ' purges ' + tgt.name + '.' }); }
        heal(S, p, tgt, 60, 'Purge');
        break;

      /* ---- Striker ---- */
      case 'beam':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shock' });
        damageEnemy(S, p, tgt, 70, 1, 'Beam');
        tgt.mark = { src: p.id, t: S.t };
        break;
      case 'core':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'core' });
        // Shock combo: a Core shortly after a Beam on the same target hits harder.
        var combo = tgt.mark && tgt.mark.src === p.id && S.t - tgt.mark.t <= 3;
        if (combo) { tgt.mark = null; emit(S, { type: 'fx', fx: 'combo', src: tgt.id }); }
        damageEnemy(S, p, tgt, (90 + 75 * n) * (combo ? 1.4 : 1), 1, combo ? 'Combo!' : 'Core'); break;
      case 'gib':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'core' });
        damageEnemy(S, p, tgt, 380, 1, 'Instagib!'); break;
      case 'rocket':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'rocket' });
        damageEnemy(S, p, tgt, 85, 1, 'Rocket');
        splash(tgt, 55, 4, 'Splash', tgt);
        if (p.lockTgt === tgt.id) p.lock = Math.min(3, (p.lock || 0) + 1); else { p.lockTgt = tgt.id; p.lock = 1; }
        break;
      case 'volley':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'volley' });
        // Lock-on: each Rocket on this target (up to 3) adds a rocket to the volley.
        var locks = p.lockTgt === tgt.id ? (p.lock || 0) : 0; p.lock = 0;
        for (var v = 0; v < 2 + locks; v++) { damageEnemy(S, p, tgt, 110, 1, v >= 2 ? 'Volley!' : 'Volley'); splash(tgt, 45, 4, 'Splash', tgt); }
        break;
      case 'seeker':
        var pool = enemies(S).filter(function (e) { return dist(e, tgt) <= 15; });
        for (var sk = 0; sk < 3; sk++) {
          var hit = pool.length ? pool[sk % pool.length] : tgt;
          if (!hit.alive) hit = tgt;
          emit(S, { type: 'beam', src: p.id, dst: hit.id, fx: 'rocket' });
          damageEnemy(S, p, hit, 110, 1, sk === 2 ? 'Seeker!' : 'Seeker');
        }
        break;
      case 'scope':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'snipe' });
        damageEnemy(S, p, tgt, 65, 1, 'Quick Scope');
        if (tgt.hp < tgt.maxHp * 0.35 || tgt.stagger > 0) procUp(S, p);
        break;
      case 'snipe':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'snipe' });
        damageEnemy(S, p, tgt, 110 + 70 * n, 1, 'Snipe'); break;
      case 'headshot':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'snipe' });
        damageEnemy(S, p, tgt, 420, 1, 'Headshot!'); break;
      case 'adren': p.adren = 8; emit(S, { type: 'fx', fx: 'adren', src: p.id }); break;
      case 'trans':
        var fx = p.x, fz = p.z, jx, jz;
        if (p.moving) { jx = p.inMx; jz = p.inMz; }
        else {
          var from = p.target != null ? ent(S, p.target) : null;
          if (!from || from.kind !== 'enemy' || !from.alive) from = ent(S, S.bossId);
          var ax = p.x - from.x, az = p.z - from.z, al = Math.sqrt(ax * ax + az * az);
          if (from.alive && al > 0.1) { jx = ax / al; jz = az / al; } else { jx = Math.sin(p.facing); jz = Math.cos(p.facing); }
        }
        p.x += jx * 12; p.z += jz * 12; p.facing = Math.atan2(jx, jz);
        clampArena(p);
        emit(S, { type: 'blink', id: p.id, fromX: fx, fromZ: fz });
        break;

      /* ---- Wrecker ---- */
      case 'rip':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'saw' });
        damageEnemy(S, p, tgt, 80 * back, 1, back > 1 ? 'Rip!' : 'Rip');
        if (back > 1) p.pips = Math.min(resOf(p).max, (p.pips || 0) + 1);   // key 1 adds the other one
        if (tgt.bleed > 0 && tgt.bleedBy === p.id && S.rng() < 0.15) procUp(S, p);   // blood in the water
        break;
      case 'saw':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'sawbig' });
        damageEnemy(S, p, tgt, (80 + 70 * n) * back, 1, back > 1 ? 'Saw!' : 'Saw');
        tgt.bleed = Math.max(tgt.bleed || 0, 2 * n); tgt.bleedBy = p.id;   // Bleed: 2s a Rev
        break;
      case 'overdrive':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'sawbig' });
        damageEnemy(S, p, tgt, 300 * back, 1, 'Overdrive!'); break;
      case 'razor':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'razor' });
        damageEnemy(S, p, tgt, 120, 1, 'Razor');
        if (p.returns > 0 && tgt.alive) { p.returns--; emit(S, { type: 'beam', src: tgt.id, dst: p.id, fx: 'razor' }); damageEnemy(S, p, tgt, 50, 1, 'Return'); }
        break;
      case 'bounce':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'razor' });
        var rico = 95 + 80 * n;
        damageEnemy(S, p, tgt, rico, 1, 'Ricochet');
        var others = enemies(S).filter(function (e) { return e !== tgt && dist(e, tgt) <= 10; }).slice(0, 2);
        others.forEach(function (e) { emit(S, { type: 'beam', src: tgt.id, dst: e.id, fx: 'razor' }); damageEnemy(S, p, e, rico / 2, 1, 'Ricochet'); });
        // Nothing to bounce to: the blade comes back through the target and your next two Razors return too.
        if (!others.length && tgt.alive) { emit(S, { type: 'beam', src: tgt.id, dst: p.id, fx: 'razor' }); damageEnemy(S, p, tgt, rico * 0.4, 1, 'Return'); }
        p.returns = 2;
        break;
      case 'storm':
        emit(S, { type: 'fx', fx: 'flak', src: p.id });
        enemies(S).forEach(function (e) { if (dist(p, e) <= ab.range + (e.radius || 0)) { emit(S, { type: 'beam', src: p.id, dst: e.id, fx: 'razor' }); damageEnemy(S, p, e, 320, 1, 'Blade Storm!'); } });
        break;
      case 'tap':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'tap' });
        p.taps = ((p.taps || 0) + 1) % 3;
        p.trick = p.taps === 0;
        damageEnemy(S, p, tgt, 88 * mv, 1, p.trick ? 'Trick Shot!' : 'Tap');
        p.trick = false; break;
      case 'fan':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'tap' });
        for (var f = 0; f < n + 1; f++) damageEnemy(S, p, tgt, 64 * mv, 1, 'Fan');
        break;
      case 'draw':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'tap' });
        damageEnemy(S, p, tgt, 330 * mv, 1, 'Quick Draw!'); break;
      case 'dash':
        var ox = p.x, oz = p.z, gx, gz;
        if (tgt.type === 'boss') { gx = tgt.x - Math.sin(tgt.facing) * (tgt.radius + 1.5); gz = tgt.z - Math.cos(tgt.facing) * (tgt.radius + 1.5); }
        else { var dx = p.x - tgt.x, dz = p.z - tgt.z, dl = Math.sqrt(dx * dx + dz * dz) || 1; gx = tgt.x + dx / dl * ((tgt.radius || 1) + 1); gz = tgt.z + dz / dl * ((tgt.radius || 1) + 1); }
        p.x = gx; p.z = gz; clampArena(p); p.facing = Math.atan2(tgt.x - p.x, tgt.z - p.z);
        if (T(p, 'afterburner')) p.afterburn = 3;
        if (T(p, 'warcry')) {
          players(S, true).forEach(function (q) { if (dist(q, p) <= 10) q.warcry = 5; });
          proc(S, p, 'warcry', 'WAR CRY', 'all');
        }
        emit(S, { type: 'blink', id: p.id, fromX: ox, fromZ: oz, fx: 'dash' });
        break;
    }
  }

  /* ---------- player update ---------- */

  function applyInput(S, p, inp, dt) {
    if (!p.alive) return;
    if (inp.target !== undefined) p.target = inp.target;
    var mx = inp.mx || 0, mz = inp.mz || 0, len = Math.sqrt(mx * mx + mz * mz);
    if (p.dash) { mx = 0; mz = 0; len = 0; }
    p.moving = len > 0.01;
    if (p.moving) {
      mx /= len; mz /= len; p.inMx = mx; p.inMz = mz;
      var sp = moveSpeed(S, p);
      p.x += mx * sp * dt; p.z += mz * sp * dt;
      p.facing = Math.atan2(mx, mz);
      clampArena(p);
      p.still = 0;
      if (p.cast) { p.cast = null; p.gcd = Math.min(p.gcd, 0.3); }
    } else p.still = (p.still || 0) + dt;
    if (typeof inp.aim === 'number' && isFinite(inp.aim)) p.aimIn = inp.aim;
    if (typeof inp.ad === 'number' && isFinite(inp.ad)) p.aimDist = Math.max(2, Math.min(25, inp.ad));   // how far a thrown thing goes
    if (p.dash) { p.moving = true; p.still = 0; return; }   // mid-charge: the boosters are in control
    if (aimWeapon(p)) {
      if (typeof inp.aim === 'number' && isFinite(inp.aim)) p.facing = inp.aim;
      if (p.kit.weapons[p.weapon].id === 'link') medicHold(S, p, inp.hold || [], dt); else hammerHold(S, p, inp.hold || [], dt);
    }
    if (inp.jump && (p.role === 'tank' || (p.cds.leap || 0) <= 0)) spaceTalent(S, p);
    if (inp.ability != null && inp.ability >= 0) p.queued = { idx: inp.ability, t: 0.45 };
    if (p.queued) {
      if (tryUse(S, p, p.queued.idx)) p.queued = null;
      else { p.queued.t -= dt; if (p.queued.t <= 0) p.queued = null; }
    }
  }

  /* Aimed Link Gun held inputs: hold[0] keeps bolts going, hold[1] latches and keeps the beam on, both = Nanite Burst. */
  function medicHold(S, p, hold, dt) {
    var both = !!hold[0] && !!hold[1];
    if (both && !p.bothHeld) { var bi = abilitiesOf(p).map(function (a) { return a.id; }).indexOf('lburst'); if (bi >= 0) tryUse(S, p, bi); }
    p.bothHeld = both;
    var wantBeam = (!!hold[1] || p.beamHoldT > 0) && !both && !p.cast;
    var longL = T(p, 'longlink');
    if (wantBeam && !p.beamTo) {
      var lock = softTarget(S, p, { range: longL ? 40 : 25, dot: 0.75, ally: true });
      if (lock && (p.pips || 0) > 1) { p.beamTo = lock.id; p.beamAcc = 0; emit(S, { type: 'fx', fx: 'beamon', src: p.id }); }
    }
    if (p.beamTo) {
      var bt = ent(S, p.beamTo);
      if (!wantBeam || !bt || !bt.alive || dist(p, bt) > (longL ? 42 : 27) || (p.pips || 0) <= 0) { p.beamTo = 0; p.beamAcc = 0; p.siphonTo = 0; p.chainTo = 0; }
      else {
        // Siphon Link: the beam arcs on from your ally to the nearest enemy, and the arc pays for the beam.
        var arc = null;
        if (T(p, 'siphon')) arc = enemies(S).filter(function (e) { return dist(e, bt) <= 10 + (e.radius || 0); }).sort(function (a, c) { return dist(a, bt) - dist(c, bt); })[0] || null;
        p.siphonTo = arc ? arc.id : 0;
        p.pips = Math.max(0, (p.pips || 0) - (longL ? 3 : 5) * dt);
        p.beamAcc = (p.beamAcc || 0) + 185 * dt;
        if (p.beamAcc >= 40) {
          heal(S, p, bt, p.beamAcc, 'Link Beam');
          if (T(p, 'chainlink')) {
            // Chain Link: on to the most hurt ally near them, at half strength.
            var nx = players(S, true).filter(function (q) { return q !== bt && q.hp < q.maxHp && dist(q, bt) <= 12; })
              .sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; })[0];
            p.chainTo = nx ? nx.id : 0;
            if (nx) { emit(S, { type: 'beam', src: bt.id, dst: nx.id, fx: 'link' }); heal(S, p, nx, p.beamAcc * 0.5, 'Chain Link'); }
          }
          if (arc) damageEnemy(S, p, arc, 70 * p.beamAcc / 185, 1, 'Siphon');
          p.beamAcc = 0;
        }
        return;
      }
    }
    if (both || wantBeam) return;
    if (hold[0] && p.gcd <= 0 && !p.cast) tryUse(S, p, 0);
  }
  /* Impact Hammer held inputs: hold[0] keeps the combo swinging, hold[1] keeps the barrier up. */
  function hammerHold(S, p, hold, dt) {
    if (p.barrier == null) p.barrier = barrierMax(p);
    var wantBar = (!!hold[1] || p.barrierHoldT > 0) && !(p.barrierBroken > 0) && p.barrier > 0 && !p.cast;
    if (wantBar && !p.barrierUp) { p.barrierUp = 1; emit(S, { type: 'fx', fx: 'barrierup', src: p.id }); }
    else if (!wantBar && p.barrierUp) { p.barrierUp = 0; p.barrierRestT = 0; }
    // Both buttons together: Shove. It fires on the press, not every frame you hold them.
    var both = !!hold[0] && !!hold[1];
    if (both && !p.bothHeld) { var si = abilitiesOf(p).map(function (a) { return a.id; }).indexOf('shove'); if (si >= 0) tryUse(S, p, si); }
    p.bothHeld = both;
    if (both || p.barrierUp) return;
    // Holding key 1 keeps the combo going whenever the next swing is ready.
    if (hold[0] && p.gcd <= 0 && !p.cast) tryUse(S, p, 0);
  }
  /* Bot hands. The bot brain decides where it wants to be every frame with perfect precision; a person doesn't.
     This sits between the two: it presses one of eight directions relative to a lazily following camera, holds it
     for a beat before re-deciding, aims a little off, and lets go quickly when the brain wants to stand still. */
  function hands(S, p, raw, dt) {
    var H = TUNE.hands, h = p.hand || (p.hand = { mx: 0, mz: 0, hold: 0, cam: p.facing || 0 }), slow = (p.bot && p.bot.slow) || 1;
    var len = Math.sqrt((raw.mx || 0) * (raw.mx || 0) + (raw.mz || 0) * (raw.mz || 0)), want = len > 0.01;
    var on = Math.abs(h.mx) + Math.abs(h.mz) > 0.01;
    // The camera swings round behind the player slowly, so "forward" drifts.
    var dc = (p.facing || 0) - h.cam; while (dc > Math.PI) dc -= Math.PI * 2; while (dc < -Math.PI) dc += Math.PI * 2;
    h.cam += dc * Math.min(1, dt * 1.5);
    h.hold -= dt;
    if (!want && on) h.hold = Math.min(h.hold, H.release * slow);
    if (h.hold <= 0) {
      if (!want) { h.mx = 0; h.mz = 0; }
      else {
        var a = Math.atan2(raw.mx / len, raw.mz / len), cur = Math.atan2(h.mx, h.mz), da = a - cur;
        while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        if (!on || Math.abs(da) > 0.3) {
          a += (S.rng() - 0.5) * 2 * H.aim * slow;
          if (H.eightWay) a = h.cam + Math.round((a - h.cam) / (Math.PI / 4)) * (Math.PI / 4);
          h.mx = Math.sin(a); h.mz = Math.cos(a);
          h.hold = (H.holdMin + S.rng() * (H.holdMax - H.holdMin)) * slow;
        }
      }
    }
    return { mx: h.mx, mz: h.mz, ability: raw.ability, target: raw.target, jump: raw.jump, aim: raw.aim, hold: raw.hold, ad: raw.ad };
  }
  /* Movement measures, kept the same way for people and bots so the two can be compared and the hands fitted. */
  function trackMove(S, p, dt) {
    if (!p.alive) return;
    var q = met(S, p.id), a = p.moving ? Math.atan2(p.inMx, p.inMz) : null;
    q.liveT += dt; if (p.moving) q.mvT += dt;
    var tr = p.track || (p.track = { a: null, t: 0, red: 0 });
    var changed = (a === null) !== (tr.a === null) || (a !== null && Math.abs(Math.atan2(Math.sin(a - tr.a), Math.cos(a - tr.a))) > 0.3);
    if (changed) { if (tr.a !== null && tr.t > 0) { q.holdSum += tr.t; q.holdN++; } tr.a = a; tr.t = 0; }
    tr.t += dt;
    var red = S.telegraphs.some(function (g) { return inTele(g, p); });
    if (red) tr.red += dt;
    else if (tr.red > 0) { q.redSum += tr.red; q.redN++; tr.red = 0; }
  }
  /* Space does whatever this class's tier 1 talent says: Riot Charge, Stim Leap, Medevac or Dodge Jump. */
  /* Riot Charge: every Juggernaut's gap closer on Space. Tier 1 talents change it (Ram, Twin Thrusters, Intercept).
     Aimed weapons charge at whatever is in front of you; others at your target, or the Foreman. */
  function riotCharge(S, p, ox, oz) {
    if ((p.charges || 0) < 1 || p.dash || p.barrierUp) return;
    // Aimed: launch the way you're aiming. With no aim (an old client), head for your target or the Foreman.
    var dir = typeof p.aimIn === 'number' ? p.aimIn : null;
    if (dir === null) {
      var t0 = p.target != null ? ent(S, p.target) : null;
      if (!t0 || !t0.alive) t0 = ent(S, S.bossId);
      if (!t0) return;
      dir = Math.atan2(t0.x - p.x, t0.z - p.z);
    }
    p.dash = { dx: Math.sin(dir), dz: Math.cos(dir), left: T(p, 'intercept') ? 34 : 22, hit: {} };
    p.facing = dir; p.charges -= 1; p.cast = null; p.still = 0;
    emit(S, { type: 'fx', fx: 'boost', src: p.id });
  }
  /* The charge in flight: rockets on your back at 38 m/s, stopping at the first enemy (or ally, with Intercept). */
  function tickDash(S, p, dt) {
    var D = p.dash, stepD = Math.min(38 * dt, D.left), x0 = p.x, z0 = p.z;
    p.x += D.dx * stepD; p.z += D.dz * stepD; D.left -= stepD;
    clampArena(p);
    if (T(p, 'ram')) {
      var seg = { x1: x0, z1: z0, x2: p.x, z2: p.z };
      enemies(S).forEach(function (e) { if (!D.hit[e.id] && segDist(e.x, e.z, seg).d <= 2 + (e.radius || 0)) { D.hit[e.id] = 1; damageEnemy(S, p, e, 200, 8, 'Battering Ram'); } });
    }
    var foe = enemies(S).filter(function (e) { return dist(p, e) <= (e.radius || 1) + 1.4; })[0];
    var ally = T(p, 'intercept') ? players(S, true).filter(function (q) { return q !== p && dist(p, q) <= 2; })[0] : null;
    var stuck = Math.hypot(p.x - x0, p.z - z0) < stepD * 0.3;   // ran into the wall
    if (foe || ally || D.left <= 0 || stuck) {
      p.dash = null; p.momentum = foe ? 3 : 0;
      if (foe) { emit(S, { type: 'fx', fx: 'charge', src: p.id }); damageEnemy(S, p, foe, 60, 8, 'Impact'); }
      if (ally) { shieldUp(ally, p, 250, 450); emit(S, { type: 'fx', fx: 'guard', src: ally.id }); proc(S, p, 'intercept', 'INTERCEPT'); }
    }
  }
  function spaceTalent(S, p) {
    var ox = p.x, oz = p.z, dir = function () { return p.moving ? [p.inMx, p.inMz] : [Math.sin(p.facing), Math.cos(p.facing)]; };
    var land = function (x, z, cd, momentum, fx) {
      p.x = x; p.z = z; clampArena(p); p.cds.leap = cd; p.momentum = momentum; p.still = 0;
      if (p.cast) p.cast = null;
      emit(S, { type: 'blink', id: p.id, fromX: ox, fromZ: oz, fx: fx });
    };
    if (T(p, 'dodge')) { var d1 = dir(); land(p.x + d1[0] * 7, p.z + d1[1] * 7, 4, 2, 'leap'); return; }
    if (T(p, 'stim')) { var d2 = dir(); land(p.x + d2[0] * 9, p.z + d2[1] * 9, 8, 3, 'leap'); return; }
    if (T(p, 'skates')) { p.cds.leap = 8; p.skates = 3; emit(S, { type: 'fx', fx: 'boost', src: p.id }); return; }
    if (p.role === 'tank') { riotCharge(S, p, ox, oz); return; }
    if (T(p, 'medevac')) {
      // Aimed: whoever you're pointing at. Otherwise (or nobody there), the most hurt.
      var hurt = (aimWeapon(p) ? softTarget(S, p, { range: 25, dot: 0.75, ally: true }) : null) ||
        players(S, true).filter(function (q) { return q !== p && q.hp < q.maxHp && dist(q, p) <= 25; })
          .sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; })[0];
      if (!hurt) return;
      var hx = p.x - hurt.x, hz = p.z - hurt.z, hl = Math.sqrt(hx * hx + hz * hz) || 1;
      land(hurt.x + hx / hl * 1.5, hurt.z + hz / hl * 1.5, 12, 0, 'leap');
      shieldUp(hurt, p, 150, 400); emit(S, { type: 'fx', fx: 'guard', src: hurt.id });
    }
  }
  function moveSpeed(S, p) { return p.speed * (nearby(S, p, 'escort', 8) ? 1.2 : 1) * (p.barrierUp ? 0.5 : 1) * (p.skates > 0 ? 1.5 : 1); }
  function tickPlayer(S, p, dt) {
    if (!p.alive) { p.dash = null; return; }
    if (p.dash) tickDash(S, p, dt);
    if (p.gcd > 0) p.gcd = Math.max(0, p.gcd - dt);
    var cdRate = 1;
    for (var k in p.cds) if (p.cds[k] > 0) p.cds[k] = Math.max(0, p.cds[k] - dt * cdRate);
    if (p.spreeT > 0) { p.spreeT -= dt; if (p.spreeT <= 0) p.spree = 0; }
    if (p.alive && S.t > 0) p.ult = Math.min(100, (p.ult || 0) + TUNE.ultRate * dt);
    if (p.alive && resOf(p).regen) p.pips = Math.max(0, Math.min(resOf(p).max, (p.pips || 0) + resOf(p).regen * dt));
    if (p.rad > 0 && p.alive) {
      // Meltdown radiation ramps up the longer it sits on you.
      var into = TUNE.radDur - p.rad; p.rad -= dt;
      p.radAcc = (p.radAcc || 0) + (25 + 9 * into) * dt;
      if (p.radAcc >= 40 || p.rad <= 0) { damagePlayer(S, S.bossId, p, p.radAcc, 'Radiation', true); p.radAcc = 0; }
      if (p.rad < 0) p.rad = 0;
    }
    if (p.recoil > 0) p.recoil = Math.max(0, p.recoil - p.recoil * dt / 3);
    if (p.comboStep && S.t - (p.comboT || 0) > TUNE.comboReset) p.comboStep = 0;   // the slam doesn't wait for you
    if (p.role === 'tank') {
      var maxC = T(p, 'twincharge') ? 2 : 1;
      if ((p.charges || 0) < maxC) { p.chargeT = (p.chargeT || 0) + dt; if (p.chargeT >= TUNE.chargeCd) { p.chargeT = 0; p.charges = (p.charges || 0) + 1; } }
      else p.chargeT = 0;
    }
    if (p.barrier != null && !p.barrierUp) {
      p.barrierRestT = (p.barrierRestT || 0) + dt;
      if (!(p.barrierBroken > 0) && p.barrierRestT >= TUNE.barrierRest) p.barrier = Math.min(barrierMax(p), p.barrier + TUNE.barrierRegen * (T(p, 'hardened') ? 2 : 1) * dt);
    }   // "recent" fades over a few seconds
    ['belt', 'adren', 'amp', 'pump', 'afterburn', 'momentum', 'opp', 'counter', 'rallied', 'stimmed', 'warcry', 'procT', 'wall', 'dome', 'screen', 'jam', 'barrierHoldT', 'barrierBroken', 'beamHoldT', 'cloak', 'storm', 'skates'].forEach(function (f) { if (p[f] > 0) p[f] = Math.max(0, p[f] - dt); });
    if (p.hot > 0) {
      var src = ent(S, p.hotSrc), step = Math.min(dt, p.hot);
      p.hot -= dt;
      p.hotAcc = (p.hotAcc || 0) + 25 * step;
      if (p.hotAcc >= 16 || p.hot <= 0) { if (src) heal(S, src, p, p.hotAcc, 'Spray'); p.hotAcc = 0; }
      if (p.hot < 0) p.hot = 0;
    }
    if (p.sludge > 0) {
      p.sludge -= dt; p.sludgeAcc += dt;
      while (p.sludgeAcc >= 1 && p.alive) { p.sludgeAcc -= 1; damagePlayer(S, S.bossId, p, TUNE.sludgeTick, 'Sludge'); }
      if (p.sludge <= 0) { p.sludge = 0; p.sludgeAcc = 0; }
    }
    if (p.cast && p.alive) {
      p.cast.t += dt * (braced(p) ? 1.25 : 1);
      if (p.cast.t >= p.cast.dur) {
        var c = p.cast; p.cast = null;
        var tgt = ent(S, c.targetId);
        if (tgt && tgt.alive) fire(S, p, c.ab, tgt);
      }
    }
  }

  /* ---------- enemies ---------- */

  function pickTarget(S, e) {
    if (e.fixate) {
      var f = ent(S, e.fixate.id);
      if (f && f.alive) return f.id;
      e.fixate = null;
    }
    var cur = e.target != null ? ent(S, e.target) : null;
    var curT = cur && cur.alive ? (e.threat[cur.id] || 0) : -1;
    if (cur && !cur.alive) cur = null;
    var best = cur && cur.alive ? cur : null, bestT = curT;
    players(S, true).forEach(function (p) {
      var th = e.threat[p.id] || 0;
      // A new target needs 10% more threat than the current one, so aggro doesn't flicker.
      if (!best || (best === cur ? th > bestT * 1.1 : th > bestT)) { best = p; bestT = th; }
    });
    return best ? best.id : null;
  }

  function tickEnemy(S, e, dt) {
    if (!e.alive) return;
    // Never keep a dead player as the target, whatever state the enemy is in (staggered, walking to the middle, mid-charge).
    var was = e.target != null ? ent(S, e.target) : null;
    if (was && !was.alive) { e.target = pickTarget(S, e); if (e.cast && e.cast.target === was.id) e.cast = null; }
    if (e.acid > 0) {
      // Bio Rifle acid: ticks about once a second.
      var step0 = Math.min(dt, e.acid); e.acid -= dt;
      e.acidAcc = (e.acidAcc || 0) + e.acidDps * step0;
      if (e.acidAcc >= 15 || e.acid <= 0) { var asrc = ent(S, e.acidSrc); if (asrc) damageEnemy(S, asrc, e, e.acidAcc, 1, 'Acid'); e.acidAcc = 0; }
      if (!e.alive) return;
    }
    if (e.bleed > 0) {
      // Chainsaw bleed: kept apart from the Bio Rifle's acid so a Medic and a Wrecker don't overwrite each other.
      var bstep = Math.min(dt, e.bleed); e.bleed -= dt;
      e.bleedAcc = (e.bleedAcc || 0) + 28 * bstep;
      if (e.bleedAcc >= 28 || e.bleed <= 0) { var bsrc = ent(S, e.bleedBy); if (bsrc) damageEnemy(S, bsrc, e, e.bleedAcc, 1, 'Bleed'); e.bleedAcc = 0; }
      if (!e.alive) return;
    }
    if (e.stagger > 0) { e.stagger -= dt; return; }   // staggered: no moving, no swinging
    if (e.goCentre) {
      var cl = Math.hypot(e.x, e.z), cs = Math.min(TUNE.centreSpeed * dt, cl);
      if (cl > 0.01) { e.x -= e.x / cl * cs; e.z -= e.z / cl * cs; e.facing = Math.atan2(-e.x, -e.z); }
      return;
    }
    if (e.oshield) { e.target = pickTarget(S, e); return; }   // planted and channelling: no moving, no swinging
    if (e.charging) {
      var c = e.charging; c.t += dt;
      var k = Math.min(1, c.t / c.dur);
      e.x = c.x1 + (c.x2 - c.x1) * k; e.z = c.z1 + (c.z2 - c.z1) * k;
      if (k >= 1) { e.charging = null; e.swing = 1.2; }
      return;
    }
    if (e.fixate) { e.fixate.t -= dt; if (e.fixate.t <= 0) e.fixate = null; }
    if (e.weak > 0) e.weak -= dt;
    if (e.branded > 0) e.branded -= dt;
    if (e.suppressed > 0) e.suppressed -= dt;
    if (e.spotted > 0) e.spotted -= dt;
    if (e.hamstrung > 0) e.hamstrung -= dt;
    if (e.slowed > 0) e.slowed -= dt;
    e.target = pickTarget(S, e);
    var tgt = e.target != null ? ent(S, e.target) : null;
    if (e.cast) {
      e.cast.t += dt * (e.suppressed > 0 ? 0.6 : 1);
      if (e.cast.t >= e.cast.dur) { var cc = e.cast; e.cast = null; cc.done(); }
      return;
    }
    if (!tgt) return;
    var reach = (e.radius || 1) + 1.5;
    var d = dist(e, tgt);
    e.facing = Math.atan2(tgt.x - e.x, tgt.z - e.z);
    if (d > reach) {
      var step = Math.min(e.speed * dt, d - reach + 0.1);
      e.x += (tgt.x - e.x) / d * step; e.z += (tgt.z - e.z) / d * step;
    }
    e.swing -= dt;
    if (e.swing <= 0 && d <= reach + 0.6) {
      e.swing = e.swingInt * (e.slowed > 0 ? 1.33 : 1);
      var dmg = e.melee * (S.enraged && e.type === 'boss' ? 3 : 1) * (e.weak > 0 ? 0.75 : 1) * (e.suppressed > 0 ? 0.8 : 1) * (e.hamstrung > 0 ? 0.85 : 1);
      emit(S, { type: 'fx', fx: e.type === 'boss' ? 'cleave' : 'melee', src: e.id, dst: tgt.id });
      damagePlayer(S, e.id, tgt, dmg, 'Hit');
      if (e.type === 'boss') {
        // Frontal cleave: anyone else standing in front of the Foreman gets clipped.
        var fx = Math.sin(e.facing), fz = Math.cos(e.facing);
        players(S, true).forEach(function (p) {
          if (p === tgt) return;
          var dx = p.x - e.x, dz = p.z - e.z, l = Math.sqrt(dx * dx + dz * dz);
          if (l <= reach + 2 && (fx * dx + fz * dz) / (l || 1) > 0.35) damagePlayer(S, e.id, p, dmg * TUNE.cleaveMult, 'Cleave');
        });
      }
    }
  }

  function bossScript(S, boss, dt) {
    if (!boss.alive) return;
    var T = S.timers, alive = players(S, true);
    if (!alive.length) return;

    if (S.phase === 1 && boss.hp <= boss.maxHp * 0.5) {
      S.phase = 2;
      emit(S, { type: 'announce', text: 'PHASE TWO', tone: 'bad' });
      emit(S, { type: 'log', text: 'The Foreman calls security drones and vents bio sludge.' });
    }
    if (!S.enraged && S.t >= TUNE.enrageAt) {
      S.enraged = true;
      emit(S, { type: 'announce', text: 'OVERTIME', tone: 'bad' });
      emit(S, { type: 'log', text: 'Overtime. The Foreman hits three times as hard and runs you down.' });
      boss.speed = 9;
    }

    T.barrage -= dt;
    if (T.barrage <= 0) {
      T.barrage = TUNE.barrageEvery * (S.phase === 3 ? 0.8 : 1);
      var pool = alive.filter(function (p) { return p.id !== boss.target; });
      if (!pool.length) pool = alive.slice();
      var n = S.phase >= 2 ? 2 : 1;
      for (var i = 0; i < n && pool.length; i++) {
        var p = pool.splice(Math.floor(S.rng() * pool.length), 1)[0];
        S.telegraphs.push({ id: S.nextId++, shape: 'circle', x: p.x, z: p.z, r: TUNE.barrageR, t: 0, dur: TUNE.barrageDelay, dmg: TUNE.barrageDmg });
      }
      emit(S, { type: 'log', text: 'Rocket barrage incoming. Move out of the red.' });
      emit(S, { type: 'fx', fx: 'barrage', src: boss.id });
    }

    if (!boss.cast && !boss.charging && !boss.oshield && !boss.goCentre) {
      T.charge -= dt;
      if (T.charge <= 0) {
        T.charge = TUNE.chargeEvery;
        var far = alive.filter(function (p) { return p.id !== boss.target; }).sort(function (a, b) { return dist(b, boss) - dist(a, boss); })[0];
        if (far) {
          var dx = far.x - boss.x, dz = far.z - boss.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
          var len = Math.min(l + 5, 34), ex = boss.x + dx / l * len, ez = boss.z + dz / l * len;
          var end = { x: ex, z: ez }; clampArena(end, 3);
          var g = { id: S.nextId++, shape: 'line', x1: boss.x, z1: boss.z, x2: end.x, z2: end.z, w: TUNE.chargeW, t: 0, dur: TUNE.chargeDelay, dmg: TUNE.chargeDmg, charge: true };
          S.telegraphs.push(g);
          boss.facing = Math.atan2(dx, dz);
          boss.cast = { name: 'Bulldozer', t: 0, dur: TUNE.chargeDelay, done: function () {} };
          emit(S, { type: 'log', text: 'The Foreman lines up a charge at ' + far.name + '.' });
          emit(S, { type: 'fx', fx: 'barrage', src: boss.id });
        }
      }
    }

    // Crusher: the tank buster. Only when he's next to his target and not busy with anything else.
    var victim = boss.target != null ? ent(S, boss.target) : null;
    if (!boss.cast && !boss.charging && !boss.oshield && !boss.goCentre && !(boss.stagger > 0) && victim && victim.alive && dist(boss, victim) <= boss.radius + 4) {
      T.buster -= dt;
      if (T.buster <= 0) {
        T.buster = TUNE.busterEvery;
        boss.cast = { name: 'Crusher', t: 0, dur: TUNE.busterCast, target: victim.id, done: function () {
          var v = ent(S, this.target);
          if (!v || !v.alive || !boss.alive) return;
          emit(S, { type: 'fx', fx: 'cleave', src: boss.id });
          damagePlayer(S, boss.id, v, TUNE.busterDmg * (boss.weak > 0 ? 0.75 : 1), 'Crusher');
        } };
        emit(S, { type: 'announce', src: victim.id, text: 'CRUSHER ON ' + victim.name, you: 'CRUSHER: MITIGATE', tone: 'bad', quick: true });
        emit(S, { type: 'log', id: victim.id, text: 'The Foreman winds up a Crusher on ' + victim.name + '.', you: 'The Foreman winds up a Crusher on you. Mitigate it.' });
      }
    }

    // Leap: the Foreman crouches, marks where he will land on someone, and comes down there.
    if (!boss.cast && !boss.charging && !boss.oshield && !boss.goCentre) {
      T.leap -= dt;
      if (T.leap <= 0) {
        T.leap = TUNE.leapEvery;
        var prey = alive.filter(function (p) { return p.id !== boss.target && dist(p, boss) > 10; });
        var mark = prey.length ? prey[Math.floor(S.rng() * prey.length)] : null;
        var lx, lz;
        if (mark) { lx = mark.x; lz = mark.z; }
        else { var la = S.rng() * Math.PI * 2; lx = -boss.x * 0.5 + Math.sin(la) * 12; lz = -boss.z * 0.5 + Math.cos(la) * 12; }
        var spot = { x: lx, z: lz }; clampArena(spot, 5);
        S.telegraphs.push({ id: S.nextId++, shape: 'circle', x: spot.x, z: spot.z, r: TUNE.leapR, t: 0, dur: TUNE.leapDelay, dmg: TUNE.leapDmg, leap: true });
        boss.cast = { name: 'Leap', t: 0, dur: TUNE.leapDelay, done: function () {} };
        boss.facing = Math.atan2(spot.x - boss.x, spot.z - boss.z);
        emit(S, { type: 'log', text: 'The Foreman crouches to leap' + (mark ? ' at ' + mark.name : '') + '. Get out from under him.' });
        emit(S, { type: 'fx', fx: 'barrage', src: boss.id });
      }
    }

    // Hero moments: one class at a time gets a mechanic only their ultimate answers.
    T.hero += dt;
    if (TUNE.heroMoments && !S.hero && !boss.cast && !boss.charging && !boss.goCentre && !boss.oshield && !(boss.stagger > 0) && T.hero >= (S.heroIdx ? TUNE.heroEvery : TUNE.heroFirst)) {
      var ROT = ['tank', 'melee', 'healer', 'dps'];
      var role = ROT[S.heroIdx % ROT.length]; S.heroIdx++;
      if (alive.some(function (q) { return q.role === role; })) { T.hero = 0; startHero(S, boss, role, alive); }
    }

    // Overcharge: energy builds; when full he heads for the middle of the room, plants himself and raises the shield.
    // While it's up he stands still, doesn't swing, and pulses the whole room. Break it in time and he staggers.
    if (!boss.oshield && !boss.goCentre && !(boss.stagger > 0)) boss.energy = Math.min(100, (boss.energy || 0) + 100 / TUNE.overEvery * dt);
    if (boss.energy >= 100 && !boss.oshield && !boss.goCentre && !boss.cast && !boss.charging && !(boss.stagger > 0)) {
      boss.goCentre = true;
      emit(S, { type: 'announce', text: 'OVERCHARGING', tone: 'bad', quick: true });
      emit(S, { type: 'log', text: 'The Foreman is fully charged and heads for the middle of the floor.' });
    }
    if (boss.goCentre && Math.hypot(boss.x, boss.z) < 0.6) {
      boss.goCentre = false; boss.energy = 0; boss.x = 0; boss.z = 0;
      boss.oshield = { hp: TUNE.overShield, max: TUNE.overShield, t: 0, dur: TUNE.overWindow };
      T.pulse = TUNE.pulseEvery;
      S.m.shields.raised++;
      emit(S, { type: 'announce', text: 'OVERCHARGE SHIELD', tone: 'bad' });
      emit(S, { type: 'fx', fx: 'oshield', src: boss.id });
      emit(S, { type: 'log', text: 'The Foreman plants himself and raises an overcharge shield. Everyone on him: break it in ' + TUNE.overWindow + 's.' });
    }
    if (boss.oshield) {
      boss.oshield.t += dt;
      T.pulse -= dt;
      if (T.pulse <= 0) {
        T.pulse = TUNE.pulseEvery;
        emit(S, { type: 'fx', fx: 'pulse', src: boss.id });
        players(S, true).forEach(function (p) { damagePlayer(S, boss.id, p, TUNE.pulseDmg, 'Overcharge Pulse'); });
      }
      if (boss.oshield && boss.oshield.t >= boss.oshield.dur) {
        boss.oshield = null;
        emit(S, { type: 'announce', text: 'OVERCHARGE', tone: 'bad' });
        emit(S, { type: 'fx', fx: 'overcharge', src: boss.id });
        emit(S, { type: 'log', text: 'The shield held. The overcharge goes off.' });
        players(S, true).forEach(function (p) { damagePlayer(S, boss.id, p, TUNE.overDmg, 'Overcharge'); });
      }
    }

    if (S.phase === 2 && boss.hp <= boss.maxHp * TUNE.p3At) {
      S.phase = 3;
      emit(S, { type: 'announce', text: 'PHASE THREE', tone: 'bad' });
      emit(S, { type: 'log', text: 'The Foreman starts tearing up the floor. Sections fall for good and the room shrinks: keep off the red, and throw his drones down the shaft.' });
      T.collapse = 2;
    }
    if (S.phase === 3) {
      T.collapse -= dt;
      if (T.collapse <= 0) {
        T.collapse = TUNE.collapseEvery;
        var down = S.telegraphs.filter(function (g) { return g.shape === 'sector'; });
        if (down.length < TUNE.collapseMax) {
          var taken = down.map(function (g) { return g.k; }), free = [0, 1, 2, 3, 4, 5].filter(function (k) { return taken.indexOf(k) < 0; });
          var k = free[Math.floor(S.rng() * free.length)], w = Math.PI / 3;
          S.telegraphs.push({ id: S.nextId++, shape: 'sector', k: k, a0: k * w, a1: (k + 1) * w, r0: TUNE.collapseR0, r1: ARENA_R + 1, t: 0, dur: TUNE.collapseDelay, life: 1e9, dps: TUNE.collapseDps });
          emit(S, { type: 'log', text: 'A section of floor is giving way. It won\'t come back.' });
          emit(S, { type: 'fx', fx: 'barrage', src: boss.id });
        }
      }
    }

    if (S.phase >= 2) {
      T.drone -= dt;
      if (T.drone <= 0) {
        T.drone = S.phase === 3 ? TUNE.droneEveryP3 : TUNE.droneEvery;
        var healer = alive.filter(function (p) { return p.role === 'healer'; })[0] || alive[Math.floor(S.rng() * alive.length)];
        var a0 = S.rng() * Math.PI * 2;
        for (var j = 0; j < 2; j++) {
          var ang = a0 + j * 2.2;
          var d = {
            id: S.nextId++, kind: 'enemy', type: 'drone', name: 'SECURITY DRONE',
            x: Math.sin(ang) * (ARENA_R - 2), z: Math.cos(ang) * (ARENA_R - 2), facing: 0,
            speed: 6, radius: 1, hp: TUNE.droneHp, maxHp: TUNE.droneHp, alive: true,
            threat: {}, target: null, fixate: null, swing: 1,
            melee: TUNE.droneMelee, swingInt: TUNE.droneSwing, cast: null
          };
          d.threat[healer.id] = 300;
          S.ents.push(d);
          emit(S, { type: 'spawn', id: d.id });
        }
        emit(S, { type: 'log', text: 'Security drones are hunting ' + healer.name + '.' });
      }
      T.sludge -= dt;
      if (T.sludge <= 0) {
        T.sludge = TUNE.sludgeEvery;
        var v = alive[Math.floor(S.rng() * alive.length)];
        v.sludge = TUNE.sludgeDur; v.sludgeAcc = 0;
        emit(S, { type: 'log', text: v.name + ' is covered in Bio Sludge.' });
        emit(S, { type: 'fx', fx: 'sludge', src: v.id });
      }
    }
  }

  var HERO_CALL = {
    tank: ['JUGGERNAUT: RIOT WALL', 'RIOT WALL NOW: KEY 6'],
    melee: ['WRECKER: COUNTER-SLAM', 'COUNTER-SLAM HIM: KEY 6'],
    healer: ['MEDIC: FIELD HOSPITAL', 'FIELD HOSPITAL: KEY 6'],
    dps: ['STRIKER: DEADEYE', 'SHOOT IT DOWN: KEY 6']
  };
  function startHero(S, boss, role, alive) {
    S.hero = { role: role, t: 0 };
    S.m.heroes[role][0]++;
    var who = alive.filter(function (q) { return q.role === role; })[0];
    emit(S, { type: 'announce', text: HERO_CALL[role][0], you: HERO_CALL[role][1], src: who ? who.id : null, tone: 'neutral' });
    emit(S, { type: 'hero', role: role, id: who ? who.id : null });
    var end = function () { S.hero = null; };
    if (role === 'tank') {
      boss.cast = { name: 'Demolition Blast', t: 0, dur: TUNE.blastCast, hero: 'tank', done: function () {
        emit(S, { type: 'fx', fx: 'overcharge', src: boss.id });
        players(S, true).forEach(function (q) { damagePlayer(S, boss.id, q, TUNE.blastDmg, 'Demolition Blast'); });
        end();
      } };
      emit(S, { type: 'log', text: 'Demolition Blast in ' + TUNE.blastCast + 's. Juggernaut, raise the Riot Wall; everyone get behind them.' });
    } else if (role === 'melee') {
      boss.cast = { name: 'Haymaker', t: 0, dur: TUNE.haymakerCast, hero: 'melee', done: function () {
        var victim = boss.target != null ? ent(S, boss.target) : null;
        emit(S, { type: 'fx', fx: 'cleave', src: boss.id });
        if (victim && victim.alive) damagePlayer(S, boss.id, victim, TUNE.haymakerDmg, 'Haymaker');
        end();
      } };
      emit(S, { type: 'log', text: 'The Foreman winds up a Haymaker. Wrecker, Counter-Slam him before it lands.' });
    } else if (role === 'healer') {
      boss.cast = { name: 'Meltdown', t: 0, dur: TUNE.meltCast, hero: 'healer', done: function () {
        players(S, true).forEach(function (q) { q.rad = TUNE.radDur; q.radAcc = 0; });
        emit(S, { type: 'fx', fx: 'sludge', src: boss.id });
        emit(S, { type: 'log', text: 'Meltdown. Radiation is building on everyone. Medic: Field Hospital clears it.' });
        S.hero.t = 0; S.hero.melt = true;
      } };
      emit(S, { type: 'log', text: 'The Foreman vents his core. Meltdown in ' + TUNE.meltCast + 's.' });
    } else {
      var prey = alive.filter(function (q) { return q.role === 'healer'; })[0] || alive.filter(function (q) { return q.role !== 'dps'; })[0] || alive[0];
      S.missile = { x: boss.x, z: boss.z, x0: boss.x, z0: boss.z, tgt: prey.id, t: 0, dur: TUNE.rocketDur };
      emit(S, { type: 'log', text: 'Heavy Rocket away, homing on ' + prey.name + '. Striker, Deadeye it out of the air.' });
      emit(S, { type: 'fx', fx: 'barrage', src: boss.id });
    }
  }
  function heroDone(S, role, ok) {
    if (!ok || !S.hero || S.hero.role !== role || S.hero.done) return;
    S.hero.done = true; S.m.heroes[role][1]++;
  }

  function tickWorld(S, dt) {
    for (var di = S.domes.length - 1; di >= 0; di--) { S.domes[di].t -= dt; if (S.domes[di].t <= 0) S.domes.splice(di, 1); }
    for (var fi = S.fields.length - 1; fi >= 0; fi--) {
      // Nano Field: heals anyone standing in it, half a second at a time.
      var fd = S.fields[fi], fby = ent(S, fd.by); fd.t -= dt;
      if (fd.t > (fd.life || 6)) continue;   // still in the air
      if (!fd.landed) { fd.landed = true; emit(S, { type: 'fx', fx: 'field', src: fd.by, x2: fd.x, z2: fd.z }); }
      fd.acc += dt;
      if (fd.acc >= 0.5) {
        players(S, true).forEach(function (q) {
          if (!fby || Math.hypot(q.x - fd.x, q.z - fd.z) > fd.r) return;
          heal(S, fby, q, 70 * fd.acc, 'Nano Field');
          if (T(fby, 'purgefield') && q.sludge > 0 && !(fd.purged = fd.purged || {})[q.id]) { fd.purged[q.id] = 1; q.sludge = 0; emit(S, { type: 'log', text: fby.name + "'s field washes the sludge off " + q.name + '.' }); }
        });
        if (fby && T(fby, 'caustic')) enemies(S).forEach(function (e) { if (Math.hypot(e.x - fd.x, e.z - fd.z) <= fd.r + (e.radius || 0)) damageEnemy(S, fby, e, 80 * fd.acc, 1, 'Caustic Field'); });
        fd.acc = 0;
      }
      if (fd.t <= 0) S.fields.splice(fi, 1);
    }
    players(S, true).forEach(function (q) {
      if (!(q.storm > 0)) return;
      // Link Storm: the beam on everyone in reach.
      q.stormAcc = (q.stormAcc || 0) + dt;
      if (q.stormAcc >= 0.5) { players(S, true).forEach(function (a) { if (dist(a, q) <= 25) heal(S, q, a, 150 * q.stormAcc, 'Link Storm'); }); q.stormAcc = 0; }
    });
    if (S.hero && S.hero.melt) {
      // Meltdown is over once the radiation is gone, whether cleansed or not.
      S.hero.t += dt;
      if (!players(S, true).some(function (q) { return q.rad > 0; })) S.hero = null;
    }
    if (S.missile) {
      // The Heavy Rocket homes in on its mark; two seconds out it marks the blast on the floor.
      var mm = S.missile, mt = ent(S, mm.tgt); mm.t += dt;
      if (mt && mt.alive) { mm.tx = mt.x; mm.tz = mt.z; }
      else if (!mm.marked) {
        // Its mark went down: the rocket picks someone else still standing rather than diving on a body.
        var nm = players(S, true).sort(function (a, c) { return dist(a, mm) - dist(c, mm); })[0];
        if (nm) mm.tgt = nm.id;
      }
      var kk = Math.min(1, mm.t / mm.dur);
      mm.x = mm.x0 + ((mm.tx || mm.x0) - mm.x0) * kk; mm.z = mm.z0 + ((mm.tz || mm.z0) - mm.z0) * kk;
      if (mm.t >= mm.dur - 2 && !mm.marked) {
        mm.marked = true;
        S.telegraphs.push({ id: S.nextId++, shape: 'circle', x: mm.tx || mm.x, z: mm.tz || mm.z, r: 6, t: 0, dur: 2, dmg: TUNE.rocketDmg, missile: true, label: 'Heavy Rocket' });
      }
      if (mm.t >= mm.dur) { S.missile = null; if (S.hero && S.hero.role === 'dps') S.hero = null; }
    }
    var boss = ent(S, S.bossId);
    for (var r = S.revives.length - 1; r >= 0; r--) {
      var rv = S.revives[r]; rv.t -= dt;
      if (rv.t > 0) continue;
      S.revives.splice(r, 1);
      var back = ent(S, rv.id), by = ent(S, rv.by);
      if (!back || back.alive || !boss.alive) continue;
      back.alive = true; back.hp = Math.round(back.maxHp * 0.3); back.cast = null; back.armor = 0;
      emit(S, { type: 'revive', id: back.id });
      if (by) proc(S, by, 'defib', 'CLEAR!', 'all');
      emit(S, { type: 'log', id: back.id, text: back.name + ' is back up.', you: "You're back up." });
    }
    for (var i = S.telegraphs.length - 1; i >= 0; i--) {
      var g = S.telegraphs[i];
      g.t += dt;
      if (g.shape === 'sector' && g.t >= g.dur) {
        if (!g.down) { g.down = true; emit(S, { type: 'collapse', id: g.id }); emit(S, { type: 'log', text: 'The floor gives way.' }); }
        players(S, true).forEach(function (q) {
          if (!inTele(g, q)) return;
          q.fallAcc = (q.fallAcc || 0) + g.dps * dt;
          if (q.fallAcc >= g.dps / 2) { damagePlayer(S, S.bossId, q, q.fallAcc, 'Collapse'); q.fallAcc = 0; }
        });
        if (g.t >= g.dur + g.life) S.telegraphs.splice(i, 1);
        continue;
      }
      players(S, true).forEach(function (q) { if (T(q, 'opportunist') && inTele(g, q)) { g.lastIn = g.lastIn || {}; g.lastIn[q.id] = g.t; } });
      if (g.t < g.dur) continue;
      players(S, true).forEach(function (q) {
        if (!T(q, 'opportunist') || !g.lastIn || g.lastIn[q.id] === undefined || inTele(g, q)) return;
        if (g.dur - g.lastIn[q.id] <= 1.0) {
          q.opp = 6;
          emit(S, { type: 'fx', fx: 'opportunist', src: q.id });
          emit(S, { type: 'log', id: q.id, text: q.name + ' dodges late. Opportunist.', you: 'Late dodge. Opportunist for 6s.' });
        }
      });
      S.telegraphs.splice(i, 1);
      if (g.shape === 'line') {
        if (!boss.alive) continue;
        boss.cast = null;
        boss.charging = { x1: boss.x, z1: boss.z, x2: g.x2, z2: g.z2, t: 0, dur: 0.45 };
        emit(S, { type: 'fx', fx: 'charge', src: boss.id });
        players(S, true).forEach(function (p) {
          if (!inTele(g, p)) return;
          damagePlayer(S, boss.id, p, g.dmg, 'Charge');
          if (braced(p) || T(p, 'clamps')) return;   // Brace and Mag-Clamps hold their ground
          var e = escapeDir(g, p); p.x += e.x * 6; p.z += e.z * 6; clampArena(p); p.cast = null;
          emit(S, { type: 'knock', id: p.id });
        });
      } else if (g.leap) {
        if (!boss.alive) continue;
        boss.cast = null;
        boss.charging = { x1: boss.x, z1: boss.z, x2: g.x, z2: g.z, t: 0, dur: 0.5 };
        emit(S, { type: 'boom', x: g.x, z: g.z, r: g.r });
        emit(S, { type: 'fx', fx: 'leap', src: boss.id });
        players(S, true).forEach(function (p) {
          if (!inTele(g, p)) return;
          damagePlayer(S, boss.id, p, g.dmg, 'Leap');
          if (braced(p) || T(p, 'clamps')) return;
          var e = escapeDir(g, p); p.x += e.x * 5; p.z += e.z * 5; clampArena(p); p.cast = null;
          emit(S, { type: 'knock', id: p.id });
        });
      } else {
        emit(S, { type: 'boom', x: g.x, z: g.z, r: g.r });
        players(S, true).forEach(function (p) { if (inTele(g, p)) damagePlayer(S, S.bossId, p, g.dmg, g.label || 'Rocket'); });
      }
    }
  }

  /* ---------- bots ---------- */

  function botThink(S, p, dt) {
    var inp = { mx: 0, mz: 0, ability: -1 };
    if (!p.alive) return inp;
    var b = p.bot, boss = ent(S, S.bossId), foes = enemies(S), slow = b.slow || 1, W = p.gear.weapon;
    var abil = abilitiesOf(p);
    var idx = function (id) { for (var i = 0; i < abil.length; i++) if (abil[i].id === id) return i; return -1; };
    var ready = function (id) { return idx(id) >= 0 && (p.cds[id] || 0) <= 0; };
    var moveTo = function (x, z) { inp.mx = x - p.x; inp.mz = z - p.z; };
    var moving = function () { return Math.abs(inp.mx) + Math.abs(inp.mz) > 0.01; };
    // The same rotation a person plays: proc when it lights, spend at full pips (sooner while the shield is up), else build.
    var wab = p.kit.weapons[p.weapon].abilities, BLD = wab[0], SPD = wab[1], PRC = wab[2];
    var inRange = function (ab, t) { return ab.kind === 'self' || (t && dist(p, t) <= ab.range + (t.radius || 0)); };
    var attack = function (t) {
      if (!t) return false;
      if (p.procT > 0 && PRC.kind !== 'friend' && inRange(PRC, t)) { inp.target = t.id; inp.ability = 2; return true; }
      if (p.gcd > 0) return false;
      var RS = resOf(p), hot = boss.oshield || boss.stagger > 0, spendAt;
      if (RS.id === 'revs') spendAt = boss.oshield ? 3 : RS.max - (S.rng() < 0.3 ? 1 : 0);
      else if (RS.id === 'heat') spendAt = boss.oshield ? 60 : 96;      // ride the Redline, vent before it is wasted
      else spendAt = hot ? RS.min : 95;                                    // Striker: pool, then dump into a window
      if (b.dump > 0 && (p.pips || 0) >= RS.min) spendAt = RS.min;
      if (SPD.kind === 'enemy' && (p.pips || 0) >= spendAt && (b.dump = RS.id === 'cap' ? 1 : 0, true) && inRange(SPD, t) && !(SPD.cast > 0 && moving())) { inp.target = t.id; inp.ability = 1; return true; }
      if (inRange(BLD, t)) { inp.target = t.id; inp.ability = 0; return true; }
      return false;
    };

    // Step out of telegraphs after a short reaction delay.
    var inside = null;
    S.telegraphs.forEach(function (g) { if (!g.down && inTele(g, p, 1.2)) inside = g; });   // fallen floor: see avoidFallen
    if (inside) {
      b.danger += dt;
      if (b.danger > b.react * slow) {
        var e = escapeDir(inside, p); inp.mx = e.x; inp.mz = e.z; if (T(p, 'dodge') || T(p, 'stim')) inp.jump = true;
        // About to land and still under it: pop the personal defensive if there is one.
        if (inside.dur - inside.t < 0.7 && ready('cloak')) inp.ability = idx('cloak');
        return inp;
      }
    } else b.danger = 0;

    b.think -= dt / slow;
    var canAct = !p.cast && b.think <= 0;
    if (b.lazy && p.role === 'tank' && boss.alive) {
      // The one-button tank for the report: walk to the Foreman, face him, press key 1. Nothing else, ever.
      var dl = dist(p, boss) - boss.radius;
      if (dl > 3.5) moveTo(boss.x, boss.z);
      inp.aim = Math.atan2(boss.x - p.x, boss.z - p.z); inp.target = boss.id;
      if (canAct && p.gcd <= 0 && !(p.jam > 0)) { inp.ability = 0; b.think = 0.15 + S.rng() * 0.35; }
      return inp;
    }

    // Hero moments: answer your own with the ultimate after a human-ish beat; get behind a Riot Wall.
    var ULT = abil.findIndex ? abil.findIndex(function (a) { return a.role === 'ult'; }) : abil.length - 1, ultUp = (p.ult || 0) >= 100, bc = boss.alive && boss.cast;
    if (bc && bc.name === 'Demolition Blast') {
      if (p.role === 'tank') { if (ultUp && bc.t > 0.8 * slow) { inp.ability = ULT; return inp; } }
      else {
        var wallT = players(S, true).filter(function (q) { return q.wall > 0; })[0];
        if (wallT && !sheltered(S, p)) {
          var wx = wallT.x - boss.x, wz = wallT.z - boss.z, wl = Math.sqrt(wx * wx + wz * wz) || 1;
          moveTo(wallT.x + wx / wl * 5, wallT.z + wz / wl * 5); return inp;
        }
      }
    }
    if (p.role === 'tank' && bc && bc.name === 'Demolition Blast' && p.wall > 0) { inp.target = boss.id; return inp; }   // hold the wall in place
    // Free use: each class spends its ultimate when it would do the most.
    var osh = boss.alive && boss.oshield, lateShield = osh && osh.t > osh.dur - 1.6 && osh.hp > osh.max * 0.2;
    if (ultUp && boss.alive && S.t > 8) {
      if (p.role === 'tank' && (lateShield || p.hp < p.maxHp * 0.5 || S.telegraphs.some(function (g) { return g.leap; }))) { inp.ability = ULT; return inp; }
      if (p.role === 'healer') {
        var squadNow = players(S, true);
        if (squadNow.filter(function (q) { return q.hp < q.maxHp * 0.6; }).length >= 2 || squadNow.some(function (q) { return q.hp < q.maxHp * 0.3; })) { inp.ability = ULT; return inp; }
      }
      if (p.role === 'dps' && (osh || boss.stagger > 0 || p.adren > 0)) { inp.target = boss.id; inp.ability = ULT; return inp; }
      if (p.role === 'melee' && !osh && !(boss.stagger > 0) && !bc && dist(p, boss) <= 7 + boss.radius && b.think <= 0) { inp.target = boss.id; inp.ability = ULT; return inp; }
    }
    var domeNear = S.domes.filter(function (dm) { return dm.t > 1 && Math.hypot(p.x - dm.x, p.z - dm.z) > dm.r - 1.5 && Math.hypot(p.x - dm.x, p.z - dm.z) < 22; })[0];
    if (domeNear && p.role !== 'tank') { moveTo(domeNear.x, domeNear.z); return inp; }
    if (lateShield && p.role !== 'tank') {
      // The shield is going to hold: get behind a Riot Wall if there is one.
      var wallUp = players(S, true).filter(function (q) { return q.wall > 0; })[0];
      if (wallUp && !sheltered(S, p)) {
        var ux = wallUp.x - boss.x, uz = wallUp.z - boss.z, ul = Math.sqrt(ux * ux + uz * uz) || 1;
        moveTo(wallUp.x + ux / ul * 5, wallUp.z + uz / ul * 5); return inp;
      }
    }
    if (p.role === 'healer' && ultUp && players(S, true).some(function (q) { return q.rad > 0 && q.rad < TUNE.radDur - 1.2 * slow; })) { inp.ability = ULT; return inp; }
    if (p.role === 'dps' && ultUp && S.missile && S.missile.t > 1.5 * slow) { inp.ability = ULT; return inp; }
    if (p.role === 'melee' && ultUp && bc && bc.name === 'Haymaker' && bc.t > 1.0 * slow) {
      inp.target = boss.id;
      if (dist(p, boss) > 7 + boss.radius) { if (ready('dash')) inp.ability = idx('dash'); else moveTo(boss.x, boss.z); return inp; }
      inp.ability = ULT; return inp;
    }

    if (p.role === 'tank') {
      if (!foes.length) return inp;
      var main = boss.alive ? boss : foes[0];
      inp.target = main.id;
      var d = dist(p, main) - (main.radius || 0), heat = p.pips || 0;
      if (d > 3.5) moveTo(main.x, main.z);
      if (d > 10 && (p.charges || 0) >= 1 && !S.telegraphs.length) { inp.jump = true; inp.aim = Math.atan2(main.x - p.x, main.z - p.z); }   // charge in, never back into a telegraph
      var fire0 = function (i, t) { inp.target = (t || main).id; inp.ability = i; b.think = 0.15 + S.rng() * 0.35; return inp; };
      if (W === 'hammer') inp.aim = Math.atan2(main.x - p.x, main.z - p.z);
      if (b.lazy) { if (canAct && p.gcd <= 0 && !(p.jam > 0)) fire0(0); return inp; }   // the one-button tank, for the report
      if (W === 'hammer') {
        // Aim at the main target. Raise the barrier for the Crusher and a failing shield; otherwise keep the combo going.
        var bcH = boss.alive && boss.cast;
        var crushH = bcH && bcH.name === 'Crusher' && bcH.target === p.id && bcH.t > 0.6 * slow;
        var oshH = boss.alive && boss.oshield && boss.oshield.t > boss.oshield.dur - 1.0 && boss.oshield.hp > boss.oshield.max * 0.15;
        if ((crushH || oshH) && p.barrier > 300 && !(p.barrierBroken > 0)) b.barT = 0.5;
        if (b.barT > 0) { b.barT -= dt; b.chgT = 0; inp.hold = [false, true]; inp.aim = Math.atan2(boss.x - p.x, boss.z - p.z); return inp; }
        if (crushH && ready('belt') && !(p.belt > 0)) return fire0(idx('belt'), p);
        if (p.hp < p.maxHp * 0.3 && ready('belt')) return fire0(idx('belt'), p);
        var looseH = foes.filter(function (f) { return f.target !== p.id && !(f.fixate && f.fixate.id === p.id); })
          .sort(function (a2, c2) { return dist(p, a2) - dist(p, c2); });
        var aimAt = function (f) { inp.aim = Math.atan2(f.x - p.x, f.z - p.z); };
        if (looseH.length && ready('challenge') && dist(p, looseH[0]) <= 30 + (looseH[0].radius || 0)) { aimAt(looseH[0]); return fire0(idx('challenge'), looseH[0]); }
        if (looseH.length && ready('piston') && dist(p, looseH[0]) > 8 && dist(p, looseH[0]) <= 22 + (looseH[0].radius || 0)) { aimAt(looseH[0]); return fire0(idx('piston'), looseH[0]); }
        if (looseH.length && dist(p, looseH[0]) > 12 && (p.charges || 0) >= 1 && !S.telegraphs.length) { inp.jump = true; aimAt(looseH[0]); return inp; }
        // Shove when the bar is (nearly) full, or a little earlier if there's a drone in the arc to throw.
        var arcAdds = inCone(S, p, 8, 0.4).filter(function (f) { return f.type !== 'boss'; }).length;
        if (heat >= 95 - (slow > 1 ? 10 : 0) || (heat >= 60 && arcAdds >= 1)) { if (d <= 7) { inp.hold = [true, true]; b.think = 0.2; return inp; } }
        if (d <= 6 && canAct) { inp.hold = [true, false]; b.think = 0.05 + S.rng() * 0.2 * slow; }
        return inp;
      }
      // The Crusher is coming at me: mitigate in the weapon's own way, a beat after it starts.
      var crush = boss.alive && boss.cast && boss.cast.name === 'Crusher' && boss.cast.target === p.id && boss.cast.t > 0.7 * slow;
      if (crush && !(p.belt > 0) && !(p.screen > 0) && !(p.armor > 300)) {
        if (W === 'flak' && heat >= 50) return fire0(2, p);
        if (W === 'minigun' && heat >= 30) return fire0(2, p);
        if (ready('belt')) return fire0(idx('belt'), p);
      }
      if (p.hp < p.maxHp * 0.3 && ready('belt')) return fire0(idx('belt'), p);
      // Pick up anything not on me: taunt the closest, or a Shell from range.
      var loose = foes.filter(function (f) { return f.target !== p.id && !(f.fixate && f.fixate.id === p.id); })
        .sort(function (a2, c2) { return dist(p, a2) - dist(p, c2); });
      if (loose.length && ready('challenge') && dist(p, loose[0]) <= 30 + (loose[0].radius || 0)) return fire0(idx('challenge'), loose[0]);
      if (!canAct) return inp;
      var near = foes.filter(function (f) { return dist(p, f) <= 8 + (f.radius || 0); }).length;
      if (W === 'flak') {
        if (loose.length && heat >= 30 && p.gcd <= 0 && dist(p, loose[0]) <= 25 + (loose[0].radius || 0)) return fire0(1, loose[0]);
        if (p.hp < p.maxHp * 0.55 && heat >= 50 && !(p.screen > 0)) return fire0(2, p);
        if (heat >= 85 && p.gcd <= 0) return fire0(1);
        if (p.gcd <= 0 && d <= 8) return fire0(0);
      } else {
        if (p.jam > 0) return inp;
        if (heat >= 85 + S.rng() * 8) return fire0(2, p);   // ride it up, vent before it jams
        if (ready('sweep') && p.gcd <= 0 && heat <= 70 && (loose.length || near >= 2 || S.rng() < 0.25)) return fire0(1);
        if (p.gcd <= 0 && heat <= 92) return fire0(0);
      }
      return inp;
    }

    if (p.role === 'dps' || p.role === 'melee') {
      if (!foes.length) return inp;
      var dr = foes.filter(function (f) { return f.type === 'drone'; }).sort(function (a, c) { return a.hp - c.hp; });
      var tg = (boss.alive && boss.oshield) ? boss : (dr[0] || boss);
      inp.target = tg.id;
      if (ready('adren') && boss.alive && canAct && boss.hp < boss.maxHp * 0.97) { inp.ability = idx('adren'); b.think = 0.2; return inp; }
      if (p.role === 'dps') {
        var dd = dist(p, tg);
        if (dd > 28) { moveTo(tg.x, tg.z); return inp; }
        if (boss.alive && boss.target !== p.id && dist(p, boss) < boss.radius + 8) { inp.mx = p.x - boss.x; inp.mz = p.z - boss.z; }
        if (canAct && attack(tg)) b.think = 0.2 + S.rng() * 0.5;
        return inp;
      }
      var dm = dist(p, tg) - (tg.radius || 0);
      if (W === 'chainsaw') {
        var spot = tg.type === 'boss' ? { x: tg.x - Math.sin(tg.facing) * (tg.radius + 1.6), z: tg.z - Math.cos(tg.facing) * (tg.radius + 1.6) } : { x: tg.x, z: tg.z };
        var off = Math.sqrt(Math.pow(spot.x - p.x, 2) + Math.pow(spot.z - p.z, 2));
        if (dm > 10 && ready('dash')) { inp.ability = idx('dash'); return inp; }
        if (off > 1.2 && (tg.type === 'boss' || dm > 3)) moveTo(spot.x, spot.z);
        if (canAct && attack(tg)) b.think = 0.2 + S.rng() * 0.4;
      } else if (W === 'enforcers') {
        // Enforcers: circle the target at about 8m so every shot gets the moving bonus.
        var ang = Math.atan2(p.x - tg.x, p.z - tg.z) + 0.6;
        var ring = { x: tg.x + Math.sin(ang) * ((tg.radius || 1) + 7), z: tg.z + Math.cos(ang) * ((tg.radius || 1) + 7) };
        clampArena(ring, 2);
        moveTo(ring.x, ring.z);
        if (tg.type === 'boss') { var fx2 = Math.sin(tg.facing), fz2 = Math.cos(tg.facing); if (((p.x - tg.x) * fx2 + (p.z - tg.z) * fz2) > 0) moveTo(tg.x - fx2 * 9, tg.z - fz2 * 9); }
        if (canAct && attack(tg)) b.think = 0.2 + S.rng() * 0.4;
      } else {
        // Ripper: hold a spot 12m behind the target so the cleave and charge lanes miss you.
        var back = tg.type === 'boss' ? { x: tg.x - Math.sin(tg.facing) * 12, z: tg.z - Math.cos(tg.facing) * 12 } : null;
        if (back) { clampArena(back, 2); if (Math.hypot(back.x - p.x, back.z - p.z) > 2) moveTo(back.x, back.z); }
        else if (dm > 16) moveTo(tg.x, tg.z);
        if (canAct && attack(tg)) b.think = 0.2 + S.rng() * 0.4;
      }
      return inp;
    }

    // healer
    var allies = players(S, true).slice().sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; });
    var low = allies[0];
    var chaser = foes.filter(function (f) { return f.target === p.id && dist(f, p) < 10; })[0];
    if (T(p, 'medevac') && low && low !== p && low.hp < low.maxHp * 0.45 && dist(p, low) > 6) inp.jump = true;
    if (low && dist(p, low) > 28) moveTo(low.x, low.z);
    else if (chaser) { inp.mx = p.x - chaser.x; inp.mz = p.z - chaser.z; }
    else if (boss.alive && dist(p, boss) < 12 && boss.target !== p.id) { inp.mx = p.x - boss.x; inp.mz = p.z - boss.z; }
    // Stay in builder range of the Foreman so quiet moments turn into damage.
    if (boss.alive && !chaser && dist(p, boss) > BLD.range - 3 && !(low && dist(p, low) > 28)) moveTo(boss.x, boss.z);
    if (W === 'link') return medicBot(S, p, inp, b, allies, low, boss, canAct, idx, ready, slow);
    if (!canAct) return inp;
    var sick = allies.filter(function (a) { return a.sludge > 0; })[0];
    var hurt = allies.filter(function (a) { return a.hp < a.maxHp * 0.65; }).length;
    var tank = allies.filter(function (a) { return a.role === 'tank'; })[0];
    var aim = function (t, i) { inp.target = t.id; inp.ability = i; if (abil[i].cast > 0) { inp.mx = 0; inp.mz = 0; } };
    if (p.procT > 0 && low.hp < low.maxHp * 0.8) aim(PRC === wab[2] && W === 'shield' && tank ? tank : low, 2);
    else if (p.gcd > 0) return inp;
    else if (sick && ready('purge')) aim(sick, idx('purge'));
    else if (hurt >= 3 && ready('keg')) inp.ability = idx('keg');
    else if (low.hp < low.maxHp * 0.55 && p.pips >= 25) aim(low, 1);
    else if (low.hp < low.maxHp * 0.85 && p.pips >= 60) aim(low, 1);
    else if (W === 'shield' && tank && tank.armor < 100 && p.pips >= 60) aim(tank, 1);
    else if (boss.alive) attack(boss);
    if (inp.ability >= 0) b.think = 0.2 + S.rng() * 0.4;
    return inp;
  }

  /* The aimed Medic bot: decides who to point at and which buttons to hold, a person-like beat at a time,
     and keeps pointing and holding between decisions. */
  function medicBot(S, p, inp, b, allies, low, boss, canAct, idx, ready, slow) {
    var m = b.med || (b.med = { aim: null, hold: [false, false] });
    if (low && low !== p && dist(p, low) > 22) { inp.mx = low.x - p.x; inp.mz = low.z - p.z; }
    if (canAct) {
      b.think = 0.25 + S.rng() * 0.35;
      var others = allies.filter(function (a) { return a !== p; });
      var lowO = others[0];
      var sick = allies.filter(function (a) { return a.sludge > 0; })[0];
      var near = allies.filter(function (a) { return dist(a, p) <= 11 && a.hp < a.maxHp * 0.8; }).length;
      var beamOn = p.beamTo ? ent(S, p.beamTo) : null;
      var hurt = allies.filter(function (a) { return a.hp < a.maxHp * 0.75; }).length;
      var nan = p.pips || 0;
      m.hold = [false, false]; m.aim = boss.alive ? boss.id : null;
      if (p.hp < p.maxHp * 0.45 && ready('cloak')) { inp.ability = idx('cloak'); }
      else if (sick && ready('purge') && dist(p, sick) <= 30) { if (sick === p) { m.aim = null; inp.aim = p.facing + Math.PI; } else m.aim = sick.id; inp.ability = idx('purge'); }
      else if ((near >= 2 || p.hp < p.maxHp * 0.7) && nan >= 35) { m.hold = [true, true]; }
      else if (p.hp < p.maxHp * 0.7 && ready('field') && nan >= 25) { m.aim = null; inp.ad = 2; inp.ability = idx('field'); }
      else if (beamOn && lowO && lowO !== beamOn && lowO.hp < lowO.maxHp * 0.5 && beamOn.hp / beamOn.maxHp > lowO.hp / lowO.maxHp + 0.25) { m.hold = [false, false]; m.aim = lowO.id; }   // let go, switch next beat
      else if (hurt >= 1 && lowO && ready('field') && nan >= 40 && dist(p, lowO) <= 25 && lowO.hp < lowO.maxHp * 0.75) { m.aim = lowO.id; inp.ad = dist(p, lowO); inp.ability = idx('field'); }
      else if (lowO && lowO.hp < lowO.maxHp * (p.beamTo ? 0.97 : 0.8) && nan > (p.beamTo ? 3 : 15) && dist(p, lowO) <= 24) { m.aim = (p.beamTo && ent(S, p.beamTo)) ? p.beamTo : lowO.id; m.hold = [false, true]; }
      else if (lowO && lowO.hp < lowO.maxHp * 0.9 && dist(p, lowO) <= 33) { m.aim = lowO.id; m.hold = [true, false]; }
      else if (boss.alive) { m.aim = boss.id; m.hold = [true, false]; }
    }
    var at = m.aim != null ? ent(S, m.aim) : null;
    if (at) { inp.aim = Math.atan2(at.x - p.x, at.z - p.z); inp.target = at.id; }
    inp.hold = m.hold.slice();
    return inp;
  }

  /* ---------- main step ---------- */

  /* inputs: { [playerId]: { mx, mz, ability, target, jump } }. A bare input object means the solo player. */
  function step(S, dt, inputs) {
    if (S.result) return;
    inputs = inputs || {};
    if ('mx' in inputs || 'ability' in inputs || 'target' in inputs || 'jump' in inputs || 'hold' in inputs || 'aim' in inputs) { var one = {}; one[S.humanId] = inputs; inputs = one; }
    if (S.countdown > 0) {
      var before = Math.ceil(S.countdown);
      S.countdown -= dt;
      var after = Math.ceil(S.countdown);
      if (after !== before) emit(S, { type: 'announce', text: after > 0 ? String(after) : 'FIGHT', tone: 'neutral', quick: true });
      // Players may move, swap and pick targets during the countdown, but nothing fires.
      players(S).forEach(function (p) {
        var hi = inputs[p.id];
        if (p.human && !p.auto && hi) {
          applyInput(S, p, { mx: hi.mx, mz: hi.mz, target: hi.target }, dt);
        }
      });
      return;
    }
    S.t += dt;
    players(S).forEach(function (p) {
      var inp = (p.human && !p.auto) ? (inputs[p.id] || {}) : avoidFallen(S, p, hands(S, p, botThink(S, p, dt), dt));
      applyInput(S, p, inp, dt);
      trackMove(S, p, dt);
      tickPlayer(S, p, dt);
    });
    var boss = ent(S, S.bossId);
    S.ents.forEach(function (e) { if (e.kind === 'enemy') tickEnemy(S, e, dt); });
    bossScript(S, boss, dt);
    tickWorld(S, dt);
    // Drop dead drones after their death event has gone out.
    S.ents = S.ents.filter(function (e) { return !(e.kind === 'enemy' && e.type === 'drone' && !e.alive); });
    players(S).forEach(function (p) {
      if (p.target != null) { var t = ent(S, p.target); if (!t || !t.alive) p.target = null; }
    });

    if (boss.alive && S.t >= TUNE.shiftEnd) {
      // Hard stop: nobody can kite the Foreman forever.
      S.result = 'wipe';
      emit(S, { type: 'log', text: 'The shift is over. Halcyon-Vance writes the squad off.' });
      emit(S, { type: 'announce', text: 'SHIFT OVER', tone: 'bad' });
    } else if (!boss.alive) {
      S.result = 'win';
      emit(S, { type: 'announce', text: 'FLOOR CLEARED', tone: 'good' });
    } else if (!players(S, true).length) {
      S.result = 'wipe';
      emit(S, { type: 'announce', text: 'SQUAD TERMINATED', tone: 'bad' });
    }
  }

  /* ---------- network snapshots ----------
     The host runs the sim and sends snapshot() about ten times a second. A client builds the
     same squad with create() and the shared roster and seed, then feeds each snapshot to
     applySnapshot(), so the renderer reads it exactly like a local fight. */
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  function snapshot(S, events) {
    var snap = { t: r2(S.t), ph: S.phase, en: S.enraged ? 1 : 0, r: S.result || 0, cd: r2(S.countdown), p: [], e: [], g: [], ev: [] };
    if (S.missile) snap.ms = [r1(S.missile.x), r1(S.missile.z), S.missile.tgt, r2(S.missile.t), S.missile.dur];
    if (S.hero) snap.hr = S.hero.role;
    if (S.domes.length) snap.dm = S.domes.map(function (d) { return [r1(d.x), r1(d.z), d.r, r1(d.t)]; });
    if (S.fields.length) snap.fl = S.fields.map(function (d) { return [r1(d.x), r1(d.z), d.r, r1(d.t)]; });
    S.ents.forEach(function (e) {
      if (e.kind === 'player') {
        var cds = {}; for (var k in e.cds) if (e.cds[k] > 0) cds[k] = r1(e.cds[k]);
        var o = { i: e.id, x: r2(e.x), z: r2(e.z), f: r2(e.facing), h: Math.round(e.hp), a: e.alive ? 1 : 0, tg: e.target, g: r2(e.gcd), c: cds };
        if (e.moving) o.mv = 1;
        if (e.auto && e.human) o.au = 1;
        if (e.defibUsed) o.du = 1;
        if (e.dash) o.ds = 1;
        if (e.lastDeath) o.ld = [e.lastDeath.label, e.lastDeath.t, e.lastDeath.log || []];
        if (e.cast) o.k = [e.cast.ab.id, r2(e.cast.t), r2(e.cast.dur), e.cast.targetId];
        ['belt', 'adren', 'pump', 'afterburn', 'armor', 'hot', 'sludge', 'spinStacks', 'momentum', 'still', 'rage', 'opp', 'counter', 'rallied', 'stimmed', 'warcry', 'spree', 'rampage', 'pips', 'procT', 'ult', 'wall', 'dome', 'rad', 'lock', 'taps', 'returns', 'screen', 'jam', 'recoil', 'barrier', 'barrierUp', 'barrierBroken', 'comboStep', 'charges', 'chargeT', 'beamTo', 'cloak', 'storm', 'siphonTo', 'chainTo', 'skates'].forEach(function (f) { if (e[f] > 0) o[f] = r1(e[f]); });
        snap.p.push(o);
      } else {
        var q = { i: e.id, ty: e.type, n: e.name, x: r2(e.x), z: r2(e.z), f: r2(e.facing), h: Math.round(e.hp), mh: e.maxHp, a: e.alive ? 1 : 0, tg: e.target, ra: e.radius };
        if (e.cast) q.k = [e.cast.name, r2(e.cast.t), r2(e.cast.dur), e.cast.target == null ? null : e.cast.target];
        if (e.energy > 0) q.eg = Math.round(e.energy);
        if (e.goCentre) q.gc = 1;
        if (e.oshield) q.os = [Math.round(e.oshield.hp), e.oshield.max, r2(e.oshield.t), e.oshield.dur];
        if (e.stagger > 0) q.st = r1(e.stagger);
        if (e.weak > 0) q.wk = 1;
        if (e.branded > 0) q.br = 1;
        if (e.slowed > 0) q.sw = 1;
        snap.e.push(q);
      }
    });
    S.telegraphs.forEach(function (g) {
      snap.g.push(g.shape === 'line'
        ? { i: g.id, s: 'l', x1: r1(g.x1), z1: r1(g.z1), x2: r1(g.x2), z2: r1(g.z2), w: g.w, t: r2(g.t), d: g.dur }
        : g.shape === 'sector'
          ? { i: g.id, s: 's', k: g.k, a0: r2(g.a0), a1: r2(g.a1), r0: g.r0, r1: g.r1, t: r2(g.t), d: g.dur, l: g.life, dn: g.down ? 1 : 0 }
          : { i: g.id, s: 'c', x: r1(g.x), z: r1(g.z), r: g.r, t: r2(g.t), d: g.dur, lp: g.leap ? 1 : 0 });
    });
    // Events ride along until the message would pass the 4 KiB room limit.
    var size = JSON.stringify(snap).length;
    events = events || [];
    for (var n = 0; n < events.length; n++) {
      var j = JSON.stringify(events[n]);
      if (size + j.length + 1 >= 3900) break;   // the rest go in the next snapshot, in order
      snap.ev.push(events[n]); size += j.length + 1;
    }
    return snap;
  }
  function applySnapshot(M, snap) {
    M.t = snap.t; M.phase = snap.ph; M.enraged = !!snap.en; M.result = snap.r || null; M.countdown = snap.cd;
    M.missile = snap.ms ? { x: snap.ms[0], z: snap.ms[1], tgt: snap.ms[2], t: snap.ms[3], dur: snap.ms[4] } : null;
    M.hero = snap.hr ? { role: snap.hr } : null;
    M.domes = (snap.dm || []).map(function (d) { return { x: d[0], z: d[1], r: d[2], t: d[3] }; });
    M.fields = (snap.fl || []).map(function (d) { return { x: d[0], z: d[1], r: d[2], t: d[3] }; });
    snap.p.forEach(function (o) {
      var p = ent(M, o.i); if (!p) return;
      p.x = o.x; p.z = o.z; p.facing = o.f; p.hp = o.h; p.alive = !!o.a; p.target = o.tg; p.gcd = o.g; p.cds = o.c || {};
      p.moving = !!o.mv; p.auto = !!o.au || !p.human; p.defibUsed = !!o.du;
      p.lastDeath = o.ld ? { label: o.ld[0], t: o.ld[1], log: o.ld[2] || [] } : null;
      ['belt', 'adren', 'pump', 'afterburn', 'armor', 'hot', 'sludge', 'spinStacks', 'momentum', 'still', 'rage', 'opp', 'counter', 'rallied', 'stimmed', 'warcry', 'spree', 'rampage', 'pips', 'procT', 'ult', 'wall', 'dome', 'rad', 'lock', 'taps', 'returns', 'screen', 'jam', 'recoil', 'barrier', 'barrierUp', 'barrierBroken', 'comboStep', 'charges', 'chargeT', 'beamTo', 'cloak', 'storm', 'siphonTo', 'chainTo', 'skates'].forEach(function (f) { p[f] = o[f] || 0; });
      if (o.k) {
        var ab = abilitiesOf(p).filter(function (a) { return a.id === o.k[0]; })[0];
        p.cast = ab ? { ab: ab, t: o.k[1], dur: o.k[2], targetId: o.k[3] } : null;
      } else p.cast = null;
    });
    var seen = {};
    snap.e.forEach(function (q) {
      seen[q.i] = 1;
      var e = ent(M, q.i);
      if (!e) { e = { id: q.i, kind: 'enemy', type: q.ty, name: q.n, threat: {} }; M.ents.push(e); }
      e.x = q.x; e.z = q.z; e.facing = q.f; e.hp = q.h; e.maxHp = q.mh; e.alive = !!q.a; e.target = q.tg; e.radius = q.ra;
      e.cast = q.k ? { name: q.k[0], t: q.k[1], dur: q.k[2], target: q.k[3] } : null;
      e.oshield = q.os ? { hp: q.os[0], max: q.os[1], t: q.os[2], dur: q.os[3] } : null;
      e.stagger = q.st || 0; e.energy = q.eg || 0; e.goCentre = !!q.gc;
      e.weak = q.wk ? 1 : 0; e.slowed = q.sw ? 1 : 0; e.branded = q.br ? 1 : 0;
    });
    M.ents = M.ents.filter(function (e) { return e.kind === 'player' || seen[e.id]; });
    M.telegraphs = snap.g.map(function (g) {
      return g.s === 'l' ? { id: g.i, shape: 'line', x1: g.x1, z1: g.z1, x2: g.x2, z2: g.z2, w: g.w, t: g.t, dur: g.d }
        : g.s === 's' ? { id: g.i, shape: 'sector', k: g.k, a0: g.a0, a1: g.a1, r0: g.r0, r1: g.r1, t: g.t, dur: g.d, life: g.l, down: !!g.dn }
        : { id: g.i, shape: 'circle', x: g.x, z: g.z, r: g.r, t: g.t, dur: g.d, leap: !!g.lp };
    });
    snap.ev.forEach(function (ev) { M.events.push(ev); });
  }
  /* Client-side prediction for your own movement, so it feels instant despite the round trip. */
  function predictMove(p, mx, mz, dt, S) {
    var len = Math.sqrt(mx * mx + mz * mz);
    if (!p.alive || len < 0.01) return;
    var sp = S ? moveSpeed(S, p) : p.speed;
    p.x += mx / len * sp * dt; p.z += mz / len * sp * dt; p.facing = Math.atan2(mx, mz);
    clampArena(p);
  }

  /* One compact record of a finished (or abandoned) fight, for the stats page and the balance reports. */
  function summary(S, meta) {
    meta = meta || {};
    var boss = ent(S, S.bossId), m = S.m || { p: {}, taken: {}, killers: {} };
    var round = function (o) { var r = {}; for (var k in o) r[k] = Math.round(o[k]); return r; };
    return {
      v: 1, version: VERSION, build: String(meta.build || 'dev'), mode: meta.mode || 'solo', result: S.result || 'abandoned',
      secs: Math.round(S.t), bossPct: boss ? Math.round(boss.hp / boss.maxHp * 100) : 0, phase: S.phase, enraged: S.enraged ? 1 : 0,
      players: players(S).map(function (p) {
        var q = m.p[p.id] || {};
        return {
          role: p.role, human: p.human ? 1 : 0, weapon: p.gear.weapon, boots: p.gear.boots, rig: p.gear.rig, implant: p.gear.implant, util: p.gear.util,
          dmg: Math.round(q.dmg || 0), heal: Math.round(q.heal || 0), taken: Math.round(q.taken || 0),
          deaths: q.deaths || 0, crit: q.hits ? Math.round(q.crits / q.hits * 100) : 0, shieldDmg: Math.round(q.shield || 0), ults: q.ults || 0, alive: p.alive ? 1 : 0,
          // How this seat moved: average seconds a direction was held, share of the fight spent moving,
          // and average seconds spent standing in a red zone each time one caught you.
          move: q.liveT > 5 ? { hold: r2(q.holdN ? q.holdSum / q.holdN : 0), moving: Math.round(q.mvT / q.liveT * 100), red: r2(q.redN ? q.redSum / q.redN : 0), reds: q.redN } : null
        };
      }),
      taken: round(m.taken), killers: m.killers, shields: m.shields || { raised: 0, broken: 0 }, heroes: m.heroes || {}
    };
  }

  /* HUD chips: one per talent showing what it is doing right now, plus any squad buffs you are under. [text, lit] */
  function talentChips(p) {
    var g = p.gear || {}, cds = p.cds || {}, out = [];
    var cd = function (k) { var c = cds[k] || 0; return c > 0 ? Math.ceil(c) + 's' : 'ready'; };
    var ready = function (k) { return !(cds[k] > 0); };
    var space = function (name, boosted) { out.push([p.momentum > 0 ? boosted : name + ' [Space] ' + cd('leap'), p.momentum > 0 || ready('leap')]); };
    var timed = function (v, on, off) { out.push([v > 0 ? on + ' ' + Math.ceil(v) + 's' : off, v > 0]); };
    var named = function (slot) { out.push([gearName(slot, g[slot], p.role), true]); };
    var still = (p.still || 0) >= 1;
    var tankCharge = function () {
      var n = p.charges || 0;
      out.push([p.momentum > 0 ? 'Charged: next hit +30%' : 'Riot Charge [Space] ' + (n > 0 ? 'x' + n : Math.ceil(TUNE.chargeCd - (p.chargeT || 0)) + 's'), n > 0 || p.momentum > 0]);
    };
    var CHIP = {
      ram: function () { tankCharge(); }, twincharge: function () { tankCharge(); }, intercept: function () { tankCharge(); },
      stim: function () { space('Stim Leap', 'Stimmed: next heal instant'); },
      dodge: function () { space('Dodge', 'Dodged: next shot +30%'); },
      medevac: function () { out.push(['Medevac [Space] ' + cd('leap'), ready('leap')]); },
      mag: function () { var n = gearName('boots', 'mag', p.role); out.push([braced(p) ? n + ' set' : p.moving ? n + ': stand still' : n + '...', braced(p)]); },
      cover: function () { out.push([still ? 'Covering squad' : 'Cover: stand still', still]); },
      clamps: function () { out.push(['Mag-Clamps: no knockback', true]); },
      afterburner: function () { timed(p.afterburn, 'Afterburn', 'Afterburner: Dash'); },
      pump: function () { out.push([p.pump > 0 ? gearName('rig', 'pump', p.role) + ' active' : gearName('rig', 'pump', p.role) + ' ' + cd('pump'), p.pump > 0 || ready('pump')]); },
      plate: function () { out.push([gearName('rig', 'plate', p.role) + ' ' + cd('plate'), ready('plate')]); },
      lifeline: function () { out.push(['Lifeline ' + cd('lifeline'), ready('lifeline')]); },
      decoy: function () { out.push(['Decoy ' + cd('decoy'), ready('decoy')]); },
      meatshield: function () { out.push(['Meat Shield ' + cd('meatshield'), ready('meatshield')]); },
      vengeance: function () { out.push(['Rage ' + Math.round(p.rage || 0), (p.rage || 0) >= 100]); },
      rampage: function () { out.push(['Rampage x' + (p.rampage || 0), (p.rampage || 0) >= 8]); },
      opportunist: function () { timed(p.opp, 'Thrill +30%', 'Thrill Seeker: dodge late'); },
      counter: function () { timed(p.counter, 'Counterstrike +40%', 'Counterstrike: get hit'); },
      spree: function () { out.push([(p.spree || 0) > 0 ? 'Spree x' + p.spree + ' +' + p.spree * 8 + '%' : 'Spree: land a highlight', (p.spree || 0) > 0]); },
      defib: function () { out.push([p.defibUsed ? 'Defibrillator spent' : 'Defibrillator charged', !p.defibUsed]); },
      livefire: function () { out.push(['Live Fire: crit 15%', true]); }
    };
    SLOTS.forEach(function (slot) { if (g[slot]) (CHIP[g[slot]] || function () { named(slot); })(); });
    if (p.rallied > 0) out.push(['Holding the line -20%', true]);
    if (p.stimmed > 0) out.push(['Stimulant +25%', true]);
    if (p.warcry > 0) out.push(['War Cry +15%', true]);
    var wid = p.kit ? p.kit.weapons[p.weapon].id : '';
    if (wid === 'flak') out.push([p.screen > 0 ? 'Flak Screen ' + Math.ceil(p.screen) + 's' : 'Screen down', p.screen > 0]);
    if (wid === 'hammer') {
      out.push([p.barrierBroken > 0 ? 'Barrier broken ' + Math.ceil(p.barrierBroken) + 's' : (p.barrierUp ? 'Barrier UP ' : 'Barrier ') + Math.round(p.barrier == null ? barrierMax(p) : p.barrier), !!p.barrierUp]);
      out.push([['Swing', 'Swing', 'SLAM next'][p.comboStep || 0], (p.comboStep || 0) === 2]);
      out.push([(p.pips || 0) >= 99 ? 'FULL SHOVE ready' : 'Shield Energy ' + Math.floor(p.pips || 0), (p.pips || 0) >= 99]);
    }
    if (wid === 'link') {
      out.push([p.beamTo ? 'Beam linked: LMB = Burst' : 'Beam free', !!p.beamTo]);
      if (p.cloak > 0) out.push(['Cloak -40% ' + Math.ceil(p.cloak) + 's', true]);
      if (p.storm > 0) out.push(['Link Storm ' + Math.ceil(p.storm) + 's', true]);
    }
    if (wid === 'minigun') out.push([p.jam > 0 ? 'JAMMED ' + Math.ceil(p.jam) + 's' : (p.pips || 0) >= 85 ? 'Perfect Vent ready' : 'Heat ' + Math.floor(p.pips || 0), !(p.jam > 0) && (p.pips || 0) >= 85]);
    if (wid === 'rockets' && p.lock > 0) out.push(['Lock-on x' + p.lock, p.lock >= 3]);
    if (wid === 'sniper') { var aim = Math.min(3, Math.floor(p.still || 0)); out.push(['Steady Aim +' + aim * 5 + '% crit', aim >= 3]); }
    if (wid === 'enforcers') out.push([p.taps === 2 ? 'Trick Shot next' : 'Taps ' + (p.taps || 0) + '/3', p.taps === 2]);
    if (wid === 'ripper' && p.returns > 0) out.push(['Returning x' + p.returns, true]);
    if (p.wall > 0) out.push(['Riot Wall ' + Math.ceil(p.wall) + 's', true]);
    if (p.dome > 0) out.push(['Field Hospital: half damage', true]);
    if (p.rad > 0) out.push(['Radiation ' + Math.ceil(p.rad) + 's', false]);
    if ((p.spinStacks || 0) > 0 && p.kit && p.kit.weapons[p.weapon].id === 'minigun') out.push(['Spin x' + p.spinStacks, true]);
    return out;
  }

  /* The version players see. Bump it with every change you ship and add a line to CHANGELOG.md:
     the middle number for new things, the last number for fixes. package.json must match (a test checks). */
  var VERSION = '0.24.0';

  var api = {
    VERSION: VERSION,
    summary: summary,
    snapshot: snapshot, applySnapshot: applySnapshot, predictMove: predictMove,
    create: create, step: step, usable: usable, GEAR: GEAR, TALENTS: TALENTS, SLOTS: SLOTS, talentList: talentList, talentChips: talentChips, STYLES: STYLES, braced: braced, hasTalent: T, BOT_GEAR: BOT_GEAR, validGear: validGear, gearName: gearName, abilitiesOf: abilitiesOf, behind: behind, inTele: inTele,
    damageEnemy: damageEnemy, damagePlayer: damagePlayer, resOf: resOf, aimWeapon: aimWeapon, barrierMax: barrierMax, inCone: inCone, barrierFor: barrierFor, softTarget: softTarget, BOLT_AIM: BOLT_AIM, fieldSpot: fieldSpot,
    ent: ent, players: players, enemies: enemies, KITS: KITS, TUNE: TUNE, PIP_MAX: PIP_MAX, PROC_WINDOW: PROC_WINDOW,
    ARENA_R: ARENA_R, GCD: GCD, dist: dist
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
