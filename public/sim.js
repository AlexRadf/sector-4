/* Sector-4 combat simulation.
   Pure logic, no rendering. Runs the same in the browser and in Node, and is written as an
   authoritative step(dt, inputs) loop so it can move onto a server later without a rewrite. */
(function (root) {
  'use strict';

  var ARENA_R = 28;
  var GCD = 1.5;

  /* ---------- kits ---------- */
  function A(o) { o.cast = o.cast || 0; o.cd = o.cd || 0; if (o.gcd === undefined) o.gcd = true; return o; }
  /* Every hit and heal rolls 85% to 115%, and 10% of them crit for 80% more. */
  var CRIT_CHANCE = 0.10, CRIT_MULT = 1.8;
  /* A weapon: its own resource, and its abilities (the first is the filler). */
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
  function fieldSpot(S, p) { return lobSpot(S, p, true); }
  /* A thrown thing (Nano Field, EMP Grenade): along your aim, as far as you're aiming, settling on a nearby ally or enemy. */
  function lobSpot(S, p, allies) {
    var d = p.aimDist == null ? 10 : p.aimDist;
    var spot = { x: p.x + Math.sin(p.facing) * d, z: p.z + Math.cos(p.facing) * d };
    var pool = allies ? players(S, true) : enemies(S);
    var near = pool.filter(function (q) { return Math.hypot(q.x - spot.x, q.z - spot.z) <= 3 + (allies ? 0 : (q.radius || 0)); })
      .sort(function (a, c) { return Math.hypot(a.x - spot.x, a.z - spot.z) - Math.hypot(c.x - spot.x, c.z - spot.z); })[0];
    if (near && (allies || near.type !== 'boss')) { spot.x = near.x; spot.z = near.z; }
    clampArena(spot, 2);
    return spot;
  }
  /* A shock detonation at a point: everything inside takes amt and is Charged (Shock Beams on it hit harder).
     Returns how many enemies it caught. Used by Shock Combos and the Shock Nova. */
  function shockBlast(S, p, at, amt, r, stun, label) {
    emit(S, { type: 'fx', fx: 'scombo', x2: Math.round(at.x * 10) / 10, z2: Math.round(at.z * 10) / 10, pw: r, src: p.id });
    var n = 0;
    enemies(S).forEach(function (e) {
      if (!e.alive || Math.hypot(e.x - at.x, e.z - at.z) > r + (e.radius || 0)) return;
      n++;
      damageEnemy(S, p, e, amt, 1.5, label);
      if (!e.alive) return;
      e.charged = TUNE.chargedDur; e.chargedBy = p.id; e.arcOn = T(p, 'arclink');
      if (stun && e.type !== 'boss') e.stagger = Math.max(e.stagger || 0, stun);
    });
    return n;
  }
  /* Shock Cores in flight: S.cores, each { id, by, x, z, dx, dz, sp, t, life, big, spent, flown }. */
  function launchCore(S, p, dir, big, spent, life) {
    var c = { id: S.nextId++, by: p.id, x: p.x + Math.sin(dir) * 1.2, z: p.z + Math.cos(dir) * 1.2, dx: Math.sin(dir), dz: Math.cos(dir),
      sp: big ? TUNE.ocoreSpeed : TUNE.coreSpeed, t: 0, life: life || (big ? TUNE.ocoreLife : TUNE.coreLife), big: big ? 1 : 0, spent: spent || 0, flown: 0 };
    if (T(p, 'magnet')) { var hm = softTarget(S, p, { range: 35, dot: 0.8, enemy: true }); if (hm) c.home = hm.id; }
    S.cores.push(c);
    emit(S, { type: 'fx', fx: big ? 'ocore' : 'core', src: p.id });
    return c;
  }
  /* Your own core nearest the crosshair, inside a generous cone: the beam snaps onto it. */
  function coreInAim(S, p, range) {
    var fx = Math.sin(p.facing), fz = Math.cos(p.facing), best = null, bs = -2;
    S.cores.forEach(function (c) {
      if (c.by !== p.id) return;
      var dx = c.x - p.x, dz = c.z - p.z, l = Math.sqrt(dx * dx + dz * dz);
      if (l > range || l < 0.3) return;
      var r = c.big ? 2.6 : 2.0;
      var ang = Math.max(0, Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / l))) - Math.atan2(r, Math.max(l, 0.5)));
      var eff = Math.cos(ang);
      if (eff < 0.96) return;
      if (eff - l * 0.001 > bs) { bs = eff - l * 0.001; best = c; }
    });
    return best;
  }
  /* The combo: a core blown up by its owner's beam. Bigger the further it has flown; two or more caught refunds the core. */
  function detonate(S, p, c) {
    S.cores.splice(S.cores.indexOf(c), 1);
    var travel = 1 + TUNE.comboTravelMult * Math.min(1, c.flown / TUNE.comboTravel);
    var base = (c.big ? TUNE.ocoreBase + TUNE.ocorePer * c.spent : c.nova ? 420 : TUNE.comboDmg) * (c.surge ? TUNE.surgeMult : 1);
    var r = c.big ? TUNE.ocoreR : T(p, 'volatile') ? 8 : TUNE.coreR;
    base *= (T(p, 'volatile') && !c.big ? 1.15 : 1) * (c.big && T(p, 'supercharge') ? 1.3 : 1);
    emit(S, { type: 'beam', src: p.id, x2: Math.round(c.x * 10) / 10, z2: Math.round(c.z * 10) / 10, fx: 'shock' });
    var n = shockBlast(S, p, c, base * travel, r, c.big ? (T(p, 'empburst') ? 3 : 1.5) : 0, c.big ? 'Overcharged Combo!' : 'Shock Combo!');
    if (c.big && T(p, 'empburst')) enemies(S).forEach(function (e) { if (Math.hypot(e.x - c.x, e.z - c.z) <= r + (e.radius || 0)) empShield(S, p, e); });
    if (n >= 2 && !c.nova) { p.cds.score = 0; proc(S, p, 'reset', 'MULTI-COMBO'); }
    return n;
  }
  /* Coolant ports on the Foreman: three glowing panels round his body that drift slowly round him. One is open at a time;
     all of them blow open for a few seconds after a big move (Crusher, charge, leap, ground pound) and while he's staggered.
     Hit an open one with the Shock Beam, with real aim (no snapping), for a crit and Capacitor. */
  function portAngle(boss, i) { return boss.facing + Math.PI + (boss.portRot || 0) + i * Math.PI * 2 / 3; }
  function portOpen(S, boss, i) {
    if (boss.stagger > 0 || boss.portBurst > 0) return true;
    var cyc = TUNE.portOpen + TUNE.portGap, k = Math.floor(S.t / cyc) % 3, into = S.t % cyc;
    return k === i && into < TUNE.portOpen;
  }
  function portHit(S, p, boss) {
    if (!boss || !boss.alive || boss.type !== 'boss') return -1;
    var fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    for (var i = 0; i < 3; i++) {
      if (!portOpen(S, boss, i)) continue;
      var a = portAngle(boss, i), px = boss.x + Math.sin(a) * boss.radius, pz = boss.z + Math.cos(a) * boss.radius;
      var dx = px - p.x, dz = pz - p.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
      if (((p.x - px) * Math.sin(a) + (p.z - pz) * Math.cos(a)) / l < 0.15) continue;   // it has to face you
      var off = Math.abs(dx * fz - dz * fx);              // how far the aim line passes from the port
      if ((dx * fx + dz * fz) > 0 && off <= (T(p, 'precision') ? 1.6 : TUNE.portHalf)) return i;
    }
    return -1;
  }
  function burstPorts(S, boss) { if (boss && boss.alive) { boss.portBurst = TUNE.portBurst; emit(S, { type: 'fx', fx: 'ports', src: boss.id }); } }
  var SHOCK_AIM = { range: 35, dot: 0.95, enemy: true };
  var BOLT_AIM = { range: 35, dot: 0.9, ally: true, enemy: true, hurt: true };
  function aimWeapon(p) { var w = p.kit && p.kit.weapons[p.weapon]; return !!(w && w.aim); }
  /* One aimed weapon per role. Each weapon brings its own resource (res), its three mouse abilities (LMB, RMB, L+R),
     its Q / E / F utilities and its ultimate (R). */
  var KITS = {
    tank: {
      role: 'tank', title: 'Juggernaut', hp: 1700,
      blurb: 'Hold the Foreman, pick up the drones, and survive the Crusher your own way. Your plating takes 30% off his fists; nobody else has it.',
      weapons: [
        TW('hammer', 'Impact Hammer', 'The plate-wearing mitigator, played like a Protection Warrior. Swing and block to fill Shield Energy; Shove spends it and builds Bulwark, your active mitigation. Block a Foreman hit with the barrier for a Riposte, and keep him Sundered with Piston Shot for the squad. No self-healing: you block, the Medic heals.',
          { id: 'senergy', name: 'Shield Energy', max: 100, start: 0, regen: 0, build: 0,
            how: 'Shield Energy. Each swing stores 6, the slam 12, and your barrier stores 1 for every 25 damage it blocks. It never leaks. Spend all of it on a Shove (LMB + RMB): the fuller the bar, the harder it lands, and every 10 spent is a second of Bulwark (15% less damage, stacking up to 12s). Hoard for a big Shove or spend often to keep Bulwark up.' },
          [{ id: 'combo', key: 'LMB', name: 'Hammer Combo', kind: 'aim', range: 6, hold: 'repeat', desc: 'Swing, swing, slam. Hits everything in an arc in front of you: 60, 60, then a wider 150 slam. Hold or tap to keep the chain going; a 2s pause resets it. With Riposte lit, your next swing is a Slam with 50% more.' },
           { id: 'ebarrier', key: 'RMB', name: 'Energy Barrier', kind: 'aim', range: 0, hold: 'channel', gcd: false, desc: 'Hold to raise a barrier facing where you aim. It blocks enemy hits on you and anyone behind you until its 1,800 health runs out, and what it blocks fills Shield Energy. Block a Foreman hit of 100 or more for a Riposte: your next swing is a Slam with 50% more, and Hammer Throw is ready again. Regenerates while lowered; breaks for 5s if emptied. No swinging while it\'s up.' },
           { id: 'shove', key: 'L+R', name: 'Shove', kind: 'aim', range: 8, needs: 20, gcd: false, desc: 'Press both mouse buttons (needs 20 Shield Energy). Spends it all: everything in the arc in front of you is thrown back up to 14m, and anything slammed into a wall or another enemy is stunned for 2s and takes 150 more. The Foreman won\'t budge, but a full Shove hits him for 500. Every 10 Shield Energy spent gives a second of Bulwark: 15% less damage, stacking up to 12s.' }],
          { aim: true,
            utils: [A({ id: 'hthrow', key: 'Q', name: 'Hammer Throw', kind: 'enemy', range: 30, cd: 8, gcd: false, desc: 'Hurl the charged hammer head at what you aim at (or your target): 180 and huge threat, then it bounces to the nearest other enemy within 10m for 120 and huge threat. How you pick up drones. No forced taunt: it works on anything.' }),
                    A({ id: 'piston', key: 'E', name: 'Piston Shot', kind: 'aim', range: 22, cd: 4, desc: 'The hammer head fires a compressed-air round where you aim: 120 to the first enemy within 22m and very high threat, and it Sunders them for 12s: they take 8% more damage from the whole squad (an orange ring at their feet). Keep the Foreman Sundered.' }),
                    A({ id: 'belt', key: 'F', name: 'Shield Belt', kind: 'self', range: 0, cd: 30, gcd: false, desc: 'Take half damage for 6s. Your big emergency button.' })],
            ult: A({ id: 'aegis', key: 'R', name: 'Aegis Dome', kind: 'self', range: 0, gcd: false, role: 'ult', desc: 'Ultimate. A dome 9m across forms around you: nobody inside takes any damage for 5s. Buy the squad time.' }) })
      ]
    },
    healer: {
      role: 'healer', title: 'Medic', hp: 900,
      blurb: 'Keep four health bars up. Your builder shoots the Foreman, and every shot patches someone up.',
      weapons: [
        TW('link', 'Link Gun', 'Aimed healing, played like a Discipline Priest. Tag your squad with Link Bolts, the beam or a Nanite Burst, then shoot the Foreman: every bolt that hits him heals everyone you have Tagged (Atonement) and refills your Nanites. Where you stand decides who you can reach.',
          { id: 'nanites', name: 'Nanites', max: 100, start: 100, regen: 2.5, build: 0,
            how: 'Nanites. Every Link Bolt that hits an enemy harvests 7. The Link Beam drains 5 a second, Nanite Burst costs 35 and a Nano Field 25. They barely refill on their own: shoot to heal, and with the squad Tagged, shooting is healing.' },
          [{ id: 'lbolt', key: 'LMB', name: 'Link Bolt', kind: 'aim', range: 35, hold: 'repeat', desc: 'Fires at whatever is nearest your crosshair, no precision needed. A hurt ally is healed for 70 and Tagged for 10s (green motes: a small heal over time). An enemy takes 50, gives you 7 Nanites, and heals every ally you have Tagged for a quarter of the damage (Atonement). A crit or every fifth bolt on an enemy lights Flux: your next bolt on an ally heals double and jumps to a second hurt ally. Allies at full health are skipped.' },
           { id: 'lbeam', key: 'RMB', name: 'Link Beam', kind: 'aim', range: 25, hold: 'channel', gcd: false, desc: 'Hold to latch onto the ally nearest your crosshair. The beam stays attached, heals 185 a second for 5 Nanites a second and keeps them Tagged. It snaps if they get more than 25m away. No bolts while it\'s on.' },
           { id: 'lburst', key: 'L+R', name: 'Nanite Burst', kind: 'aim', range: 10, needs: 35, gcd: false, desc: 'Press both mouse buttons (35 Nanites). Heals everyone within 10m of you, you included, for 260 (30% more on anyone already Tagged) and Tags them all. Get into the group, then pop it: the fastest way to Tag the squad.' }],
          { aim: true,
            utils: [A({ id: 'field', key: 'Q', name: 'Nano Field', kind: 'aim', range: 25, cd: 10, cost: 25, lob: true, lobR: 6, desc: '25 Nanites. Hold to aim a healing grenade (look further up or down the room to throw it further or nearer), let go to throw. It lands as a 6m field, settling on any ally within 3m of where it lands. Anyone standing in it heals 70 a second for 6s.' }),
                    A({ id: 'purge', key: 'E', name: 'Purge', kind: 'friend', range: 30, cd: 6, gcd: false, desc: 'Cleanses Bio Sludge and heals for 60. Smart: it takes a sludged ally roughly in front of you first, then you if you have it, then whoever you point at.' }),
                    A({ id: 'cloak', key: 'F', name: 'Nanite Cloak', kind: 'self', range: 0, cd: 25, gcd: false, desc: 'You take 40% less damage for 4s. For when you had to stand somewhere dangerous to reach someone.' })],
            ult: A({ id: 'storm', key: 'R', name: 'Link Storm', kind: 'self', range: 25, gcd: false, role: 'ult', desc: 'Ultimate. Every ally within 25m of you is instantly healed for 35% of their health, then your beam links to all of them for 5s, healing each 150 a second. Free.' }) })
      ]
    },
    dps: {
      role: 'dps', title: 'Striker', hp: 900,
      blurb: 'Ranged damage from a safe distance.',
      weapons: [
        TW('shock', 'Shock Rifle', 'Arcane precision with a UT heart. Beams build Shock Charges, and every charge makes your beams stronger and hungrier for Capacitor. Burn hot, then spend the charges on an Overcharged Core to get the Capacitor back. Keep your target Charged with Shock Cores, and hit the coolant ports to Surge.',
          { id: 'cap', name: 'Capacitor', max: 100, start: 100, regen: 6,
            how: 'Capacitor: your mana. It refills by itself (6 a second, faster while Overclocked). A Shock Beam costs 3, plus 3 for each Shock Charge you hold, so at four charges you burn through it. An Overcharged Core spends your charges and gives 8 Capacitor back for each.' },
          [{ id: 'sbeam', key: 'LMB', name: 'Shock Beam', kind: 'aim', range: 35, hold: 'repeat', desc: 'Hold or tap. An instant beam at the enemy nearest your crosshair: 42, plus 20% for each Shock Charge you hold. Each hit adds a Shock Charge (up to 4; a coolant port adds 2). Costs 3 Capacitor plus 3 per charge. Click (a fresh press) with your own Shock Core near the crosshair to pop it: the Shock Combo, free. Holding the beam fires past your cores. An open coolant port under your crosshair (no snapping for those) takes double, and two port hits in a row Surge your next core. Charged targets take 40% more.' },
           { id: 'score', key: 'RMB', name: 'Shock Core', kind: 'aim', range: 30, cd: 4, gcd: false, desc: 'Fire a slow glowing core along your aim (every 4s). Let it fly and it hits the first enemy it touches for 190 and Charges it for 8s. Click your beam on it in the air and it detonates instead: a Shock Combo, 220 to everything within 6m (up to 50% more the further it flew), all of them Charged. Catch two or more enemies and the core is ready again at once. Surge: ready at once, twice as fast, 50% harder.' },
           { id: 'ocore', key: 'L+R', name: 'Overcharged Core', kind: 'aim', range: 30, needs: 1, gcd: false, shareCd: 'score', desc: 'Press both buttons together (needs a Shock Charge; shares the Shock Core\'s 4s). Spends all your Shock Charges on a big, slow core and gives 8 Capacitor back for each. Pop it for an 8m combo: 180, plus 100 per charge (580 with four), plus the distance bonus. Left alone, it hits the first enemy it touches for 60% of that.' }],
          { aim: true,
            utils: [A({ id: 'emp', key: 'Q', name: 'EMP Grenade', kind: 'aim', range: 25, cd: 15, lob: true, lobR: 6, desc: 'Hold to aim, let go to throw (look further up the room to throw further). 6m blast: 200 damage, drones stunned for 2.5s, and an overcharge shield takes 600 more.' }),
                    A({ id: 'overclock', key: 'E', name: 'Overclock', kind: 'self', range: 0, cd: 45, gcd: false, desc: 'Your burn window: the Capacitor fills up, you get 4 Shock Charges and you deal 30% more damage for 8s. Line it up with open ports, the stagger or the shield.' }),
                    A({ id: 'kshield', key: 'F', name: 'Kinetic Shield', kind: 'self', range: 0, cd: 25, gcd: false, desc: 'A 350 shield on yourself for 4s.' })],
            ult: A({ id: 'nova', key: 'R', name: 'Shock Nova', kind: 'aim', range: 40, gcd: false, role: 'ult', desc: 'Ultimate. A Shock Nova goes off on the enemy nearest your crosshair (600 to it, 300 within 8m, drones stunned 3s, all Charged), you get 4 Shock Charges, and five Shock Cores fan out from you for 8s. Beam them one by one.' }) })
      ]
    },
    melee: {
      role: 'melee', title: 'Wrecker', hp: 1100,
      blurb: 'Melee damage. Stay out of the Foreman\'s front.',
      weapons: [
        TW('ripsaw', 'Ripsaw', 'Aimed melee, played like a Rogue. Rip what\'s in front of you to build Revs (double from behind), cash them in on Saw Through to keep a Bleed rolling, or Shred everything round you. Rips on a bleeding target can light Overdrive.',
          { id: 'revs', name: 'Revs', max: 5, start: 0, regen: 0, build: 0, spend: 'all', min: 1, per: 1,
            how: 'Revs, like combo points: up to 5. Rip adds one, two from behind. Saw Through (RMB) and Shred (both buttons) spend them all.' },
          [{ id: 'wrip', key: 'LMB', name: 'Rip', kind: 'aim', range: 4.5, hold: 'repeat', desc: 'Hold or tap. Rips the enemy in front of you for 40 and adds a Rev; from behind, 50% more and two Revs. A Rip on a bleeding target can light Overdrive (always on a crit).' },
           { id: 'wsaw', key: 'RMB', name: 'Saw Through', kind: 'aim', range: 4.5, needs: 1, gcd: false, desc: 'Spends all your Revs on the enemy in front of you: 30 plus 32 a Rev (50% more from behind), and a Bleed of 25 a second for 2.4s a Rev, added on to what\'s left. With Overdrive lit, it counts as five Revs.' },
           { id: 'shred', key: 'L+R', name: 'Shred', kind: 'aim', range: 5, needs: 1, gcd: false, desc: 'Press both buttons together. Spends all your Revs on everything within 5m of you: 40 plus 45 a Rev each, and a Bleed of 1s a Rev. For drones in a pile.' }],
          { aim: true,
            utils: [A({ id: 'hook', key: 'Q', name: 'Chain Hook', kind: 'aim', range: 22, cd: 12, gcd: false, desc: 'Hook the enemy nearest your crosshair within 22m. A drone is yanked to you and stunned for 1s; the Foreman pulls you onto his back instead.' }),
                    A({ id: 'redline', key: 'E', name: 'Redline', kind: 'self', range: 0, cd: 45, gcd: false, desc: 'Your burn window: for 8s Rips come a third faster and everything hits 20% harder.' }),
                    A({ id: 'ironhide', key: 'F', name: 'Iron Hide', kind: 'self', range: 0, cd: 25, gcd: false, desc: 'Take 40% less damage for 5s. For when you have to stay in.' })],
            ult: A({ id: 'slam', key: 'R', name: 'Wrecking Slam', kind: 'aim', range: 8, gcd: false, role: 'ult', desc: 'Ultimate. 450 to the enemy in front of you and it staggers for 3s: it stops attacking and the whole squad hits it 30% harder.' }) })
      ]
    }
  };
  var BACKSTAB = { wrip: 1, wsaw: 1 };

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
      tiers: ['Charge', 'Shield', 'Shove', 'Throw'],
      boots: [
        t('ram', 'aggressive', 'Battering Ram', 'Through them, not around them.', 'Riot Charge hits everything you plough past for 200 and high threat.'),
        t('twincharge', 'steady', 'Twin Thrusters', 'Always have a way in.', 'Riot Charge holds two charges.'),
        t('intercept', 'squad', 'Intercept', 'Go to whoever needs you.', 'Riot Charge flies 34m instead of 22, and if you reach a squad member it stops and gives them a 250 shield.')
      ],
      // Rows 2 to 4 never add a button: each changes one you already have (your shield, your Shove, your Hammer Throw).
      rig: [
        t('spikes', 'aggressive', 'Spiked Barrier', 'Shield: make them pay.', 'Whatever hits your barrier takes 30% of the blocked damage back.'),
        t('hardened', 'steady', 'Hardened Emitters', 'Shield: hold longer.', 'Your barrier has 2,500 health instead of 1,800 and recovers twice as fast.'),
        t('firingline', 'squad', 'Firing Line', 'Shield: shoot from behind me.', 'Squad members your barrier is covering deal 15% more damage.')
      ],
      implant: [
        t('piledriver', 'aggressive', 'Piledriver', 'Shove: hit like a wrecking ball.', 'Shove hits 40% harder, and anything you slam is stunned for 3s instead of 2.'),
        t('capacitor', 'steady', 'Capacitor Bank', 'Shove: more often.', 'Everything that fills Shield Energy fills it 50% faster.'),
        t('breathing', 'squad', 'Breathing Room', 'Shove: clear space for them.', 'Shove also shields every squad member within 8m of you for 50, up to 200 with a full bar.')
      ],
      util: [
        t('brand', 'aggressive', 'Brand', 'Throw: mark it for the squad.', 'Whatever your Hammer Throw hits takes 15% more damage from everyone for 6s.'),
        t('daze', 'steady', 'Daze', 'Throw: ring its bell.', 'Hammer Throw stuns a drone for 2s. The Foreman hits 25% softer for 4s instead.'),
        t('protector', 'squad', 'Protector', 'Throw: step in front.', 'Hammer Throw also shields whoever its targets were attacking for 250.')
      ]
    },
    healer: {
      theme: 'Field surgeon on a nanite link. Reach the squad wherever they stand: link them, burst them, drop a field under them.',
      tiers: ['Footwork', 'Link', 'Burst', 'Field'],
      // Shift changes how you move; rows 2 to 4 change the Link Gun's beam, Nanite Burst and Nano Field.
      boots: [
        t('stim', 'aggressive', 'Stim Leap', 'Leap in, heal hot.', 'Shift leaps 9m the way you are moving (8s). For 3s after you land, your heals are 30% stronger.'),
        t('skates', 'steady', 'Nanite Skates', 'Always in reach.', 'Shift gives you 50% more speed for 3s (8s), and you can keep beaming and shooting the whole time.'),
        t('medevac', 'squad', 'Medevac', 'Go to them.', 'Shift leaps to the ally nearest your crosshair (or the most hurt) within 25m and gives them a 150 shield (12s).')
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
      theme: 'Tournament champion with a Shock Rifle. Precision and highlights: land the port, pop the core, chain the combo.',
      tiers: ['Footwork', 'Beam', 'Core', 'Overcharge'],
      // Shift changes how you move; rows 2 to 4 change the Shock Rifle's beam, Shock Core and Overcharged Core.
      boots: [
        t('dodge', 'aggressive', 'Dodge Jump', 'Never stand still.', 'Shift dodges 7m the way you are moving (4s). Your next shot within 2s does 30% more.'),
        t('slide', 'steady', 'Kinetic Slide', 'Out of trouble, still shooting.', 'Shift slides 8m the way you are moving (5s), and you take 30% less damage for 2s after.'),
        t('coverdash', 'squad', 'Covering Dash', 'Get between them and it.', 'Shift dashes 9m the way you are moving (10s), and every squad member within 6m of where you land gets a 120 shield.')
      ],
      rig: [
        t('overload', 'aggressive', 'Overload', 'Beam: stay on it.', 'Every Shock Beam that hits the same enemy as your last one does 6% more, up to 30%. Popping a core keeps it; switching targets or missing starts it again.'),
        t('precision', 'steady', 'Precision Coils', 'Beam: the perfect shot.', 'Coolant ports take two and a half times a beam instead of double, and they\'re a little easier to hit (1.6m either side instead of 1.2).'),
        t('spotter', 'squad', 'Spotter', 'Beam: mark it for the squad.', 'Your hits mark the target for 5s: the whole squad deals 6% more damage to it.')
      ],
      implant: [
        t('volatile', 'aggressive', 'Volatile Core', 'Core: bigger bang.', 'Shock Combos are 8m across instead of 6 and hit 15% harder, but a core you don\'t pop only does half damage when it hits.'),
        t('magnet', 'steady', 'Magnetic Core', 'Core: it finds them.', 'Your cores curve gently towards the enemy nearest your crosshair when you fire, so they arrive where you meant them to.'),
        t('arclink', 'squad', 'Arc Link', 'Core: Charged for everyone.', 'Everything your combos Charge takes 10% more damage from the whole squad, not just your beams.')
      ],
      util: [
        t('supercharge', 'aggressive', 'Supercharge', 'Overcharge: all in.', 'The Overcharged Core needs all 4 Shock Charges, and it hits 30% harder.'),
        t('discharge', 'steady', 'Discharge Plating', 'Overcharge: armour up.', 'Firing an Overcharged Core shields you for 75 per Shock Charge it spends (up to 300) for 6s.'),
        t('empburst', 'squad', 'EMP Burst', 'Overcharge: crack it open.', 'Overcharged combos stun drones for 3s instead of 1.5 and hit an overcharge shield for 600 more, like the EMP.')
      ]
    },
    melee: {
      theme: 'Demolition berserker. Momentum, mess and noise. The longer you keep swinging, the worse it gets for them.',
      tiers: ['Momentum', 'Hide', 'Butchery', 'Mayhem'],
      // Shift is the Wrecker's Dash; Momentum changes it. The other rows change how you hit and how you survive.
      boots: [
        t('afterburner', 'aggressive', 'Afterburner', 'Dash in constantly.', 'Your Dash (Shift) is ready every 5s. For 3s after a Dash, every hit counts as from behind.'),
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
        t('flanker', 'steady', 'Flanker', 'Hold the back line.', 'Rip gives an extra Rev when it hits from behind.'),
        t('hamstring', 'squad', 'Hamstring', 'Blunt his hits for the tank.', 'Your hits from behind make the target deal 15% less damage for 4s.')
      ],
      util: [
        t('opportunist', 'aggressive', 'Thrill Seeker', 'Dodge late, strike hard.', 'Leave a red zone in its last second and you deal and heal 30% more for 6s.'),
        t('breaker', 'steady', 'Can Opener', 'Rip the shield open.', 'Your hits do 40% more to the overcharge shield. When it breaks, your Revs are full.'),
        t('warcry', 'squad', 'War Cry', 'Lead the charge.', 'Your Dash (Shift) gives every squad member within 10m 15% more damage for 5s.')
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
    dps: { weapon: 'shock', boots: 'dodge', rig: 'spotter', implant: 'magnet', util: 'empburst' },
    melee: { weapon: 'ripsaw', boots: 'escort', rig: 'pump', implant: 'flanker', util: 'breaker' }
  };
  /* One weapon per role. weaponsFor and playable stay so the armory and lobby read the same if a role ever gets a second. */
  function weaponsFor(role) { return KITS[role].weapons; }
  function playable(role) { return weaponsFor(role).length > 0; }
  function validGear(role, g) {
    var out = {}, has = function (list, id) { return list.some(function (x) { return x.id === id; }); };
    g = g || {};
    var offer = weaponsFor(role);
    out.weapon = has(offer, g.weapon) ? g.weapon : offer[0].id;
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
    bossHp: 194000, bossMelee: 515, bossSwing: 2.0, cleaveMult: 0.5,
    barrageEvery: 12, barrageDelay: 2.6, barrageR: 6, barrageDmg: 660,
    // Overcharge shield: break it inside the window or the whole room takes the pulse. Breaking it staggers him.
    // Overcharge: energy fills over overEvery seconds, then he walks to the middle, channels a shield and pulses the room.
    overEvery: 34, overShield: 11500, overWindow: 14, overDmg: 600, staggerDur: 7, staggerBonus: 1.3,
    // The pulse ramps while the shield holds (one entry per pulse, the last repeats): the longer the DPS take, the harder the healer works.
    pulseEvery: 2.25, pulseRamp: [30, 90, 180, 270, 360, 450], centreSpeed: 10,
    // Ground Pound: a boss slams the floor and a shockwave rolls out to the walls. Jump it (Space). Anything lying
    // on the floor (sludge, fallen sections) still gets you in the air; only the moving wave can be jumped.
    // Built, but off for the Foreman: he's a classic raid boss. A future boss turns it on.
    groundPound: false, waveEvery: 21, waveFirst: 16, waveWind: 1.5, waveSpeed: 11, waveW: 1.4, waveDmg: 300, jumpAir: 0.6,
    // The Foreman leaps onto someone (long warning), and in phase three tears up sections of floor.
    leapEvery: 24, leapDelay: 2.6, leapR: 7, leapDmg: 520, p3At: 0.25,
    // Ultimates fill in about a minute and are free to use.
    slamStagger: 3, ultRate: 1.7, ultStart: 40,
    collapseEvery: 15, collapseDelay: 3.0, collapseMax: 4, collapseDps: 240, collapseR0: 7, droneEveryP3: 40,
    chargeEvery: 19, chargeDelay: 1.8, chargeW: 4.5, chargeDmg: 380,
    // Crusher: a telegraphed tank buster on whoever the Foreman is fighting. Mitigate it or eat most of your health.
    // Impact Hammer: combo pacing, Aegis Dome size, Riot Charge recharge, and how the barrier holds and recovers.
    boltGcd: 0.6, lobTime: 0.6, sbeamGcd: 0.75, throwThreat: 30, swingGcd: 0.6, slamGcd: 0.9, comboReset: 2, aegisR: 9, aegisDur: 5, chargeCd: 10,
    // Shock Rifle. Cores fly along your aim; the beam detonates them (combo grows with distance flown, to +50% at 18m).
    // Coolant ports ring the Foreman: one opens at a time, all of them after his big moves and while he's staggered.
    sbeamDmg: 42, chargeStep: 0.2, beamCost: 3, chargeCost: 3, chargeRefund: 8, chargedMult: 1.4, chargedDur: 8, overclockMult: 1.3, surgeMult: 1.5,
    coreCd: 4, coreSpeed: 12, coreLife: 2.6, coreR: 6, comboDmg: 220, coreHit: 190,
    ocoreSpeed: 7, ocoreLife: 4.5, ocoreR: 8, ocoreBase: 180, ocorePer: 100, ocoreHit: 0.6, comboTravel: 18, comboTravelMult: 0.5,
    portMult: 2, portHalf: 1.2, portSpin: 0.22, portOpen: 2.5, portGap: 2.5, portBurst: 3,
    // Impact Hammer rotation: Bulwark (active mitigation from Shove), Riposte (a barrier block lights it), Sunder (Piston Shot).
    bulwarkCut: 0.85, bulwarkMax: 12, riposteDur: 6, riposteMult: 1.5, sunderDur: 12, sunderMult: 1.08,
    // Link Gun rotation: Nanite Tags (a HoT, and who Atonement reaches), Atonement (bolts on enemies heal the Tagged), Flux (proc).
    tagDur: 10, tagHot: 8, atone: 0.2, burstTagMult: 1.3, fluxEvery: 5, fluxDur: 10,
    // Ripsaw: Rip builds Revs, Saw Through / Shred spend them; Bleeds stack time on; Overdrive is the proc; Redline the burst.
    ripDmg: 40, ripGcd: 0.6, sawBase: 30, sawPer: 32, bleedDps: 25, bleedPer: 2.4, bleedCap: 14, shredBase: 40, shredPer: 45,
    overdriveChance: 0.06, redlineMult: 1.2, redlineGcd: 0.4, dashLen: 10, dashCd: 10,
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
  function critChance(S, p) {
    var c = CRIT_CHANCE;
    if (p.kit.weapons[p.weapon].id === 'sniper') c += 0.05 * Math.min(3, Math.floor(p.still || 0));   // Steady Aim
    if (p.trick) c = 1;                                                                              // Enforcers: every third Double Tap
    return c;
  }
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
      ents: [], telegraphs: [], events: [], domes: [], fields: [], blasts: [], cores: [], waves: [], nextId: 1,
      m: { p: {}, taken: {}, killers: {}, shields: { raised: 0, broken: 0 } },
      rng: makeRng(opts.seed || 12345),
      timers: { buster: 11, barrage: 8, over: 22, drone: 4, sludge: 7, charge: 13, leap: 30, collapse: 6, wave: TUNE.waveFirst },
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
        pips: 0, ult: TUNE.ultStart,
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
      amt *= src.pump > 0 ? 1.4 : 1;
      amt *= (src.boostNow || 1) * (src.opp > 0 ? 1.3 : 1) * (src.warcry > 0 ? 1.15 : 1);
      if (src.overclock > 0) amt *= TUNE.overclockMult;
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
    if (tgt.charged > 0 && tgt.arcOn) amt *= 1.1;   // Arc Link: Charged for the whole squad
    if (tgt.sundered > 0) amt *= TUNE.sunderMult;   // Sundered by a Piston Shot
    // A Shock Beam on an open coolant port (see portHit): the fireAbility sets weakNow for that one hit.
    var vent = src.kind === 'player' && !!src.weakNow;
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
    emit(S, { type: 'dmg', src: src.id, dst: tgt.id, amt: shown, label: label, crit: crit ? 1 : 0, sh: soaked > 0 ? 1 : 0, vent: vent ? 1 : 0 });
    var killed = tgt.hp <= 0;
    if (killed) {
      tgt.hp = 0; tgt.alive = false; tgt.cast = null; tgt.charging = null;
      emit(S, { type: 'death', id: tgt.id });
    }
    return dealt;
  }
  /* Nanite Tag: a small heal over time, and who your Atonement reaches. One Medic's Tag at a time per person. */
  function tagAlly(S, p, q) { if (!q.alive) return; if (!(q.tag > 0)) emit(S, { type: 'fx', fx: 'tag', src: q.id }); q.tag = TUNE.tagDur; q.tagBy = p.id; }
  /* An EMP hit on an overcharge shield: 600 straight off it. */
  function empShield(S, by, e) {
    if (!e.oshield || !(e.oshield.hp > 0)) return;
    var bonus = Math.min(e.oshield.hp, 600); e.oshield.hp -= bonus; met(S, by.id).shield += bonus;
    if (e.oshield.hp <= 0) breakShield(S, e, by);
  }
  /* The squad cracked the overcharge shield: the Foreman staggers and takes extra damage. */
  function breakShield(S, boss, by) {
    boss.oshield = null; boss.stagger = TUNE.staggerDur; boss.cast = null;
    S.m.shields.broken++;
    emit(S, { type: 'announce', text: 'SHIELD BROKEN', tone: 'good' });
    emit(S, { type: 'fx', fx: 'shieldbreak', src: boss.id });
    emit(S, { type: 'log', text: (by && by.name ? by.name + ' cracks' : 'The squad cracks') + ' the overcharge shield. The Foreman staggers: ' + Math.round((TUNE.staggerBonus - 1) * 100) + '% more damage for ' + TUNE.staggerDur + 's.' });
    players(S, true).forEach(function (q) {
      if (!T(q, 'breaker')) return;
      if (q.role === 'melee') q.pips = resOf(q).max;   // Can Opener: full Revs
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
    if (p.belt > 0) amt = amt * 0.5;
    if (p.bulwark > 0) amt = amt * TUNE.bulwarkCut;   // Impact Hammer Bulwark
    if (p.slideT > 0) amt = amt * 0.7;   // Kinetic Slide
    if (p.ironhide > 0) amt = amt * 0.6;   // Wrecker Iron Hide
    if (p.pump > 0) amt = amt * 0.75;
    if (srcId !== p.id && S.domes.some(function (d) { return Math.hypot(p.x - d.x, p.z - d.z) <= d.r; })) {
      // Aegis Dome: nothing gets through while it lasts.
      emit(S, { type: 'absorb', id: p.id, amt: Math.round(amt), barrier: 1 });
      return;
    }
    var BLOCKABLE = label !== 'Sludge' && label !== 'Collapse';
    var bsrc = !guarded && BLOCKABLE ? ent(S, srcId) : null;
    var wallBy = bsrc ? barrierFor(S, p, bsrc) : null;
    if (wallBy) {
      // Impact Hammer barrier: it soaks the hit for whoever it covers until it runs dry.
      var soakB = Math.min(wallBy.barrier, amt);
      wallBy.barrier -= soakB; amt -= soakB;
      addEnergy(wallBy, soakB / 25);
      if (T(wallBy, 'spikes') && bsrc.kind === 'enemy' && bsrc.alive && soakB > 0) damageEnemy(S, wallBy, bsrc, soakB * 0.3, 4, 'Spiked Barrier');
      emit(S, { type: 'absorb', id: p.id, amt: Math.round(soakB), barrier: 1, by: wallBy.id });
      if (bsrc.type === 'boss' && soakB >= 100 && wallBy.role === 'tank') {
        // Riposte (a Revenge proc): the next swing is a Slam, and Hammer Throw is ready again.
        if (!(wallBy.riposte > 0)) proc(S, wallBy, 'riposte', 'RIPOSTE');
        wallBy.riposte = TUNE.riposteDur; wallBy.cds.hthrow = 0;
      }
      if (wallBy.barrier <= 0) {
        wallBy.barrier = 0; wallBy.barrierUp = 0; wallBy.barrierBroken = TUNE.barrierBreak; wallBy.barrierRestT = 0;
        emit(S, { type: 'fx', fx: 'barrierbreak', src: wallBy.id });
        proc(S, wallBy, 'barrier', 'BARRIER BROKEN');
      }
      if (amt <= 0) return;
    }
    // Juggernaut plating: the Foreman's fists are tuned for the tank. Anyone else he catches gets flattened.
    if (p.role === 'tank' && (label === 'Hit' || label === 'Crusher' || label === 'Cleave')) amt = amt * 0.7;
    if (p.cloak > 0) amt = amt * 0.6;

    if (label === 'Cleave' && T(p, 'clamps')) amt = amt * 0.5;
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
    p.hp -= amt;
    emit(S, { type: 'dmg', src: srcId, dst: p.id, amt: amt, label: label });
    if (p.hp > 0 && T(p, 'pump') && p.hp < p.maxHp * 0.3 && (p.cds.pump || 0) <= 0) {
      p.pump = 6; p.cds.pump = 60;
      emit(S, { type: 'fx', fx: 'pump', src: p.id });
    }
    if (p.hp <= 0) {
      met(S, p.id).deaths++; S.m.killers[label] = (S.m.killers[label] || 0) + 1;
      p.lastDeath = { label: label, t: Math.round(S.t), log: (p.recent || []).slice() };
      p.hp = 0; p.alive = false; p.cast = null; p.queued = null; p.sludge = 0; p.hot = 0; p.shockCh = 0; p.surge = 0; p.tag = 0;
      emit(S, { type: 'death', id: p.id });
      emit(S, { type: 'log', id: p.id, text: p.name + ' is down.', you: "You're down." });
    }
  }
  /* For the death log: what kind of hit was it? avoid = step out of it, buster = the tank's big hit to mitigate,
     aoe = hits the whole squad (heal through it), debuff = on you until it's purged, squad = the shield wasn't broken,
     tank = the boss's fists on the tank (the job), aggro = the boss's fists on someone else, add = a drone on you. */
  var AVOID = { Shockwave: 1, Charge: 1, Collapse: 1, Leap: 1, Rocket: 1 };
  function hitKind(p, label, src) {
    if (AVOID[label]) return 'avoid';
    if (label === 'Cleave') return p.role === 'tank' ? 'tank' : 'avoid';
    if (label === 'Crusher') return 'buster';
    if (label === 'Sludge') return 'debuff';
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
      amt *= 0.85 + S.rng() * 0.3;
      if (S.rng() < critChance(S, src)) { amt *= CRIT_MULT; src.critThis = true; var hc = true; met(S, src.id).crits++; }
      met(S, src.id).hits++;
    }
    amt = Math.round(amt);   // whole points, so a squad client's copy matches the host exactly
    var before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amt);
    var eff = p.hp - before;
    if (src.kind === 'player') met(S, src.id).heal += eff;
    emit(S, { type: 'heal', src: src.id, dst: p.id, amt: Math.round(eff), label: label, crit: hc ? 1 : 0 });
    enemies(S).forEach(function (e) { addThreat(S, e, src.id, eff * 0.5); });
  }

  /* ---------- abilities ---------- */


  function shieldUp(q, src, amt, cap) { q.armor = Math.min(cap, Math.max(q.armor, 0) + amt); q.armorSrc = src.id; }
  function resolveTarget(S, p, ab) {
    if (ab.id === 'slam' && aimWeapon(p)) return inCone(S, p, ab.range, 0.5)[0] || null;   // the aimed Wrecking Slam: what's in front of you
    if (ab.kind === 'aim') return p;
    if (ab.id === 'hthrow' && aimWeapon(p)) {
      // Aimed tanks throw at whatever is in front of them, falling back to their target.
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
    if (ab.role === 'ult' && (p.ult || 0) < 100) out.state = 'locked';
    else if ((ab.cost && (p.pips || 0) < ab.cost) || (ab.needs && haveOf(p, ab) < needsOf(p, ab))) out.state = 'locked';
    else if (ab.id === 'ebarrier' && p.barrierBroken > 0) out.state = 'locked';
    else if (ab.id === 'combo' && p.barrierUp) out.state = 'locked';
    else if (ab.kind !== 'self' && ab.kind !== 'aim' && dist(p, tgt) > reach(p, ab) + (tgt.radius || 0)) out.state = 'range';
    else if ((p.cds[ab.id] || 0) > 0 || (ab.shareCd && (p.cds[ab.shareCd] || 0) > 0)) out.state = 'cd';
    else out.state = 'ok';
    return out;
  }

  /* What an ability needs in the class resource, after talents (Supercharge raises the Overcharged Core's). */
  function needsOf(p, ab) { return ab.id === 'ocore' && T(p, 'supercharge') ? 4 : ab.needs; }
  /* What a 'needs' ability is measured in: Shock Charges for the Overcharged Core, the class resource otherwise. */
  function haveOf(p, ab) { return ab.id === 'ocore' ? (p.shockCh || 0) : (p.pips || 0); }
  function fail(S, p, text) {
    if (p.human && !p.auto) emit(S, { type: 'error', id: p.id, text: text });
    return false;
  }

  function tryUse(S, p, idx) {
    var ab = abilitiesOf(p)[idx];
    if (!ab || !p.alive) return false;
    if (p.cast) return false;
    if ((p.cds[ab.id] || 0) > 0 || (ab.shareCd && (p.cds[ab.shareCd] || 0) > 0)) return fail(S, p, ab.name + ' is not ready');
    if (ab.role === 'ult' && (p.ult || 0) < 100) return fail(S, p, ab.name + ' is still charging');
    if ((ab.cost && (p.pips || 0) < ab.cost) || (ab.needs && haveOf(p, ab) < needsOf(p, ab))) return fail(S, p, ab.id === 'ocore' ? 'No Shock Charges: beam something' : 'Not enough ' + resOf(p).name);
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
    if (T(p, 'purgefield') && ab.id === 'field') p.cds.field = 16;   // a cleanse for a crowd costs you time
    if (tgt && tgt !== p && !p.moving) p.facing = Math.atan2(tgt.x - p.x, tgt.z - p.z);
    var back = BACKSTAB[ab.id] && tgt.kind === 'enemy' && (behind(p, tgt) || p.afterburn > 0) ? 1.5 : 1;
    // Momentum (Riot Charge, Dodge Jump): the next thing you hit with gets 30% more. Stim Leap's window is on heals instead.
    p.boostNow = p.momentum > 0 && ab.kind !== 'self' && ab.role !== 'ult' && !T(p, 'stim') ? 1.3 : 1;
    if (p.boostNow > 1) { p.momentum = 0; emit(S, { type: 'fx', fx: 'adren', src: p.id }); }
    if (ab.cost) p.pips = (p.pips || 0) - ab.cost;
    if (ab.role === 'ult') { p.ult = 0; met(S, p.id).ults++; }
    p.critThis = false;
    fireAbility(S, p, ab, tgt, G, back);
    p.boostNow = 1;
  }


  /* Is this spot on floor that has already fallen in phase three? */
  function fallen(S, e) { return S.telegraphs.some(function (g) { return g.shape === 'sector' && g.t >= g.dur && inTele(g, e); }); }
  /* Bots treat fallen floor like a wall: off it straight away (towards the middle, which never falls),
     and steer round it rather than walking in. */
  function avoidFallen(S, p, inp) {
    if (!S.telegraphs.length) return inp;
    var r = Math.sqrt(p.x * p.x + p.z * p.z) || 1;
    if (fallen(S, p)) { inp.mx = -p.x / r; inp.mz = -p.z / r; return inp; }
    // A live warning (not one we're already standing in, which the escape handles) is a wall too: don't walk back into it.
    var bad = function (pt) { return fallen(S, pt) || S.telegraphs.some(function (g) { return !g.down && g.t < g.dur && !inTele(g, p, 0.5) && inTele(g, pt, 0.8); }); };
    var mx = inp.mx || 0, mz = inp.mz || 0, len = Math.sqrt(mx * mx + mz * mz);
    if (len < 0.01) return inp;
    var a0 = Math.atan2(mx, mz), tries = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2];
    for (var i = 0; i < tries.length; i++) {
      var a = a0 + tries[i];
      if (!bad({ x: p.x + Math.sin(a) * 2.5, z: p.z + Math.cos(a) * 2.5 })) { inp.mx = Math.sin(a); inp.mz = Math.cos(a); return inp; }
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
  /* Hammer Throw talents: Brand marks it, Daze rings its bell, Protector shields whoever it was hitting. */
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
  function fireAbility(S, p, ab, tgt, G, back) {
    switch (ab.id) {
      /* ---- ultimates ---- */
      case 'slam':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'sawbig' });
        emit(S, { type: 'fx', fx: 'flak', src: p.id });
        proc(S, p, 'slam', 'WRECKING SLAM', 'all');
        if (tgt.alive) {
          tgt.stagger = Math.max(tgt.stagger || 0, TUNE.slamStagger);
          emit(S, { type: 'log', id: p.id, text: p.name + ' staggers ' + (tgt.type === 'boss' ? 'the Foreman' : 'a drone') + '. Everything you have.', you: 'Staggered for ' + TUNE.slamStagger + 's. Everything you have.' });
        }
        damageEnemy(S, p, tgt, 450, 2, 'Wrecking Slam!');
        break;

      case 'combo':
        // Swing, swing, slam. The chain resets after a pause.
        if (S.t - (p.comboT == null ? -99 : p.comboT) > TUNE.comboReset) p.comboStep = 0;
        var rip = p.riposte > 0;
        if (rip) { p.comboStep = 2; p.riposte = 0; }
        var step = p.comboStep || 0, slam = step === 2;
        var hitList = inCone(S, p, ab.range + (slam ? 1 : 0), slam ? 0.25 : 0.5);
        emit(S, { type: 'fx', fx: 'smash', src: p.id, pw: slam ? 1 : 0.3 });
        hitList.forEach(function (e) { damageEnemy(S, p, e, (slam ? 150 : 60) * (rip ? TUNE.riposteMult : 1), slam ? 8 : 6, rip ? 'Riposte!' : slam ? 'Slam!' : 'Swing'); });
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
        // Bulwark: a second of active mitigation for every 10 Energy spent, stacking on what's left.
        var wasBw = p.bulwark || 0;
        p.bulwark = Math.min(TUNE.bulwarkMax, wasBw + en * 10);
        if (!(wasBw > 0)) emit(S, { type: 'fx', fx: 'bulwark', src: p.id });
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
        pt.sundered = TUNE.sunderDur;
        damageEnemy(S, p, pt, 120, 14, 'Piston Shot');
        break;
      /* ---- Striker, aimed Shock Rifle ---- */
      case 'sbeam':
        p.gcd = TUNE.sbeamGcd;
        // Only a fresh click pops your own core; a held beam fires past it (p.popOk is set by shockHold; a bar click counts as fresh).
        var mine = p.popOk !== false ? coreInAim(S, p, ab.range) : null;
        if (mine) { detonate(S, p, mine); break; }   // your own core near the crosshair: the combo, free (Overload stacks survive it)
        var bcost = TUNE.beamCost + TUNE.chargeCost * (p.shockCh || 0);
        if ((p.pips || 0) < bcost) { p.gcd = 0.3; return fail(S, p, 'Not enough Capacitor: spend your charges'); }
        p.pips -= bcost;
        var sbt = softTarget(S, p, SHOCK_AIM);
        if (!sbt) { p.olN = 0; p.portRun = 0; emit(S, { type: 'fx', fx: 'boltmiss', src: p.id }); break; }
        // Overload: the same target again, a little harder each time.
        if (T(p, 'overload')) { var olWas = p.olN || 0; p.olN = p.olTo === sbt.id ? Math.min(5, olWas + 1) : 0; p.olTo = sbt.id; if (p.olN === 5 && olWas < 5) proc(S, p, 'overload', 'OVERLOADED'); }
        emit(S, { type: 'beam', src: p.id, dst: sbt.id, fx: 'shock' });
        var port = sbt.type === 'boss' ? portHit(S, p, sbt) : -1;
        var chg = sbt.charged > 0;
        p.weakNow = port >= 0;
        var pmult = T(p, 'precision') ? 2.5 : TUNE.portMult, olm = T(p, 'overload') ? 1 + 0.06 * (p.olN || 0) : 1;
        var chm = 1 + TUNE.chargeStep * (p.shockCh || 0);
        damageEnemy(S, p, sbt, TUNE.sbeamDmg * chm * (port >= 0 ? pmult : 1) * (chg ? TUNE.chargedMult : 1) * olm, 1, port >= 0 ? 'Weak Point!' : 'Shock Beam');
        p.weakNow = false;
        // Shock Charges: like Arcane Charges, each hit stacks one (a port two), up to four.
        var chWas = p.shockCh || 0;
        p.shockCh = Math.min(4, chWas + (port >= 0 ? 2 : 1));
        if (p.shockCh === 4 && chWas < 4) emit(S, { type: 'fx', fx: 'charges4', src: p.id });
        if (port >= 0) {
          met(S, p.id).ports = (met(S, p.id).ports || 0) + 1; emit(S, { type: 'fx', fx: 'port', src: sbt.id, pw: port });
          // Surge (Clearcasting): two port hits in a row and your next core is ready, fast and hard.
          p.portRun = (p.portRun || 0) + 1;
          if (p.portRun >= 2 && !(p.surge > 0)) { p.portRun = 0; p.surge = 10; p.cds.score = 0; proc(S, p, 'surge', 'SURGE'); }
        } else p.portRun = 0;
        break;
      case 'score':
        var sc0 = launchCore(S, p, p.facing, false);
        if (p.surge > 0) { sc0.surge = 1; sc0.sp *= 2; p.surge = 0; }
        break;
      case 'ocore':
        // Arcane Barrage: spend every Shock Charge, get Capacitor back for each.
        var spentC = p.shockCh || 0; p.shockCh = 0;
        p.pips = Math.min(resOf(p).max, (p.pips || 0) + TUNE.chargeRefund * spentC);
        if (T(p, 'discharge')) { shieldUp(p, p, spentC * 75, 600); p.kshieldT = Math.max(p.kshieldT || 0, 6); emit(S, { type: 'fx', fx: 'guard', src: p.id }); }
        p.cds.score = TUNE.coreCd;
        var oc0 = launchCore(S, p, p.facing, true, spentC);
        if (p.surge > 0) { oc0.surge = 1; oc0.sp *= 2; p.surge = 0; }
        if (spentC >= 4) proc(S, p, 'ocore', 'FULL OVERCHARGE');
        break;
      case 'overclock':
        // Arcane Surge / Evocation: the burn window.
        p.pips = resOf(p).max; p.shockCh = 4; p.overclock = 8;
        emit(S, { type: 'fx', fx: 'adren', src: p.id });
        proc(S, p, 'overclock', 'OVERCLOCK');
        break;
      case 'emp':
        var es = lobSpot(S, p, false);
        S.blasts.push({ x: es.x, z: es.z, t: TUNE.lobTime, by: p.id, kind: 'emp', r: 6 });
        emit(S, { type: 'fx', fx: 'lob', src: p.id, x2: Math.round(es.x * 10) / 10, z2: Math.round(es.z * 10) / 10, c: 'emp' });
        break;
      case 'kshield':
        shieldUp(p, p, 350, 700); p.kshieldT = 4; emit(S, { type: 'fx', fx: 'guard', src: p.id });
        break;
      case 'nova':
        // The instant payoff, then the sustained one: five cores fan out for you to pop.
        var nt = softTarget(S, p, { range: ab.range, dot: 0.85, enemy: true }) || ent(S, S.bossId);
        if (nt && nt.alive) {
          emit(S, { type: 'beam', src: p.id, dst: nt.id, fx: 'core' });
          damageEnemy(S, p, nt, 300, 1.5, 'Shock Nova!');
          shockBlast(S, p, nt, 300, 8, 3, 'Shock Nova!');
        }
        // Nova cores drift out for a second and a half, then hang in the air (they don't fizzle on contact).
        for (var nc = -2; nc <= 2; nc++) launchCore(S, p, p.facing + nc * 0.3, false, 0, 8).nova = 1;
        p.shockCh = 4;
        proc(S, p, 'nova', 'SHOCK NOVA', 'all');
        break;

      /* ---- Wrecker, aimed Ripsaw ---- */
      case 'wrip':
        p.gcd = p.redline > 0 ? TUNE.redlineGcd : TUNE.ripGcd;
        var rt = inCone(S, p, ab.range, 0.55)[0];
        emit(S, { type: 'fx', fx: 'smash', src: p.id, pw: 0.25 });
        if (!rt) { emit(S, { type: 'fx', fx: 'boltmiss', src: p.id }); break; }
        var rback = behind(p, rt) || p.afterburn > 0;
        emit(S, { type: 'beam', src: p.id, dst: rt.id, fx: 'saw' });
        damageEnemy(S, p, rt, TUNE.ripDmg * (rback ? 1.5 : 1) * (p.redline > 0 ? TUNE.redlineMult : 1), 1, rback ? 'Rip!' : 'Rip');
        p.pips = Math.min(5, (p.pips || 0) + (rback ? 2 : 1) + (rback && T(p, 'flanker') ? 1 : 0));
        if (rt.alive && rt.bleed > 0 && (p.critThis || S.rng() < TUNE.overdriveChance) && !(p.overdrive > 0)) { p.overdrive = 10; proc(S, p, 'overdrive', 'OVERDRIVE'); }
        break;
      case 'wsaw':
        var st2 = inCone(S, p, ab.range, 0.55)[0];
        if (!st2) { p.gcd = 0.3; return fail(S, p, 'Nothing in front of you'); }
        var revs = p.overdrive > 0 ? 5 : (p.pips || 0), od = p.overdrive > 0;
        p.pips = 0; p.overdrive = 0;
        var sback = behind(p, st2) || p.afterburn > 0;
        emit(S, { type: 'beam', src: p.id, dst: st2.id, fx: 'sawbig' });
        damageEnemy(S, p, st2, (TUNE.sawBase + TUNE.sawPer * revs) * (sback ? 1.5 : 1) * (p.redline > 0 ? TUNE.redlineMult : 1), 1, od ? 'Overdrive!' : revs >= 5 ? 'Saw Through!' : 'Saw Through');
        if (st2.alive) { st2.bleed = Math.min(TUNE.bleedCap, (st2.bleedBy === p.id ? st2.bleed || 0 : 0) + TUNE.bleedPer * revs); st2.bleedBy = p.id; st2.bleedDps = TUNE.bleedDps; }
        p.gcd = TUNE.ripGcd;
        break;
      case 'shred':
        var sr = p.pips || 0; p.pips = 0;
        emit(S, { type: 'fx', fx: 'flak', src: p.id });
        enemies(S).forEach(function (e) {
          if (dist(e, p) > ab.range + (e.radius || 0)) return;
          emit(S, { type: 'beam', src: p.id, dst: e.id, fx: 'saw' });
          damageEnemy(S, p, e, (TUNE.shredBase + TUNE.shredPer * sr) * (p.redline > 0 ? TUNE.redlineMult : 1), 1, sr >= 5 ? 'Shred!' : 'Shred');
          if (e.alive) { e.bleed = Math.min(TUNE.bleedCap, (e.bleedBy === p.id ? e.bleed || 0 : 0) + sr); e.bleedBy = p.id; e.bleedDps = TUNE.bleedDps; }
        });
        p.gcd = TUNE.ripGcd;
        break;
      case 'hook':
        var hk = softTarget(S, p, { range: ab.range, dot: 0.9, enemy: true });
        if (!hk) { p.cds.hook = 1; return fail(S, p, 'Nothing to hook'); }
        emit(S, { type: 'beam', src: p.id, dst: hk.id, fx: 'kick' });
        var hox = p.x, hoz = p.z;
        if (hk.type === 'boss') {
          p.x = hk.x - Math.sin(hk.facing) * (hk.radius + 1.5); p.z = hk.z - Math.cos(hk.facing) * (hk.radius + 1.5); clampArena(p);
          p.facing = Math.atan2(hk.x - p.x, hk.z - p.z);
          emit(S, { type: 'blink', id: p.id, fromX: hox, fromZ: hoz, fx: 'dash' });
        } else {
          var hl = dist(p, hk) || 1;
          hk.x = p.x + (hk.x - p.x) / hl * 2.2; hk.z = p.z + (hk.z - p.z) / hl * 2.2;
          hk.stagger = Math.max(hk.stagger || 0, 1);
          damageEnemy(S, p, hk, 60, 4, 'Chain Hook');
        }
        break;
      case 'redline':
        p.redline = 8; emit(S, { type: 'fx', fx: 'adren', src: p.id }); proc(S, p, 'redline', 'REDLINE');
        break;
      case 'ironhide':
        p.ironhide = 5; emit(S, { type: 'fx', fx: 'guard', src: p.id });
        break;

      /* ---- Medic, aimed Link Gun ---- */
      case 'lbolt':
        var lt = softTarget(S, p, BOLT_AIM);
        p.gcd = TUNE.boltGcd;
        if (!lt) { emit(S, { type: 'fx', fx: 'boltmiss', src: p.id }); break; }
        emit(S, { type: 'beam', src: p.id, dst: lt.id, fx: 'link' });
        if (lt.kind === 'player') {
          var fx2 = p.flux > 0; p.flux = 0;
          heal(S, p, lt, 70 * (fx2 ? 2 : 1), fx2 ? 'Flux!' : 'Link Bolt'); tagAlly(S, p, lt);
          if (fx2) {
            // Flux: the bolt jumps on to the next most hurt ally within 10m.
            var jump = players(S, true).filter(function (q) { return q !== lt && q !== p && q.hp < q.maxHp && dist(q, lt) <= 10; }).sort(function (a, c) { return a.hp / a.maxHp - c.hp / c.maxHp; })[0];
            if (jump) { emit(S, { type: 'beam', src: lt.id, dst: jump.id, fx: 'link' }); heal(S, p, jump, 70, 'Flux!'); tagAlly(S, p, jump); }
          }
        } else {
          var dealtL = damageEnemy(S, p, lt, 50, 1, 'Link Bolt') || 0;
          p.pips = Math.min(resOf(p).max, (p.pips || 0) + 7);
          // Atonement: everyone you've Tagged is healed for a share of the hit.
          players(S, true).forEach(function (q) { if (q.tag > 0 && q.tagBy === p.id) heal(S, p, q, dealtL * TUNE.atone, 'Atonement'); });
          p.fluxN = (p.fluxN || 0) + 1;
          if ((p.critThis || p.fluxN >= TUNE.fluxEvery) && !(p.flux > 0)) { p.fluxN = 0; p.flux = TUNE.fluxDur; proc(S, p, 'flux', 'FLUX'); }
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
          heal(S, p, q, 260 * (q.tag > 0 ? TUNE.burstTagMult : 1), 'Nanite Burst'); tagAlly(S, p, q);
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
      case 'hthrow':
        // A real attack with huge threat rather than a forced taunt, so it means the same thing against a player.
        var thrown = [tgt];
        var hop2 = enemies(S).filter(function (e) { return e !== tgt && dist(e, tgt) <= 10 + (e.radius || 0); }).sort(function (a2, c2) { return dist(a2, tgt) - dist(c2, tgt); })[0];
        if (hop2) thrown.push(hop2);
        thrown.forEach(function (e) { e.prevTarget = e.target; });
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'hammer' });
        damageEnemy(S, p, tgt, 180, TUNE.throwThreat, 'Hammer Throw');
        if (hop2) { emit(S, { type: 'beam', src: tgt.id, dst: hop2.id, fx: 'hammer' }); damageEnemy(S, p, hop2, 120, TUNE.throwThreat, 'Hammer Throw'); }
        emit(S, { type: 'fx', fx: 'throw', src: tgt.id });
        onTaunt(S, p, thrown);
        break;
      case 'belt':
        p.belt = 6; emit(S, { type: 'fx', fx: 'belt', src: p.id });
        break;

      case 'purge':
        emit(S, { type: 'beam', src: p.id, dst: tgt.id, fx: 'purge' });
        if (tgt.sludge > 0) { tgt.sludge = 0; emit(S, { type: 'log', text: p.name + ' purges ' + tgt.name + '.' }); }
        heal(S, p, tgt, 60, 'Purge');
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
      var hw0 = p.kit.weapons[p.weapon].id;
      if (hw0 === 'link') medicHold(S, p, inp.hold || [], dt); else if (hw0 === 'shock') shockHold(S, p, inp.hold || [], dt); else if (hw0 === 'ripsaw') sawHold(S, p, inp.hold || [], dt); else hammerHold(S, p, inp.hold || [], dt);
    }
    if (inp.jump && (p.role === 'tank' || (p.cds.leap || 0) <= 0)) spaceTalent(S, p);   // Shift: the class's movement ability
    if (inp.hop && !(p.air > 0) && !p.dash) { p.air = TUNE.jumpAir; emit(S, { type: 'fx', fx: 'jump', src: p.id }); }   // Space: a plain jump
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
          heal(S, p, bt, p.beamAcc, 'Link Beam'); tagAlly(S, p, bt);
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
  /* Aimed Shock Rifle held inputs. hold[0] keeps the beam firing. A right-click press fires a Shock Core a tenth of a
     second later, unless the left button goes down in that time: both pressed together (within 0.12s) is the
     Overcharged Core. Holding the beam and tapping right fires a normal core. */
  function shockHold(S, p, hold, dt) {
    var L = !!hold[0], R = !!hold[1];
    var at = function (id) { var l = abilitiesOf(p); for (var i = 0; i < l.length; i++) if (l[i].id === id) return i; return -1; };
    if (L && !p.lHeld) { p.lDownT = S.t; p.popPend = 0.35; }   // a fresh click can pop a core, if the beam fires in the next 0.35s
    if (p.popPend > 0) p.popPend -= dt;
    if (R && !p.rHeld) { p.rDownT = S.t; p.rPend = 0.1; }
    if (L && R && !p.chord && Math.abs((p.lDownT == null ? -9 : p.lDownT) - (p.rDownT == null ? -9 : p.rDownT)) <= 0.12) {
      p.chord = true; p.rPend = 0;
      tryUse(S, p, at('ocore'));
    }
    if (!L || !R) p.chord = false;
    p.lHeld = L; p.rHeld = R;
    if (p.rPend > 0) { p.rPend -= dt; if (p.rPend <= 0) { p.rPend = 0; if (!p.chord) tryUse(S, p, at('score')); } }
    if (L && !p.chord && p.gcd <= 0 && !p.cast) { p.popOk = p.popPend > 0; if (tryUse(S, p, 0)) p.popPend = 0; p.popOk = undefined; }
  }
  /* Ripsaw held inputs: hold[0] keeps Ripping. A right-click press is Saw Through a tenth of a second later, unless
     the left button goes down in that time: both together (within 0.12s) is Shred. */
  function sawHold(S, p, hold, dt) {
    var L = !!hold[0], R = !!hold[1];
    var at = function (id) { var l = abilitiesOf(p); for (var i = 0; i < l.length; i++) if (l[i].id === id) return i; return -1; };
    if (L && !p.lHeld) p.lDownT = S.t;
    if (R && !p.rHeld) { p.rDownT = S.t; p.rPend = 0.1; }
    if (L && R && !p.chord && Math.abs((p.lDownT == null ? -9 : p.lDownT) - (p.rDownT == null ? -9 : p.rDownT)) <= 0.12) { p.chord = true; p.rPend = 0; tryUse(S, p, at('shred')); }
    if (!L || !R) p.chord = false;
    p.lHeld = L; p.rHeld = R;
    if (p.rPend > 0) { p.rPend -= dt; if (p.rPend <= 0) { p.rPend = 0; if (!p.chord) tryUse(S, p, at('wsaw')); } }
    if (L && !p.chord && p.gcd <= 0 && !p.cast) tryUse(S, p, 0);
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
    return { mx: h.mx, mz: h.mz, ability: raw.ability, target: raw.target, jump: raw.jump, hop: raw.hop, aim: raw.aim, hold: raw.hold, ad: raw.ad };
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
  /* Shift (the movement key, inp.jump in the sim for history's sake) does whatever this class's tier 1 talent says: Riot Charge, Stim Leap, Medevac or Dodge Jump. */
  /* Riot Charge: every Juggernaut's gap closer on Shift. Tier 1 talents change it (Ram, Twin Thrusters, Intercept).
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
    if (T(p, 'slide')) { var d3 = dir(); land(p.x + d3[0] * 8, p.z + d3[1] * 8, 5, 0, 'leap'); p.slideT = 2; return; }
    if (T(p, 'coverdash')) {
      var d4 = dir(); land(p.x + d4[0] * 9, p.z + d4[1] * 9, 10, 0, 'leap');
      players(S, true).forEach(function (q) { if (q !== p && dist(q, p) <= 6) { shieldUp(q, p, 120, 450); emit(S, { type: 'fx', fx: 'guard', src: q.id }); } });
      return;
    }
    if (T(p, 'stim')) { var d2 = dir(); land(p.x + d2[0] * 9, p.z + d2[1] * 9, 8, 3, 'leap'); return; }
    if (T(p, 'skates')) { p.cds.leap = 8; p.skates = 3; emit(S, { type: 'fx', fx: 'boost', src: p.id }); return; }
    if (p.role === 'tank') { riotCharge(S, p, ox, oz); return; }
    if (p.role === 'melee' && aimWeapon(p)) {
      // The Wrecker's Dash: along your aim (or the way you're moving if you're not aiming).
      var da = typeof p.aimIn === 'number' ? [Math.sin(p.aimIn), Math.cos(p.aimIn)] : dir();
      land(p.x + da[0] * TUNE.dashLen, p.z + da[1] * TUNE.dashLen, T(p, 'afterburner') ? 5 : TUNE.dashCd, 0, 'dash');
      if (T(p, 'afterburner')) p.afterburn = 3;
      if (T(p, 'warcry')) { players(S, true).forEach(function (q) { if (dist(q, p) <= 10) q.warcry = 5; }); proc(S, p, 'warcry', 'WAR CRY', 'all'); }
      return;
    }
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
    if (p.alive && resOf(p).regen) p.pips = Math.max(0, Math.min(resOf(p).max, (p.pips || 0) + resOf(p).regen * (p.overclock > 0 ? 2 : 1) * dt));
    if (p.kshieldT > 0 && p.kshieldT - dt <= 0 && p.armorSrc === p.id) p.armor = 0;   // Kinetic Shield fades after 4s
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
    ['belt', 'pump', 'afterburn', 'momentum', 'opp', 'warcry', 'barrierHoldT', 'barrierBroken', 'beamHoldT', 'cloak', 'storm', 'skates', 'air', 'kshieldT', 'slideT', 'surge', 'overclock', 'bulwark', 'riposte', 'flux', 'overdrive', 'redline', 'ironhide'].forEach(function (f) { if (p[f] > 0) p[f] = Math.max(0, p[f] - dt); });
    if (p.tag > 0) {
      // Nanite Tag heal over time, a beat at a time.
      var tsrc = ent(S, p.tagBy), tstep = Math.min(dt, p.tag); p.tag -= dt;
      p.tagAcc = (p.tagAcc || 0) + TUNE.tagHot * tstep;
      if (p.tagAcc >= 15 || p.tag <= 0) { if (tsrc && tsrc.alive) heal(S, tsrc, p, p.tagAcc, 'Nanite Tag'); p.tagAcc = 0; }
      if (p.tag <= 0 || !tsrc || !tsrc.alive) p.tag = 0;
    }
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
      e.bleedAcc = (e.bleedAcc || 0) + (e.bleedDps || 28) * bstep;
      if (e.bleedAcc >= 28 || e.bleed <= 0) { var bsrc = ent(S, e.bleedBy); if (bsrc) damageEnemy(S, bsrc, e, e.bleedAcc, 1, 'Bleed'); e.bleedAcc = 0; }
      if (!e.alive) return;
    }
    if (e.charged > 0) e.charged = Math.max(0, e.charged - dt);
    if (e.sundered > 0) e.sundered = Math.max(0, e.sundered - dt);
    if (e.type === 'boss') { e.portRot = (e.portRot || 0) + TUNE.portSpin * dt; if (e.portBurst > 0) e.portBurst -= dt; }
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
          burstPorts(S, boss);
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

    // Ground Pound: he rears up, slams the floor and a shockwave rolls out to the walls. Jump it.
    if (TUNE.groundPound && !boss.cast && !boss.charging && !boss.oshield && !boss.goCentre && !(boss.stagger > 0)) {
      T.wave -= dt;
      if (T.wave <= 0) {
        T.wave = TUNE.waveEvery * (S.phase === 3 ? 0.8 : 1);
        boss.cast = { name: 'Ground Pound', t: 0, dur: TUNE.waveWind, done: function () {
          if (!boss.alive) return;
          S.waves.push({ id: S.nextId++, x: boss.x, z: boss.z, r: boss.radius, hit: {} });
          emit(S, { type: 'fx', fx: 'pound', src: boss.id });
          burstPorts(S, boss);
        } };
        emit(S, { type: 'fx', fx: 'poundup', src: boss.id });
        emit(S, { type: 'log', text: 'The Foreman rears up for a Ground Pound. Jump the shockwave (Space).' });
      }
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
        var pr = TUNE.pulseRamp, pn = boss.oshield.pulses = (boss.oshield.pulses || 0) + 1;
        var pd = pr[Math.min(pn, pr.length) - 1];
        emit(S, { type: 'fx', fx: 'pulse', src: boss.id, pw: pd });
        players(S, true).forEach(function (p) { damagePlayer(S, boss.id, p, pd, 'Overcharge Pulse'); });
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

  function tickWorld(S, dt) {
    // Ground Pound shockwaves: a ring rolling out from the slam. Anyone on the floor when it passes is hit; in the air, it goes under you.
    for (var wi = S.waves.length - 1; wi >= 0; wi--) {
      var wv = S.waves[wi], r0 = wv.r; wv.r += TUNE.waveSpeed * dt;
      players(S, true).forEach(function (q) {
        if (wv.hit[q.id]) return;
        var d = Math.hypot(q.x - wv.x, q.z - wv.z);
        if (d + TUNE.waveW / 2 < r0 || d - TUNE.waveW / 2 > wv.r) return;   // the wave hasn't reached them or is past them
        wv.hit[q.id] = 1;
        if (q.air > 0) { q.jumped = (q.jumped || 0) + 1; met(S, q.id).jumped = (met(S, q.id).jumped || 0) + 1; return; }
        damagePlayer(S, S.bossId, q, TUNE.waveDmg, 'Shockwave');
      });
      if (wv.r > ARENA_R + 2) S.waves.splice(wi, 1);
    }
    // Shock Cores: fly along their line; a normal one fizzles on the first enemy it touches, a Nova core hangs in the air.
    for (var ci = S.cores.length - 1; ci >= 0; ci--) {
      var c = S.cores[ci], cby = ent(S, c.by); c.t += dt;
      var sp = c.nova ? (c.t < 1.5 ? 6 : 0) : c.sp;
      var hm2 = c.home ? ent(S, c.home) : null;
      if (hm2 && hm2.alive) {
        // Magnetic Core: turn towards the target, at most 1.2 radians a second.
        var want = Math.atan2(hm2.x - c.x, hm2.z - c.z), have = Math.atan2(c.dx, c.dz), dA = want - have;
        while (dA > Math.PI) dA -= Math.PI * 2; while (dA < -Math.PI) dA += Math.PI * 2;
        have += Math.max(-1.2 * dt, Math.min(1.2 * dt, dA)); c.dx = Math.sin(have); c.dz = Math.cos(have);
      }
      c.x += c.dx * sp * dt; c.z += c.dz * sp * dt; c.flown += sp * dt;
      var gone = c.t >= c.life || Math.hypot(c.x, c.z) > ARENA_R - 0.5 || !cby || !cby.alive;
      if (!gone && !c.nova) {
        var touch = enemies(S).filter(function (e) { return Math.hypot(e.x - c.x, e.z - c.z) <= (e.radius || 1) + 0.6; })[0];
        if (touch) {
          // Not popped: it lands as a single-target hit and Charges what it hits (no splash). Volatile Core halves the hit.
          var hitAmt = (c.big ? (TUNE.ocoreBase + TUNE.ocorePer * c.spent) * TUNE.ocoreHit : TUNE.coreHit) * (c.surge ? TUNE.surgeMult : 1);
          damageEnemy(S, cby, touch, hitAmt * (T(cby, 'volatile') ? 0.5 : 1), 1, c.big ? 'Overcharged Core' : 'Shock Core');
          if (touch.alive) { touch.charged = TUNE.chargedDur; touch.chargedBy = cby.id; touch.arcOn = T(cby, 'arclink'); }   // a direct hit Charges too
          emit(S, { type: 'fx', fx: 'corehit', src: touch.id });
          gone = true;
        }
      }
      if (gone) { S.cores.splice(ci, 1); emit(S, { type: 'fx', fx: 'fizzle', x2: Math.round(c.x * 10) / 10, z2: Math.round(c.z * 10) / 10, src: c.by }); }
    }
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
    for (var bi2 = S.blasts.length - 1; bi2 >= 0; bi2--) {
      // EMP Grenade: lands, then pops. Drones go down, an overcharge shield takes a big hit.
      var bl = S.blasts[bi2], bby = ent(S, bl.by); bl.t -= dt;
      if (bl.t > 0) continue;
      S.blasts.splice(bi2, 1);
      emit(S, { type: 'fx', fx: 'emp', src: bl.by, x2: bl.x, z2: bl.z });
      if (!bby) continue;
      enemies(S).forEach(function (e) {
        if (Math.hypot(e.x - bl.x, e.z - bl.z) > bl.r + (e.radius || 0)) return;
        empShield(S, bby, e);
        damageEnemy(S, bby, e, 200, 4, 'EMP');
        if (e.alive && e.type !== 'boss') e.stagger = Math.max(e.stagger || 0, 2.5);
      });
    }
    players(S, true).forEach(function (q) {
      if (!(q.storm > 0)) return;
      // Link Storm: the beam on everyone in reach.
      q.stormAcc = (q.stormAcc || 0) + dt;
      if (q.stormAcc >= 0.5) { players(S, true).forEach(function (a) { if (dist(a, q) <= 25) heal(S, q, a, 150 * q.stormAcc, 'Link Storm'); }); q.stormAcc = 0; }
    });
    var boss = ent(S, S.bossId);
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
        emit(S, { type: 'fx', fx: 'charge', src: boss.id }); burstPorts(S, boss);
        players(S, true).forEach(function (p) {
          if (!inTele(g, p)) return;
          damagePlayer(S, boss.id, p, g.dmg, 'Charge');
          if (T(p, 'clamps')) return;   // Mag-Clamps hold their ground
          var e = escapeDir(g, p); p.x += e.x * 6; p.z += e.z * 6; clampArena(p); p.cast = null;
          emit(S, { type: 'knock', id: p.id });
        });
      } else if (g.leap) {
        if (!boss.alive) continue;
        boss.cast = null;
        boss.charging = { x1: boss.x, z1: boss.z, x2: g.x, z2: g.z, t: 0, dur: 0.5 };
        emit(S, { type: 'boom', x: g.x, z: g.z, r: g.r });
        emit(S, { type: 'fx', fx: 'leap', src: boss.id }); burstPorts(S, boss);
        players(S, true).forEach(function (p) {
          if (!inTele(g, p)) return;
          damagePlayer(S, boss.id, p, g.dmg, 'Leap');
          if (T(p, 'clamps')) return;
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
    var BLD = p.kit.weapons[p.weapon].abilities[0];

    // Jump the Ground Pound shockwave: each bot picks its moment per wave, sometimes badly.
    S.waves.forEach(function (wv) {
      var gap = Math.hypot(p.x - wv.x, p.z - wv.z) - wv.r;
      if (gap < -1) return;
      b.hop = b.hop || {};
      if (b.hop[wv.id] == null) b.hop[wv.id] = S.rng() < 0.08 * slow ? 6.5 : 0.3 + S.rng() * 3.6 * slow;
      if (gap <= b.hop[wv.id] && !(p.air > 0)) inp.hop = true;
    });
    // Step out of telegraphs after a short reaction delay.
    var inside = null;
    S.telegraphs.forEach(function (g) { if (!g.down && inTele(g, p, 1.2)) inside = g; });   // fallen floor: see avoidFallen
    if (inside) {
      b.danger += dt;
      if (b.danger > b.react * slow) {
        var e = escapeDir(inside, p); inp.mx = e.x; inp.mz = e.z; if (T(p, 'dodge') || T(p, 'stim') || T(p, 'slide') || T(p, 'coverdash')) inp.jump = true;
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
      if (canAct && p.gcd <= 0) { inp.ability = 0; b.think = 0.15 + S.rng() * 0.35; }
      return inp;
    }

    // Free use: each class spends its ultimate when it would do the most.
    var ULT = abil.findIndex(function (a) { return a.role === 'ult'; }), ultUp = (p.ult || 0) >= 100, bc = boss.alive && boss.cast;
    var osh = boss.alive && boss.oshield, lateShield = osh && osh.t > osh.dur - 1.6 && osh.hp > osh.max * 0.2;
    if (ultUp && boss.alive && S.t > 8) {
      if (p.role === 'tank' && (lateShield || p.hp < p.maxHp * 0.5 || S.telegraphs.some(function (g) { return g.leap; }))) { inp.ability = ULT; return inp; }
      if (p.role === 'healer') {
        var squadNow = players(S, true);
        if (squadNow.filter(function (q) { return q.hp < q.maxHp * 0.6; }).length >= 2 || squadNow.some(function (q) { return q.hp < q.maxHp * 0.3; })) { inp.ability = ULT; return inp; }
      }
      if (p.role === 'dps' && (osh || boss.stagger > 0 || p.overclock > 0)) { inp.target = boss.id; inp.aim = Math.atan2(boss.x - p.x, boss.z - p.z); inp.ability = ULT; return inp; }
      if (p.role === 'melee' && !osh && !(boss.stagger > 0) && !bc && dist(p, boss) <= 7 + boss.radius && b.think <= 0) { inp.target = boss.id; inp.aim = Math.atan2(boss.x - p.x, boss.z - p.z); inp.ability = ULT; return inp; }
    }
    var domeNear = S.domes.filter(function (dm) { return dm.t > 1 && Math.hypot(p.x - dm.x, p.z - dm.z) > dm.r - 1.5 && Math.hypot(p.x - dm.x, p.z - dm.z) < 22; })[0];
    if (domeNear && p.role !== 'tank') { moveTo(domeNear.x, domeNear.z); return inp; }
    if (p.role === 'tank') {
      if (!foes.length) return inp;
      var main = boss.alive ? boss : foes[0];
      inp.target = main.id;
      var d = dist(p, main) - (main.radius || 0), heat = p.pips || 0;
      if (d > 3.5) moveTo(main.x, main.z);
      if (d > 10 && (p.charges || 0) >= 1 && !S.telegraphs.length) { inp.jump = true; inp.aim = Math.atan2(main.x - p.x, main.z - p.z); }   // charge in, never back into a telegraph
      var fire0 = function (i, t) { inp.target = (t || main).id; inp.ability = i; b.think = 0.15 + S.rng() * 0.35; return inp; };
      if (W === 'hammer') inp.aim = Math.atan2(main.x - p.x, main.z - p.z);
      if (b.lazy) { if (canAct && p.gcd <= 0) fire0(0); return inp; }   // the one-button tank, for the report
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
        if (looseH.length && ready('hthrow') && dist(p, looseH[0]) <= 30 + (looseH[0].radius || 0)) { aimAt(looseH[0]); return fire0(idx('hthrow'), looseH[0]); }
        if (looseH.length && ready('piston') && dist(p, looseH[0]) > 8 && dist(p, looseH[0]) <= 22 + (looseH[0].radius || 0)) { aimAt(looseH[0]); return fire0(idx('piston'), looseH[0]); }
        if (looseH.length && dist(p, looseH[0]) > 12 && (p.charges || 0) >= 1 && !S.telegraphs.length) { inp.jump = true; aimAt(looseH[0]); return inp; }
        // Shove when the bar is (nearly) full, or a little earlier if there's a drone in the arc to throw.
        var arcAdds = inCone(S, p, 8, 0.4).filter(function (f) { return f.type !== 'boss'; }).length;
        if (heat >= 95 - (slow > 1 ? 10 : 0) || (heat >= 60 && arcAdds >= 1) || (heat >= 40 && !(p.bulwark > 1.5 * slow))) { if (d <= 7) { inp.hold = [true, true]; b.think = 0.2; return inp; } }
        // Keep the Foreman Sundered for the squad.
        if (boss.alive && main === boss && ready('piston') && !(boss.sundered > 2 * slow) && canAct && dist(p, boss) <= 22 + boss.radius) { aimAt(boss); return fire0(idx('piston'), boss); }
        if (d <= 6 && canAct) { inp.hold = [true, false]; b.think = 0.05 + S.rng() * 0.2 * slow; }
        return inp;
      }
    }

    if (p.role === 'dps' || p.role === 'melee') {
      if (!foes.length) return inp;
      var dr = foes.filter(function (f) { return f.type === 'drone'; }).sort(function (a, c) { return a.hp - c.hp; });
      var tg = (boss.alive && boss.oshield) ? boss : (dr[0] || boss);
      inp.target = tg.id;
      return p.role === 'dps' ? strikerBot(S, p, inp, b, tg, boss, foes, canAct, idx, ready, slow) : wreckerBot(S, p, inp, b, tg, boss, foes, canAct, idx, ready, slow);
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
    return medicBot(S, p, inp, b, allies, low, boss, canAct, idx, ready, slow);
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
      else if (others.some(function (a) { return !(a.tag > 1.5) && a.hp < a.maxHp - 1 && dist(p, a) <= 33; })) {
        // Keep the squad Tagged so shooting the Foreman heals them (Atonement).
        var untag = others.filter(function (a) { return !(a.tag > 1.5) && a.hp < a.maxHp - 1 && dist(p, a) <= 33; })[0];
        m.aim = untag.id; m.hold = [true, false];
      }
      else if (boss.alive) { m.aim = boss.id; m.hold = [true, false]; }
    }
    var at = m.aim != null ? ent(S, m.aim) : null;
    if (at) { inp.aim = Math.atan2(at.x - p.x, at.z - p.z); inp.target = at.id; }
    inp.hold = m.hold.slice();
    return inp;
  }

  /* The aimed Striker bot, playing the Arcane-style loop: keep the target Charged with a core (direct hit on one target,
     popped on a crowd), build Shock Charges with beams aimed at open ports, burn at four, spend them on an Overcharged
     Core when the Capacitor runs low or there's a window, Overclock into staggers and shields, fire Surge cores at once. */
  function strikerBot(S, p, inp, b, tg, boss, foes, canAct, idx, ready, slow) {
    var m = b.str || (b.str = { hold: [false, false], aim: null, port: -1, err: 0, popErr: 0, coreTgt: null, popIt: false });
    function moveTo(x, z) { inp.mx = x - p.x; inp.mz = z - p.z; }
    if (tg.type === 'boss' && !tg.oshield && !tg.goCentre) {
      var side = (p.id % 2 ? 1 : -1) * 1.9;
      var spot = { x: tg.x + Math.sin(tg.facing + side) * 16, z: tg.z + Math.cos(tg.facing + side) * 16 }; clampArena(spot, 2);
      if (Math.hypot(spot.x - p.x, spot.z - p.z) > 2.5) moveTo(spot.x, spot.z);
    } else if (dist(p, tg) > 22) moveTo(tg.x, tg.z);
    var cap = p.pips || 0, ch = p.shockCh || 0, cost = TUNE.beamCost + TUNE.chargeCost * ch;
    var drones = foes.filter(function (f) { return f.type === 'drone' && dist(p, f) <= 25; });
    var mine = S.cores.filter(function (c) { return c.by === p.id; });
    var crowd = foes.filter(function (f) { return f !== tg && dist(f, tg) <= 7; }).length >= 1;
    if (canAct) {
      b.think = 0.25 + S.rng() * 0.35;
      m.aim = tg.id; m.hold = [cap >= cost, false]; m.port = -1;
      var wait = S.t < 4 || (boss.alive && boss.target === p.id);
      var hot = boss.alive && (boss.oshield || boss.stagger > 0 || boss.portBurst > 0);
      var coreUp = !mine.length && ready('score') && dist(p, tg) <= 26;
      var needOc = T(p, 'supercharge') ? 4 : 1;
      var chord = function () { if (p.lHeld || p.rHeld) { m.hold = [false, false]; b.think = 0.05; } else { m.hold = [true, true]; m.coreTgt = tg.id; m.popIt = true; m.popErr = (S.rng() - 0.3) * 2 * slow; } };
      if (p.hp < p.maxHp * 0.45 && ready('kshield')) inp.ability = idx('kshield');
      else if (wait) m.hold = S.t < 1.5 ? [false, false] : [cap >= cost, false];
      else if (ready('emp') && (drones.length || (boss.alive && boss.oshield))) {
        var et = drones[0] || boss; m.aim = et.id; inp.ad = Math.max(2, dist(p, et) - (et.type === 'boss' ? et.radius : 0)); inp.ability = idx('emp');
      }
      else if (ready('overclock') && hot && ch < 4) inp.ability = idx('overclock');
      else if (coreUp && p.surge > 0) { m.hold = [false, true]; m.coreTgt = tg.id; m.popIt = crowd; m.popErr = (S.rng() - 0.3) * 2 * slow; }
      else if (coreUp && ch >= needOc && (cap < cost + 3 || (ch >= 4 && cap < 45) || (crowd && ch >= 3) || (hot && ch >= 4 && !(p.overclock > 0)))) chord();
      else if (coreUp && (!(tg.charged > 2.5) || crowd)) { m.hold = [cap >= cost, true]; m.coreTgt = tg.id; m.popIt = crowd; m.popErr = (S.rng() - 0.3) * 2 * slow; }
      if (m.hold[0] && !m.hold[1] && m.aim === tg.id && tg.type === 'boss') {
        // Go for an open port that faces me, with a wobble.
        for (var i = 0; i < 3; i++) {
          var pa = portAngle(tg, i), px = tg.x + Math.sin(pa) * tg.radius, pz = tg.z + Math.cos(pa) * tg.radius;
          if (portOpen(S, tg, i) && ((p.x - px) * Math.sin(pa) + (p.z - pz) * Math.cos(pa)) > 0.3 * Math.hypot(p.x - px, p.z - pz)) { m.port = i; m.err = (S.rng() - 0.5) * 0.36 * slow; break; }
        }
      }
    }
    // A core I mean to pop (a crowd, an Overcharged one, Nova cores): let go of the beam, then click on it as it arrives.
    var popNow = null;
    if (mine.length) {
      var ct = m.coreTgt != null ? ent(S, m.coreTgt) : null;
      mine.forEach(function (c) {
        if (popNow || !(c.big || c.nova || m.popIt)) return;
        var reach = ct && ct.alive ? Math.hypot(c.x - ct.x, c.z - ct.z) - (ct.radius || 1) : 99;
        if (c.nova ? c.t > 1.6 + Math.abs(m.popErr) * 0.3 : (reach <= (c.big ? 3.5 : 2.5) + m.popErr || c.t > c.life - 0.35)) popNow = c;
      });
    }
    if (popNow) {
      inp.aim = Math.atan2(popNow.x - p.x, popNow.z - p.z); inp.target = tg.id;
      inp.hold = p.lHeld ? [false, false] : [true, false];
      return inp;
    }
    var at = m.aim != null ? ent(S, m.aim) : null;
    if (!at || !at.alive) at = tg;
    inp.aim = Math.atan2(at.x - p.x, at.z - p.z); inp.target = at.id;
    if (m.port >= 0 && at.type === 'boss' && portOpen(S, at, m.port)) {
      var pa2 = portAngle(at, m.port);
      inp.aim = Math.atan2(at.x + Math.sin(pa2) * at.radius - p.x, at.z + Math.cos(pa2) * at.radius - p.z) + m.err;
    }
    inp.hold = m.hold.slice();
    if (inp.hold[0] && (p.pips || 0) < TUNE.beamCost + TUNE.chargeCost * (p.shockCh || 0)) inp.hold[0] = false;   // out of Capacitor: wait
    return inp;
  }

  /* The aimed Wrecker bot, playing the Rogue loop: get behind the Foreman (Chain Hook or Dash in), Rip to build Revs,
     Saw Through at five (or four with the Bleed running low, or at once on Overdrive), Shred a pile of drones,
     Redline on cooldown into the fight, Iron Hide when it's getting bad. */
  function wreckerBot(S, p, inp, b, tg, boss, foes, canAct, idx, ready, slow) {
    var m = b.wr || (b.wr = { hold: [false, false] });
    var aimAt = function (t) { inp.aim = Math.atan2(t.x - p.x, t.z - p.z); };
    var spot = tg.type === 'boss' ? { x: tg.x - Math.sin(tg.facing) * (tg.radius + 1.6), z: tg.z - Math.cos(tg.facing) * (tg.radius + 1.6) } : { x: tg.x, z: tg.z };
    var dm = dist(p, tg) - (tg.radius || 0), off = Math.hypot(spot.x - p.x, spot.z - p.z);
    aimAt(tg); inp.target = tg.id;
    if (dm > 9 && ready('hook') && canAct && dm < 22) { inp.ability = idx('hook'); b.think = 0.3; return inp; }
    if (dm > 8 && !((p.cds.leap || 0) > 0) && !S.telegraphs.length) inp.jump = true;
    if (off > 1.2 && (tg.type === 'boss' || dm > 3)) { inp.mx = spot.x - p.x; inp.mz = spot.z - p.z; }
    if (canAct) {
      b.think = 0.2 + S.rng() * 0.3 * slow;
      var revs = p.pips || 0, near = foes.filter(function (f) { return dist(f, p) <= 5 + (f.radius || 0); }).length;
      m.hold = [true, false];
      if (p.hp < p.maxHp * 0.4 && ready('ironhide')) inp.ability = idx('ironhide');
      else if (ready('redline') && boss.alive && S.t > 6 && dm < 4) inp.ability = idx('redline');
      else if (near >= 2 && revs >= 3) { if (p.lHeld || p.rHeld) { m.hold = [false, false]; b.think = 0.05; } else m.hold = [true, true]; }
      else if (dm < 4.5 && (p.overdrive > 0 || revs >= 5 || (revs >= 4 && !(tg.bleed > 2)))) { if (p.rHeld) { m.hold = [true, false]; b.think = 0.05; } else m.hold = [true, true]; }
    }
    inp.hold = m.hold.slice();
    return inp;
  }

  /* ---------- main step ---------- */

  /* inputs: { [playerId]: { mx, mz, ability, target, jump } }. A bare input object means the solo player. */
  function step(S, dt, inputs) {
    if (S.result) return;
    inputs = inputs || {};
    if ('mx' in inputs || 'ability' in inputs || 'target' in inputs || 'jump' in inputs || 'hop' in inputs || 'hold' in inputs || 'aim' in inputs) { var one = {}; one[S.humanId] = inputs; inputs = one; }
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
    if (S.domes.length) snap.dm = S.domes.map(function (d) { return [r1(d.x), r1(d.z), d.r, r1(d.t)]; });
    if (S.fields.length) snap.fl = S.fields.map(function (d) { return [r1(d.x), r1(d.z), d.r, r1(d.t)]; });
    if (S.cores.length) snap.co = S.cores.map(function (c) { return [c.id, c.by, r1(c.x), r1(c.z), c.big ? 1 : 0]; });
    if (S.waves.length) snap.wv = S.waves.map(function (w) { return [w.id, r1(w.x), r1(w.z), r1(w.r)]; });
    S.ents.forEach(function (e) {
      if (e.kind === 'player') {
        var cds = {}; for (var k in e.cds) if (e.cds[k] > 0) cds[k] = r1(e.cds[k]);
        var o = { i: e.id, x: r2(e.x), z: r2(e.z), f: r2(e.facing), h: Math.round(e.hp), a: e.alive ? 1 : 0, tg: e.target, g: r2(e.gcd), c: cds };
        if (e.moving) o.mv = 1;
        if (e.auto && e.human) o.au = 1;
        if (e.dash) o.ds = 1;
        if (e.lastDeath) o.ld = [e.lastDeath.label, e.lastDeath.t, e.lastDeath.log || []];
        if (e.cast) o.k = [e.cast.ab.id, r2(e.cast.t), r2(e.cast.dur), e.cast.targetId];
        ['belt', 'pump', 'afterburn', 'armor', 'hot', 'sludge', 'momentum', 'still', 'opp', 'warcry', 'rampage', 'pips', 'ult', 'barrier', 'barrierUp', 'barrierBroken', 'comboStep', 'charges', 'chargeT', 'beamTo', 'cloak', 'storm', 'siphonTo', 'chainTo', 'skates', 'air', 'olN', 'slideT', 'shockCh', 'surge', 'overclock', 'bulwark', 'riposte', 'tag', 'flux', 'fluxN', 'overdrive', 'redline', 'ironhide'].forEach(function (f) { if (e[f] > 0) o[f] = r1(e[f]); });
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
        if (e.charged > 0) q.ch = 1;
        if (e.sundered > 0) q.sd = r1(e.sundered);
        if (e.bleed > 0) q.bl = r1(e.bleed);
        if (e.type === 'boss') { q.pr = r2(e.portRot || 0); if (e.portBurst > 0) q.pb = r1(e.portBurst); }
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
    M.domes = (snap.dm || []).map(function (d) { return { x: d[0], z: d[1], r: d[2], t: d[3] }; });
    M.fields = (snap.fl || []).map(function (d) { return { x: d[0], z: d[1], r: d[2], t: d[3] }; });
    M.cores = (snap.co || []).map(function (c) { return { id: c[0], by: c[1], x: c[2], z: c[3], big: c[4] }; });
    M.waves = (snap.wv || []).map(function (w) { return { id: w[0], x: w[1], z: w[2], r: w[3], hit: {} }; });
    snap.p.forEach(function (o) {
      var p = ent(M, o.i); if (!p) return;
      p.x = o.x; p.z = o.z; p.facing = o.f; p.hp = o.h; p.alive = !!o.a; p.target = o.tg; p.gcd = o.g; p.cds = o.c || {};
      p.moving = !!o.mv; p.auto = !!o.au || !p.human;
      p.lastDeath = o.ld ? { label: o.ld[0], t: o.ld[1], log: o.ld[2] || [] } : null;
      ['belt', 'pump', 'afterburn', 'armor', 'hot', 'sludge', 'momentum', 'still', 'opp', 'warcry', 'rampage', 'pips', 'ult', 'barrier', 'barrierUp', 'barrierBroken', 'comboStep', 'charges', 'chargeT', 'beamTo', 'cloak', 'storm', 'siphonTo', 'chainTo', 'skates', 'air', 'olN', 'slideT', 'shockCh', 'surge', 'overclock', 'bulwark', 'riposte', 'tag', 'flux', 'fluxN', 'overdrive', 'redline', 'ironhide'].forEach(function (f) { p[f] = o[f] || 0; });
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
      e.charged = q.ch ? 1 : 0; e.sundered = q.sd || 0; e.bleed = q.bl || 0; if (q.pr != null) { e.portRot = q.pr; e.portBurst = q.pb || 0; }
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
      taken: round(m.taken), killers: m.killers, shields: m.shields || { raised: 0, broken: 0 }
    };
  }

  /* HUD chips: one per talent showing what it is doing right now, plus any squad buffs you are under. [text, lit] */
  function talentChips(p) {
    var g = p.gear || {}, cds = p.cds || {}, out = [];
    var cd = function (k) { var c = cds[k] || 0; return c > 0 ? Math.ceil(c) + 's' : 'ready'; };
    var ready = function (k) { return !(cds[k] > 0); };
    var space = function (name, boosted) { out.push([p.momentum > 0 ? boosted : name + ' [Shift] ' + cd('leap'), p.momentum > 0 || ready('leap')]); };
    var timed = function (v, on, off) { out.push([v > 0 ? on + ' ' + Math.ceil(v) + 's' : off, v > 0]); };
    var named = function (slot) { out.push([gearName(slot, g[slot], p.role), true]); };
    var still = (p.still || 0) >= 1;
    var tankCharge = function () {
      var n = p.charges || 0;
      out.push([p.momentum > 0 ? 'Charged: next hit +30%' : 'Riot Charge [Shift] ' + (n > 0 ? 'x' + n : Math.ceil(TUNE.chargeCd - (p.chargeT || 0)) + 's'), n > 0 || p.momentum > 0]);
    };
    var CHIP = {
      ram: function () { tankCharge(); }, twincharge: function () { tankCharge(); }, intercept: function () { tankCharge(); },
      stim: function () { space('Stim Leap', 'Stimmed: next heal instant'); },
      dodge: function () { space('Dodge', 'Dodged: next shot +30%'); },
      slide: function () { out.push([p.slideT > 0 ? 'Sliding: -30% damage' : 'Slide [Shift] ' + cd('leap'), p.slideT > 0 || ready('leap')]); },
      coverdash: function () { out.push(['Covering Dash [Shift] ' + cd('leap'), ready('leap')]); },
      overload: function () { out.push([(p.olN || 0) > 0 ? 'Overload +' + (p.olN * 6) + '%' : 'Overload: stay on one', (p.olN || 0) >= 5]); },
      medevac: function () { out.push(['Medevac [Shift] ' + cd('leap'), ready('leap')]); },
      cover: function () { out.push([still ? 'Covering squad' : 'Cover: stand still', still]); },
      clamps: function () { out.push(['Mag-Clamps: no knockback', true]); },
      afterburner: function () { timed(p.afterburn, 'Afterburn', 'Afterburner: Dash'); },
      pump: function () { out.push([p.pump > 0 ? gearName('rig', 'pump', p.role) + ' active' : gearName('rig', 'pump', p.role) + ' ' + cd('pump'), p.pump > 0 || ready('pump')]); },
      plate: function () { out.push([gearName('rig', 'plate', p.role) + ' ' + cd('plate'), ready('plate')]); },
      meatshield: function () { out.push(['Meat Shield ' + cd('meatshield'), ready('meatshield')]); },
      rampage: function () { out.push(['Rampage x' + (p.rampage || 0), (p.rampage || 0) >= 8]); },
      opportunist: function () { timed(p.opp, 'Thrill +30%', 'Thrill Seeker: dodge late'); },
    };
    SLOTS.forEach(function (slot) { if (g[slot]) (CHIP[g[slot]] || function () { named(slot); })(); });
    if (p.warcry > 0) out.push(['War Cry +15%', true]);
    var wid = p.kit ? p.kit.weapons[p.weapon].id : '';
    if (wid === 'hammer') {
      out.push([p.barrierBroken > 0 ? 'Barrier broken ' + Math.ceil(p.barrierBroken) + 's' : (p.barrierUp ? 'Barrier UP ' : 'Barrier ') + Math.round(p.barrier == null ? barrierMax(p) : p.barrier), !!p.barrierUp]);
      out.push([['Swing', 'Swing', 'SLAM next'][p.comboStep || 0], (p.comboStep || 0) === 2]);
      out.push([(p.pips || 0) >= 99 ? 'FULL SHOVE ready' : 'Shield Energy ' + Math.floor(p.pips || 0), (p.pips || 0) >= 99]);
      out.push([p.bulwark > 0 ? 'Bulwark -15% ' + Math.ceil(p.bulwark) + 's' : 'No Bulwark: Shove', p.bulwark > 0]);
      if (p.riposte > 0) out.push(['RIPOSTE: next swing Slams', true]);
    }
    if (wid === 'link') {
      out.push([p.beamTo ? 'Beam linked: LMB = Burst' : 'Beam free', !!p.beamTo]);
      if (p.flux > 0) out.push(['FLUX: next heal x2 and jumps', true]);
      else out.push(['Flux in ' + (5 - (p.fluxN || 0)) + ' hits', false]);
      if (p.cloak > 0) out.push(['Cloak -40% ' + Math.ceil(p.cloak) + 's', true]);
      if (p.storm > 0) out.push(['Link Storm ' + Math.ceil(p.storm) + 's', true]);
    }
    if (wid === 'ripsaw') {
      if (p.overdrive > 0) out.push(['OVERDRIVE: Saw counts as 5', true]);
      if (p.redline > 0) out.push(['Redline ' + Math.ceil(p.redline) + 's', true]);
      if (p.ironhide > 0) out.push(['Iron Hide -40% ' + Math.ceil(p.ironhide) + 's', true]);
    }
    if (wid === 'shock') {
      out.push(['Shock Charges ' + (p.shockCh || 0) + '/4', (p.shockCh || 0) >= 4]);
      if (p.surge > 0) out.push(['SURGE: core ready ' + Math.ceil(p.surge) + 's', true]);
      if (p.overclock > 0) out.push(['Overclocked +30% ' + Math.ceil(p.overclock) + 's', true]);
    }
    return out;
  }

  /* The version players see. Bump it with every change you ship and add a line to CHANGELOG.md:
     the middle number for new things, the last number for fixes. package.json must match (a test checks). */
  var VERSION = '0.32.0';

  var api = {
    VERSION: VERSION,
    summary: summary,
    snapshot: snapshot, applySnapshot: applySnapshot, predictMove: predictMove,
    create: create, step: step, usable: usable, GEAR: GEAR, TALENTS: TALENTS, SLOTS: SLOTS, talentList: talentList, talentChips: talentChips, STYLES: STYLES, hasTalent: T, BOT_GEAR: BOT_GEAR, validGear: validGear, weaponsFor: weaponsFor, playable: playable, gearName: gearName, abilitiesOf: abilitiesOf, behind: behind, inTele: inTele,
    damageEnemy: damageEnemy, damagePlayer: damagePlayer, resOf: resOf, aimWeapon: aimWeapon, barrierMax: barrierMax, inCone: inCone, barrierFor: barrierFor, softTarget: softTarget, coreInAim: coreInAim, portAngle: portAngle, portOpen: portOpen, portHit: portHit, BOLT_AIM: BOLT_AIM, SHOCK_AIM: SHOCK_AIM, fieldSpot: fieldSpot, lobSpot: lobSpot,
    ent: ent, players: players, enemies: enemies, KITS: KITS, TUNE: TUNE,
    ARENA_R: ARENA_R, GCD: GCD, dist: dist
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
