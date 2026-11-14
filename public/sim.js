/* Sector-4 combat simulation.
   Pure logic, no rendering. Runs the same in the browser and in Node, and is written as an
   authoritative step(dt, inputs) loop so it can move onto a server later without a rewrite. */
(function (root) {
  'use strict';

  var ARENA_R = 28;
  var GCD = 1.5;

  /* ---------- kits: two weapons own slots 1-2, the role's utilities own slots 3-4 ---------- */
  function A(o) { o.cast = o.cast || 0; o.cd = o.cd || 0; if (o.gcd === undefined) o.gcd = true; return o; }

  var KICK = A({ id: 'kick', name: 'Interrupt', kind: 'enemy', range: 25, cd: 15, gcd: false, desc: 'Stops an interruptible cast within 25m. Every role has one.' });

  var KITS = {
    tank: {
      role: 'tank', title: 'Juggernaut', hp: 1700,
      blurb: 'Hold the Foreman and keep drones off the Medic.',
      weapons: [
        { id: 'flak', name: 'Flak Cannon', pitch: 'Area threat. Grabs drones from range and slows what it hits.', abilities: [
          A({ id: 'flak', name: 'Flak Blast', kind: 'enemy', range: 8, desc: 'Hits every enemy within 8m. High threat.' }),
          A({ id: 'shell', name: 'Flak Shell', kind: 'enemy', range: 25, cd: 8, desc: 'Long-range shot. Very high threat. The target attacks 25% slower for 5s.' })
        ] },
        { id: 'hammer', name: 'Impact Hammer', pitch: 'Single-target threat. Weakens the Foreman\'s hits.', abilities: [
          A({ id: 'swing', name: 'Hammer Swing', kind: 'enemy', range: 5, desc: 'Melee hit. Highest single-target threat.' }),
          A({ id: 'concuss', name: 'Concussion', kind: 'enemy', range: 5, cd: 8, desc: 'Heavy hit. The target deals 25% less damage for 5s.' })
        ] },
        { id: 'minigun', name: 'Minigun', pitch: 'Threat that builds the longer you hold one target. Slows enemy casts, buying time for the interrupt.', abilities: [
          A({ id: 'spin', name: 'Minigun Burst', kind: 'enemy', range: 20, desc: 'Each burst on the same target hits 12% harder, up to 5 stacks. High threat.' }),
          A({ id: 'suppress', name: 'Suppressive Fire', kind: 'enemy', range: 20, cd: 10, desc: 'For 8s the target casts 40% slower and hits 20% softer.' })
        ] }
      ],
      utils: [
        A({ id: 'challenge', name: 'Challenge', kind: 'self', range: 30, cd: 10, gcd: false, desc: 'Every enemy within 30m attacks you for 4s.' }),
        A({ id: 'belt', name: 'Shield Belt', kind: 'self', range: 0, cd: 25, gcd: false, desc: 'Take half damage for 6s.' })
      ]
    },
    healer: {
      role: 'healer', title: 'Medic', hp: 900,
      blurb: 'Keep four health bars up. You are never on the interrupt rotation.',
      weapons: [
        { id: 'link', name: 'Link Gun', pitch: 'Big heals. You stand still to cast.', abilities: [
          A({ id: 'link', name: 'Link Beam', kind: 'friend', range: 40, cast: 1.0, desc: 'Heal. 1s cast. Target the Foreman to heal whoever he hits.' }),
          A({ id: 'surge', name: 'Nano Surge', kind: 'friend', range: 40, cast: 2.0, cd: 8, desc: 'Large heal. 2s cast.' })
        ] },
        { id: 'bio', name: 'Bio Rifle', pitch: 'Instant heals on the move. Less per heal.', abilities: [
          A({ id: 'spray', name: 'Bio Spray', kind: 'friend', range: 30, desc: 'Instant heal, plus more over 6s. Recasting refreshes it.' }),
          A({ id: 'glob', name: 'Bio Glob', kind: 'friend', range: 30, cd: 10, desc: 'Instant. Heals everyone within 7m of the target.' })
        ] },
        { id: 'shield', name: 'Shield Gun', pitch: 'Shields before the hit instead of heals after it. Strong if you see the damage coming.', abilities: [
          A({ id: 'barrier', name: 'Barrier', kind: 'friend', range: 35, desc: 'Instant. Heals 60 and adds a 180 shield, up to 400.' }),
          A({ id: 'bulwark', name: 'Bulwark', kind: 'friend', range: 35, cd: 15, desc: 'Instant. Everyone within 8m of the target gets a 250 shield.' })
        ] }
      ],
      utils: [
        A({ id: 'keg', name: 'Health Keg', kind: 'self', range: 40, cd: 20, desc: 'Heals the whole squad within 40m.' }),
        A({ id: 'purge', name: 'Purge', kind: 'friend', range: 40, cd: 6, desc: 'Removes Bio Sludge and heals a little.' })
      ]
    },
    dps: {
      role: 'dps', title: 'Striker', hp: 900,
      blurb: 'Ranged damage from a safe distance.',
      weapons: [
        { id: 'shock', name: 'Shock Rifle', pitch: 'Highest damage, but your big shot needs you standing still.', abilities: [
          A({ id: 'beam', name: 'Shock Beam', kind: 'enemy', range: 35, desc: 'Instant shot.' }),
          A({ id: 'core', name: 'Shock Core', kind: 'enemy', range: 35, cast: 1.5, desc: 'Heavy shot. 1.5s cast, stand still. 40% more within 3s of a Shock Beam on the same target.' })
        ] },
        { id: 'rockets', name: 'Rocket Launcher', pitch: 'All instant, so you never stop moving. Splash shreds drone packs.', abilities: [
          A({ id: 'rocket', name: 'Rocket', kind: 'enemy', range: 30, desc: 'Instant. Splashes enemies within 4m of the target.' }),
          A({ id: 'volley', name: 'Rocket Volley', kind: 'enemy', range: 30, cd: 10, desc: 'Instant burst of three rockets.' })
        ] },
        { id: 'sniper', name: 'Sniper Rifle', pitch: 'Long, slow shots from across the arena. Headshot a target mid-cast for huge damage.', abilities: [
          A({ id: 'snipe', name: 'Snipe', kind: 'enemy', range: 50, cast: 2.0, desc: 'Heavy shot from up to 50m. 2s cast, stand still.' }),
          A({ id: 'headshot', name: 'Headshot', kind: 'enemy', range: 50, cd: 12, desc: 'Instant. Two and a half times the damage on a target that is casting or below 35% health.' })
        ] }
      ],
      utils: [
        A({ id: 'adren', name: 'Adrenaline', kind: 'self', range: 0, cd: 45, gcd: false, desc: '40% more damage for 8s.' }),
        A({ id: 'trans', name: 'Translocator', kind: 'self', range: 0, cd: 10, gcd: false, desc: 'Jump 12m the way you are moving, or away from your target.' })
      ]
    },
    melee: {
      role: 'melee', title: 'Wrecker', hp: 1100,
      blurb: 'Melee damage. Stay out of the Foreman\'s front.',
      weapons: [
        { id: 'chainsaw', name: 'Chainsaw', pitch: 'Big hits, 50% more from behind. You live next to the Foreman.', abilities: [
          A({ id: 'rip', name: 'Rip', kind: 'enemy', range: 4, desc: 'Melee hit. 50% more from behind.' }),
          A({ id: 'saw', name: 'Saw Through', kind: 'enemy', range: 4, cd: 8, desc: 'Heavy melee hit. 50% more from behind.' })
        ] },
        { id: 'ripper', name: 'Ripper', pitch: 'Mid-range blades that bounce between targets. Safer, less damage.', abilities: [
          A({ id: 'razor', name: 'Razor', kind: 'enemy', range: 18, desc: 'Thrown blade at 18m.' }),
          A({ id: 'bounce', name: 'Ricochet', kind: 'enemy', range: 18, cd: 8, desc: 'Blade that also hits two more enemies nearby.' })
        ] },
        { id: 'enforcers', name: 'Dual Enforcers', pitch: 'Mid-range pistols that hit 35% harder while you keep moving. No positioning tax.', abilities: [
          A({ id: 'tap', name: 'Double Tap', kind: 'enemy', range: 10, desc: 'Two quick shots. 35% more damage while moving.' }),
          A({ id: 'fan', name: 'Fan the Hammer', kind: 'enemy', range: 10, cd: 7, desc: 'Four shots at once. 35% more damage while moving.' })
        ] }
      ],
      utils: [
        A({ id: 'dash', name: 'Dash', kind: 'enemy', range: 20, cd: 10, gcd: false, desc: 'Rush to your target, behind it if it is the Foreman.' }),
        A({ id: 'adren', name: 'Adrenaline', kind: 'self', range: 0, cd: 45, gcd: false, desc: '40% more damage for 8s.' })
      ]
    }
  };
  var BACKSTAB = { rip: 1, saw: 1 };

  /* ---------- talents ----------
     Each class has its own tree: four tiers, three picks a tier, always in the same order:
       aggressive - takes risks for bursts of power
       steady     - holds ground and stays consistent
       squad      - makes the people around you stronger
     Ids are unique within a class. A few mechanics appear in more than one class under that class's name. */
  var STYLES = { aggressive: 'Aggressive', steady: 'Steady', squad: 'Squad' };
  var SLOTS = ['boots', 'rig', 'implant', 'util'];
  function t(id, style, name, play, desc) { return { id: id, style: style, name: name, play: play, desc: desc }; }
  var TALENTS = {
    tank: {
      theme: 'Riot enforcer. Hold the line, punish anything that hits you, protect whoever is behind you.',
      tiers: ['Stance', 'Armor', 'Enforcement', 'Command'],
      boots: [
        t('charge', 'aggressive', 'Riot Charge', 'Crash into the fight.', 'Space charges up to 25m into your enemy target (10s). Your next weapon hit within 3s does 30% more damage and threat.'),
        t('mag', 'steady', 'Mag-Lock Soles', 'Plant your feet.', 'Stand still for 2s to Brace: casts 25% faster, 15% less damage taken, and charges can\'t knock you back. Moving breaks it.'),
        t('escort', 'squad', 'Phalanx', 'Move as one.', 'You and every squad member within 8m of you move 20% faster.')
      ],
      rig: [
        t('vengeance', 'aggressive', 'Vengeance', 'Take hits, hit back.', '20% of the damage you take is stored as Rage, up to 500. Your next weapon hit unleashes all of it as extra damage and threat.'),
        t('plate', 'steady', 'Ablative Plating', 'Shrug off the big hit.', 'Ignore the first hit of 100 or more every 20s.'),
        t('bodyguard', 'squad', 'Bodyguard', 'Keep them close.', 'Squad members within 6m of you take 20% less damage. You take that 20% instead.')
      ],
      implant: [
        t('bash', 'aggressive', 'Shield Bash', 'Turn defence into a weapon.', 'Shield Belt also slams every enemy within 8m for 200 damage and heavy threat.'),
        t('recharge', 'steady', 'Rapid Recharge', 'Belt up on rhythm.', 'Shield Belt is ready every 15s instead of 25s, but lasts 4s instead of 6s.'),
        t('guardian', 'squad', 'Guardian Link', 'Cover the weakest.', 'Challenge also puts a 300 shield on the most hurt squad member.')
      ],
      util: [
        t('counter', 'aggressive', 'Counterstrike', 'Punish the cast.', 'When you interrupt, you deal 40% more damage for 6s and Challenge is ready again.'),
        t('comms', 'steady', 'Field Comms', 'Own the interrupt.', 'Interrupt is ready every 10s instead of 15s and reaches 35m.'),
        t('rally', 'squad', 'Hold the Line', 'Call the squad in.', 'Challenge also gives every squad member within 15m 20% less damage taken for 4s.')
      ]
    },
    healer: {
      theme: 'Field surgeon. Nanites, triage and stubbornness: nobody dies while you are standing.',
      tiers: ['Footwork', 'Vitals', 'Medicine', 'Protocols'],
      boots: [
        t('stim', 'aggressive', 'Stim Leap', 'Leap in, heal instantly.', 'Space leaps 9m the way you are moving (8s). Your next heal within 3s of landing casts instantly and heals 30% more.'),
        t('mag', 'steady', 'Surgical Stance', 'Plant and operate.', 'Stand still for 2s to Brace: casts 25% faster, 15% less damage taken, and charges can\'t knock you back. Moving breaks it.'),
        t('medevac', 'squad', 'Medevac', 'Go to them.', 'Space leaps to the most hurt squad member within 25m and gives them a 150 shield (12s).')
      ],
      rig: [
        t('pump', 'aggressive', 'Adrenaline Shot', 'Work best on the edge.', 'Drop below 30% health and for 6s you deal and heal 40% more and take 25% less. Once a minute.'),
        t('selfrepair', 'steady', 'Self-Repair Nanites', 'Keep yourself in the fight.', 'Every heal you cast on someone else also heals you for 15% of it.'),
        t('lifeline', 'squad', 'Lifeline', 'Nobody dies on your watch.', 'When a squad member drops below 20% health they are instantly healed for 35% of it. Recharges after 90s.')
      ],
      implant: [
        t('triage', 'aggressive', 'Triage Matrix', 'Let them drop, then save them.', 'Your healing is 25% stronger on anyone below 40% health.'),
        t('overflow', 'steady', 'Overflow', 'Top everyone up early.', 'Healing past full health turns into a shield, up to 300.'),
        t('chain', 'squad', 'Chain Heal', 'Heal where they bunch up.', 'Every heal you cast also gives 30% of it to the most hurt ally within 8m of the target.')
      ],
      util: [
        t('adpurge', 'aggressive', 'Combat Stimulant', 'Juice the damage dealers.', 'Purge is ready every 3s and gives its target 25% more damage for 5s.'),
        t('supply', 'steady', 'Supply Drop', 'Little and often.', 'Health Keg is ready every 12s instead of 20s, but heals 25% less.'),
        t('defib', 'squad', 'Defibrillator', 'Clear!', 'Once per raid, the first squad member to go down is shocked back up 3s later with 30% health.')
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
        t('marksman', 'steady', 'Marksman', 'Hang back, stay safe.', '25% more damage to anything 25m or more away.'),
        t('spotter', 'squad', 'Spotter', 'Mark targets for the squad.', 'Your hits mark the target for 5s. The whole squad deals 10% more damage to it.')
      ],
      util: [
        t('spree', 'aggressive', 'Killing Spree', 'Chain the highlights.', 'Each Combo, Headshot or kill adds a Spree stack: 8% more damage each, up to 5, for 15s.'),
        t('comms', 'steady', 'Shotcaller', 'Call the cast and cut it from range.', 'Interrupt is ready every 10s instead of 15s and reaches 35m.'),
        t('uplink', 'squad', 'Team Uplink', 'Stay close, cycle faster.', 'You and every squad member within 10m recover cooldowns 12% faster.')
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
        t('flanker', 'steady', 'Flanker', 'Hold the back line.', 'Every hit from behind takes 1.5s off your weapon\'s heavy ability.'),
        t('hamstring', 'squad', 'Hamstring', 'Blunt his hits for the tank.', 'Your hits from behind make the target deal 15% less damage for 4s.')
      ],
      util: [
        t('opportunist', 'aggressive', 'Thrill Seeker', 'Dodge late, strike hard.', 'Leave a red zone in its last second and you deal and heal 30% more for 6s.'),
        t('shoulder', 'steady', 'Shoulder Check', 'Interrupt with your body.', 'Interrupt reaches only 8m, but is ready every 7s and hits for 300.'),
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
    tank: { weapon: 'hammer', boots: 'mag', rig: 'plate', implant: 'recharge', util: 'comms' },
    healer: { weapon: 'link', boots: 'mag', rig: 'lifeline', implant: 'triage', util: 'supply' },
    dps: { weapon: 'rockets', boots: 'dodge', rig: 'pump', implant: 'spotter', util: 'comms' },
    melee: { weapon: 'chainsaw', boots: 'escort', rig: 'pump', implant: 'flanker', util: 'shoulder' }
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
    bossHp: 75000, bossMelee: 280, bossSwing: 2.0, cleaveMult: 0.7,
    barrageEvery: 12, barrageDelay: 2.6, barrageR: 6, barrageDmg: 560,
    overEvery: 24, overCast: 3.0, overDmg: 520,
    chargeEvery: 19, chargeDelay: 1.8, chargeW: 4.5, chargeDmg: 380,
    droneEvery: 32, droneHp: 650, droneMelee: 70, droneSwing: 1.5,
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
  function abilitiesOf(p) { return p.kit.weapons[p.weapon].abilities.concat(p.kit.utils, [KICK]); }
  function braced(p) { return T(p, 'mag') && p.alive && (p.still || 0) >= 2; }
  /* Does this player have talent id, in whichever tier their class keeps it? */
  function T(p, id) { var g = p.gear; return !!g && (g.boots === id || g.rig === id || g.implant === id || g.util === id); }
  function nearby(S, p, id, range) {
    return players(S, true).some(function (q) { return T(q, id) && dist(q, p) <= range; });
  }
  function isWeaponAbility(p, ab) { return p.kit.weapons[p.weapon].abilities.indexOf(ab) >= 0; }
  function reach(p, ab) {
    if (ab.id !== 'kick') return ab.range;
    return T(p, 'shoulder') ? 8 : T(p, 'comms') ? 35 : ab.range;
  }
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
    return dist(p, g) <= g.r + pad;
  }
  function escapeDir(g, p) {
    var dx, dz;
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
      ents: [], telegraphs: [], events: [], revives: [], nextId: 1, kickIdx: 0,
      rng: makeRng(opts.seed || 12345),
      timers: { barrage: 8, over: 16, drone: 4, sludge: 7, charge: 13 },
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
        bot: { danger: 0, react: 0.35 + S.rng() * 0.3, think: S.rng() * 0.5, intDelay: 0.9 + S.rng() * 0.6, slow: 1 }
      };
      p.weapon = Math.max(0, kit.weapons.map(function (w) { return w.id; }).indexOf(p.gear.weapon));
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
    S.m = S.m || { p: {}, taken: {}, killers: {} };
    return S.m.p[id] || (S.m.p[id] = { dmg: 0, heal: 0, taken: 0, deaths: 0, duty: 0, miss: 0, kicks: 0, mvT: 0, liveT: 0, holdSum: 0, holdN: 0, redSum: 0, redN: 0 });
  }
  function damageEnemy(S, src, tgt, amt, threatMult, label) {
    if (!tgt.alive) return;
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
      if (T(src, 'marksman') && range >= 25) amt *= 1.25;
      if (T(src, 'pointblank') && range <= 10) amt *= 1.3;
      if (T(src, 'spotter')) tgt.spotted = 5;
      if (T(src, 'hamstring') && behind(src, tgt)) tgt.hamstrung = 4;
    }
    if (tgt.spotted > 0) amt *= 1.1;
    amt = Math.round(amt);
    if (src.kind === 'player') met(S, src.id).dmg += Math.min(amt, tgt.hp);
    tgt.hp -= amt;
    addThreat(S, tgt, src.id, amt * (threatMult || 1));
    emit(S, { type: 'dmg', src: src.id, dst: tgt.id, amt: amt, label: label });
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
      if (p.armorSrc) { var shieldBy = ent(S, p.armorSrc); if (shieldBy) met(S, shieldBy.id).heal += soak; }
    }
    met(S, p.id).taken += amt; S.m.taken[label] = (S.m.taken[label] || 0) + amt;
    if (T(p, 'vengeance')) p.rage = Math.min(500, (p.rage || 0) + amt * 0.2);
    p.hp -= amt;
    emit(S, { type: 'dmg', src: srcId, dst: p.id, amt: amt, label: label });
    if (p.hp > 0 && T(p, 'pump') && p.hp < p.maxHp * 0.3 && (p.cds.pump || 0) <= 0) {
      p.pump = 6; p.cds.pump = 60;
      emit(S, { type: 'fx', fx: 'pump', src: p.id });
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
  function heal(S, src, p, amt, label) {
    if (!p.alive) return;
    if (src.kind === 'player') {
      if (src.pump > 0) amt *= 1.4;
      amt *= (src.boostNow || 1) * (src.opp > 0 ? 1.3 : 1);
      if (T(src, 'triage') && p.hp < p.maxHp * 0.4) amt *= 1.25;
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
    emit(S, { type: 'heal', src: src.id, dst: p.id, amt: Math.round(eff), label: label });
    enemies(S).forEach(function (e) { addThreat(S, e, src.id, eff * 0.5); });
  }

  /* ---------- abilities ---------- */

  function castingEnemy(S, p, range) {
    return enemies(S).filter(function (e) { return e.cast && e.cast.interruptible && dist(p, e) <= range + (e.radius || 0); })[0] || null;
  }
  function shieldUp(q, src, amt, cap) { q.armor = Math.min(cap, Math.max(q.armor, 0) + amt); q.armorSrc = src.id; }
  function resolveTarget(S, p, ab) {
    if (ab.id === 'kick') return castingEnemy(S, p, 999);
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
    if (!tgt) return { state: ab.id === 'kick' ? 'idle' : 'notarget', tgt: null };
    var out = { tgt: tgt, behind: BACKSTAB[ab.id] && tgt.kind === 'enemy' && (behind(p, tgt) || p.afterburn > 0) };
    if (ab.kind !== 'self' && dist(p, tgt) > reach(p, ab) + (tgt.radius || 0)) out.state = 'range';
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
    if (ab.gcd && p.gcd > 0) return false;
    var tgt = resolveTarget(S, p, ab);
    if (!tgt) return fail(S, p, ab.id === 'kick' ? 'Nothing to interrupt' : 'No target');
    if (ab.kind !== 'self') {
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
    if (T(p, 'recharge') && ab.id === 'belt') p.cds.belt = 15;
    if (T(p, 'comms') && ab.id === 'kick') p.cds.kick = 10;
    if (T(p, 'shoulder') && ab.id === 'kick') p.cds.kick = 7;
    if (T(p, 'adpurge') && ab.id === 'purge') p.cds.purge = 3;
    if (T(p, 'supply') && ab.id === 'keg') p.cds.keg = 12;
    if (tgt && tgt !== p && !p.moving) p.facing = Math.atan2(tgt.x - p.x, tgt.z - p.z);
    var back = BACKSTAB[ab.id] && tgt.kind === 'enemy' && (behind(p, tgt) || p.afterburn > 0) ? 1.5 : 1;
    // Jump Boots: the first ability that targets something after a leap gets the Momentum bonus.
    p.boostNow = p.momentum > 0 && ab.kind !== 'self' && ab.id !== 'kick' && (!T(p, 'stim') || ab.kind === 'friend') ? 1.3 : 1;
    if (p.boostNow > 1) { p.momentum = 0; emit(S, { type: 'fx', fx: 'adren', src: p.id }); }
    var triage = 1;
    fireAbility(S, p, ab, tgt, G, back, triage);
    if (tgt && tgt.kind === 'enemy' && tgt.alive !== undefined && isWeaponAbility(p, ab)) {
      if (T(p, 'vengeance') && p.rage >= 1 && tgt.alive) {
        var rage = Math.round(p.rage); p.rage = 0;
        emit(S, { type: 'fx', fx: 'challenge', src: p.id });
        damageEnemy(S, p, tgt, rage, 4, 'Vengeance');
      }
      if (T(p, 'flanker') && behind(p, tgt)) {
        var heavy = p.kit.weapons[p.weapon].abilities[1];
        if (heavy && heavy !== ab && p.cds[heavy.id] > 0) p.cds[heavy.id] = Math.max(0, p.cds[heavy.id] - 1.5);
      }
    }
    p.boostNow = 1;
  }

  function fireAbility(S, p, ab, tgt, G, back, triage) {
    switch (ab.id) {
      case 'flak':
        emit(S, { type: 'fx', fx: 'flak', src: p.id });
        enemies(S).forEach(function (e) { if (dist(p, e) <= ab.range + (e.radius || 0)) damageEnemy(S, p, e, 85, 7, 'Flak'); });
        break;
      case 'shell':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shell' });
        tgt.slowed = 5;
        damageEnemy(S, p, tgt, 90, 9, 'Shell');
        break;
      case 'swing':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'hammer' });
        damageEnemy(S, p, tgt, 90, 7, 'Swing');
        break;
      case 'concuss':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'blast' });
        tgt.weak = 5;
        damageEnemy(S, p, tgt, 120, 7, 'Concussion');
        break;
      case 'kick':
        met(S, p.id).kicks++;
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'kick' });
        var assigned = tgt.cast.assigned;
        var cover = assigned && assigned !== p.id ? ', covering for ' + (ent(S, assigned) || {}).name : '';
        emit(S, { type: 'announce', src: p.id, text: p.name + ' INTERRUPTS', you: 'NICE INTERRUPT', tone: 'good' });
        emit(S, { type: 'log', id: p.id, text: p.name + ' interrupts ' + tgt.cast.name + cover + '.', you: 'You interrupt ' + tgt.cast.name + cover + '.' });
        emit(S, { type: 'kicked', src: p.id });
        tgt.cast = null;
        if (T(p, 'counter')) { p.counter = 6; p.cds.challenge = 0; proc(S, p, 'counter', 'COUNTERSTRIKE'); }
        if (T(p, 'shoulder')) damageEnemy(S, p, tgt, 300, 3, 'Shoulder Check');
        break;
      case 'challenge':
        emit(S, { type: 'fx', fx: 'challenge', src: p.id });
        enemies(S).forEach(function (e) {
          if (dist(p, e) > ab.range + (e.radius || 0)) return;
          var top = 0; for (var k in e.threat) top = Math.max(top, e.threat[k]);
          e.threat[p.id] = top * 1.2 + 200;
          e.fixate = { id: p.id, t: 4 };
        });
        if (T(p, 'guardian')) {
          var ward = players(S, true).filter(function (q) { return q !== p; }).sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; })[0];
          if (ward) { shieldUp(ward, p, 300, 400); emit(S, { type: 'fx', fx: 'guard', src: ward.id }); }
        }
        if (T(p, 'rally')) {
          players(S, true).forEach(function (q) { if (dist(q, p) <= 15) q.rallied = 4; });
          proc(S, p, 'rally', 'HOLD THE LINE', 'all');
        }
        break;
      case 'belt':
        p.belt = T(p, 'recharge') ? 4 : 6; emit(S, { type: 'fx', fx: 'belt', src: p.id });
        if (T(p, 'bash')) {
          emit(S, { type: 'fx', fx: 'flak', src: p.id }); proc(S, p, 'bash', 'SHIELD BASH');
          enemies(S).forEach(function (e) { if (dist(p, e) <= 8 + (e.radius || 0)) damageEnemy(S, p, e, 200, 8, 'Shield Bash'); });
        }
        break;
      case 'adren': p.adren = 8; emit(S, { type: 'fx', fx: 'adren', src: p.id }); break;
      case 'beam':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shock' });
        damageEnemy(S, p, tgt, 75, 1, 'Beam');
        tgt.mark = { src: p.id, t: S.t };
        break;
      case 'core':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'core' });
        // Shock combo: a Core shortly after a Beam on the same target hits harder.
        var combo = tgt.mark && tgt.mark.src === p.id && S.t - tgt.mark.t <= 3;
        if (combo) { tgt.mark = null; emit(S, { type: 'fx', fx: 'combo', src: tgt.id }); }
        damageEnemy(S, p, tgt, 170 * (combo ? 1.4 : 1), 1, combo ? 'Combo!' : 'Core'); break;
      case 'rocket':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'rocket' });
        damageEnemy(S, p, tgt, 95, 1, 'Rocket');
        enemies(S).forEach(function (e) { if (e !== tgt && dist(e, tgt) <= 4 + (e.radius || 0)) damageEnemy(S, p, e, 60, 1, 'Splash'); });
        break;
      case 'volley':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'volley' });
        damageEnemy(S, p, tgt, 300, 1, 'Volley');
        enemies(S).forEach(function (e) { if (e !== tgt && dist(e, tgt) <= 4 + (e.radius || 0)) damageEnemy(S, p, e, 120, 1, 'Splash'); });
        break;
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
      case 'rip':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'saw' });
        damageEnemy(S, p, tgt, 85 * back, 1, back > 1 ? 'Rip!' : 'Rip');
        break;
      case 'saw':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'sawbig' });
        damageEnemy(S, p, tgt, 230 * back, 1, back > 1 ? 'Saw!' : 'Saw'); break;
      case 'razor':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'razor' });
        damageEnemy(S, p, tgt, 100, 1, 'Razor'); break;
      case 'bounce':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'razor' });
        damageEnemy(S, p, tgt, 240, 1, 'Ricochet');
        var near = enemies(S).filter(function (e) { return e !== tgt && dist(e, tgt) <= 10; }).slice(0, 2);
        near.forEach(function (e) { emit(S, { type: 'beam', src: tgt.id, dst: e.id, fx: 'razor' }); damageEnemy(S, p, e, 160, 1, 'Ricochet'); });
        break;
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
      case 'link':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'link' });
        heal(S, p, tgt, 185, 'Link'); break;
      case 'surge':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'surge' });
        heal(S, p, tgt, 470, 'Surge'); break;
      case 'spray':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'bio' });
        tgt.hot = 6; tgt.hotSrc = p.id; heal(S, p, tgt, 110, 'Spray');
        break;
      case 'glob':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'bio' });
        emit(S, { type: 'fx', fx: 'glob', src: tgt.id });
        players(S, true).forEach(function (q) { if (dist(q, tgt) <= 7) heal(S, p, q, 170, 'Glob'); });
        break;
      case 'spin':
        if (p.spinTgt === tgt.id) p.spinStacks = Math.min(5, (p.spinStacks || 0) + 1); else { p.spinTgt = tgt.id; p.spinStacks = 0; }
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'spin' });
        damageEnemy(S, p, tgt, 55 * (1 + 0.12 * p.spinStacks), 7, 'Minigun'); break;
      case 'suppress':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'suppress' });
        tgt.suppressed = 8;
        damageEnemy(S, p, tgt, 80, 7, 'Suppress'); break;
      case 'barrier':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shield' });
        heal(S, p, tgt, 60, 'Barrier'); shieldUp(tgt, p, 180, 400); break;
      case 'bulwark':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shield' });
        emit(S, { type: 'fx', fx: 'guard', src: tgt.id });
        players(S, true).forEach(function (q) { if (dist(q, tgt) <= 8) shieldUp(q, p, 250, 400); }); break;
      case 'snipe':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'snipe' });
        damageEnemy(S, p, tgt, 270, 1, 'Snipe'); break;
      case 'headshot':
        var casting = !!tgt.cast || tgt.hp < tgt.maxHp * 0.35;
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'snipe' });
        damageEnemy(S, p, tgt, casting ? 650 : 260, 1, casting ? 'Headshot!' : 'Headshot'); break;
      case 'tap':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'tap' });
        damageEnemy(S, p, tgt, 80 * (p.moving ? 1.35 : 1), 1, p.moving ? 'Tap!' : 'Tap'); break;
      case 'fan':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'tap' });
        damageEnemy(S, p, tgt, 180 * (p.moving ? 1.35 : 1), 1, p.moving ? 'Fan!' : 'Fan'); break;
      case 'keg':
        emit(S, { type: 'fx', fx: 'keg', src: p.id });
        players(S, true).forEach(function (q) { if (dist(p, q) <= ab.range) heal(S, p, q, T(p, 'supply') ? 143 : 190, 'Keg'); });
        break;
      case 'purge':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'purge' });
        if (tgt.sludge > 0) { tgt.sludge = 0; emit(S, { type: 'log', text: p.name + ' purges ' + tgt.name + '.' }); }
        heal(S, p, tgt, 60, 'Purge');
        if (T(p, 'adpurge')) tgt.stimmed = 5;
        break;
    }
  }

  /* ---------- player update ---------- */

  function applyInput(S, p, inp, dt) {
    if (!p.alive) return;
    if (inp.target !== undefined) p.target = inp.target;
    var mx = inp.mx || 0, mz = inp.mz || 0, len = Math.sqrt(mx * mx + mz * mz);
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
    if (inp.jump && (p.cds.leap || 0) <= 0) spaceTalent(S, p);
    if (inp.ability != null && inp.ability >= 0) p.queued = { idx: inp.ability, t: 0.45 };
    if (p.queued) {
      if (tryUse(S, p, p.queued.idx)) p.queued = null;
      else { p.queued.t -= dt; if (p.queued.t <= 0) p.queued = null; }
    }
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
    return { mx: h.mx, mz: h.mz, ability: raw.ability, target: raw.target, jump: raw.jump };
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
  function spaceTalent(S, p) {
    var ox = p.x, oz = p.z, dir = function () { return p.moving ? [p.inMx, p.inMz] : [Math.sin(p.facing), Math.cos(p.facing)]; };
    var land = function (x, z, cd, momentum, fx) {
      p.x = x; p.z = z; clampArena(p); p.cds.leap = cd; p.momentum = momentum; p.still = 0;
      if (p.cast) p.cast = null;
      emit(S, { type: 'blink', id: p.id, fromX: ox, fromZ: oz, fx: fx });
    };
    if (T(p, 'dodge')) { var d1 = dir(); land(p.x + d1[0] * 7, p.z + d1[1] * 7, 4, 2, 'leap'); return; }
    if (T(p, 'stim')) { var d2 = dir(); land(p.x + d2[0] * 9, p.z + d2[1] * 9, 8, 3, 'leap'); return; }
    if (T(p, 'charge')) {
      var foe = p.target != null ? ent(S, p.target) : null;
      if (!foe || foe.kind !== 'enemy' || !foe.alive) foe = ent(S, S.bossId);
      if (!foe || !foe.alive) return;
      var dx = foe.x - p.x, dz = foe.z - p.z, l = Math.sqrt(dx * dx + dz * dz), stop = (foe.radius || 1) + 1.5;
      if (l > 25 + (foe.radius || 0) || l <= stop) return;
      land(foe.x - dx / l * stop, foe.z - dz / l * stop, 10, 3, 'dash');
      p.facing = Math.atan2(dx, dz);
      return;
    }
    if (T(p, 'medevac')) {
      var hurt = players(S, true).filter(function (q) { return q !== p && q.hp < q.maxHp && dist(q, p) <= 25; })
        .sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; })[0];
      if (!hurt) return;
      var hx = p.x - hurt.x, hz = p.z - hurt.z, hl = Math.sqrt(hx * hx + hz * hz) || 1;
      land(hurt.x + hx / hl * 1.5, hurt.z + hz / hl * 1.5, 12, 0, 'leap');
      shieldUp(hurt, p, 150, 400); emit(S, { type: 'fx', fx: 'guard', src: hurt.id });
    }
  }
  function moveSpeed(S, p) { return p.speed * (nearby(S, p, 'escort', 8) ? 1.2 : 1); }
  function tickPlayer(S, p, dt) {
    if (!p.alive) return;
    if (p.gcd > 0) p.gcd = Math.max(0, p.gcd - dt);
    var cdRate = nearby(S, p, 'uplink', 10) ? 1.12 : 1;
    for (var k in p.cds) if (p.cds[k] > 0) p.cds[k] = Math.max(0, p.cds[k] - dt * cdRate);
    if (p.spreeT > 0) { p.spreeT -= dt; if (p.spreeT <= 0) p.spree = 0; }
    ['belt', 'adren', 'amp', 'pump', 'afterburn', 'momentum', 'opp', 'counter', 'rallied', 'stimmed', 'warcry'].forEach(function (f) { if (p[f] > 0) p[f] = Math.max(0, p[f] - dt); });
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
    if (e.charging) {
      var c = e.charging; c.t += dt;
      var k = Math.min(1, c.t / c.dur);
      e.x = c.x1 + (c.x2 - c.x1) * k; e.z = c.z1 + (c.z2 - c.z1) * k;
      if (k >= 1) { e.charging = null; e.swing = 1.2; }
      return;
    }
    if (e.fixate) { e.fixate.t -= dt; if (e.fixate.t <= 0) e.fixate = null; }
    if (e.weak > 0) e.weak -= dt;
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
      T.barrage = TUNE.barrageEvery;
      var pool = alive.filter(function (p) { return p.id !== boss.target; });
      if (!pool.length) pool = alive.slice();
      var n = S.phase === 2 ? 2 : 1;
      for (var i = 0; i < n && pool.length; i++) {
        var p = pool.splice(Math.floor(S.rng() * pool.length), 1)[0];
        S.telegraphs.push({ id: S.nextId++, shape: 'circle', x: p.x, z: p.z, r: TUNE.barrageR, t: 0, dur: TUNE.barrageDelay, dmg: TUNE.barrageDmg });
      }
      emit(S, { type: 'log', text: 'Rocket barrage incoming. Move out of the red.' });
      emit(S, { type: 'fx', fx: 'barrage', src: boss.id });
    }

    if (!boss.cast && !boss.charging) {
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
          boss.cast = { name: 'Bulldozer', t: 0, dur: TUNE.chargeDelay, interruptible: false, done: function () {} };
          emit(S, { type: 'log', text: 'The Foreman lines up a charge at ' + far.name + '.' });
          emit(S, { type: 'fx', fx: 'barrage', src: boss.id });
        }
      }
    }

    if (!boss.cast && !boss.charging) {
      T.over -= dt;
      if (T.over <= 0) {
        T.over = TUNE.overEvery;
        var order = ['tank', 'dps', 'melee'].map(function (r) { return alive.filter(function (q) { return q.role === r; })[0]; }).filter(Boolean);
        var on = order.length ? order[S.kickIdx++ % order.length] : null;
        if (on) met(S, on.id).duty++;
        boss.cast = {
          name: 'Overcharge', t: 0, dur: TUNE.overCast, interruptible: true, assigned: on ? on.id : null,
          done: function () {
            var who = on && ent(S, on.id);
            if (who) { met(S, who.id).miss++; emit(S, { type: 'log', id: who.id, text: who.name + ' missed the interrupt.', you: 'You missed the interrupt.' }); }
            emit(S, { type: 'announce', text: 'OVERCHARGE', tone: 'bad' });
            emit(S, { type: 'fx', fx: 'overcharge', src: boss.id });
            players(S, true).forEach(function (p) { damagePlayer(S, boss.id, p, TUNE.overDmg, 'Overcharge'); });
          }
        };
        emit(S, { type: 'log', id: on ? on.id : null, text: 'Overcharge. ' + (on ? on.name + ' is on the interrupt.' : 'Interrupt it.'), you: "Overcharge. You're on the interrupt." });
        if (on) emit(S, { type: 'assign', id: on.id });
      }
    }

    if (S.phase === 2) {
      T.drone -= dt;
      if (T.drone <= 0) {
        T.drone = TUNE.droneEvery;
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

  function tickWorld(S, dt) {
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
      } else {
        emit(S, { type: 'boom', x: g.x, z: g.z, r: g.r });
        players(S, true).forEach(function (p) { if (inTele(g, p)) damagePlayer(S, S.bossId, p, g.dmg, 'Rocket'); });
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

    // Step out of telegraphs after a short reaction delay.
    var inside = null;
    S.telegraphs.forEach(function (g) { if (inTele(g, p, 1.2)) inside = g; });
    if (inside) {
      b.danger += dt;
      if (b.danger > b.react * slow) { var e = escapeDir(inside, p); inp.mx = e.x; inp.mz = e.z; if (T(p, 'dodge') || T(p, 'stim')) inp.jump = true; return inp; }
    } else b.danger = 0;

    b.think -= dt / slow;
    var canAct = !p.cast && b.think <= 0;

    // Interrupt duty: take your assigned Overcharge, or cover when the assigned player is down.
    if (boss.alive && boss.cast && boss.cast.interruptible && ready('kick')) {
      var asg = ent(S, boss.cast.assigned);
      var mine = boss.cast.assigned === p.id || ((!asg || !asg.alive) && p.role !== 'healer');
      if (mine && boss.cast.t >= b.intDelay * slow) {
        if (dist(p, boss) > reach(p, KICK) - 1 + boss.radius) { moveTo(boss.x, boss.z); return inp; }
        inp.target = boss.id; inp.ability = idx('kick'); return inp;
      }
    }

    if (p.role === 'tank') {
      if (!foes.length) return inp;
      var main = boss.alive ? boss : foes[0];
      inp.target = main.id;
      var d = dist(p, main) - (main.radius || 0);
      if (d > 3.5) moveTo(main.x, main.z);
      if (d > 10 && T(p, 'charge') && !S.telegraphs.length) inp.jump = true;   // never charge back into a telegraph
      if (p.hp < p.maxHp * 0.45 && ready('belt')) { inp.ability = idx('belt'); return inp; }
      var loose = foes.filter(function (f) { return f.target !== p.id && !(f.fixate && f.fixate.id === p.id); });
      if (loose.length && ready('challenge') && canAct) { inp.ability = idx('challenge'); b.think = 0.3; return inp; }
      if (canAct && p.gcd <= 0) {
        if (W === 'flak') {
          var looseFar = loose.filter(function (f) { return f.type === 'drone' && dist(p, f) > 9; })[0];
          if (looseFar && ready('shell')) { inp.target = looseFar.id; inp.ability = idx('shell'); }
          else if (ready('shell') && boss.alive && !(boss.slowed > 0)) { inp.target = boss.id; inp.ability = idx('shell'); }
          else if (d <= 8) inp.ability = idx('flak');
        } else if (W === 'minigun') {
          if (boss.alive && ready('suppress') && (boss.cast || !(boss.suppressed > 0))) { inp.target = boss.id; inp.ability = idx('suppress'); }
          else inp.ability = idx('spin');
        } else if (d <= 5) inp.ability = ready('concuss') ? idx('concuss') : idx('swing');
        b.think = 0.15 + S.rng() * 0.35;
      }
      return inp;
    }

    if (p.role === 'dps' || p.role === 'melee') {
      if (!foes.length) return inp;
      var dr = foes.filter(function (f) { return f.type === 'drone'; }).sort(function (a, c) { return a.hp - c.hp; });
      var tg = dr[0] || boss;
      inp.target = tg.id;
      if (ready('adren') && boss.alive && canAct && boss.hp < boss.maxHp * 0.97) { inp.ability = idx('adren'); b.think = 0.2; return inp; }
      if (p.role === 'dps') {
        var dd = dist(p, tg);
        if (dd > 28) { moveTo(tg.x, tg.z); return inp; }
        if (boss.alive && boss.target !== p.id && dist(p, boss) < boss.radius + 8) { inp.mx = p.x - boss.x; inp.mz = p.z - boss.z; }
        if (canAct && p.gcd <= 0) {
          if (W === 'rockets') inp.ability = ready('volley') ? idx('volley') : idx('rocket');
          else if (W === 'sniper') {
            if (ready('headshot') && (tg.cast || tg.hp < tg.maxHp * 0.35 || moving())) inp.ability = idx('headshot');
            else if (!moving()) inp.ability = idx('snipe');
          }
          else {
            // Shock combo: Beam to mark, then Core inside 3s.
            var marked = tg.mark && tg.mark.src === p.id && S.t - tg.mark.t <= 3;
            inp.ability = moving() || (!marked && S.rng() < 0.35) ? idx('beam') : idx('core');
          }
          b.think = 0.2 + S.rng() * 0.5;
        }
        return inp;
      }
      var dm = dist(p, tg) - (tg.radius || 0);
      if (W === 'chainsaw') {
        var spot = tg.type === 'boss' ? { x: tg.x - Math.sin(tg.facing) * (tg.radius + 1.6), z: tg.z - Math.cos(tg.facing) * (tg.radius + 1.6) } : { x: tg.x, z: tg.z };
        var off = Math.sqrt(Math.pow(spot.x - p.x, 2) + Math.pow(spot.z - p.z, 2));
        if (dm > 10 && ready('dash')) { inp.ability = idx('dash'); return inp; }
        if (off > 1.2 && (tg.type === 'boss' || dm > 3)) moveTo(spot.x, spot.z);
        if (canAct && p.gcd <= 0) { inp.ability = ready('saw') ? idx('saw') : idx('rip'); b.think = 0.2 + S.rng() * 0.4; }
      } else if (W === 'enforcers') {
        // Enforcers: circle the target at about 8m so every shot gets the moving bonus.
        var ang = Math.atan2(p.x - tg.x, p.z - tg.z) + 0.6;
        var ring = { x: tg.x + Math.sin(ang) * ((tg.radius || 1) + 7), z: tg.z + Math.cos(ang) * ((tg.radius || 1) + 7) };
        clampArena(ring, 2);
        moveTo(ring.x, ring.z);
        if (tg.type === 'boss') { var fx2 = Math.sin(tg.facing), fz2 = Math.cos(tg.facing); if (((p.x - tg.x) * fx2 + (p.z - tg.z) * fz2) > 0) moveTo(tg.x - fx2 * 9, tg.z - fz2 * 9); }
        if (canAct && p.gcd <= 0) { inp.ability = ready('fan') ? idx('fan') : idx('tap'); b.think = 0.2 + S.rng() * 0.4; }
      } else {
        // Ripper: hold a spot 12m behind the target so the cleave and charge lanes miss you.
        var back = tg.type === 'boss' ? { x: tg.x - Math.sin(tg.facing) * 12, z: tg.z - Math.cos(tg.facing) * 12 } : null;
        if (back) { clampArena(back, 2); if (Math.hypot(back.x - p.x, back.z - p.z) > 2) moveTo(back.x, back.z); }
        else if (dm > 16) moveTo(tg.x, tg.z);
        if (canAct && p.gcd <= 0) { inp.ability = ready('bounce') ? idx('bounce') : idx('razor'); b.think = 0.2 + S.rng() * 0.4; }
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
    if (!canAct || p.gcd > 0) return inp;
    var sick = allies.filter(function (a) { return a.sludge > 0; })[0];
    var hurt = allies.filter(function (a) { return a.hp < a.maxHp * 0.65; }).length;
    if (sick && ready('purge')) { inp.target = sick.id; inp.ability = idx('purge'); }
    else if (hurt >= 3 && ready('keg')) { inp.ability = idx('keg'); }
    else if (W === 'bio') {
      if (hurt >= 2 && ready('glob')) { inp.target = low.id; inp.ability = idx('glob'); }
      else {
        var nohot = allies.filter(function (a) { return a.hp < a.maxHp * 0.95 && !a.hot; })[0];
        var pick = low.hp < low.maxHp * 0.6 ? low : (nohot || (low.hp < low.maxHp * 0.92 ? low : null));
        if (pick) { inp.target = pick.id; inp.ability = idx('spray'); }
      }
    } else if (W === 'shield') {
      // Shield the tank ahead of the hits, blanket the squad when something big is coming.
      var bigHit = boss.alive && (boss.cast || S.telegraphs.length);
      var tank = allies.filter(function (a) { return a.role === 'tank'; })[0];
      if (bigHit && ready('bulwark')) { inp.target = (tank || low).id; inp.ability = idx('bulwark'); }
      else if (low.hp < low.maxHp * 0.6 || low.armor < 100) { inp.target = low.id; inp.ability = idx('barrier'); }
      else if (tank && tank.armor < 250) { inp.target = tank.id; inp.ability = idx('barrier'); }
      else { var bare = allies.filter(function (a) { return a.armor < 100; })[0]; if (bare) { inp.target = bare.id; inp.ability = idx('barrier'); } }
    } else if (!moving()) {
      if (low.hp < low.maxHp * 0.5 && ready('surge')) { inp.target = low.id; inp.ability = idx('surge'); }
      else if (low.hp < low.maxHp * 0.88) { inp.target = low.id; inp.ability = idx('link'); }
    }
    if (inp.ability >= 0) b.think = 0.2 + S.rng() * 0.4;
    return inp;
  }

  /* ---------- main step ---------- */

  /* inputs: { [playerId]: { mx, mz, ability, target, jump } }. A bare input object means the solo player. */
  function step(S, dt, inputs) {
    if (S.result) return;
    inputs = inputs || {};
    if ('mx' in inputs || 'ability' in inputs || 'target' in inputs || 'jump' in inputs) { var one = {}; one[S.humanId] = inputs; inputs = one; }
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
      var inp = (p.human && !p.auto) ? (inputs[p.id] || {}) : hands(S, p, botThink(S, p, dt), dt);
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
    S.ents.forEach(function (e) {
      if (e.kind === 'player') {
        var cds = {}; for (var k in e.cds) if (e.cds[k] > 0) cds[k] = r1(e.cds[k]);
        var o = { i: e.id, x: r2(e.x), z: r2(e.z), f: r2(e.facing), h: Math.round(e.hp), a: e.alive ? 1 : 0, tg: e.target, g: r2(e.gcd), c: cds };
        if (e.moving) o.mv = 1;
        if (e.auto && e.human) o.au = 1;
        if (e.defibUsed) o.du = 1;
        if (e.cast) o.k = [e.cast.ab.id, r2(e.cast.t), r2(e.cast.dur), e.cast.targetId];
        ['belt', 'adren', 'pump', 'afterburn', 'armor', 'hot', 'sludge', 'spinStacks', 'momentum', 'still', 'rage', 'opp', 'counter', 'rallied', 'stimmed', 'warcry', 'spree', 'rampage'].forEach(function (f) { if (e[f] > 0) o[f] = r1(e[f]); });
        snap.p.push(o);
      } else {
        var q = { i: e.id, ty: e.type, n: e.name, x: r2(e.x), z: r2(e.z), f: r2(e.facing), h: Math.round(e.hp), mh: e.maxHp, a: e.alive ? 1 : 0, tg: e.target, ra: e.radius };
        if (e.cast) q.k = [e.cast.name, r2(e.cast.t), r2(e.cast.dur), e.cast.interruptible ? 1 : 0, e.cast.assigned == null ? null : e.cast.assigned];
        if (e.weak > 0) q.wk = 1;
        if (e.slowed > 0) q.sw = 1;
        snap.e.push(q);
      }
    });
    S.telegraphs.forEach(function (g) {
      snap.g.push(g.shape === 'line'
        ? { i: g.id, s: 'l', x1: r1(g.x1), z1: r1(g.z1), x2: r1(g.x2), z2: r1(g.z2), w: g.w, t: r2(g.t), d: g.dur }
        : { i: g.id, s: 'c', x: r1(g.x), z: r1(g.z), r: g.r, t: r2(g.t), d: g.dur });
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
    snap.p.forEach(function (o) {
      var p = ent(M, o.i); if (!p) return;
      p.x = o.x; p.z = o.z; p.facing = o.f; p.hp = o.h; p.alive = !!o.a; p.target = o.tg; p.gcd = o.g; p.cds = o.c || {};
      p.moving = !!o.mv; p.auto = !!o.au || !p.human; p.defibUsed = !!o.du;
      ['belt', 'adren', 'pump', 'afterburn', 'armor', 'hot', 'sludge', 'spinStacks', 'momentum', 'still', 'rage', 'opp', 'counter', 'rallied', 'stimmed', 'warcry', 'spree', 'rampage'].forEach(function (f) { p[f] = o[f] || 0; });
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
      e.cast = q.k ? { name: q.k[0], t: q.k[1], dur: q.k[2], interruptible: !!q.k[3], assigned: q.k[4] } : null;
      e.weak = q.wk ? 1 : 0; e.slowed = q.sw ? 1 : 0;
    });
    M.ents = M.ents.filter(function (e) { return e.kind === 'player' || seen[e.id]; });
    M.telegraphs = snap.g.map(function (g) {
      return g.s === 'l' ? { id: g.i, shape: 'line', x1: g.x1, z1: g.z1, x2: g.x2, z2: g.z2, w: g.w, t: g.t, dur: g.d }
        : { id: g.i, shape: 'circle', x: g.x, z: g.z, r: g.r, t: g.t, dur: g.d };
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
      v: 1, build: String(meta.build || 'dev'), mode: meta.mode || 'solo', result: S.result || 'abandoned',
      secs: Math.round(S.t), bossPct: boss ? Math.round(boss.hp / boss.maxHp * 100) : 0, phase: S.phase, enraged: S.enraged ? 1 : 0,
      players: players(S).map(function (p) {
        var q = m.p[p.id] || {};
        return {
          role: p.role, human: p.human ? 1 : 0, weapon: p.gear.weapon, boots: p.gear.boots, rig: p.gear.rig, implant: p.gear.implant, util: p.gear.util,
          dmg: Math.round(q.dmg || 0), heal: Math.round(q.heal || 0), taken: Math.round(q.taken || 0),
          deaths: q.deaths || 0, duty: q.duty || 0, miss: q.miss || 0, kicks: q.kicks || 0, alive: p.alive ? 1 : 0,
          // How this seat moved: average seconds a direction was held, share of the fight spent moving,
          // and average seconds spent standing in a red zone each time one caught you.
          move: q.liveT > 5 ? { hold: r2(q.holdN ? q.holdSum / q.holdN : 0), moving: Math.round(q.mvT / q.liveT * 100), red: r2(q.redN ? q.redSum / q.redN : 0), reds: q.redN } : null
        };
      }),
      taken: round(m.taken), killers: m.killers
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
    var CHIP = {
      charge: function () { space('Riot Charge', 'Charged: next hit +30%'); },
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
      counter: function () { timed(p.counter, 'Counterstrike +40%', 'Counterstrike: interrupt'); },
      spree: function () { out.push([(p.spree || 0) > 0 ? 'Spree x' + p.spree + ' +' + p.spree * 8 + '%' : 'Spree: land a highlight', (p.spree || 0) > 0]); },
      defib: function () { out.push([p.defibUsed ? 'Defibrillator spent' : 'Defibrillator charged', !p.defibUsed]); },
      shoulder: function () { out.push(['Shoulder Check ' + cd('kick'), ready('kick')]); }
    };
    SLOTS.forEach(function (slot) { if (g[slot]) (CHIP[g[slot]] || function () { named(slot); })(); });
    if (p.rallied > 0) out.push(['Holding the line -20%', true]);
    if (p.stimmed > 0) out.push(['Stimulant +25%', true]);
    if (p.warcry > 0) out.push(['War Cry +15%', true]);
    if ((p.spinStacks || 0) > 0 && p.kit && p.kit.weapons[p.weapon].id === 'minigun') out.push(['Spin x' + p.spinStacks, true]);
    return out;
  }

  var api = {
    summary: summary,
    snapshot: snapshot, applySnapshot: applySnapshot, predictMove: predictMove,
    create: create, step: step, usable: usable, GEAR: GEAR, TALENTS: TALENTS, SLOTS: SLOTS, talentList: talentList, talentChips: talentChips, STYLES: STYLES, braced: braced, hasTalent: T, BOT_GEAR: BOT_GEAR, validGear: validGear, gearName: gearName, abilitiesOf: abilitiesOf, behind: behind, inTele: inTele,
    damageEnemy: damageEnemy, damagePlayer: damagePlayer,
    ent: ent, players: players, enemies: enemies, KITS: KITS, KICK: KICK, TUNE: TUNE,
    ARENA_R: ARENA_R, GCD: GCD, dist: dist
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
