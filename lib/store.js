/* Where fight records live.
   DATABASE_URL set (e.g. a free Neon Postgres): records survive restarts and redeploys. Use this on Render,
   whose free disk is wiped on every restart.
   Otherwise: one JSON line per fight in DATA_DIR/runs.jsonl. Fine locally or on your own box with a volume. */
'use strict';
const fs = require('fs');
const path = require('path');

function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'runs.jsonl');
  return {
    kind: 'file',
    async init() {},
    async add(run) { fs.appendFileSync(file, JSON.stringify(Object.assign({ at: new Date().toISOString() }, run)) + '\n'); },
    async recent(limit) {
      if (!fs.existsSync(file)) return [];
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-limit);
      return lines.map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    }
  };
}

function pgStore(url) {
  const { Pool } = require('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new Pool({ connectionString: url, max: 3, ssl: local ? false : { rejectUnauthorized: true } });
  return {
    kind: 'postgres',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS runs (
        id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
        build text, mode text, result text, secs integer, data jsonb NOT NULL)`);
    },
    async add(run) {
      await pool.query('INSERT INTO runs (build, mode, result, secs, data) VALUES ($1, $2, $3, $4, $5)',
        [run.build, run.mode, run.result, run.secs, run]);
    },
    async recent(limit) {
      const r = await pool.query('SELECT at, data FROM runs ORDER BY id DESC LIMIT $1', [limit]);
      return r.rows.map((row) => Object.assign({ at: row.at }, row.data)).reverse();
    }
  };
}

module.exports = function makeStore() {
  return process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
};
