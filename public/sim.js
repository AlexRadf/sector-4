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
          A({ id: 'core', name: 'Shock Core', kind: 'enemy', range: 35, cast: 1.5, desc: 'Heavy shot. 1.5s cast, stand still.' })
        ] },
        { id: 'rockets', name: 'Rocket Launcher', pitch: 'All instant, so you never stop moving. Splash shreds drone packs.', abilities: [
          A({ id: 'rocket', name: 'Rocket', kind: 'enemy', range: 30, desc: 'Instant. Splashes enemies within 4m of the target.' }),
          A({ id: 'volley', name: 'Rocket Volley', kind: 'enemy', range: 30, cd: 10, desc: 'Instant burst of three rockets.' })
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
        ] }
      ],
      utils: [
        A({ id: 'dash', name: 'Dash', kind: 'enemy', range: 20, cd: 10, gcd: false, desc: 'Rush to your target, behind it if it is the Foreman.' }),
        A({ id: 'adren', name: 'Adrenaline', kind: 'self', range: 0, cd: 45, gcd: false, desc: '40% more damage for 8s.' })
      ]
    }
  };
  var BACKSTAB = { rip: 1, saw: 1 };

  /* ---------- gear: three slots, every item changes a mechanic instead of adding stats ---------- */
  var GEAR = {
    boots: [
      { id: 'treads', name: 'Sprint Treads', desc: 'Move 25% faster. Casts take 20% longer.' },
      { id: 'jump', name: 'Jump Boots', desc: 'Space leaps 9m the way you are moving. 8s cooldown.' },
      { id: 'mag', name: 'Mag-Lock Soles', desc: 'Cast while moving, at half speed.' }
    ],
    rig: [
      { id: 'wind', name: 'Second Wind', desc: 'The first time you would go down, you stay up at 1 health and take half damage for 3s. Once per raid.' },
      { id: 'plate', name: 'Ablative Plating', desc: 'Ignore the first hit of 100 or more every 20s.' },
      { id: 'pump', name: 'Adrenal Pump', desc: 'Drop below 30% health and you deal and heal 40% more for 6s. Once a minute.' }
    ],
    implant: {
      tank: [
        { id: 'recharge', name: 'Rapid Recharge', desc: 'Shield Belt is ready every 15s instead of 25s, but lasts 4s instead of 6s.' },
        { id: 'guardian', name: 'Guardian Link', desc: 'Challenge also gives the most hurt squad member 300 armor.' }
      ],
      healer: [
        { id: 'triage', needs: 'link', name: 'Triage Matrix', desc: 'Link Beam and Nano Surge heal 30% more on anyone below 40% health.' },
        { id: 'recycler', needs: 'bio', name: 'Bio Recycler', desc: 'Bio Spray also lands on the most hurt ally within 8m of your target.' }
      ],
      dps: [
        { id: 'capacitor', needs: 'shock', name: 'Combo Capacitor', desc: 'Shock Core does 60% more to a target you hit with Shock Beam in the last 3s.' },
        { id: 'seeker', needs: 'rockets', name: 'Seeker Payload', desc: 'Rocket splash reaches 7m. Rocket Volley cooldown drops to 7s.' }
      ],
      melee: [
        { id: 'bloodlust', needs: 'chainsaw', name: 'Bloodlust Saw', desc: 'Each Rip from behind takes 2s off Saw Through.' },
        { id: 'afterburner', name: 'Afterburner', desc: 'Dash cooldown drops to 5s. For 3s after a Dash every hit counts as from behind.' }
      ]
    }
  };
  var BOT_GEAR = {
    tank: { weapon: 'hammer', boots: 'treads', rig: 'plate', implant: 'recharge' },
    healer: { weapon: 'link', boots: 'jump', rig: 'plate', implant: 'triage' },
    dps: { weapon: 'rockets', boots: 'jump', rig: 'pump', implant: 'seeker' },
    melee: { weapon: 'chainsaw', boots: 'treads', rig: 'pump', implant: 'bloodlust' }
  };
  function validGear(role, g) {
    var out = {}, has = function (list, id) { return list.some(function (x) { return x.id === id; }); };
    g = g || {};
    out.weapon = has(KITS[role].weapons, g.weapon) ? g.weapon : KITS[role].weapons[0].id;
    out.boots = has(GEAR.boots, g.boots) ? g.boots : GEAR.boots[0].id;
    out.rig = has(GEAR.rig, g.rig) ? g.rig : GEAR.rig[0].id;
    out.implant = has(GEAR.implant[role], g.implant) ? g.implant : GEAR.implant[role][0].id;
    return out;
  }
  function gearName(slot, id, role) {
    var list = slot === 'implant' ? GEAR.implant[role] : slot === 'weapon' ? KITS[role].weapons : GEAR[slot];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return id;
  }

  var TUNE = {
    bossHp: 62000, bossMelee: 265, bossSwing: 2.0, cleaveMult: 0.7,
    barrageEvery: 12, barrageDelay: 2.6, barrageR: 6, barrageDmg: 520,
    overEvery: 24, overCast: 3.0, overDmg: 520,
    chargeEvery: 19, chargeDelay: 1.8, chargeW: 4.5, chargeDmg: 380,
    droneEvery: 32, droneHp: 650, droneMelee: 65, droneSwing: 1.5,
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
      ents: [], telegraphs: [], events: [], nextId: 1, kickIdx: 0,
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
      p.weapon = kit.weapons[0].id === p.gear.weapon ? 0 : 1;
      if (p.gear.boots === 'treads') p.speed *= 1.25;
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
    return S.m.p[id] || (S.m.p[id] = { dmg: 0, heal: 0, taken: 0, deaths: 0, duty: 0, miss: 0, kicks: 0 });
  }
  function damageEnemy(S, src, tgt, amt, threatMult, label) {
    if (!tgt.alive) return;
    if (src.kind === 'player') amt *= (src.adren > 0 ? 1.4 : 1) * (src.amp > 0 ? 1.5 : 1) * (src.pump > 0 ? 1.4 : 1);
    amt = Math.round(amt);
    if (src.kind === 'player') met(S, src.id).dmg += Math.min(amt, tgt.hp);
    tgt.hp -= amt;
    addThreat(S, tgt, src.id, amt * (threatMult || 1));
    emit(S, { type: 'dmg', src: src.id, dst: tgt.id, amt: amt, label: label });
    if (tgt.hp <= 0) {
      tgt.hp = 0; tgt.alive = false; tgt.cast = null; tgt.charging = null;
      emit(S, { type: 'death', id: tgt.id });
    }
  }
  function damagePlayer(S, srcId, p, amt, label) {
    if (!p.alive) return;
    if (p.belt > 0) amt = amt * 0.5;
    amt = Math.round(amt);
    if (p.gear && p.gear.rig === 'plate' && amt >= 100 && (p.cds.plate || 0) <= 0) {
      p.cds.plate = 20;
      emit(S, { type: 'absorb', id: p.id, amt: amt, label: label });
      return;
    }
    if (p.armor > 0) { var soak = Math.min(p.armor, amt); p.armor -= soak; amt -= soak; }
    met(S, p.id).taken += amt; S.m.taken[label] = (S.m.taken[label] || 0) + amt;
    p.hp -= amt;
    emit(S, { type: 'dmg', src: srcId, dst: p.id, amt: amt, label: label });
    if (p.hp > 0 && p.gear && p.gear.rig === 'pump' && p.hp < p.maxHp * 0.3 && (p.cds.pump || 0) <= 0) {
      p.pump = 6; p.cds.pump = 60;
      emit(S, { type: 'fx', fx: 'pump', src: p.id });
    }
    if (p.hp <= 0 && p.gear && p.gear.rig === 'wind' && !p.windUsed) {
      p.windUsed = true; p.hp = 1; p.belt = Math.max(p.belt, 3);
      emit(S, { type: 'fx', fx: 'wind', src: p.id });
      emit(S, { type: 'log', id: p.id, text: p.name + ' catches a Second Wind.', you: 'You catch a Second Wind.' });
    }
    if (p.hp <= 0) {
      met(S, p.id).deaths++; S.m.killers[label] = (S.m.killers[label] || 0) + 1;
      p.hp = 0; p.alive = false; p.cast = null; p.queued = null; p.sludge = 0; p.hot = 0;
      emit(S, { type: 'death', id: p.id });
      emit(S, { type: 'log', id: p.id, text: p.name + ' is down.', you: "You're down." });
    }
  }
  function heal(S, src, p, amt, label) {
    if (!p.alive) return;
    if (src.kind === 'player' && src.pump > 0) amt *= 1.4;
    var before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amt);
    var eff = p.hp - before;
    if (src.kind === 'player') met(S, src.id).heal += eff;
    emit(S, { type: 'heal', src: src.id, dst: p.id, amt: Math.round(eff), label: label });
    enemies(S).forEach(function (e) { addThreat(S, e, src.id, eff * 0.5); });
  }

  /* ---------- abilities ---------- */

  function castingEnemy(S, p, range) {
    return enemies(S).filter(function (e) { return e.cast && e.cast.interruptible && dist(p, e) <= range + (e.radius || 0); })[0] || null;
  }
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
    if (ab.kind !== 'self' && dist(p, tgt) > ab.range + (tgt.radius || 0)) out.state = 'range';
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
      if (dist(p, tgt) > ab.range + (tgt.radius || 0)) return fail(S, p, 'Out of range');
    }
    if (ab.cast > 0 && p.moving && p.gear.boots !== 'mag') return fail(S, p, 'Stand still to cast ' + ab.name);
    if (ab.gcd) p.gcd = GCD;
    if (ab.cast > 0) { p.cast = { ab: ab, t: 0, dur: ab.cast * (p.gear.boots === 'treads' ? 1.2 : 1), targetId: tgt.id }; return true; }
    fire(S, p, ab, tgt);
    return true;
  }

  function fire(S, p, ab, tgt) {
    var G = p.gear;
    p.cds[ab.id] = ab.cd;
    if (G.implant === 'seeker' && ab.id === 'volley') p.cds.volley = 7;
    if (G.implant === 'afterburner' && ab.id === 'dash') p.cds.dash = 5;
    if (G.implant === 'recharge' && ab.id === 'belt') p.cds.belt = 15;
    if (tgt && tgt !== p && !p.moving) p.facing = Math.atan2(tgt.x - p.x, tgt.z - p.z);
    var back = BACKSTAB[ab.id] && tgt.kind === 'enemy' && (behind(p, tgt) || p.afterburn > 0) ? 1.5 : 1;
    var triage = G.implant === 'triage' && tgt.kind === 'player' && tgt.hp < tgt.maxHp * 0.4 ? 1.3 : 1;
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
        break;
      case 'challenge':
        emit(S, { type: 'fx', fx: 'challenge', src: p.id });
        enemies(S).forEach(function (e) {
          if (dist(p, e) > ab.range + (e.radius || 0)) return;
          var top = 0; for (var k in e.threat) top = Math.max(top, e.threat[k]);
          e.threat[p.id] = top * 1.2 + 200;
          e.fixate = { id: p.id, t: 4 };
        });
        if (G.implant === 'guardian') {
          var ward = players(S, true).filter(function (q) { return q !== p; }).sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; })[0];
          if (ward) { ward.armor = Math.max(ward.armor, 300); emit(S, { type: 'fx', fx: 'guard', src: ward.id }); }
        }
        break;
      case 'belt': p.belt = G.implant === 'recharge' ? 4 : 6; emit(S, { type: 'fx', fx: 'belt', src: p.id }); break;
      case 'adren': p.adren = 8; emit(S, { type: 'fx', fx: 'adren', src: p.id }); break;
      case 'beam':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'shock' });
        damageEnemy(S, p, tgt, 75, 1, 'Beam');
        if (G.implant === 'capacitor') tgt.mark = { src: p.id, t: S.t };
        break;
      case 'core':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'core' });
        var combo = G.implant === 'capacitor' && tgt.mark && tgt.mark.src === p.id && S.t - tgt.mark.t <= 3;
        if (combo) { tgt.mark = null; emit(S, { type: 'fx', fx: 'combo', src: tgt.id }); }
        damageEnemy(S, p, tgt, 180 * (combo ? 1.6 : 1), 1, combo ? 'Combo!' : 'Core'); break;
      case 'rocket':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'rocket' });
        damageEnemy(S, p, tgt, 95, 1, 'Rocket');
        enemies(S).forEach(function (e) { if (e !== tgt && dist(e, tgt) <= (G.implant === 'seeker' ? 7 : 4) + (e.radius || 0)) damageEnemy(S, p, e, 60, 1, 'Splash'); });
        break;
      case 'volley':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'volley' });
        damageEnemy(S, p, tgt, 300, 1, 'Volley');
        enemies(S).forEach(function (e) { if (e !== tgt && dist(e, tgt) <= (G.implant === 'seeker' ? 7 : 4) + (e.radius || 0)) damageEnemy(S, p, e, 120, 1, 'Splash'); });
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
        if (G.implant === 'bloodlust' && back > 1) p.cds.saw = Math.max(0, (p.cds.saw || 0) - 2);
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
        if (G.implant === 'afterburner') p.afterburn = 3;
        emit(S, { type: 'blink', id: p.id, fromX: ox, fromZ: oz, fx: 'dash' });
        break;
      case 'link':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'link' });
        heal(S, p, tgt, 160 * triage, 'Link'); break;
      case 'surge':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'surge' });
        heal(S, p, tgt, 430 * triage, 'Surge'); break;
      case 'spray':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'bio' });
        tgt.hot = 6; tgt.hotSrc = p.id; heal(S, p, tgt, 110, 'Spray');
        if (G.implant === 'recycler') {
          var extra = players(S, true).filter(function (q) { return q !== tgt && dist(q, tgt) <= 8 && q.hp < q.maxHp; }).sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; })[0];
          if (extra) { extra.hot = 6; extra.hotSrc = p.id; emit(S, { type: 'beam', src: tgt.id, dst: extra.id, fx: 'bio' }); }
        }
        break;
      case 'glob':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'bio' });
        emit(S, { type: 'fx', fx: 'glob', src: tgt.id });
        players(S, true).forEach(function (q) { if (dist(q, tgt) <= 7) heal(S, p, q, 170, 'Glob'); });
        break;
      case 'keg':
        emit(S, { type: 'fx', fx: 'keg', src: p.id });
        players(S, true).forEach(function (q) { if (dist(p, q) <= ab.range) heal(S, p, q, 190, 'Keg'); });
        break;
      case 'purge':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'purge' });
        if (tgt.sludge > 0) { tgt.sludge = 0; emit(S, { type: 'log', text: p.name + ' purges ' + tgt.name + '.' }); }
        heal(S, p, tgt, 60, 'Purge'); break;
    }
  }

  /* ---------- player update ---------- */

  function applyInput(S, p, inp, dt) {
    if (!p.alive) return;
    if (inp.target !== undefined) p.target = inp.target;
    var mx = inp.mx || 0, mz = inp.mz || 0, len = Math.sqrt(mx * mx + mz * mz);
    p.moving = len > 0.01;
    var mag = p.gear.boots === 'mag';
    if (p.moving) {
      mx /= len; mz /= len; p.inMx = mx; p.inMz = mz;
      var sp = p.speed * (p.cast && mag ? 0.5 : 1);
      p.x += mx * sp * dt; p.z += mz * sp * dt;
      p.facing = Math.atan2(mx, mz);
      clampArena(p);
      if (p.cast && !mag) { p.cast = null; p.gcd = Math.min(p.gcd, 0.3); }
    }
    if (inp.jump && p.gear.boots === 'jump' && (p.cds.leap || 0) <= 0) {
      var jx = p.moving ? p.inMx : Math.sin(p.facing), jz = p.moving ? p.inMz : Math.cos(p.facing), ox = p.x, oz = p.z;
      p.x += jx * 9; p.z += jz * 9; clampArena(p); p.cds.leap = 8;
      if (p.cast && !mag) p.cast = null;
      emit(S, { type: 'blink', id: p.id, fromX: ox, fromZ: oz, fx: 'leap' });
    }
    if (inp.ability != null && inp.ability >= 0) p.queued = { idx: inp.ability, t: 0.45 };
    if (p.queued) {
      if (tryUse(S, p, p.queued.idx)) p.queued = null;
      else { p.queued.t -= dt; if (p.queued.t <= 0) p.queued = null; }
    }
  }

  function tickPlayer(S, p, dt) {
    if (!p.alive) return;
    if (p.gcd > 0) p.gcd = Math.max(0, p.gcd - dt);
    for (var k in p.cds) if (p.cds[k] > 0) p.cds[k] = Math.max(0, p.cds[k] - dt);
    ['belt', 'adren', 'amp', 'pump', 'afterburn'].forEach(function (f) { if (p[f] > 0) p[f] = Math.max(0, p[f] - dt); });
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
      p.cast.t += dt;
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
    if (e.slowed > 0) e.slowed -= dt;
    e.target = pickTarget(S, e);
    var tgt = e.target != null ? ent(S, e.target) : null;
    if (e.cast) {
      e.cast.t += dt;
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
      var dmg = e.melee * (S.enraged && e.type === 'boss' ? 3 : 1) * (e.weak > 0 ? 0.75 : 1);
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
    for (var i = S.telegraphs.length - 1; i >= 0; i--) {
      var g = S.telegraphs[i];
      g.t += dt;
      if (g.t < g.dur) continue;
      S.telegraphs.splice(i, 1);
      if (g.shape === 'line') {
        if (!boss.alive) continue;
        boss.cast = null;
        boss.charging = { x1: boss.x, z1: boss.z, x2: g.x2, z2: g.z2, t: 0, dur: 0.45 };
        emit(S, { type: 'fx', fx: 'charge', src: boss.id });
        players(S, true).forEach(function (p) {
          if (!inTele(g, p)) return;
          damagePlayer(S, boss.id, p, g.dmg, 'Charge');
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
      if (b.danger > b.react * slow) { var e = escapeDir(inside, p); inp.mx = e.x; inp.mz = e.z; return inp; }
    } else b.danger = 0;

    b.think -= dt / slow;
    var canAct = !p.cast && b.think <= 0;

    // Interrupt duty: take your assigned Overcharge, or cover when the assigned player is down.
    if (boss.alive && boss.cast && boss.cast.interruptible && ready('kick')) {
      var asg = ent(S, boss.cast.assigned);
      var mine = boss.cast.assigned === p.id || ((!asg || !asg.alive) && p.role !== 'healer');
      if (mine && boss.cast.t >= b.intDelay * slow) {
        if (dist(p, boss) > 24 + boss.radius) { moveTo(boss.x, boss.z); return inp; }
        inp.target = boss.id; inp.ability = idx('kick'); return inp;
      }
    }

    if (p.role === 'tank') {
      if (!foes.length) return inp;
      var main = boss.alive ? boss : foes[0];
      inp.target = main.id;
      var d = dist(p, main) - (main.radius || 0);
      if (d > 3.5) moveTo(main.x, main.z);
      if (p.hp < p.maxHp * 0.45 && ready('belt')) { inp.ability = idx('belt'); return inp; }
      var loose = foes.filter(function (f) { return f.target !== p.id && !(f.fixate && f.fixate.id === p.id); });
      if (loose.length && ready('challenge') && canAct) { inp.ability = idx('challenge'); b.think = 0.3; return inp; }
      if (canAct && p.gcd <= 0) {
        if (W === 'flak') {
          var looseFar = loose.filter(function (f) { return f.type === 'drone' && dist(p, f) > 9; })[0];
          if (looseFar && ready('shell')) { inp.target = looseFar.id; inp.ability = idx('shell'); }
          else if (ready('shell') && boss.alive && !(boss.slowed > 0)) { inp.target = boss.id; inp.ability = idx('shell'); }
          else if (d <= 8) inp.ability = idx('flak');
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
          else inp.ability = moving() && p.gear.boots !== 'mag' ? idx('beam') : idx('core');
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
    } else if (!moving() || p.gear.boots === 'mag') {
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
      var inp = (p.human && !p.auto) ? (inputs[p.id] || {}) : botThink(S, p, dt);
      applyInput(S, p, inp, dt);
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
        if (e.cast) o.k = [e.cast.ab.id, r2(e.cast.t), r2(e.cast.dur), e.cast.targetId];
        ['belt', 'adren', 'pump', 'afterburn', 'armor', 'hot', 'sludge'].forEach(function (f) { if (e[f] > 0) o[f] = r1(e[f]); });
        if (e.windUsed) o.wu = 1;
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
      p.moving = !!o.mv; p.auto = !!o.au || !p.human;
      ['belt', 'adren', 'pump', 'afterburn', 'armor', 'hot', 'sludge'].forEach(function (f) { p[f] = o[f] || 0; });
      p.windUsed = !!o.wu;
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
  function predictMove(p, mx, mz, dt) {
    var len = Math.sqrt(mx * mx + mz * mz);
    if (!p.alive || len < 0.01) return;
    var sp = p.speed * (p.cast && p.gear.boots === 'mag' ? 0.5 : 1);
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
          role: p.role, human: p.human ? 1 : 0, weapon: p.gear.weapon, boots: p.gear.boots, rig: p.gear.rig, implant: p.gear.implant,
          dmg: Math.round(q.dmg || 0), heal: Math.round(q.heal || 0), taken: Math.round(q.taken || 0),
          deaths: q.deaths || 0, duty: q.duty || 0, miss: q.miss || 0, kicks: q.kicks || 0, alive: p.alive ? 1 : 0
        };
      }),
      taken: round(m.taken), killers: m.killers
    };
  }

  var api = {
    summary: summary,
    snapshot: snapshot, applySnapshot: applySnapshot, predictMove: predictMove,
    create: create, step: step, usable: usable, GEAR: GEAR, BOT_GEAR: BOT_GEAR, validGear: validGear, gearName: gearName, abilitiesOf: abilitiesOf, behind: behind, inTele: inTele,
    ent: ent, players: players, enemies: enemies, KITS: KITS, KICK: KICK, TUNE: TUNE,
    ARENA_R: ARENA_R, GCD: GCD, dist: dist
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
