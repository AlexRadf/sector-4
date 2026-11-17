/* Sector-4 client: rendering, HUD and input. All combat rules live in sim.js. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var R = Sim.ARENA_R;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ROLE_COLOR = { tank: 0xffb000, healer: 0x4fd88f, dps: 0xb98cff, melee: 0x5cc8ff };
  var ROLE_GLYPH = { tank: 'J', healer: 'M', dps: 'S', melee: 'W' };
  var SLOTS = [
    { key: 'tank', label: 'Juggernaut', h: 2.0 }, { key: 'healer', label: 'Medic', h: 2.0 }, { key: 'dps', label: 'Striker', h: 2.0 }, { key: 'melee', label: 'Wrecker', h: 2.0 },
    { key: 'boss', label: 'The Foreman', h: 6.2 }, { key: 'drone', label: 'Security drone', h: 1.6 }
  ];

  /* ---------- sound: small synthesized set, no audio files ---------- */
  var Snd = (function () {
    var ctx = null, master = null, muted = false, noiseBuf = null, lastHurt = 0;
    try { muted = localStorage.getItem('s4-mute') === '1'; } catch (e) {}
    function ensure() {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.45; master.connect(ctx.destination); }
        catch (e) { ctx = null; }
      }
      if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    }
    function tone(freq, dur, type, vol, slideTo, delay) {
      if (!ctx || muted) return;
      var t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol || 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, freq, delay) {
      if (!ctx || muted) return;
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var t = ctx.currentTime + (delay || 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq || 1200;
      g.gain.setValueAtTime(vol || 0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02);
    }
    var lib = {
      shock: function () { tone(1400, 0.12, 'sawtooth', 0.07, 300); },
      core: function () { tone(900, 0.25, 'sawtooth', 0.09, 120); noise(0.15, 0.07, 3000); },
      combo: function () { noise(0.4, 0.3, 900); tone(220, 0.4, 'square', 0.1, 50); },
      link: function () { tone(520, 0.18, 'sine', 0.12, 880); },
      surge: function () { tone(440, 0.3, 'sine', 0.12, 1320); tone(660, 0.3, 'sine', 0.06, 1760, 0.05); },
      purge: function () { tone(1200, 0.15, 'triangle', 0.1, 1800); },
      keg: function () { [523, 659, 784].forEach(function (f, i) { tone(f, 0.25, 'sine', 0.08, null, i * 0.06); }); },
      flak: function () { noise(0.22, 0.28, 1600); },
      challenge: function () { tone(110, 0.5, 'sawtooth', 0.1, 220); },
      belt: function () { tone(300, 0.35, 'triangle', 0.12, 900); },
      hammer: function () { noise(0.12, 0.3, 4000); tone(180, 0.2, 'square', 0.1, 60); },
      trans: function () { tone(300, 0.15, 'sine', 0.12, 1600); },
      rocket: function () { noise(0.25, 0.22, 900); tone(160, 0.2, 'sawtooth', 0.06, 60); },
      saw: function () { tone(90, 0.18, 'sawtooth', 0.09, 140); noise(0.14, 0.12, 2400); },
      razor: function () { tone(2200, 0.1, 'triangle', 0.07, 900); },
      swap: function () { tone(500, 0.05, 'square', 0.05); tone(750, 0.06, 'square', 0.05, null, 0.07); },
      kick: function () { noise(0.12, 0.3, 3500); tone(1200, 0.12, 'square', 0.08, 200); },
      charge: function () { noise(0.6, 0.35, 400); tone(90, 0.6, 'sawtooth', 0.12, 40); },
      hurt: function () { var n = Date.now(); if (n - lastHurt < 150) return; lastHurt = n; tone(140, 0.12, 'square', 0.1, 70); },
      alarm: function () { tone(880, 0.12, 'square', 0.06); tone(660, 0.12, 'square', 0.06, null, 0.14); },
      boom: function () { noise(0.5, 0.35, 600); },
      death: function () { tone(300, 0.6, 'sawtooth', 0.08, 40); },
      error: function () { tone(120, 0.08, 'square', 0.05); },
      tick: function () { tone(1000, 0.06, 'square', 0.05); },
      crit: function () { tone(1800, 0.08, 'square', 0.06, 2600); noise(0.08, 0.12, 3000); },
      proc: function () { [880, 1320].forEach(function (f, i) { tone(f, 0.12, 'triangle', 0.08, null, i * 0.07); }); },
      hero: function () { [196, 262, 330, 392].forEach(function (f, i) { tone(f, 0.5, 'sawtooth', 0.07, null, i * 0.09); }); },
      ult: function () { noise(0.6, 0.3, 400); [220, 330, 440, 660].forEach(function (f, i) { tone(f, 0.7, 'sawtooth', 0.06, null, i * 0.05); }); },
      good: function () { [392, 494, 587].forEach(function (f, i) { tone(f, 0.6, 'sawtooth', 0.05, null, i * 0.03); }); },
      bad: function () { [196, 233, 277].forEach(function (f, i) { tone(f, 0.7, 'sawtooth', 0.05, null, i * 0.03); }); }
    };
    return {
      ensure: ensure,
      play: function (n) { if (lib[n]) lib[n](); },
      toggle: function () { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.45; try { localStorage.setItem('s4-mute', muted ? '1' : '0'); } catch (e) {} return muted; },
      isMuted: function () { return muted; }
    };
  })();

  /* ---------- three.js scene ---------- */
  var stage = $('#stage');
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(renderer.domElement);
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d12);
  scene.fog = new THREE.FogExp2(0x0a0d12, 0.009);
  var camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  var cam = { yaw: Math.PI, pitch: 0.55, dist: 22 };

  function resize() {
    var w = stage.clientWidth || 800, h = stage.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function canvasTex(size, draw) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  var pillars = [];
  function buildArena() {
    scene.add(new THREE.HemisphereLight(0x9fb4d0, 0x1a1410, 0.95));
    var sun = new THREE.DirectionalLight(0xffe2b0, 0.75); sun.position.set(20, 40, 10); scene.add(sun);

    var floorTex = canvasTex(1024, function (g, s) {
      g.fillStyle = '#1b222c'; g.fillRect(0, 0, s, s);
      for (var y = 0; y < s; y += 64) for (var x = 0; x < s; x += 64) {
        var v = 24 + Math.floor(Math.random() * 12);
        g.fillStyle = 'rgb(' + v + ',' + (v + 7) + ',' + (v + 16) + ')'; g.fillRect(x + 1, y + 1, 62, 62);
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 1, y + 1, 62, 2);
        g.fillStyle = '#0c1015'; g.fillRect(x + 5, y + 5, 3, 3); g.fillRect(x + 56, y + 56, 3, 3);
      }
      g.translate(s / 2, s / 2);
      var rr = s / 2 - 26;
      for (var i = 0; i < 72; i++) {
        g.beginPath(); g.arc(0, 0, rr, i * Math.PI / 36, (i + 0.5) * Math.PI / 36);
        g.lineWidth = 22; g.strokeStyle = 'rgba(255,176,0,0.75)'; g.stroke();
      }
      g.beginPath(); g.arc(0, 0, s * 0.2, 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = 'rgba(255,176,0,0.35)'; g.stroke();
      g.fillStyle = 'rgba(255,176,0,0.22)'; g.font = 'italic 800 230px Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('04', 0, 10);
    });
    var floor = new THREE.Mesh(new THREE.CircleGeometry(R, 72), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8, metalness: 0.35 }));
    floor.rotation.x = -Math.PI / 2; floor.rotation.z = Math.PI; scene.add(floor);

    var wallTex = canvasTex(512, function (g, s) {
      g.fillStyle = '#161c25'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#222c38'; g.fillRect(8, 60, s - 16, s - 120);
      g.fillStyle = '#ffb000'; g.fillRect(0, s - 40, s, 8);
      g.fillStyle = 'rgba(255,176,0,0.9)'; g.fillRect(40, 20, s - 80, 10);
      g.fillStyle = '#ff4a36'; g.font = '800 34px Impact, sans-serif'; g.textAlign = 'center';
      g.fillText('SECTOR-4  //  LOADING DOCK', s / 2, s / 2 - 10);
      g.fillStyle = '#8a97a6'; g.font = '22px monospace';
      g.fillText('CONTRACTORS ONLY BEYOND THIS LINE', s / 2, s / 2 + 34);
    });
    wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(-10, 1);
    var wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.6, R + 0.6, 7, 72, 1, true),
      new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.BackSide, roughness: 0.7, metalness: 0.4, emissive: 0x2a1c05, emissiveIntensity: 0.6 }));
    wall.position.y = 3.5; scene.add(wall);

    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4 + Math.PI / 8;
      var px = Math.sin(a) * (R - 0.6), pz = Math.cos(a) * (R - 0.6);
      var pillar = new THREE.Mesh(new THREE.BoxGeometry(2, 11, 2), new THREE.MeshStandardMaterial({ color: 0x2a3542, roughness: 0.6, metalness: 0.5 }));
      var pg = new THREE.Group(); pg.userData.ang = a; pillars.push(pg); scene.add(pg);
      pillar.position.set(Math.sin(a) * (R + 1.5), 5.5, Math.cos(a) * (R + 1.5)); pillar.rotation.y = a; pg.add(pillar);
      var strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), new THREE.MeshBasicMaterial({ color: 0xffb000 }));
      strip.position.set(Math.sin(a) * (R + 0.35), 5, Math.cos(a) * (R + 0.35)); pg.add(strip);
      if (i % 2 === 0) { var pl = new THREE.PointLight(0xffb000, 0.7, 45); pl.position.set(px * 0.9, 7, pz * 0.9); scene.add(pl); }
    }

    var winTex = canvasTex(256, function (g, s) {
      g.fillStyle = '#05070a'; g.fillRect(0, 0, s, s);
      for (var y = 6; y < s; y += 16) for (var x = 6; x < s; x += 12) {
        if (Math.random() < 0.35) { g.fillStyle = Math.random() < 0.8 ? '#ffcf70' : '#7fd0ff'; g.fillRect(x, y, 6, 8); }
      }
    });
    winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
    for (var t = 0; t < 46; t++) {
      var ang = Math.random() * Math.PI * 2, rad = 48 + Math.random() * 110;
      var w = 8 + Math.random() * 12, h = 50 + Math.random() * 170;
      var tex = winTex.clone(); tex.needsUpdate = true; tex.repeat.set(Math.round(w / 6), Math.round(h / 12));
      var tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshBasicMaterial({ map: tex, color: 0x9aa4b0 }));
      tower.position.set(Math.sin(ang) * rad, h / 2 - 45, Math.cos(ang) * rad); tower.rotation.y = Math.random() * 3; scene.add(tower);
    }
  }

  /* ---------- models: placeholders and custom meshes ---------- */
  var customBuffers = {};   // slot key -> ArrayBuffer of a .glb
  var mixers = [];
  var std = function (color, emissive) { return new THREE.MeshStandardMaterial({ color: color, roughness: 0.55, metalness: 0.45, emissive: emissive || 0x000000 }); };
  function box(w, h, d, mat, x, y, z) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }

  function placeholder(key) {
    var g = new THREE.Group();
    if (key === 'boss') {
      var hull = std(0x4a2a22), dark = std(0x1c2229), hot = new THREE.MeshBasicMaterial({ color: 0xff4a36 });
      g.add(box(1.1, 2.4, 1.3, dark, -1.0, 1.2, 0)); g.add(box(1.1, 2.4, 1.3, dark, 1.0, 1.2, 0));
      g.add(box(3.6, 2.6, 2.4, hull, 0, 3.7, 0));
      g.add(box(1.5, 1.0, 1.4, dark, 0, 5.5, 0.2)); g.add(box(1.2, 0.25, 0.2, hot, 0, 5.6, 0.95));
      g.add(box(1.1, 2.6, 1.2, hull, -2.5, 3.5, 0.2)); g.add(box(1.1, 2.6, 1.2, hull, 2.5, 3.5, 0.2));
      g.add(box(1.5, 1.2, 1.9, dark, -2.5, 5.2, 0.3)); g.add(box(1.5, 1.2, 1.9, dark, 2.5, 5.2, 0.3));
      g.add(box(2.2, 0.5, 0.2, new THREE.MeshBasicMaterial({ color: 0xffb000 }), 0, 3.9, 1.22));
    } else if (key === 'drone') {
      var body = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), std(0x39424e)); body.position.y = 1.1; g.add(body);
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff4a36 })); eye.position.set(0, 1.1, 0.6); g.add(eye);
    } else {
      var c = ROLE_COLOR[key], suit = std(c), dk = std(0x1c2229);
      var bulk = key === 'tank' ? 1.25 : 1;
      g.add(box(0.34 * bulk, 0.9, 0.36, dk, -0.22 * bulk, 0.45, 0)); g.add(box(0.34 * bulk, 0.9, 0.36, dk, 0.22 * bulk, 0.45, 0));
      g.add(box(0.9 * bulk, 0.8, 0.5 * bulk, suit, 0, 1.3, 0));
      g.add(box(1.25 * bulk, 0.26, 0.56 * bulk, dk, 0, 1.62, 0));
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), std(0xd8c4a8)); head.position.y = 1.9; g.add(head);
      g.add(box(0.2, 0.2, key === 'tank' ? 0.9 : 1.2, new THREE.MeshBasicMaterial({ color: c }), 0.5 * bulk, 1.25, 0.5));
    }
    return g;
  }

  function fitModel(obj, height) {
    var b = new THREE.Box3().setFromObject(obj), size = new THREE.Vector3(); b.getSize(size);
    var s = height / (size.y || 1);
    obj.scale.multiplyScalar(s);
    b.setFromObject(obj);
    var c = new THREE.Vector3(); b.getCenter(c);
    obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b.min.y;
  }

  function buildModel(key, holder) {
    while (holder.children.length) holder.remove(holder.children[0]);
    holder.add(placeholder(key));
    var buf = customBuffers[key];
    if (!buf || !THREE.GLTFLoader) return;
    var slot = SLOTS.filter(function (s) { return s.key === key; })[0];
    new THREE.GLTFLoader().parse(buf.slice(0), '', function (gltf) {
      while (holder.children.length) holder.remove(holder.children[0]);
      var wrap = new THREE.Group(); wrap.add(gltf.scene); fitModel(gltf.scene, slot.h); holder.add(wrap);
      if (gltf.animations && gltf.animations.length) {
        var mx = new THREE.AnimationMixer(gltf.scene); mx.clipAction(gltf.animations[0]).play(); mx.holder = holder; mixers.push(mx);
      }
    }, function () { setSlotStatus(key, 'Could not read that file', 'err'); });
  }

  /* mesh storage: IndexedDB keeps the files in this browser between visits */
  function idb(mode, fn) {
    try {
      var open = indexedDB.open('sector4', 1);
      open.onupgradeneeded = function () { open.result.createObjectStore('meshes'); };
      open.onsuccess = function () { try { fn(open.result.transaction('meshes', mode).objectStore('meshes')); } catch (e) {} };
      open.onerror = function () {};
    } catch (e) {}
  }
  function setSlotStatus(key, text, cls) {
    var s = document.getElementById('st-' + key); if (s) { s.textContent = text; s.className = 'st' + (cls ? ' ' + cls : ''); }
  }
  function buildMeshSlots() {
    var host = $('#meshSlots');
    SLOTS.forEach(function (sl) {
      var row = el('div', 'slot');
      var lab = el('label', null, sl.label); lab.htmlFor = 'mesh-' + sl.key;
      var inp = el('input'); inp.type = 'file'; inp.id = 'mesh-' + sl.key; inp.accept = '.glb,model/gltf-binary';
      var st = el('span', 'st', 'Placeholder'); st.id = 'st-' + sl.key;
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          customBuffers[sl.key] = rd.result; setSlotStatus(sl.key, 'Loaded', 'ok');
          idb('readwrite', function (store) { store.put(rd.result, sl.key); });
          refreshModels(sl.key);
        };
        rd.readAsArrayBuffer(f);
      });
      row.appendChild(lab); row.appendChild(inp); row.appendChild(st); host.appendChild(row);
    });
    idb('readonly', function (store) {
      SLOTS.forEach(function (sl) {
        var rq = store.get(sl.key);
        rq.onsuccess = function () { if (rq.result) { customBuffers[sl.key] = rq.result; setSlotStatus(sl.key, 'Loaded', 'ok'); refreshModels(sl.key); } };
      });
    });
  }

  /* ---------- game state ---------- */
  var S = null, human = null, role = 'dps', running = false, watching = false;
  /* Multiplayer. mode: 'solo' runs the sim here; 'host' runs it and streams snapshots; 'client' renders the host's snapshots. */
  var Net = { mode: 'solo', room: null, user: null, squad: null, code: null, isHost: false, startId: null, roster: null,
    names: {}, hostPeer: null, acts: {}, buf: [], snapT: 0, lastSnap: 0, startTimer: null, lastIn: '', unsubs: [], postEnd: 0 };
  var gearFor = {};
  ['tank', 'healer', 'dps', 'melee'].forEach(function (r) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('s4-gear-' + r) || 'null'); } catch (e) {}
    gearFor[r] = Sim.validGear(r, saved);
  });
  var views = {};            // entity id -> view
  var teleViews = {};        // telegraph id -> mesh group
  var fx = [];               // transient effects
  var input = { ability: -1, target: undefined, jump: false };
  var keys = {};
  var stats = {};
  var acc = 0, last = 0, toastT = 0;
  var fxRoot = new THREE.Group(); scene.add(fxRoot);
  var entRoot = new THREE.Group(); scene.add(entRoot);

  function modelKey(e) { return e.kind === 'player' ? e.role : e.type; }
  function entHeight(e) { return e.kind === 'player' ? 2.0 : (e.type === 'boss' ? 6.2 : 1.8); }

  function makeView(e) {
    var g = new THREE.Group(), holder = new THREE.Group();
    g.add(holder); buildModel(modelKey(e), holder);
    var rad = e.kind === 'player' ? 0.9 : (e.radius || 1) + 0.4;
    var shadow = new THREE.Mesh(new THREE.CircleGeometry(rad, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; g.add(shadow);
    var ring = new THREE.Mesh(new THREE.RingGeometry(rad + 0.15, rad + 0.4, 40), new THREE.MeshBasicMaterial({ color: 0xff4a36, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.visible = false; g.add(ring);
    var aura = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.25, depthWrite: false }));
    aura.position.y = 1.1; aura.visible = false; g.add(aura);
    g.position.set(e.x, 0, e.z); entRoot.add(g);
    var plate = el('div', 'plate ' + (e.kind === 'player' ? 'friend' : e.type));
    var nm = el('div', null, e.name), bar = el('div', 'bar'), fill = el('i'); bar.appendChild(fill); plate.appendChild(nm); plate.appendChild(bar);
    $('#plates').appendChild(plate);
    return { g: g, holder: holder, ring: ring, aura: aura, plate: plate, fill: fill, key: modelKey(e), kind: e.kind, dead: false };
  }
  function dropView(id) {
    var v = views[id]; if (!v) return;
    entRoot.remove(v.g); v.plate.remove();
    mixers = mixers.filter(function (m) { return m.holder !== v.holder; });
    delete views[id];
  }
  function refreshModels(key) {
    for (var id in views) if (views[id].key === key) {
      var v = views[id]; mixers = mixers.filter(function (m) { return m.holder !== v.holder; }); buildModel(key, v.holder);
    }
  }

  function startFight(r, watch) {
    watching = !!watch; if (!watching) role = r; Snd.ensure();
    Net.mode = 'solo';
    beginFight(Sim.create({ humanRole: watching ? null : role, gear: watching ? null : gearFor[role], seed: (Date.now() & 0xffffff) + 1 }), null);
  }
  /* myKey: this page's peer label in a squad, or null for solo/spectate. */
  function beginFight(state, myKey) {
    for (var id in views) dropView(id);
    for (var t in teleViews) { fxRoot.remove(teleViews[t]); } teleViews = {};
    fx.forEach(function (f) { fxRoot.remove(f.m); }); fx = [];
    $('#floaters').innerHTML = ''; $('#log').innerHTML = '';
    S = state;
    human = watching ? (Sim.players(S).filter(function (p) { return p.human; })[0] || Sim.players(S)[2]) : myKey ? Sim.players(S).filter(function (p) { return p.key === myKey; })[0] : Sim.ent(S, S.humanId);
    if (myKey) role = human.role;
    stats = {}; Sim.players(S).forEach(function (p) { stats[p.id] = { dmg: 0, heal: 0, taken: 0 }; });
    input.ability = -1; input.jump = false; input.target = (role === 'healer') ? undefined : S.bossId; keys = {};
    cam.yaw = Math.PI; cam.pitch = 0.6; cam.dist = 18;
    buildHud();
    ['#menu', '#end', '#armory', '#lobby'].forEach(function (q) { $(q).classList.remove('on'); }); $('#hud').classList.add('on'); showPlates(true);
    $('#netBadge').textContent = Net.mode === 'solo' ? '' : 'SQUAD ' + Net.code.toUpperCase() + (Net.mode === 'host' ? '  /  HOST' : Net.mode === 'spy' ? '  /  ADMIN' : '');
    $('#update').hidden = true;
    $('#hud').classList.toggle('spectate', watching); updateSpec();
    running = true; acc = 0; lastSim = performance.now(); Net.evMark = 0;
    logLine(watching ? 'Shift started. You are watching from the gantry.' : 'Shift started. ' + human.kit.title + ' on the floor.');
    if (Net.mode !== 'solo') logLine(Sim.players(S).filter(function (p) { return p.human; }).map(function (p) { return p.name; }).join(', ') + ' on the squad. Bots fill the rest.');
  }
  function showPlates(on) { $('#plates').style.display = on ? '' : 'none'; $('#floaters').style.display = on ? '' : 'none'; }
  function follow(p) {
    if (!watching || !p || p === human) return;
    human = p; buildActions(); updateSpec(); Snd.play('tick');
  }
  function updateSpec() {
    $('#specName').textContent = watching && human ? human.name + ', ' + human.kit.title : '';
  }
  function toMenu() {
    if (running && S && !S.result) recordFight(true);
    running = false; showPlates(false);
    if (Net.squad) leaveSquad();
    ['#hud', '#end', '#armory', '#lobby'].forEach(function (q) { $(q).classList.remove('on'); }); $('#menu').classList.add('on');
    showUpdateBanner();
  }

  /* ---------- armory ---------- */
  var armoryCtx = 'solo';
  function openArmory(r, ctx) {
    armoryCtx = ctx || 'solo';
    role = r; running = false; showPlates(false);
    var k = Sim.KITS[r], host = $('#armorySlots');
    $('#armoryRole').textContent = k.title; $('#armoryRole').className = 'display role-' + r;
    $('#armoryWeapons').textContent = 'Always carried: ' + k.utils.map(function (a) { return a.name; }).join(', ') + '. Ultimate: ' + k.ult.name;
    $('#armoryGo').textContent = armoryCtx === 'lobby' ? 'Back to squad' : 'Clock in as ' + k.title;
    $('#armoryBack').style.display = armoryCtx === 'lobby' ? 'none' : '';
    host.innerHTML = '';
    var weaponItems = k.weapons.map(function (w) {
      var wr = w.res || k.res;
      var tag = function (a) {
        if (a.role === 'skill') return a.cost ? a.cost + ' ' + wr.name : a.needs ? 'needs ' + a.needs + ' ' + wr.name : a.cd ? a.cd + 's cooldown' : 'skill';
        return { build: 'basic', spend: 'spends ' + wr.name, proc: 'proc' }[a.role];
      };
      return { id: w.id, name: w.name, desc: w.pitch, list: w.abilities.map(function (a, i) { return (i + 1) + '  ' + a.name + '  /  ' + tag(a) + (a.cast ? ', ' + a.cast + 's cast' : ''); }) };
    });
    var tree = Sim.TALENTS[r];
    var showRes = function () {
      var wi = Math.max(0, k.weapons.map(function (w) { return w.id; }).indexOf(gearFor[r].weapon));
      $('#armoryRes').textContent = (k.weapons[wi].res || k.res).how;
    };
    showRes();
    $('#armoryTheme').textContent = tree.theme; $('#armoryTheme').className = 'armtheme display role-' + r;
    [['weapon', 'Gear  /  Weapon', weaponItems]].concat(Sim.SLOTS.map(function (slot, i) {
      return [slot, 'Talent tier ' + (i + 1) + '  /  ' + tree.tiers[i], Sim.talentList(slot, r)];
    })).forEach(function (slot) {
      var sec = el('div', 'gslot');
      sec.appendChild(el('h2', null, slot[1]));
      var row = el('div', 'gopts');
      slot[2].forEach(function (item) {
        var b = el('button', 'gopt'); b.type = 'button';
        var on = gearFor[r][slot[0]] === item.id;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (item.style) { var tag = el('i', 'gstyle ' + item.style, Sim.STYLES[item.style] + (item.play ? '  /  ' + item.play : '')); b.appendChild(tag); }
        b.appendChild(el('b', 'display', item.name)); b.appendChild(el('span', null, item.desc));
        if (item.list) { var ul = el('ul', 'gabs'); item.list.forEach(function (t) { ul.appendChild(el('li', null, t)); }); b.appendChild(ul); }
        b.addEventListener('click', function () {
          gearFor[r][slot[0]] = item.id;
          try { localStorage.setItem('s4-gear-' + r, JSON.stringify(gearFor[r])); } catch (e) {}
          Array.prototype.forEach.call(row.children, function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
          showLeaning(); showRes();
          Snd.ensure(); Snd.play('swap');
        });
        row.appendChild(b);
      });
      sec.appendChild(row); host.appendChild(sec);
    });
    showLeaning();
    function showLeaning() {
      var count = { aggressive: 0, steady: 0, squad: 0 };
      Sim.SLOTS.forEach(function (slot) {
        var it = Sim.talentList(slot, r).filter(function (x) { return x.id === gearFor[r][slot]; })[0];
        if (it && it.style) count[it.style]++;
      });
      var top = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
      var line = count[top[0]] >= 3 ? (top[0] === 'aggressive' ? 'An ' : 'A ') + Sim.STYLES[top[0]].toLowerCase() + ' build.' : count[top[0]] === 2 && count[top[1]] === 2 ? 'A mixed build, ' + Sim.STYLES[top[0]].toLowerCase() + ' and ' + Sim.STYLES[top[1]].toLowerCase() + '.' : 'Leaning ' + Sim.STYLES[top[0]].toLowerCase() + '.';
      $('#armoryLean').textContent = line + '  Aggressive ' + count.aggressive + '  /  Steady ' + count.steady + '  /  Squad ' + count.squad;
    }
    ['#menu', '#end', '#hud', '#lobby'].forEach(function (q) { $(q).classList.remove('on'); }); $('#armory').classList.add('on');
  }

  /* ---------- HUD ---------- */
  var hud = { party: [], abs: [], enemies: {} };
  function buildRoleCards() {
    var host = $('#roles');
    ['dps', 'melee', 'tank', 'healer'].forEach(function (r) {
      var k = Sim.KITS[r], card = el('div', 'role role-' + r);
      card.appendChild(el('h3', 'display', k.title));
      card.appendChild(el('div', 'wpn', k.hp + ' HP'));
      card.appendChild(el('p', null, k.blurb));
      var addList = function (title, list, start) {
        card.appendChild(el('div', 'kit-h', title));
        var ol = el('ol');
        list.forEach(function (a, i) {
          var li = el('li'); li.appendChild(el('b', null, String(start + i)));
          var sp = el('span', null, a.name + (a.cd ? '  (' + a.cd + 's)' : '')); sp.appendChild(el('small', null, a.desc)); li.appendChild(sp); ol.appendChild(li);
        });
        card.appendChild(ol);
      };
      card.appendChild(el('div', 'kit-w', 'Weapon, pick one in the armory'));
      k.weapons.forEach(function (w) { var d = el('p', 'kit-opt'); d.appendChild(el('b', null, w.name + '. ')); d.appendChild(document.createTextNode(w.pitch)); card.appendChild(d); });
      addList('Always carried', k.utils.concat([k.ult]), 4);
      var b = el('button', 'go', 'Gear up as ' + k.title); b.type = 'button';
      b.addEventListener('click', function () { openArmory(r); });
      card.appendChild(b); host.appendChild(card);
    });
  }
  function buildHud() {
    var party = $('#party'); party.innerHTML = ''; hud.party = [];
    Sim.players(S).forEach(function (p, i) {
      var b = el('button', 'pf click'); b.type = 'button';
      b.appendChild(el('span', 'glyph display role-' + p.role, ROLE_GLYPH[p.role]));
      var top = el('span', 'top'); top.appendChild(el('span', null, p.name)); top.appendChild(el('small', null, 'F' + (i + 1) + ' / \u21e7' + (i + 1))); b.appendChild(top);
      var bar = el('span', 'bar'), fill = el('i'); bar.appendChild(fill); b.appendChild(bar);
      var chips = el('span', 'chips'); b.appendChild(chips);
      b.addEventListener('click', function () { if (watching) follow(p); else input.target = p.id; });
      party.appendChild(b); hud.party.push({ p: p, el: b, fill: fill, chips: chips, state: '' });
    });
    buildActions();
    $('#enemies').innerHTML = ''; hud.enemies = {};
  }
  function buildActions() {
    var acts = $('#actions'); acts.innerHTML = ''; hud.abs = [];
    hud.wpn = human.weapon;
    Sim.abilitiesOf(human).forEach(function (a, i) {
      var b = el('button', 'ab click'); b.type = 'button'; b.title = a.desc;
      var row = el('span', 'row'), tl = el('span', 'tl'); row.appendChild(el('span', 'k', String(i + 1))); row.appendChild(tl); b.appendChild(row);
      b.appendChild(el('span', 'n display', a.name));
      var cool = el('span', 'cool'), sec = el('span', 'sec display'); b.appendChild(cool); b.appendChild(sec);
      var meter = null; if (a.role === 'ult') { meter = el('span', 'meter'); b.appendChild(meter); }
      if (a.hold && i < 2) {
        var key = 'Digit' + (i + 1);
        b.addEventListener('pointerdown', function () { keys[key] = true; });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (evn) { b.addEventListener(evn, function () { keys[key] = false; }); });
      } else b.addEventListener('click', function () { input.ability = i; });
      acts.appendChild(b); hud.abs.push({ a: a, el: b, cool: cool, sec: sec, tl: tl, meter: meter, state: '' });
    });
    // The class resource: Revs show as five pips, the others as a bar.
    var pips = $('#pips'), RS = Sim.resOf(human); pips.innerHTML = ''; hud.pips = []; hud.resBar = null;
    pips.className = 'res-' + RS.id; pips.title = RS.how;
    pips.appendChild(el('span', null, RS.name.toUpperCase()));
    if (RS.max <= 5) for (var n = 0; n < RS.max; n++) { var pi = el('i'); pips.appendChild(pi); hud.pips.push(pi); }
    else { var rb = el('b', 'resbar'), rf = el('u'); rb.appendChild(rf); pips.appendChild(rb); hud.resBar = rf; hud.resNum = el('span', 'resnum'); pips.appendChild(hud.resNum); }
    hud.pipState = -1;
  }
  function setBar(fill, frac) { fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, frac)).toFixed(3) + ')'; }
  function fmtTime(t) { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }
  function logLine(text) {
    var log = $('#log'); log.appendChild(el('div', null, text));
    while (log.children.length > 6) log.removeChild(log.firstChild);
  }
  function announce(text, tone, quick) {
    var a = $('#announce'); a.textContent = text; a.className = 'display ' + (tone === 'neutral' ? '' : tone || '');
    void a.offsetWidth; a.classList.add('show'); if (quick) a.classList.add('quick');
  }

  function updateHud() {
    var boss = Sim.ent(S, S.bossId);
    setBar($('#bossHp > i'), boss.hp / boss.maxHp);
    $('#bossHp > span').textContent = Math.ceil(boss.hp) + '  /  ' + Math.round(boss.hp / boss.maxHp * 100) + '%';
    $('#phaseTag').textContent = S.enraged ? 'OVERTIME' : 'PHASE ' + S.phase;
    var bc = $('#bossCast');
    var HERO_ANSWER = { 'Demolition Blast': ['tank', 'GET BEHIND THE JUGGERNAUT'], Haymaker: ['melee', 'WRECKER: COUNTER-SLAM'], Meltdown: ['healer', 'MEDIC: FIELD HOSPITAL'] };
    if (boss.oshield) {
      bc.className = 'bar on shield'; setBar(bc.firstElementChild, boss.oshield.hp / boss.oshield.max);
      bc.lastElementChild.textContent = 'OVERCHARGE SHIELD ' + Math.ceil(boss.oshield.hp) + '  /  BREAK IT: ' + Math.max(0, Math.ceil(boss.oshield.dur - boss.oshield.t)) + 'S';
    } else if (boss.stagger > 0) {
      bc.className = 'bar on'; setBar(bc.firstElementChild, boss.stagger / 5);
      bc.lastElementChild.textContent = 'STAGGERED  /  EVERYTHING YOU HAVE';
    } else if (S.missile) {
      var mt = Sim.ent(S, S.missile.tgt);
      bc.className = 'bar on hero' + (human.role === 'dps' && !watching ? ' mine' : ''); setBar(bc.firstElementChild, S.missile.t / S.missile.dur);
      bc.lastElementChild.textContent = 'HEAVY ROCKET ON ' + (mt ? mt.name : '?') + '  /  STRIKER: DEADEYE';
    } else if (boss.cast && boss.cast.name === 'Crusher') {
      var cv = Sim.ent(S, boss.cast.target), onMe = cv === human && !watching;
      bc.className = 'bar on hero' + (onMe ? ' mine' : '');
      setBar(bc.firstElementChild, boss.cast.t / boss.cast.dur);
      bc.lastElementChild.textContent = 'CRUSHER ON ' + (cv ? cv.name : '?') + '  /  ' + (onMe ? 'MITIGATE NOW' : 'TANK BUSTER');
    } else if (boss.cast) {
      var ha = HERO_ANSWER[boss.cast.name];
      bc.className = 'bar on' + (ha ? ' hero' : '') + (ha && ha[0] === human.role && !watching ? ' mine' : '');
      setBar(bc.firstElementChild, boss.cast.t / boss.cast.dur);
      bc.lastElementChild.textContent = boss.cast.name.toUpperCase() + '  /  ' + (ha ? ha[1] : 'GET CLEAR');
    } else bc.className = 'bar';
    var left = Sim.TUNE.enrageAt - S.t, ot = $('#overtime');
    ot.textContent = S.enraged ? 'THE FOREMAN IS ON OVERTIME' : 'OVERTIME IN ' + fmtTime(left);
    ot.className = left < 45 ? 'hot' : '';
    $('#clock').textContent = fmtTime(S.t);

    hud.party.forEach(function (h) {
      var p = h.p; setBar(h.fill, p.hp / p.maxHp);
      var aggro = Sim.enemies(S).some(function (e) { return e.target === p.id; });
      var onKick = S.hero && S.hero.role === p.role;
      var st = (p === human && watching ? 'f' : '') + (p.alive ? '' : 'd') + (human.target === p.id ? 's' : '') + (p.sludge > 0 ? 'g' : '') + (p.belt > 0 ? 'b' : '') + (aggro ? 'a' : '') + (p.amp > 0 ? 'm' : '') + (p.armor > 0 ? 'r' : '') + (p.adren > 0 ? 'n' : '') + (p.hot > 0 ? 'h' : '') + (p.pump > 0 ? 'p' : '') + (onKick ? 'k' : '');
      if (st !== h.state) {
        h.state = st;
        h.el.className = 'pf click' + (p.alive ? '' : ' dead') + (human.target === p.id ? ' sel' : '') + (watching && p === human ? ' fol' : '');
        h.chips.innerHTML = '';
        if (!p.alive) h.chips.appendChild(el('span', 'chip aggro', 'DOWN'));
        if (aggro && p.alive) h.chips.appendChild(el('span', 'chip aggro', 'AGGRO'));
        if (onKick) h.chips.appendChild(el('span', 'chip kick', 'HERO'));
        if (p.sludge > 0) h.chips.appendChild(el('span', 'chip sludge', 'SLUDGE'));
        if (p.belt > 0) h.chips.appendChild(el('span', 'chip belt', 'BELT'));
        if (p.armor > 0) h.chips.appendChild(el('span', 'chip belt', 'ARMOR'));
        if (p.adren > 0) h.chips.appendChild(el('span', 'chip amp', 'ADREN'));
        if (p.hot > 0) h.chips.appendChild(el('span', 'chip sludge', 'REGEN'));
        if (p.pump > 0) h.chips.appendChild(el('span', 'chip aggro', 'PUMP'));
      }
    });

    var host = $('#enemies'), seen = {};
    Sim.enemies(S).forEach(function (e) {
      seen[e.id] = 1;
      var h = hud.enemies[e.id];
      if (!h) {
        var b = el('button', 'ef click'); b.type = 'button';
        var top = el('span', 'top'), nm = el('span', null, e.name), tg = el('small'); top.appendChild(nm); top.appendChild(tg); b.appendChild(top);
        var bar = el('span', 'bar'), fill = el('i'); bar.appendChild(fill); b.appendChild(bar);
        b.addEventListener('click', function () { input.target = e.id; });
        host.appendChild(b); h = hud.enemies[e.id] = { el: b, fill: fill, tg: tg };
      }
      setBar(h.fill, e.hp / e.maxHp);
      var t = e.target != null ? Sim.ent(S, e.target) : null;
      h.tg.textContent = t ? 'on ' + t.name : '';
      h.el.classList.toggle('sel', human.target === e.id);
    });
    for (var id in hud.enemies) if (!seen[id]) { hud.enemies[id].el.remove(); delete hud.enemies[id]; }

    var tf = $('#targetFrame'), t = human.target != null ? Sim.ent(S, human.target) : null;
    if (t) {
      tf.className = t.kind === 'player' ? 'friend' : '';
      $('#tName').textContent = t.name; $('#tInfo').textContent = Math.ceil(t.hp) + ' / ' + t.maxHp + '   ' + Math.round(Sim.dist(human, t)) + 'm';
      setBar(tf.querySelector('.bar > i'), t.hp / t.maxHp);
    } else { tf.className = ''; $('#tName').textContent = 'No target'; $('#tInfo').textContent = 'Tab for an enemy, F1 to F4 for the squad'; setBar(tf.querySelector('.bar > i'), 0); }

    var mc = $('#myCast');
    if (human.cast) { mc.classList.add('on'); setBar(mc.firstElementChild, human.cast.t / human.cast.dur); mc.lastElementChild.textContent = human.cast.ab.name.toUpperCase(); }
    else mc.classList.remove('on');
    setBar($('#myHp > i'), human.hp / human.maxHp);
    $('#myHp > span').textContent = human.alive ? Math.ceil(human.hp) + ' / ' + human.maxHp : (watching ? human.name + ' IS DOWN' : 'YOU ARE DOWN');
    if (hud.wpn !== human.weapon) buildActions();
    if (hud.wname !== human.weapon) {
      hud.wname = human.weapon; $('#weapon').innerHTML = '';
      $('#weapon').appendChild(el('b', 'display', human.kit.weapons[human.weapon].name));
    }
    // One chip per talent showing its live state, so you can see what your build is doing.
    var gl = Sim.talentChips(human);
    var gtxt = gl.map(function (x) { return x[0] + (x[1] ? '' : '~'); }).join('|');
    if (gtxt !== hud.gtxt) {
      hud.gtxt = gtxt; var gh = $('#gearline'); gh.innerHTML = '';
      gl.forEach(function (x) { gh.appendChild(el('span', 'gchip' + (x[1] ? ' on' : ''), x[0])); });
    }
    hud.abs.forEach(function (h, i) {
      var cd = human.cds[h.a.id] || 0, g = h.a.gcd ? human.gcd : 0, frac = 0;
      if (cd > g) frac = cd / h.a.cd; else if (g > 0) frac = g / Sim.GCD;
      h.cool.style.height = (frac * 100).toFixed(0) + '%';
      h.sec.textContent = cd > 1.5 ? Math.ceil(cd) : '';
      var u = Sim.usable(S, human, i), label = '', duty = false, glow = '';
      if (h.a.role === 'ult') {
        var full = (human.ult || 0) >= 100;
        if (h.meter) h.meter.style.transform = 'scaleX(' + Math.min(1, (human.ult || 0) / 100).toFixed(2) + ')';
        duty = full && !!S.hero && S.hero.role === human.role;
        label = duty ? 'HERO MOMENT' : full ? 'READY' : Math.floor(human.ult || 0) + '%';
        glow = duty ? 'hero' : full ? 'ultready' : '';
      }
      else if (h.a.role === 'proc' && human.procT > 0) { label = 'PROC ' + Math.ceil(human.procT) + 's'; glow = 'proc'; }
      else if (h.a.role === 'spend' && u.state !== 'range') label = Sim.resOf(human).spend === 'all' ? Math.floor(human.pips || 0) + ' ' + Sim.resOf(human).name.toUpperCase() : 'COSTS ' + Sim.resOf(human).spend;
      else if (h.a.id === 'smash') { label = human.charging ? 'WINDING ' + Math.round((human.charge || 0) / Sim.TUNE.smashCharge * 100) + '%' : human.barrierUp ? 'BARRIER UP' : 'HOLD'; if (human.charging && human.charge >= Sim.TUNE.smashCharge) glow = 'proc'; }
      else if (h.a.id === 'ebarrier') { label = human.barrierBroken > 0 ? 'BROKEN ' + Math.ceil(human.barrierBroken) + 's' : (human.barrierUp ? 'UP ' : 'HOLD ') + Math.round((human.barrier == null ? Sim.TUNE.barrierHp : human.barrier) / Sim.TUNE.barrierHp * 100) + '%'; if (human.barrierUp) glow = 'ultready'; }
      else if (h.a.id === 'vent' && (human.pips || 0) >= 85) { label = 'PERFECT'; glow = 'proc'; }
      else if (h.a.id === 'screen' && human.screen > 0) label = 'UP ' + Math.ceil(human.screen) + 's';
      else if ((h.a.id === 'spin' || h.a.id === 'sweep') && human.jam > 0) label = 'JAMMED';
      else if (h.a.cost && u.state !== 'range') label = 'COSTS ' + h.a.cost;
      else if (u.state === 'range') label = 'OUT OF RANGE';
      else if (u.behind) label = 'BEHIND +50%';
      else if (h.a.kind === 'friend' && u.tgt) label = u.tgt.id === human.id ? 'ON YOU' : 'ON ' + u.tgt.name;
      else if (h.a.cast > 0 && human.moving && u.state === 'ok' && human.gear.boots !== 'mag' && !(human.momentum > 0 && human.gear.boots === 'stim')) label = 'STAND STILL';
      var st = u.state + label + glow;
      if (st !== h.state) {
        h.state = st; h.tl.textContent = label;
        ['proc', 'ultready', 'hero'].forEach(function (c) { h.el.classList.toggle(c, glow === c); });
        h.el.classList.toggle('oor', u.state === 'range' || label === 'STAND STILL');
        h.el.classList.toggle('na', u.state === 'notarget' || u.state === 'dead' || u.state === 'idle' || (u.state === 'locked' && !glow));
      }
    });
    var pipN = Math.floor(human.pips || 0), RS2 = Sim.resOf(human);
    if (hud.pips && pipN !== hud.pipState) {
      hud.pipState = pipN;
      hud.pips.forEach(function (pi, n) { pi.classList.toggle('on', n < pipN); });
      if (hud.resBar) { hud.resBar.style.transform = 'scaleX(' + (pipN / RS2.max).toFixed(2) + ')'; hud.resNum.textContent = pipN + (RS2.id === 'spin' && human.jam > 0 ? '  JAMMED' : RS2.id === 'spin' && pipN >= 85 ? '  PERFECT VENT' : ''); }
      $('#pips').classList.toggle('full', pipN >= RS2.max);
      $('#pips').classList.toggle('redline', RS2.id === 'spin' && pipN >= 85);
      $('#pips').classList.toggle('low', RS2.id === 'nanites' && pipN < RS2.min);
    }
    var danger = human.alive && S.telegraphs.some(function (g) { return Sim.inTele(g, human); });
    $('#hud').classList.toggle('danger', danger);
    if (toastT > 0) { toastT -= 1 / 60; if (toastT <= 0) $('#toast').textContent = ''; }
  }

  function hitFlash() {
    var f = $('#flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }

  /* ---------- effects ---------- */
  var FX_COLOR = { shock: 0xb98cff, core: 0xd9b8ff, rocket: 0xff9a40, volley: 0xffd080, link: 0x4fd88f, surge: 0x9dffc8, bio: 0x9be25a, purge: 0xc8ff7a, hammer: 0xffb000, blast: 0xffe2a0, shell: 0xffb000, kick: 0xffffff, spin: 0xffd36b, suppress: 0xff9a40, shield: 0x7fd0ff, snipe: 0xffffff, tap: 0x9ad8ff, saw: 0x5cc8ff, sawbig: 0xbfeaff, razor: 0x9ad8ff };
  var FX_WIDTH = { shock: 0.07, core: 0.16, rocket: 0.12, volley: 0.28, link: 0.08, surge: 0.18, bio: 0.1, purge: 0.06, hammer: 0.22, blast: 0.3, shell: 0.12, kick: 0.1, spin: 0.06, suppress: 0.2, shield: 0.14, snipe: 0.05, tap: 0.05, saw: 0.18, sawbig: 0.32, razor: 0.06 };
  var FX_SOUND = { shock: 'shock', core: 'core', rocket: 'rocket', volley: 'combo', link: 'link', surge: 'surge', bio: 'purge', purge: 'purge', hammer: 'hammer', blast: 'hammer', shell: 'flak', kick: 'kick', spin: 'shock', suppress: 'rocket', shield: 'belt', snipe: 'core', tap: 'razor', saw: 'saw', sawbig: 'saw', razor: 'razor' };
  function addFx(mesh, life, tick) { fxRoot.add(mesh); fx.push({ m: mesh, t: 0, life: life, tick: tick }); }
  function beamFx(a, b, kind) {
    var va = views[a], vb = views[b]; if (!va || !vb || a === b) return;
    var p1 = new THREE.Vector3(va.g.position.x, 1.3, va.g.position.z), ea = Sim.ent(S, b);
    var p2 = new THREE.Vector3(vb.g.position.x, ea ? entHeight(ea) * 0.55 : 1.3, vb.g.position.z);
    var len = p1.distanceTo(p2), w = FX_WIDTH[kind] || 0.1;
    var m = new THREE.Mesh(new THREE.CylinderGeometry(w, w, len, 6, 1, true), new THREE.MeshBasicMaterial({ color: FX_COLOR[kind] || 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(p1).lerp(p2, 0.5); m.lookAt(p2); m.rotateX(Math.PI / 2);
    addFx(m, 0.28, function (f, k) { f.m.material.opacity = 1 - k; });
  }
  function ringFx(x, z, r0, r1, color, life) {
    var m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ color: color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.12, z);
    addFx(m, life, function (f, k) { var s = r0 + (r1 - r0) * k; f.m.scale.set(s, s, 1); f.m.material.opacity = 1 - k; });
  }
  function cleaveFx(boss) {
    var m = new THREE.Mesh(new THREE.CircleGeometry(7, 24, -0.75, 1.5), new THREE.MeshBasicMaterial({ color: 0xff4a36, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    // Lay the wedge flat (X), then turn it to the Foreman's facing (Y).
    m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, boss.facing - Math.PI / 2, 0); m.position.set(boss.x, 0.15, boss.z);
    addFx(m, 0.3, function (f, k) { f.m.material.opacity = 0.7 * (1 - k); });
  }
  function floatText(id, text, cls) {
    var v = views[id], e = Sim.ent(S, id); if (!v) return;
    var pt = project(v.g.position.x + (Math.random() - 0.5), (e ? entHeight(e) : 2) + 0.4, v.g.position.z); if (!pt) return;
    var d = el('div', 'float ' + cls, text); d.style.left = pt.x + 'px'; d.style.top = pt.y + 'px';
    var host = $('#floaters'); host.appendChild(d); if (host.children.length > 40) host.removeChild(host.firstChild);
    setTimeout(function () { d.remove(); }, 900);
  }
  var pv = new THREE.Vector3();
  function project(x, y, z) {
    pv.set(x, y, z).project(camera); if (pv.z > 1) return null;
    return { x: (pv.x * 0.5 + 0.5) * stage.clientWidth, y: (-pv.y * 0.5 + 0.5) * stage.clientHeight };
  }

  /* A talent going off. Each class has its own colour and sound so you can hear your partner's build working.
     Squad-wide procs (Hold the Line, Meat Shield, Clear!) are called to everyone; personal ones only to their owner. */
  var PROC_SOUND = { tank: 'challenge', healer: 'keg', dps: 'combo', melee: 'saw' };
  function procFx(ev) {
    var v = views[ev.id], col = ROLE_COLOR[ev.role] || 0xffffff, mine = ev.id === human.id;
    if (v) {
      var x = v.g.position.x, z = v.g.position.z, big = ev.scope === 'all';
      ringFx(x, z, 0.5, big ? 12 : 4, col, big ? 0.7 : 0.5);
      if (ev.talent === 'bash' || ev.talent === 'rally') ringFx(x, z, 0.5, ev.talent === 'rally' ? 15 : 8, 0xffffff, 0.3);
    }
    if ((mine && !watching) || ev.scope === 'all' || (watching && mine)) {
      var by = mine ? '' : '  /  ' + (Sim.ent(S, ev.id) || {}).name;
      announce(ev.text + (mine ? '' : by), ev.talent === 'meatshield' || ev.talent === 'decoy' ? 'neutral' : 'good', true);
      Snd.play(PROC_SOUND[ev.role] || 'good');
    }
  }
  function drainEvents() {
    S.events.forEach(function (ev) {
      var v;
      switch (ev.type) {
        case 'dmg':
          var dst = Sim.ent(S, ev.dst);
          if (stats[ev.src] && (!dst || dst.kind === 'enemy')) stats[ev.src].dmg += ev.amt;
          if (stats[ev.dst]) stats[ev.dst].taken += ev.amt;
          if (ev.src === human.id) {
            floatText(ev.dst, String(ev.amt) + (ev.crit || /!$/.test(ev.label) ? '!' : ''), 'out' + (ev.crit ? ' crit' : '') + (ev.sh ? ' sh' : ''));
            if (ev.crit) Snd.play('crit');
          }
          else if (ev.dst === human.id) {
            floatText(ev.dst, '-' + ev.amt, 'in'); Snd.play('hurt');
            if (ev.amt >= 250) hitFlash();
          }
          break;
        case 'heal':
          if (stats[ev.src]) stats[ev.src].heal += ev.amt;
          if (ev.amt > 0 && (ev.src === human.id || ev.dst === human.id)) floatText(ev.dst, '+' + ev.amt + (ev.crit ? '!' : ''), 'heal' + (ev.crit ? ' crit' : ''));
          break;
        case 'beam': beamFx(ev.src, ev.dst, ev.fx); if (ev.src === human.id) Snd.play(FX_SOUND[ev.fx]); break;
        case 'fx':
          v = views[ev.src]; if (!v) break;
          var x = v.g.position.x, z = v.g.position.z;
          if (ev.src === human.id && /^(flak|challenge|belt|keg)$/.test(ev.fx)) Snd.play(ev.fx);
          if (ev.fx === 'charge') { Snd.play('charge'); ringFx(x, z, 2, 8, 0xff4a36, 0.5); }
          else if (ev.fx === 'cleave') { var bf = Sim.ent(S, ev.src); if (bf) cleaveFx(bf); }
          else if (ev.fx === 'glob') ringFx(x, z, 1, 7, 0x9be25a, 0.5);
          else if (ev.fx === 'adren') ringFx(x, z, 0.5, 3, 0xb98cff, 0.4);
          else if (ev.fx === 'pump') { ringFx(x, z, 0.5, 4, 0xff4a36, 0.5); if (ev.src === human.id) { announce('ADRENAL PUMP', 'bad', true); Snd.play('challenge'); } }
          else if (ev.fx === 'guard') ringFx(x, z, 0.5, 2.5, 0xffb000, 0.5);
          else if (ev.fx === 'opportunist') { ringFx(x, z, 0.5, 4, 0xff4a36, 0.5); if (ev.src === human.id && !watching) { announce('OPPORTUNIST', 'good', true); Snd.play('challenge'); } }
          else if (ev.fx === 'lifeline') { ringFx(x, z, 0.5, 4, 0x4fd88f, 0.6); if (ev.src === human.id && !watching) announce('LIFELINE', 'good', true); }
          else if (ev.fx === 'combo') { ringFx(x, z, 1, 6, 0xd9b8ff, 0.4); Snd.play('combo'); }
          else if (ev.fx === 'wall' || ev.fx === 'hospital') { ringFx(x, z, 0.5, ev.fx === 'wall' ? 14 : 40, ev.fx === 'wall' ? 0xffb000 : 0x4fd88f, 0.9); Snd.play('ult'); }
          else if (ev.fx === 'oshield') { ringFx(x, z, 6, 3, 0x7fd0ff, 0.6); Snd.play('alarm'); }
          else if (ev.fx === 'shieldbreak') { ringFx(x, z, 3, 12, 0x7fd0ff, 0.7); ringFx(x, z, 2, 8, 0xffffff, 0.4); Snd.play('boom'); }
          else if (ev.fx === 'smash') {
            var sp = Sim.ent(S, ev.src), ff = sp ? sp.facing : 0;
            ringFx(x + Math.sin(ff) * 3, z + Math.cos(ff) * 3, 0.5, 3 + 4 * (ev.pw || 0), 0xffb000, 0.4);
            Snd.play('hammer'); if (ev.src === human.id && ev.pw >= 0.95) hitFlash();
          }
          else if (ev.fx === 'barrierup') { if (ev.src === human.id) Snd.play('belt'); }
          else if (ev.fx === 'barrierbreak') { ringFx(x, z, 0.5, 6, 0x5cc8ff, 0.6); Snd.play('boom'); }
          else if (ev.fx === 'leap') { ringFx(x, z, 1, 9, 0xff8a30, 0.6); Snd.play('boom'); hitFlash(); }
          if (ev.fx === 'barrage') Snd.play('alarm');
          if (ev.fx === 'flak') ringFx(x, z, 1, 8, 0xffb000, 0.35);
          else if (ev.fx === 'challenge') ringFx(x, z, 1, 30, 0xff4a36, 0.6);
          else if (ev.fx === 'keg') ringFx(x, z, 1, 22, 0x4fd88f, 0.7);
          else if (ev.fx === 'overcharge') ringFx(x, z, 3, R, 0x5cc8ff, 0.7);
          else if (ev.fx === 'sludge') ringFx(x, z, 0.5, 3, 0x9be25a, 0.6);
          break;
        case 'boom': Snd.play('boom'); ringFx(ev.x, ev.z, 0.5, ev.r, 0xff7a30, 0.5); ringFx(ev.x, ev.z, 0.2, ev.r * 0.6, 0xffe0a0, 0.3); break;
        case 'blink': if (ev.id === human.id) Snd.play(ev.fx === 'dash' ? 'saw' : 'trans'); v = views[ev.id]; if (v) { ringFx(ev.fromX, ev.fromZ, 0.3, 2.5, 0xb98cff, 0.4); var e = Sim.ent(S, ev.id); v.g.position.set(e.x, 0, e.z); ringFx(e.x, e.z, 2.5, 0.3, 0xb98cff, 0.4); } break;
        case 'proc': procFx(ev); break;
        case 'procready':
          v = views[ev.id];
          if (v) ringFx(v.g.position.x, v.g.position.z, 0.3, 3, ROLE_COLOR[ev.role] || 0xffffff, 0.35);
          if (ev.id === human.id && !watching) { Snd.play('proc'); logLine(ev.name + ' is ready. Press 3.'); }
          break;
        case 'hero': if (ev.role === human.role) Snd.play('hero'); break;
        case 'collapse': Snd.play('boom'); hitFlash(); break;
        case 'missiledown': Snd.play('boom'); ringFx(ev.x, ev.z, 0.5, 6, 0xffd36b, 0.6); ringFx(ev.x, ev.z, 0.2, 3, 0xffffff, 0.4); break;
        case 'revive':
          v = views[ev.id]; if (v) { ringFx(v.g.position.x, v.g.position.z, 4, 0.3, ROLE_COLOR.healer, 0.8); ringFx(v.g.position.x, v.g.position.z, 0.3, 6, 0xffffff, 0.4); }
          Snd.play('combo'); break;
        case 'death': if (ev.id === human.id || ev.id === S.bossId) Snd.play('death'); v = views[ev.id]; if (v && v.kind === 'enemy') ringFx(v.g.position.x, v.g.position.z, 0.5, 5, 0xff4a36, 0.6); break;
        case 'kicked': if (ev.src === human.id || watching) Snd.play('kick'); break;
        case 'assign':
          if (ev.id === human.id && !watching) { announce('YOUR INTERRUPT', 'neutral', true); Snd.play('alarm'); }
          break;
        case 'absorb':
          if (ev.id === human.id || ev.by === human.id) { floatText(ev.id, (ev.barrier ? 'BLOCKED ' : ev.wall ? 'WALLED ' : 'PLATED ') + ev.amt, 'heal'); if (ev.id === human.id) Snd.play('belt'); }
          v = views[ev.id]; if (v) ringFx(v.g.position.x, v.g.position.z, 0.5, 2.5, 0xffb000, 0.4);
          break;
        case 'knock': if (ev.id === human.id) hitFlash(); break;
        case 'announce': announce(ev.src === human.id && ev.you && !watching ? ev.you : ev.text, ev.tone, ev.quick); Snd.play(ev.quick && ev.text !== 'FIGHT' ? 'tick' : ev.tone === 'bad' ? 'bad' : 'good'); break;
        case 'log': logLine(ev.id === human.id && ev.you && !watching ? ev.you : ev.text); break;
        case 'error': if (ev.id != null && ev.id !== human.id) break; $('#toast').textContent = ev.text; toastT = 1.2; Snd.play('error'); break;
      }
    });
    S.events.length = 0;
  }

  function syncViews(dt) {
    var seen = {}, k = Math.min(1, dt * 16);
    S.ents.forEach(function (e) {
      seen[e.id] = 1;
      var v = views[e.id] || (views[e.id] = makeView(e));
      v.g.position.x += (e.x - v.g.position.x) * k; v.g.position.z += (e.z - v.g.position.z) * k;
      var d = e.facing - v.holder.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      v.holder.rotation.y += d * Math.min(1, dt * 12);
      if (!e.alive && !v.dead) { v.dead = true; v.holder.rotation.x = -Math.PI / 2; v.holder.position.y = 0.4; v.plate.style.opacity = 0.4; }
      else if (e.alive && v.dead) { v.dead = false; v.holder.rotation.x = 0; v.holder.position.y = 0; v.plate.style.opacity = 1; }
      if (e.type === 'drone') v.holder.position.y = 0.5 + Math.sin(S.t * 3 + e.id) * 0.2;
      v.ring.visible = human.target === e.id && e.alive;
      if (v.ring.visible) v.ring.material.color.setHex(e.kind === 'player' ? 0x4fd88f : 0xff4a36);
      v.aura.visible = e.kind === 'player' && e.alive && (e.belt > 0 || e.sludge > 0 || e.dome > 0 || e.rad > 0);
      if (v.aura.visible) v.aura.material.color.setHex(e.dome > 0 ? 0x4fd88f : e.rad > 0 ? 0xd4ff3a : e.belt > 0 ? 0xffb000 : 0x9be25a);
      if (e.type === 'boss') v.holder.rotation.z = e.stagger > 0 ? 0.22 * Math.sin(S.t * 9) : 0;
      var pt = project(v.g.position.x, entHeight(e) + 0.5, v.g.position.z);
      if (pt) { v.plate.style.display = ''; v.plate.style.left = pt.x + 'px'; v.plate.style.top = pt.y + 'px'; setBar(v.fill, e.hp / e.maxHp); }
      else v.plate.style.display = 'none';
    });
    for (var id in views) if (!seen[id]) dropView(id);
    syncSpecials();

    var tseen = {};
    S.telegraphs.forEach(function (g) {
      tseen[g.id] = 1;
      var m = teleViews[g.id];
      if (!m && g.shape === 'line') {
        m = new THREE.Group();
        var len = Math.hypot(g.x2 - g.x1, g.z2 - g.z1);
        var lb = new THREE.Mesh(new THREE.PlaneGeometry(g.w, len), new THREE.MeshBasicMaterial({ color: 0xff4a36, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
        var lf = new THREE.Mesh(new THREE.PlaneGeometry(g.w, len), new THREE.MeshBasicMaterial({ color: 0xff4a36, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
        var le = new THREE.Mesh(new THREE.EdgesGeometry(new THREE.PlaneGeometry(g.w, len)), new THREE.LineBasicMaterial({ color: 0xff4a36 }));
        lf.position.z = 0.01; le.position.z = 0.02;
        var inner = new THREE.Group(); inner.add(lb); inner.add(lf); inner.add(le);
        inner.rotation.x = -Math.PI / 2; m.add(inner); m.fill = lf;
        m.position.set((g.x1 + g.x2) / 2, 0.09, (g.z1 + g.z2) / 2); m.rotation.y = Math.atan2(g.x2 - g.x1, g.z2 - g.z1);
        fxRoot.add(m); teleViews[g.id] = m;
      }
      if (!m && g.shape === 'sector') {
        // A floor section: our angles run from +z towards +x; three's ring theta runs from +x, so shift by a quarter turn.
        m = new THREE.Group();
        var th0 = g.a0 - Math.PI / 2, thl = g.a1 - g.a0;
        var sb = new THREE.Mesh(new THREE.RingGeometry(g.r0, g.r1, 40, 1, th0, thl), new THREE.MeshBasicMaterial({ color: 0xff4a36, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
        var se = new THREE.Mesh(new THREE.RingGeometry(g.r0, g.r0 + 0.25, 40, 1, th0, thl), new THREE.MeshBasicMaterial({ color: 0xff4a36, side: THREE.DoubleSide }));
        se.position.z = 0.02; m.add(sb); m.add(se); m.fill = sb; m.sector = true;
        m.rotation.x = -Math.PI / 2; m.position.y = 0.08; fxRoot.add(m); teleViews[g.id] = m;
      }
      if (!m) {
        m = new THREE.Group();
        var base = new THREE.Mesh(new THREE.CircleGeometry(g.r, 40), new THREE.MeshBasicMaterial({ color: 0xff4a36, transparent: true, opacity: 0.22, depthWrite: false }));
        var fill = new THREE.Mesh(new THREE.CircleGeometry(g.r, 40), new THREE.MeshBasicMaterial({ color: 0xff4a36, transparent: true, opacity: 0.45, depthWrite: false }));
        var edge = new THREE.Mesh(new THREE.RingGeometry(g.r - 0.18, g.r, 48), new THREE.MeshBasicMaterial({ color: 0xff4a36, side: THREE.DoubleSide }));
        fill.position.z = 0.01; edge.position.z = 0.02; m.add(base); m.add(fill); m.add(edge); m.fill = fill;
        m.rotation.x = -Math.PI / 2; m.position.set(g.x, 0.08, g.z); fxRoot.add(m); teleViews[g.id] = m;
      }
      var s = Math.max(0.01, g.t / g.dur);
      if (m.sector) {
        if (g.down) { m.fill.material.color.setHex(0x2a0806); m.fill.material.opacity = 0.85; }
        else m.fill.material.opacity = 0.15 + 0.45 * Math.min(1, s);
      }
      else if (g.shape === 'line') m.fill.scale.set(s, 1, 1); else m.fill.scale.set(s, s, 1);
      if (g.leap && !m.tinted) { m.tinted = true; m.children.forEach(function (c) { if (c.material) c.material.color.setHex(0xff8a30); }); }
    });
    for (var t in teleViews) if (!tseen[t]) { fxRoot.remove(teleViews[t]); delete teleViews[t]; }

    for (var i = fx.length - 1; i >= 0; i--) {
      var f = fx[i]; f.t += dt; var kk = Math.min(1, f.t / f.life); f.tick(f, kk);
      if (kk >= 1) { fxRoot.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); fx.splice(i, 1); }
    }
  }

  function placeCamera(tx, tz) {
    // Pull the camera in so it never ends up behind the arena wall or a pillar.
    // The wall only draws its inner face, so a camera outside it sees straight in. Hide the pillars on that side.
    var cp = Math.cos(cam.pitch), d = cam.dist, sx = Math.sin(cam.yaw) * cp, sz = Math.cos(cam.yaw) * cp;
    for (var i = 0; i < 24 && Math.hypot(tx + sx * d, tz + sz * d) > 44 && d > 6; i++) d *= 0.93;
    camera.position.set(tx + sx * d, 1.5 + Math.sin(cam.pitch) * d, tz + sz * d);
    var cr = Math.hypot(camera.position.x, camera.position.z), ca = Math.atan2(camera.position.x, camera.position.z);
    pillars.forEach(function (p) {
      var da = Math.abs(p.userData.ang - ca); if (da > Math.PI) da = Math.PI * 2 - da;
      p.visible = !(cr > R - 4 && da < 0.9);
    });
    camera.lookAt(tx, 1.6, tz);
  }

  // Fade the Foreman when he stands between the camera and the player you are controlling or watching.
  function fadeOccluder(hv) {
    var boss = Sim.ent(S, S.bossId), bv = boss && views[boss.id];
    if (!bv || !hv) return;
    var cx = camera.position.x, cz = camera.position.z, px = hv.g.position.x, pz = hv.g.position.z;
    var vx = px - cx, vz = pz - cz, l2 = vx * vx + vz * vz || 1;
    var t = Math.max(0, Math.min(1, ((bv.g.position.x - cx) * vx + (bv.g.position.z - cz) * vz) / l2));
    var d = Math.hypot(cx + vx * t - bv.g.position.x, cz + vz * t - bv.g.position.z);
    var hide = boss.alive && t > 0.05 && t < 0.98 && d < boss.radius + 1.5;
    if (bv.faded === hide) return;
    bv.faded = hide;
    bv.holder.traverse(function (o) {
      if (!o.material) return;
      [].concat(o.material).forEach(function (m) { m.transparent = hide || m.userData.wasTransparent; if (m.userData.wasTransparent === undefined) m.userData.wasTransparent = false; m.opacity = hide ? 0.22 : 1; m.depthWrite = !hide; m.needsUpdate = true; });
    });
  }

  /* On the self-hosted site, each finished fight is recorded for the /stats page. The host records squad fights;
     clients don't, so nothing is counted twice. Nothing identifies the players. */
  function recordFight(abandoned) {
    if (!window.S4Transport || !S || Net.mode === 'client' || Net.mode === 'spy' || S.recorded || !Sim.summary) return;
    if (abandoned && S.t < 20) return;   // a quick look-around isn't a fight
    S.recorded = true;
    var run = Sim.summary(S, { build: BUILD, mode: watching ? 'watch' : Net.mode === 'host' ? 'squad' : 'solo' });
    try {
      fetch('api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run), keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  function endFight() {
    running = false;
    recordFight(false);
    var win = S.result === 'win', boss = Sim.ent(S, S.bossId);
    var t = $('#endTitle'); t.textContent = win ? 'Floor cleared' : 'Squad terminated'; t.className = 'display ' + (win ? 'win' : 'wipe');
    $('#endLine').textContent = (win ? 'The lift to floor 02 is unlocked.' : 'The Foreman had ' + Math.ceil(boss.hp / boss.maxHp * 100) + '% left.')
      + (human.lastDeath ? '  ' + (watching ? human.name + ' went' : 'You went') + ' down to ' + human.lastDeath.label + ' at ' + fmtTime(human.lastDeath.t) + '.' : '');
    var best = null, isNew = false, key = 's4-best-' + role;
    try { best = parseFloat(localStorage.getItem(key)) || null; } catch (e) {}
    if (win && !watching && (!best || S.t < best)) { isNew = true; best = S.t; try { localStorage.setItem(key, String(S.t)); } catch (e) {} }
    $('#endTime').textContent = 'TIME ON FLOOR ' + fmtTime(S.t);
    if (watching) best = null;
    $('#endBest').textContent = best ? 'BEST AS ' + human.kit.title.toUpperCase() + ' ' + fmtTime(best) + (isNew ? '  NEW' : '') : '';
    var inSquad = Net.mode !== 'solo' && Net.mode !== 'spy';
    if (Net.mode === 'spy') { $('#again').textContent = 'Wait for the next pull'; $('#change').textContent = 'Back to rooms'; }
    else {
      $('#again').textContent = inSquad ? 'Back to the squad' : watching ? 'Watch another' : 'Run it back';
      $('#change').textContent = inSquad ? 'Leave the squad' : watching ? 'Back to briefing' : 'Change role';
    }
    $('#regear').style.display = watching || inSquad ? 'none' : '';
    if (Net.mode === 'host') Net.postEnd = 3;
    setTimeout(showUpdateBanner, 1700);
    var tb = $('#meters'); tb.innerHTML = '';
    Sim.players(S).forEach(function (p) {
      var tr = el('tr'), s = stats[p.id];
      tr.appendChild(el('td', null, p.name)); tr.appendChild(el('td', 'role-' + p.role, p.kit.title));
      [s.dmg, s.heal, s.taken].forEach(function (n) { tr.appendChild(el('td', 'num', Math.round(n).toLocaleString())); });
      tb.appendChild(tr);
    });
    setTimeout(function () { $('#hud').classList.remove('on'); $('#end').classList.add('on'); }, 1600);
  }

  function setMute(m) { $('#mute').textContent = m ? 'Sound off' : 'Sound on'; $('#mute').setAttribute('aria-pressed', m ? 'false' : 'true'); }

  /* Things that aren't entities: the overcharge bubble, Riot Walls and their shelter, the Heavy Rocket. */
  var special = { walls: {} };
  function syncSpecials() {
    var boss = Sim.ent(S, S.bossId), bv = boss && views[boss.id];
    if (!special.bubble) {
      special.bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.22, depthWrite: false }));
      special.rocket = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
      fxRoot.add(special.bubble); fxRoot.add(special.rocket);
    }
    special.bubble.visible = !!(boss && boss.alive && boss.oshield && bv);
    if (special.bubble.visible) {
      var rr = (boss.radius || 3.5) + 1.8; special.bubble.scale.set(rr, rr * 1.4, rr);
      special.bubble.position.set(bv.g.position.x, 2.5, bv.g.position.z);
      special.bubble.material.opacity = 0.12 + 0.18 * (boss.oshield.hp / boss.oshield.max);
    }
    special.rocket.visible = !!S.missile;
    if (S.missile) special.rocket.position.set(S.missile.x, 3 + Math.sin(S.t * 10) * 0.2, S.missile.z);
    var seenW = {};
    Sim.players(S).forEach(function (p) {
      if (!(p.wall > 0) || !p.alive || !boss || !boss.alive) return;
      seenW[p.id] = 1;
      var w = special.walls[p.id];
      if (!w) {
        w = new THREE.Group();
        var pane = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
        pane.position.set(0, 2, 2.2); w.add(pane);
        // The shelter: a wedge on the floor behind the tank, away from the Foreman.
        var shade = new THREE.Mesh(new THREE.CircleGeometry(14, 32, Math.PI / 4, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4fd88f, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
        shade.rotation.x = -Math.PI / 2; shade.position.y = 0.07; w.add(shade);
        fxRoot.add(w); special.walls[p.id] = w;
      }
      var pv2 = views[p.id] ? views[p.id].g.position : p;
      w.position.set(pv2.x, 0, pv2.z);
      w.rotation.y = Math.atan2(boss.x - pv2.x, boss.z - pv2.z);
    });
    for (var wid in special.walls) if (!seenW[wid]) { fxRoot.remove(special.walls[wid]); delete special.walls[wid]; }
    // Impact Hammer barriers, and your own aim arc so you can see what a smash will hit.
    special.barriers = special.barriers || {};
    var seenB = {};
    Sim.players(S).forEach(function (p) {
      if (!p.barrierUp || !p.alive) return;
      seenB[p.id] = 1;
      var bw = special.barriers[p.id];
      if (!bw) {
        bw = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.6), new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
        fxRoot.add(bw); special.barriers[p.id] = bw;
      }
      var bp = views[p.id] ? views[p.id].g.position : p;
      bw.position.set(bp.x + Math.sin(p.facing) * 1.6, 1.8, bp.z + Math.cos(p.facing) * 1.6);
      bw.rotation.y = p.facing;
      bw.material.opacity = 0.15 + 0.4 * ((p.barrier || 0) / Sim.TUNE.barrierHp);
    });
    for (var bid in special.barriers) if (!seenB[bid]) { fxRoot.remove(special.barriers[bid]); delete special.barriers[bid]; }
    var showArc = running && !watching && human && human.alive && Sim.aimWeapon(human) && !human.barrierUp;
    if (!special.arc) {
      special.arc = new THREE.Mesh(new THREE.CircleGeometry(6.5, 24, Math.PI / 2 - Math.PI / 3, Math.PI * 2 / 3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
      special.arc.rotation.order = 'YXZ'; fxRoot.add(special.arc);
    }
    special.arc.visible = !!showArc;
    if (showArc) {
      var hp0 = views[human.id] ? views[human.id].g.position : human;
      special.arc.position.set(hp0.x, 0.09, hp0.z);
      special.arc.rotation.set(-Math.PI / 2, human.facing + Math.PI, 0);
      special.arc.material.opacity = 0.22 + (human.charging ? 0.4 * Math.min(1, (human.charge || 0) / Sim.TUNE.smashCharge) : 0);
    }
  }

  /* ---------- input ---------- */
  function cycleEnemy(dir) {
    var list = Sim.enemies(S); if (!list.length) return;
    var i = -1; list.forEach(function (e, n) { if (e.id === human.target) i = n; });
    input.target = list[(i + dir + list.length) % list.length].id;
  }
  window.addEventListener('keydown', function (ev) {
    if (!running) return;
    var c = ev.code;
    if (watching) {
      var squad = Sim.players(S), at = squad.indexOf(human);
      if (c === 'Tab') { ev.preventDefault(); follow(squad[(at + (ev.shiftKey ? -1 : 1) + squad.length) % squad.length]); return; }
      if (/^(Digit|F)[1-4]$/.test(c)) { ev.preventDefault(); follow(squad[+c[c.length - 1] - 1]); return; }
      if (c === 'KeyM') { setMute(Snd.toggle()); return; }
      if (c.indexOf('Arrow') === 0 || c === 'Space') ev.preventDefault();
      return;
    }
    if (c === 'Tab') { ev.preventDefault(); cycleEnemy(ev.shiftKey ? -1 : 1); return; }
    if (/^F[1-4]$/.test(c)) { ev.preventDefault(); var p = Sim.players(S)[+c[1] - 1]; if (p) input.target = p.id; return; }
    if (/^Digit[1-4]$/.test(c) && ev.shiftKey) { var q = Sim.players(S)[+c[5] - 1]; if (q) input.target = q.id; return; }
    if (c === 'KeyM') { setMute(Snd.toggle()); return; }
    if (c === 'Space') { ev.preventDefault(); input.jump = true; return; }
    if (c === 'KeyR') c = 'Digit6';
    // Aimed weapons (the Impact Hammer): 1 and 2 are held, not pressed.
    if ((c === 'Digit1' || c === 'Digit2') && Sim.aimWeapon(human)) { keys[c] = true; return; }
    if (/^Digit[1-6]$/.test(c)) { input.ability = +c[5] - 1; var h = hud.abs[input.ability]; if (h) { h.el.classList.add('flash'); setTimeout(function () { h.el.classList.remove('flash'); }, 120); } return; }
    if (c === 'Escape') { input.target = null; return; }
    if (c.indexOf('Arrow') === 0 || c === 'Space') ev.preventDefault();
    keys[c] = true;
  });
  window.addEventListener('keyup', function (ev) { keys[ev.code] = false; });
  window.addEventListener('blur', function () { keys = {}; });

  var drag = null;
  renderer.domElement.addEventListener('pointerdown', function (ev) { drag = { x: ev.clientX, y: ev.clientY, moved: 0 }; });
  window.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; drag.x = ev.clientX; drag.y = ev.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    cam.yaw -= dx * 0.006; cam.pitch = Math.max(0.12, Math.min(1.35, cam.pitch + dy * 0.005));
  });
  window.addEventListener('pointerup', function (ev) {
    if (drag && drag.moved < 6 && running) {
      var rect = stage.getBoundingClientRect(), mx = ev.clientX - rect.left, my = ev.clientY - rect.top, best = null, bd = 1e9;
      S.ents.forEach(function (e) {
        if (!e.alive) return;
        var pt = project(e.x, entHeight(e) * 0.5, e.z); if (!pt) return;
        var d = Math.hypot(pt.x - mx, pt.y - my), lim = e.type === 'boss' ? 110 : 48;
        if (d < lim && d / lim < bd) { bd = d / lim; best = e; }
      });
      if (best) { if (watching) { if (best.kind === 'player') follow(best); } else input.target = best.id; }
    }
    drag = null;
  });
  renderer.domElement.addEventListener('wheel', function (ev) { ev.preventDefault(); cam.dist = Math.max(8, Math.min(42, cam.dist + ev.deltaY * 0.02)); }, { passive: false });
  renderer.domElement.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  /* Where you are aiming: straight ahead of the camera. Held buttons: keyboard 1/2 or the controller's triggers. */
  function aimAngle() { return cam.yaw + Math.PI; }
  function readHold() { return [!!(keys.Digit1 || pad.hold[0]), !!(keys.Digit2 || pad.hold[1])]; }
  function readMove() {
    var f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + pad.f;
    var r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + pad.r;
    var fx_ = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    return { mx: fx_ * f + rx * r, mz: fz * f + rz * r };
  }

  /* ---------- multiplayer ----------
     Runs on the page's room capability: everyone with this page open on claude.ai can join a named squad room.
     The host simulates; everyone else sends movement as presence (continuous state) and ability presses as
     'act' messages, and renders the host's 'snap' messages. Bots fill empty roles and take over anyone who leaves. */
  var ROLE_ORDER = ['tank', 'healer', 'dps', 'melee'];
  function netStatus(t) { $('#netStatus').textContent = t; }
  var BUILD = typeof window.S4_BUILD === 'string' ? window.S4_BUILD : 'dev';
  function myName() {
    var mine = me();
    if (mine && mine.by && Net.names[mine.by]) return Net.names[mine.by];
    return callsign();
  }
  /* The version: on the briefing, faintly in the corner of the HUD, and in every fight record. */
  function showVersion() {
    var v = 'v' + Sim.VERSION + (BUILD !== 'dev' ? '  /  ' + BUILD.slice(0, 7) : '');
    $('#verTag').textContent = 'VERSION ' + v.toUpperCase();
    $('#verHud').textContent = v;
  }
  /* Admin watching: /?watch=CODE with the key saved by the admin page. Invisible to the squad. */
  function adminWatchFromUrl() {
    var code = (new URLSearchParams(location.search).get('watch') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12), key = '';
    try { key = localStorage.getItem('s4-admin-key') || ''; } catch (e) {}
    if (!code || !window.S4Transport || !window.S4Transport.spy) return;
    if (!key) { netStatus('Open /admin and enter the admin key first.'); return; }
    netStatus('Connecting to squad ' + code.toUpperCase() + ' as admin...');
    window.S4Transport.spy('s4-' + code, key).then(function (res) {
      Net.mode = 'spy'; Net.code = code; Net.spyRoom = res.api; Net.startId = null;
      var onStart = function (msg) {
        var d = msg.data || {};
        if (!d.id || !Array.isArray(d.roster) || (d.id === Net.startId && running)) return;
        if (d.build && d.build !== BUILD) { netStatus('That squad is on a different version. Reload this page after they update.'); return; }
        var roster = d.roster.filter(function (r) { return r && ROLE_ORDER.indexOf(r.role) >= 0; }).map(function (r) {
          return { role: r.role, gear: Sim.validGear(r.role, r.gear), name: String(r.name || 'Player').slice(0, 14), key: String(r.key) };
        });
        Net.startId = d.id; Net.hostPeer = msg.peer; Net.lastSnap = performance.now();
        watching = true; Net.mode = 'spy';
        beginFight(Sim.create({ humans: roster, seed: +d.seed || 1 }), null);
        logLine('Admin view. The squad cannot see you.');
      };
      res.api.on('start', onStart);
      res.api.on('snap', function (msg) {
        var snap = msg.data;
        if (!S || msg.peer !== Net.hostPeer || !snap || snap.sid !== Net.startId || !Array.isArray(snap.p)) return;
        try { Sim.applySnapshot(S, snap); } catch (e) { return; }
        Net.lastSnap = performance.now();
      });
      if (res.start) onStart(res.start);
      else {
        netStatus(res.live ? 'Admin: watching squad ' + code.toUpperCase() + '. Nobody has pulled yet; the fight opens here when they do.' : 'Admin: squad ' + code.toUpperCase() + ' is empty right now. This page picks it up if they come back.');
      }
    }).catch(function (e) { netStatus(e && e.code === 'forbidden' ? 'Wrong admin key. Re-enter it on /admin.' : 'Could not reach the server.'); });
  }
  function callsign() {
    var v = ($('#nick').value || '').replace(/[^\w .'-]/g, '').trim().slice(0, 14);
    return v || 'Player';
  }
  /* On the self-hosted site: check for a new deploy now and then. Never reload during a fight;
     offer the reload on the briefing, lobby or end screen instead. */
  function watchForUpdates() {
    var check = function () {
      fetch('version.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (v) {
        if (v && v.build && v.build !== BUILD) { Net.updateReady = true; showUpdateBanner(); }
      }).catch(function () {});
    };
    setInterval(check, 60000);
    window.addEventListener('focus', check);
  }
  // Static hosts like GitHub Pages cache the page for a few minutes, so ask for a fresh copy.
  function reloadFresh() { location.href = location.pathname + '?r=' + Date.now() + location.hash; }
  function showUpdateBanner() {
    var b = $('#update');
    b.hidden = !Net.updateReady || running;
    $('#updateText').textContent = Net.squad ? 'A new version is ready. Everyone in the squad should reload together, between fights.' : 'A new version of Sector-4 is ready.';
  }
  function netInit() {
    if (window.S4Transport) {
      Net.room = window.S4Transport;
      $('#nickRow').hidden = false;
      try { $('#nick').value = localStorage.getItem('s4-nick') || ''; } catch (e) {}
      $('#nick').addEventListener('change', function () {
        try { localStorage.setItem('s4-nick', callsign()); } catch (e) {}
        if (Net.squad) netSetPresence({ nick: callsign() });
      });
      watchForUpdates();
      $('#updateBtn').addEventListener('click', reloadFresh);
      if (window.S4Transport.configured === false) {
        netStatus('Multiplayer needs a relay server. Set its address in config.js. Solo play works now.');
        return;
      }
      $('#hostBtn').disabled = false; $('#joinBtn').disabled = false; $('#joinCode').disabled = false;
      netStatus('Host a squad and share the code, or join with a friend\'s code.');
      $('#lobbyNote').textContent = 'Share this code. Everyone opens this site and picks a different role.';
      return;
    }
    var use = window.claude && window.claude.use;
    if (!use) { netStatus('Multiplayer works when this page is open on claude.ai. Solo play works everywhere.'); return; }
    netStatus('Connecting...');
    window.claude.use('user').then(function (u) { Net.user = u; }).catch(function () {});
    window.claude.use('room').then(function (r) {
      if (!r) { netStatus('Multiplayer is not available in this view. Solo play still works.'); return; }
      Net.room = r;
      $('#hostBtn').disabled = false; $('#joinBtn').disabled = false; $('#joinCode').disabled = false;
      netStatus('Host a squad and share the code, or join with a friend\'s code. Everyone needs this page open.');
    }).catch(function () { netStatus('Multiplayer is not available in this view. Solo play still works.'); });
  }
  function squadPeers() {
    return Net.squad ? Net.squad.peers().filter(function (p) { return p.kind === 'viewer'; }) : [];
  }
  function me() { return squadPeers().filter(function (p) { return p.sameTab; })[0]; }
  function peerName(p) {
    if (!p) return 'Someone';
    if (p.by && Net.names[p.by]) return Net.names[p.by];
    return p.presence && typeof p.presence.nick === 'string' ? p.presence.nick.slice(0, 14) : 'Player';
  }
  function resolveNames() {
    if (!Net.user || !Net.user.profiles) return;
    var ids = squadPeers().map(function (p) { return p.by; }).filter(function (b) { return b && !Net.names[b]; });
    if (!ids.length) return;
    Net.user.profiles(ids).then(function (ps) {
      ids.forEach(function (id) { var n = ps && ps[id] && ps[id].name; if (n) Net.names[id] = n.split(' ')[0]; });
      var mine = me();
      if (mine && mine.by && Net.names[mine.by] && mine.presence.nick !== Net.names[mine.by]) netSetPresence({ nick: Net.names[mine.by] });
      renderLobby();
    }).catch(function () {});
  }
  function netSetPresence(patch) {
    if (patch.role !== undefined) Net.myRole = patch.role;
    if (Net.squad) Net.squad.presence(patch).catch(function () {});
  }
  function newCode() { var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = ''; for (var i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function enterSquad(code, asHost) {
    code = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    if (!Net.room || !code) { netStatus('Type the squad code your friend shared.'); return Promise.resolve(false); }
    netStatus('Joining squad ' + code.toUpperCase() + '...');
    return Net.room.join('s4-' + code).then(function (sq) {
      Net.squad = sq; Net.code = code; Net.isHost = asHost; Net.startId = null; Net.hostPeer = null;
      Net.unsubs.push(sq.onPeers(onSquadPeers));
      Net.unsubs.push(sq.on('start', onStartMsg));
      Net.unsubs.push(sq.on('snap', onSnapMsg));
      Net.unsubs.push(sq.on('act', onActMsg));
      return true;
    }).catch(function () { netStatus('Could not join that squad. Try again in a moment.'); return false; });
  }
  function hostSquad() {
    Snd.ensure();
    enterSquad(newCode(), true).then(function (ok) {
      if (!ok) return;
      netSetPresence({ host: 1, role: role, gear: gearFor[role], st: 'lobby', build: BUILD, nick: callsign() });
      showLobby();
    });
  }
  function joinSquad(code) {
    Snd.ensure();
    enterSquad(code, false).then(function (ok) {
      if (!ok) return;
      netSetPresence({ host: 0, role: null, gear: null, st: 'lobby', build: BUILD, nick: callsign() });
      showLobby();
      setTimeout(function () {
        if (Net.squad && !Net.hostPeer) { netStatus('No squad is open with code ' + Net.code.toUpperCase() + '. Check the code with your host.'); toMenu(); }
      }, 4000);
    });
  }
  function leaveSquad() {
    Net.unsubs.forEach(function (u) { try { u(); } catch (e) {} }); Net.unsubs = [];
    if (Net.startTimer) { clearInterval(Net.startTimer); Net.startTimer = null; }
    if (Net.squad) Net.squad.leave().catch(function () {});
    if (Net.hostGone) { clearTimeout(Net.hostGone); Net.hostGone = null; }
    Net.squad = null; Net.mode = 'solo'; Net.isHost = false; Net.hostPeer = null; Net.myRole = null;
  }
  function onSquadPeers(change) {
    var ps = squadPeers();
    var hosts = ps.filter(function (p) { return p.presence && p.presence.host === 1; }).sort(function (a, b) { return a.peer < b.peer ? -1 : 1; });
    // After a server restart people reconnect in any order, so the host can look missing for a moment.
    // Only give up on a host who has been gone for 10 seconds.
    if (hosts.length) { Net.hostPeer = hosts[0].peer; if (Net.hostGone) { clearTimeout(Net.hostGone); Net.hostGone = null; } }
    else if (Net.hostPeer && !Net.isHost && !Net.hostGone) {
      Net.hostGone = setTimeout(function () {
        Net.hostGone = null;
        if (!Net.squad || squadPeers().some(function (p) { return p.peer === Net.hostPeer; })) return;
        logLine('The host left the squad.'); netStatus('The host left the squad.');
        running = false; toMenu();
      }, 10000);
    }
    resolveNames();
    if (Net.isHost && Net.startTimer && Net.roster) {
      var myPeer = me() ? me().peer : null;
      var waiting = Net.roster.filter(function (r) { return r.key !== myPeer; }).some(function (r) {
        var q = ps.filter(function (x) { return x.peer === r.key; })[0];
        return q && q.presence.st !== Net.startId;
      });
      if (!waiting) { clearInterval(Net.startTimer); Net.startTimer = null; }
    }
    if ($('#lobby').classList.contains('on')) renderLobby();
  }
  function showLobby() {
    running = false; showPlates(false);
    if (Net.mode === 'host' || Net.mode === 'client') Net.mode = 'solo';
    netSetPresence({ st: 'lobby' });
    ['#menu', '#end', '#hud', '#armory'].forEach(function (q) { $(q).classList.remove('on'); }); $('#lobby').classList.add('on');
    Net.lobbySig = null; renderLobby(); showUpdateBanner();
  }
  function renderLobby() {
    if (!Net.squad) return;
    var ps = squadPeers(), mine = me();
    // Only rebuild when the roster, names or your pick changed, so buttons don't vanish mid-click.
    var sig = JSON.stringify([Net.code, Net.hostPeer, Net.isHost, Net.myRole, ps.map(function (p) { return [p.peer, p.by && Net.names[p.by], p.presence && p.presence.role, p.presence && p.presence.gear && p.presence.gear.weapon, p.presence && p.presence.nick, p.presence && p.presence.build, p.away]; })]);
    if (sig === Net.lobbySig && $('#lobbySlots').children.length) return;
    Net.lobbySig = sig;
    $('#lobbyCode').textContent = Net.code.toUpperCase();
    var host = ps.filter(function (p) { return p.peer === Net.hostPeer; })[0];
    $('#lobbyHost').textContent = Net.isHost ? 'You are hosting. Bots fill any empty role.' : host ? peerName(host) + ' is hosting. Bots fill any empty role.' : 'Looking for the host...';
    var slots = $('#lobbySlots'); slots.innerHTML = '';
    var conflict = false, myRole = Net.myRole;
    ROLE_ORDER.forEach(function (r) {
      var k = Sim.KITS[r], who = ps.filter(function (p) { return p.presence && p.presence.role === r; });
      if (who.length > 1) conflict = true;
      var b = el('button', 'lslot role-' + r + (myRole === r ? ' mine' : '') + (who.length > 1 ? ' clash' : '')); b.type = 'button';
      b.setAttribute('aria-pressed', myRole === r ? 'true' : 'false');
      b.appendChild(el('b', 'display', k.title));
      var occ = who.length ? who.map(function (p) { return (p.sameTab ? 'You' : peerName(p)) + (p.presence.gear ? ', ' + Sim.gearName('weapon', p.presence.gear.weapon, r) : ''); }).join(' + ') : 'Bot';
      b.appendChild(el('span', null, occ));
      if (who.length > 1) b.appendChild(el('em', 'gwarn', 'Two players picked this. One of you needs to move.'));
      b.addEventListener('click', function () { netSetPresence({ role: r, gear: gearFor[r] }); renderLobby(); });
      slots.appendChild(b);
    });
    var unassigned = ps.filter(function (p) { return !p.presence || !p.presence.role; });
    // Everyone has to be on the same version, or the host's fight and a client's screen disagree.
    var stale = ps.filter(function (p) { return p.presence && p.presence.build && p.presence.build !== BUILD; });
    if (stale.length) conflict = true;
    $('#lobbyVersion').textContent = stale.length ? stale.map(function (p) { return p.sameTab ? 'You' : peerName(p); }).join(', ') + ' on a different version of the game. Everyone reload the page, then rejoin with the same code.' : '';
    $('#lobbyLoose').textContent = unassigned.length ? unassigned.map(function (p) { return p.sameTab ? 'You' : peerName(p); }).join(', ') + ' still picking a role.' : '';
    $('#lobbyGear').disabled = !myRole;
    $('#lobbyGear').textContent = myRole ? 'Gear and talents for ' + Sim.KITS[myRole].title : 'Pick a role first';
    var st = $('#lobbyStart');
    st.style.display = Net.isHost ? '' : 'none';
    st.disabled = conflict || unassigned.length > 0;
    $('#lobbyWait').textContent = Net.isHost ? (stale.length ? 'Waiting for everyone to be on the same version.' : conflict ? 'Sort out the role clash to start.' : unassigned.length ? 'Waiting for everyone to pick a role.' : '') : 'Waiting for the host to start the shift.';
  }
  function hostStart() {
    if (!Net.isHost) return;
    var ps = squadPeers();
    var roster = ps.filter(function (p) { return p.presence && p.presence.role; }).map(function (p) {
      var r = p.presence.role;
      return { role: r, gear: Sim.validGear(r, p.sameTab ? gearFor[r] : p.presence.gear), name: p.sameTab ? myName() : peerName(p), key: p.peer };
    });
    Net.roster = roster; Net.startId = 'g' + Math.floor(Math.random() * 1e9).toString(36);
    var seed = (Date.now() & 0xffffff) + 1, msg = { id: Net.startId, seed: seed, roster: roster, build: BUILD };
    var send = function () { if (Net.squad) Net.squad.emit('start', msg).catch(function () {}); };
    send();
    if (Net.startTimer) clearInterval(Net.startTimer);
    var tries = 0;
    Net.startTimer = setInterval(function () { if (++tries > 12) { clearInterval(Net.startTimer); Net.startTimer = null; } else send(); }, 900);
    Net.mode = 'host'; Net.buf = []; Net.snapT = 0; Net.acts = {}; Net.missing = {};
    netSetPresence({ st: Net.startId });
    beginFight(Sim.create({ humans: roster, seed: seed }), me().peer);
  }
  function onStartMsg(msg) {
    if (msg.sameTab || Net.isHost || msg.peer !== Net.hostPeer) return;
    var d = msg.data || {};
    if (!d.id || d.id === Net.startId && running) return;
    var mine = me();
    if (!mine || !Array.isArray(d.roster) || !d.roster.some(function (r) { return r && r.key === mine.peer; })) return;
    if (d.build && d.build !== BUILD) { $('#lobbyVersion').textContent = 'The host is on a different version. Reload the page and rejoin.'; return; }
    var roster = d.roster.filter(function (r) { return r && ROLE_ORDER.indexOf(r.role) >= 0; }).map(function (r) {
      return { role: r.role, gear: Sim.validGear(r.role, r.gear), name: String(r.name || 'Player').slice(0, 14), key: String(r.key) };
    });
    Net.startId = d.id; Net.mode = 'client'; Net.lastSnap = performance.now(); Net.lastIn = '';
    netSetPresence({ st: d.id });
    beginFight(Sim.create({ humans: roster, seed: +d.seed || 1 }), mine.peer);
  }
  function onSnapMsg(msg) {
    if (msg.sameTab || Net.mode !== 'client' || msg.peer !== Net.hostPeer || !S) return;
    var snap = msg.data;
    if (!snap || snap.sid !== Net.startId || !Array.isArray(snap.p)) return;
    // Keep your own predicted position unless the host disagrees by a lot (knockback, dash, charge).
    var px = human.x, pz = human.z, pf = human.facing;
    try { Sim.applySnapshot(S, snap); } catch (e) { return; }
    var err = Math.hypot(human.x - px, human.z - pz);
    if (err < 3) {
      var still = !human.moving;
      human.x = still ? px + (human.x - px) * 0.5 : px; human.z = still ? pz + (human.z - pz) * 0.5 : pz; if (!still) human.facing = pf;
    }
    Net.lastSnap = performance.now();
  }
  function onActMsg(msg) {
    if (msg.sameTab || Net.mode !== 'host' || !S) return;
    var p = Sim.players(S).filter(function (q) { return q.key === msg.peer; })[0];
    var d = msg.data || {};
    if (!p) return;
    var a = Net.acts[p.id] || (Net.acts[p.id] = {});
    if (typeof d.a === 'number' && d.a >= 0 && d.a <= 4) a.ability = d.a | 0;
    if (d.tg === null || typeof d.tg === 'number') a.target = d.tg;
    if (d.j) a.jump = true;
  }
  function netHostInputs(ins) {
    var ps = squadPeers(), now = performance.now();
    Net.missing = Net.missing || {};
    Sim.players(S).forEach(function (p) {
      if (!p.human || p === human) return;
      var q = ps.filter(function (x) { return x.peer === p.key; })[0];
      // A player missing for 10 seconds is handed to a bot, and gets control back when they return.
      if (!q || q.away) {
        if (!Net.missing[p.key]) Net.missing[p.key] = now;
        if (!p.auto && now - Net.missing[p.key] > 10000) { p.auto = true; p.dc = true; S.events.push({ type: 'log', text: p.name + ' disconnected. A bot takes over.' }); }
      } else {
        delete Net.missing[p.key];
        if (p.dc) { p.auto = false; p.dc = false; S.events.push({ type: 'log', text: p.name + ' is back.' }); }
      }
      if (p.auto) return;
      // A player whose connection dropped stands still instead of running on their last input.
      var live = q && !q.away && (!Net.squad.connected || Net.squad.connected());
      var inn = live && q.presence && q.presence.in || {};
      var a = Net.acts[p.id] || {};
      ins[p.id] = {
        mx: +inn.mx || 0, mz: +inn.mz || 0,
        aim: typeof inn.am === 'number' ? inn.am : undefined, hold: [!!((inn.h | 0) & 1), !!((inn.h | 0) & 2)],
        target: a.target !== undefined ? a.target : (inn.tg === null || typeof inn.tg === 'number' ? inn.tg : undefined),
        ability: a.ability != null ? a.ability : -1, jump: !!a.jump
      };
      Net.acts[p.id] = {};
    });
  }
  function netHostSend(dt) {
    Net.snapT -= dt;
    if (Net.snapT > 0 || !Net.squad) return;
    Net.snapT = 0.1;
    var snap = Sim.snapshot(S, Net.buf); snap.sid = Net.startId;
    Net.buf = Net.buf.slice(snap.ev.length);
    if (Net.buf.length > 60) Net.buf = Net.buf.slice(-60);
    Net.squad.emit('snap', snap).catch(function () {});
  }
  function netClientFrame(dt) {
    var mv = readMove();
    Sim.predictMove(human, mv.mx, mv.mz, dt, S);
    human.moving = Math.abs(mv.mx) + Math.abs(mv.mz) > 0.01;
    var tg = input.target !== undefined ? input.target : human.target;
    if (input.target !== undefined) human.target = input.target;
    var inn = { mx: Math.round(mv.mx * 10) / 10, mz: Math.round(mv.mz * 10) / 10, tg: tg == null ? null : tg };
    if (Sim.aimWeapon(human)) {
      var hd = readHold();
      inn.am = Math.round(aimAngle() * 20) / 20; inn.h = (hd[0] ? 1 : 0) | (hd[1] ? 2 : 0);
      human.facing = aimAngle();
    }
    var key = JSON.stringify(inn);
    if (key !== Net.lastIn) { Net.lastIn = key; netSetPresence({ in: inn }); }
    if (input.ability >= 0 || input.jump || input.target !== undefined) {
      Net.squad && Net.squad.emit('act', { a: input.ability, tg: tg == null ? null : tg, j: input.jump ? 1 : 0 }).catch(function () {});
    }
    input.ability = -1; input.target = undefined; input.jump = false;
    var lag = performance.now() - Net.lastSnap, up = !Net.squad || !Net.squad.connected || Net.squad.connected();
    var restarting = window.S4Transport && window.S4Transport.isRestarting && window.S4Transport.isRestarting();
    $('#netBadge').textContent = 'SQUAD ' + Net.code.toUpperCase() + (!up ? (restarting ? '  /  SERVER UPDATING, RECONNECTING' : '  /  RECONNECTING') : lag > 1500 ? '  /  WAITING FOR HOST' : '');
  }

  /* ---------- loop ---------- */
  var STEP = 1 / 30, lastSim = 0;
  /* Advances the local sim (solo or host). The render loop calls it; a timer also calls it for a host whose tab is
     hidden, because browsers pause animation frames there and the whole squad would freeze. */
  function simTick() {
    var now = performance.now(), dt = Math.min(Net.mode === 'host' ? 1 : 0.1, (now - lastSim) / 1000 || 0);
    lastSim = now;
    if (!running || !S || Net.mode === 'client' || Net.mode === 'spy') return;
    acc += dt;
    while (acc >= STEP) {
      var mv = document.hidden ? { mx: 0, mz: 0 } : readMove(), ins = {};
      ins[human.id] = { mx: mv.mx, mz: mv.mz, ability: input.ability, target: input.target, jump: input.jump, aim: aimAngle(), hold: document.hidden ? [] : readHold() };
      if (Net.mode === 'host') netHostInputs(ins);
      Sim.step(S, STEP, ins);
      input.ability = -1; input.target = undefined; input.jump = false; acc -= STEP;
      if (S.result) break;
    }
    if (Net.mode === 'host') {
      Net.buf = Net.buf.concat(S.events.slice(Net.evMark || 0)); Net.evMark = S.events.length; netHostSend(dt);
      var up = !Net.squad || !Net.squad.connected || Net.squad.connected();
      $('#netBadge').textContent = 'SQUAD ' + Net.code.toUpperCase() + '  /  HOST' + (up ? '' : '  /  RECONNECTING');
    }
    if (S.result) endFight();
  }
  setInterval(function () {
    if (Net.mode === 'host' && running && document.hidden) simTick();
    else if (Net.mode === 'host' && !running && Net.postEnd > 0) { Net.postEnd -= 0.05; netHostSend(0.05); }
  }, 50);
  /* Controller (any standard gamepad). Left stick moves, right stick turns the camera.
     RT and LT are weapon buttons 1 and 2 (held for aimed weapons), X = 3, RB = 4, B = 5, Y = ultimate,
     A = Space, LB = next enemy. Keyboard Q and E turn the camera too, for aiming without the mouse. */
  var pad = { f: 0, r: 0, hold: [false, false], prev: [] };
  function pollPad(dt) {
    if (running && !watching) cam.yaw += ((keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0)) * 2.2 * dt;
    var gp = navigator.getGamepads ? Array.prototype.filter.call(navigator.getGamepads(), Boolean)[0] : null;
    if (!gp) { pad.f = 0; pad.r = 0; pad.hold = [false, false]; return; }
    var dz = function (v) { return Math.abs(v) < 0.2 ? 0 : v; }, ax = gp.axes || [];
    pad.r = dz(ax[0] || 0); pad.f = -dz(ax[1] || 0);
    cam.yaw -= dz(ax[2] || 0) * 2.6 * dt; cam.pitch = Math.max(0.12, Math.min(1.35, cam.pitch + dz(ax[3] || 0) * 1.4 * dt));
    var btn = function (i) { var b = gp.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
    var down = function (i) { return btn(i) && !pad.prev[i]; };
    if (running && !watching) {
      var aimW = Sim.aimWeapon(human);
      pad.hold = aimW ? [btn(7), btn(6)] : [false, false];
      if (!aimW && down(7)) input.ability = 0;
      if (!aimW && down(6)) input.ability = 1;
      if (down(2)) input.ability = 2;
      if (down(5)) input.ability = 3;
      if (down(1)) input.ability = 4;
      if (down(3)) input.ability = 5;
      if (down(0)) input.jump = true;
      if (down(4)) cycleEnemy(1);
    }
    pad.prev = gp.buttons.map(function (b) { return b.pressed || b.value > 0.5; });
  }
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    pollPad(dt);
    mixers.forEach(function (m) { m.update(dt); });
    if (S && (running || $('#end').classList.contains('on') || S.result)) {
      if (running && Net.mode === 'spy') {
        var lagS = performance.now() - Net.lastSnap;
        $('#netBadge').textContent = 'ADMIN  /  ' + Net.code.toUpperCase() + (lagS > 2000 ? '  /  NO SIGNAL' : '');
        drainEvents();
        if (S.result) endFight();
      } else if (running && Net.mode === 'client') {
        netClientFrame(dt);
        drainEvents();
        if (S.result) endFight();
      } else if (running) {
        simTick();
        drainEvents(); Net.evMark = 0;
      }
      syncViews(dt);
      var hv = views[human.id];
      placeCamera(hv ? hv.g.position.x : human.x, hv ? hv.g.position.z : human.z);
      fadeOccluder(hv);
      if ($('#hud').classList.contains('on')) updateHud();
    } else {
      if (!reduceMotion) cam.yaw += dt * 0.05;
      placeCamera(0, 0);
    }
    renderer.render(scene, camera);
  }

  /* ---------- boot ---------- */
  function boot(saved) {
    buildArena(); buildRoleCards(); buildMeshSlots(); resize();
    cam.dist = 34; cam.pitch = 0.42;
    // An idle squad stands in the arena behind the briefing.
    S = Sim.create({ humanRole: 'dps', seed: 7 }); human = Sim.ent(S, S.humanId); human.target = null;
    syncViews(1);
    S = null;
    if (saved && saved.role) role = saved.role;
    $('#again').addEventListener('click', function () {
      if (Net.mode === 'spy') { $('#end').classList.remove('on'); $('#menu').classList.add('on'); netStatus('Admin: watching squad ' + Net.code.toUpperCase() + '. Their next pull opens here.'); return; }
      if (Net.squad) showLobby(); else startFight(role, watching);
    });
    $('#watch').addEventListener('click', function () { startFight(role, true); });
    $('#armoryGo').addEventListener('click', function () {
      if (armoryCtx === 'lobby') { netSetPresence({ role: role, gear: gearFor[role] }); showLobby(); } else startFight(role);
    });
    $('#hostBtn').addEventListener('click', hostSquad);
    $('#joinBtn').addEventListener('click', function () { joinSquad($('#joinCode').value); });
    $('#joinCode').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') joinSquad($('#joinCode').value); });
    $('#lobbyLeave').addEventListener('click', toMenu);
    $('#lobbyGear').addEventListener('click', function () { if (Net.myRole) openArmory(Net.myRole, 'lobby'); });
    $('#lobbyStart').addEventListener('click', hostStart);
    netInit();
    showVersion();
    adminWatchFromUrl();
    $('#armoryBack').addEventListener('click', toMenu);
    $('#regear').addEventListener('click', function () { openArmory(role); });
    $('#change').addEventListener('click', function () { if (Net.mode === 'spy') location.href = 'admin'; else toMenu(); });
    $('#quit').addEventListener('click', toMenu);
    $('#mute').addEventListener('click', function () { Snd.ensure(); setMute(Snd.toggle()); });
    setMute(Snd.isMuted());
    requestAnimationFrame(frame);
  }
  var hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(function () { return { role: role }; });
  if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
})();
