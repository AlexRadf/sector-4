/* Squad transport for the self-hosted site: talks to server.js over a WebSocket and offers the same calls the
   game uses from claude.ai's room capability (join, emit, on, presence, peers, onPeers, connected, leave).
   It reconnects on its own and keeps its peer id, so a server restart is a short blip for a squad. */
window.S4Transport = (function () {
  'use strict';
  var peerId = null;
  try { peerId = sessionStorage.getItem('s4-peer'); } catch (e) {}
  if (!peerId || !/^[a-z0-9]{8,32}$/.test(peerId)) {
    peerId = Array.from(crypto.getRandomValues(new Uint8Array(8)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    try { sessionStorage.setItem('s4-peer', peerId); } catch (e) {}
  }
  var ws = null, isOpen = false, backoff = 500, restarting = false;
  var rooms = {}, connFns = [];

  // The relay is the server that serves the game, unless config.js points somewhere else (as it must on GitHub Pages).
  var relay = (window.S4_CONFIG && typeof window.S4_CONFIG.relay === 'string') ? window.S4_CONFIG.relay.trim() : '';
  var configured = !!relay || !/\.github\.io$/i.test(location.hostname);
  function url() { return relay || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
  function raw(obj) { if (ws && isOpen) ws.send(JSON.stringify(obj)); }
  function setConn(v) { connFns.forEach(function (f) { try { f(v); } catch (e) {} }); }

  function connect() {
    try { ws = new WebSocket(url()); } catch (e) { setTimeout(connect, backoff); return; }
    ws.onopen = function () {
      isOpen = true; backoff = 500; restarting = false;
      raw({ t: 'hello', peer: peerId });
      Object.keys(rooms).forEach(function (n) {
        if (rooms[n].left) return;
        if (rooms[n].spyKey) raw({ t: 'spy', room: n, key: rooms[n].spyKey }); else raw({ t: 'join', room: n, presence: rooms[n].pres });
      });
      setConn(true);
    };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'restarting') { restarting = true; return; }
      var r = m.room && rooms[m.room]; if (!r || r.left) return;
      if (m.t === 'spying') { if (r.onJoined) { r.onJoined(m); r.onJoined = null; } return; }
      if (m.t === 'error' && m.code === 'forbidden' && r.onFail) { r.onFail({ code: 'forbidden', message: 'Wrong admin key.' }); r.onFail = null; r.onJoined = null; return; }
      if (m.t === 'joined') {
        var fresh = {};
        (m.peers || []).forEach(function (p) { fresh[p.peer] = { presence: p.presence || {}, away: !!p.away, at: Date.now() }; });
        fresh[peerId] = { presence: r.pres, away: false, at: Date.now() };
        r.peers = fresh; r.notify();
        if (r.onJoined) { r.onJoined(); r.onJoined = null; }
      } else if (m.t === 'peer') {
        if (m.peer === peerId) return;
        if (m.gone) delete r.peers[m.peer];
        else r.peers[m.peer] = { presence: m.presence || {}, away: !!m.away, at: Date.now() };
        r.notify();
      } else if (m.t === 'msg') {
        (r.listeners[m.topic] || []).forEach(function (f) {
          try { f({ topic: m.topic, data: m.data, peer: m.peer, by: null, isMe: m.peer === peerId, sameTab: m.peer === peerId, kind: 'viewer', guest: false }); } catch (err) {}
        });
      }
    };
    ws.onclose = function () {
      var was = isOpen; isOpen = false;
      if (was) setConn(false);
      setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 5000);
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function makeRoom(name) {
    var r = { name: name, pres: {}, peers: {}, listeners: {}, peerFns: [], left: false, presTimer: null, onJoined: null };
    r.peers[peerId] = { presence: r.pres, away: false, at: Date.now() };
    r.list = function () {
      return Object.keys(r.peers).map(function (id) {
        var p = r.peers[id];
        return { peer: id, by: null, isMe: id === peerId, sameTab: id === peerId, kind: 'viewer', guest: false, presence: p.presence, away: p.away, updatedAt: p.at };
      });
    };
    r.notify = function () { var ps = r.list(); r.peerFns.forEach(function (f) { try { f({ peers: ps, joined: [], left: [], updated: [] }); } catch (e) {} }); };
    r.api = {
      name: name,
      emit: function (topic, data) { if (!r.left) raw({ t: 'emit', room: name, topic: topic, data: data }); return Promise.resolve(); },
      on: function (topic, fn) {
        (r.listeners[topic] = r.listeners[topic] || []).push(fn);
        return function () { r.listeners[topic] = (r.listeners[topic] || []).filter(function (x) { return x !== fn; }); };
      },
      presence: function (patch) {
        Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete r.pres[k]; else r.pres[k] = patch[k]; });
        r.peers[peerId] = { presence: Object.assign({}, r.pres), away: false, at: Date.now() };
        // Coalesce to about 30 sends a second, whole object each time.
        if (!r.presTimer) r.presTimer = setTimeout(function () { r.presTimer = null; raw({ t: 'pres', room: name, presence: r.pres }); }, 33);
        r.notify();
        return Promise.resolve();
      },
      peers: function () { return r.list(); },
      onPeers: function (fn) {
        r.peerFns.push(fn);
        setTimeout(function () { var ps = r.list(); fn({ peers: ps, joined: ps, left: [], updated: [] }); }, 0);
        return function () { r.peerFns = r.peerFns.filter(function (x) { return x !== fn; }); };
      },
      connected: function () { return isOpen; },
      onConnection: function (fn) { connFns.push(fn); setTimeout(function () { fn(isOpen); }, 0); return function () { connFns = connFns.filter(function (x) { return x !== fn; }); }; },
      leave: function () { r.left = true; raw({ t: 'leave', room: name }); delete rooms[name]; return Promise.resolve(); }
    };
    return r;
  }

  if (configured) connect();
  return {
    kind: 'websocket',
    configured: configured,
    peerId: peerId,
    isRestarting: function () { return restarting; },
    connected: function () { return isOpen; },
    /* Admin only: listen to a squad room without joining it. Resolves with { api, start } where start is the
       fight already under way, if any. The server checks the key; nobody in the room can see you. */
    spy: function (name, key) {
      var r = rooms[name] = makeRoom(name);
      r.spyKey = key;
      r.api.leave = function () { r.left = true; raw({ t: 'unspy', room: name }); delete rooms[name]; return Promise.resolve(); };
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { if (r.onJoined) { r.onJoined = null; reject({ code: 'upstream_error', message: 'Could not reach the server.' }); } }, 8000);
        r.onJoined = function (m) { clearTimeout(timer); resolve({ api: r.api, start: m.start, live: m.live }); };
        r.onFail = function (e) { clearTimeout(timer); delete rooms[name]; reject(e); };
        var go = function () { if (isOpen) raw({ t: 'spy', room: name, key: key }); else setTimeout(go, 200); };
        go();
      });
    },
    join: function (name) {
      if (rooms[name] && !rooms[name].left) return Promise.resolve(rooms[name].api);
      var r = rooms[name] = makeRoom(name);
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { if (r.onJoined) { r.onJoined = null; reject({ code: 'upstream_error', message: 'Could not reach the server.' }); } }, 8000);
        r.onJoined = function () { clearTimeout(timer); resolve(r.api); };
        raw({ t: 'join', room: name, presence: r.pres });
      });
    }
  };
})();
