/* Builds the static site for GitHub Pages into dist/. BUILD comes from the workflow (the commit id). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const stampIndex = require('./stamp');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');
const FILES = ['sim.js', 'game.js', 'net-ws.js', 'config.js'];
const BUILD = process.env.BUILD || crypto.createHash('sha1')
  .update(['index.html', ...FILES].map((f) => fs.readFileSync(path.join(PUB, f))).join('\n')).digest('hex').slice(0, 10);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), stampIndex(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'), BUILD));
FILES.forEach((f) => fs.copyFileSync(path.join(PUB, f), path.join(OUT, f)));
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ build: BUILD, version: require('../public/sim.js').VERSION }));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log('Built dist/ for build ' + BUILD);
