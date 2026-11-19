/* Placeholder models: plain boxes for every model slot, used until a real model is in public/models/<slot>.glb
   (or uploaded under "Swap in your own meshes"). Delete this file and its <script> tag in index.html once every
   slot has a model: the game then simply draws nothing for a slot without one. */
(function (root) {
  'use strict';
  function build(key, roleColor) {
    var THREE = root.THREE, g = new THREE.Group();
    var std = function (color, emissive) { return new THREE.MeshStandardMaterial({ color: color, roughness: 0.55, metalness: 0.45, emissive: emissive || 0x000000 }); };
    var box = function (w, h, d, mat, x, y, z) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
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
      var c = roleColor, suit = std(c), dk = std(0x1c2229);
      var bulk = key === 'tank' ? 1.25 : 1;
      g.add(box(0.34 * bulk, 0.9, 0.36, dk, -0.22 * bulk, 0.45, 0)); g.add(box(0.34 * bulk, 0.9, 0.36, dk, 0.22 * bulk, 0.45, 0));
      g.add(box(0.9 * bulk, 0.8, 0.5 * bulk, suit, 0, 1.3, 0));
      g.add(box(1.25 * bulk, 0.26, 0.56 * bulk, dk, 0, 1.62, 0));
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), std(0xd8c4a8)); head.position.y = 1.9; g.add(head);
      g.add(box(0.2, 0.2, key === 'tank' ? 0.9 : 1.2, new THREE.MeshBasicMaterial({ color: c }), 0.5 * bulk, 1.25, 0.5));
    }
    return g;
  }
  root.S4Placeholders = { build: build };
})(window);
