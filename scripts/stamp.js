/* Adds the build id and the extra site scripts to index.html. Used by server.js and by the GitHub Pages build,
   so both serve exactly the same page. Scripts get ?v=<build> so a deploy never mixes old and new files. */
'use strict';
module.exports = function stampIndex(html, build) {
  const v = encodeURIComponent(build);
  return html
    .replace('<script src="sim.js"></script>',
      `<script>window.S4_BUILD = ${JSON.stringify(build)};</script>\n` +
      `<script src="config.js?v=${v}"></script>\n<script src="net-ws.js?v=${v}"></script>\n<script src="sim.js?v=${v}"></script>`)
    .replace('<script src="placeholders.js"></script>', `<script src="placeholders.js?v=${v}"></script>`)
    .replace('<script src="game.js"></script>', `<script src="game.js?v=${v}"></script>`);
};
