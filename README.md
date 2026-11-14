# Sector-4: Skyscraper Ascent

A co-op raid prototype: Unreal Tournament as a tab-target MMO. One Node server serves the game and relays squad traffic. The fight itself runs in the host player's browser.

## Hosting it

- **Render** (recommended, free): one web service runs the game and the relay. See below.
- **Your own server** (`server.js`, or the Docker image) behind Cloudflare Tunnel: always on, no sleep.
- **GitHub Pages**: serves the game only. Solo play works there, but squads need the relay running somewhere else.

## Render

1. On render.com, sign in with GitHub and choose New, then Blueprint, then pick this repo. `render.yaml` fills in the settings: Node, `npm ci`, `npm start`, free instance.
2. Open the `onrender.com` link it gives you and share it.

Every push to `main` redeploys. Players in a fight see "Server updating, reconnecting" for a few seconds and carry on.

A free service sleeps after 15 minutes with no visitors, and the first visit afterwards takes about a minute to wake it. Open the link a minute before game night. Play keeps it awake.

## GitHub Pages

1. In the repo, go to Settings, then Pages, and set Source to **GitHub Actions**.
2. In the Actions tab, run "Deploy to GitHub Pages". The workflow in `.github/workflows/pages.yml` builds the site and deploys it. Each deploy is stamped with the commit id, so open pages offer a reload when a new version is out.
3. For multiplayer, run the relay on your own server (see below) and put its address in `public/config.js`:

```js
window.S4_CONFIG = { relay: 'wss://sector4.slothstudio.co.uk/ws' };
```

Until that's set, the Pages site plays solo and the squad panel says a relay is needed.

The relay accepts connections from any site, so the Pages copy and a self-hosted copy can share it. Pages caches the page for up to 10 minutes, so a new deploy can take that long to show up as the "Reload now" banner.

## Fight records and the stats page

When a fight ends, the host (or a solo player) sends one small record to the server: result, time, how far the Foreman got, and for each seat its role, weapon, talents, damage, healing, deaths and interrupts. No names or callsigns are stored. Open `/stats` on the site to see win rates by role, weapon and talent, what is killing people, and how each version compares.

Where records are kept:

- **Render:** its free disk is wiped on every restart, so give it a database. Create a free project at neon.tech, copy its connection string, and add it in Render as the environment variable `DATABASE_URL`. The server creates its table on first start.
- **Your own box:** with no `DATABASE_URL`, records go to `data/runs.jsonl`. Mount `data/` as a volume if you use Docker.

The stats page is public, like the game.

## Automated checks

- **On every push** (`.github/workflows/ci.yml`): syntax, then `npm test`. The tests check that every fight ends, that a bot squad wins most but not all fights, that an idle player in any role gets the squad killed, that every weapon and talent can win, that network snapshots stay under the 4 KiB limit, and that the relay and the fight-record API work. Under a minute.
- **Every night** (`.github/workflows/nightly.yml`, or run it from the Actions tab): about 4,000 simulated fights covering every role, weapon and talent. The report lands on the run's summary page and flags any pick whose win rate gap is bigger than chance would explain. Set the repository variable `SITE_URL` (Settings, then Secrets and variables, then Actions, then Variables) to your live site and the report adds your real players' numbers alongside the sims.

Run them yourself with `npm test` and `npm run report` (`SEEDS=20 npm run report` for a quick one).

## Run it locally

```
npm install
npm start
```

Open http://localhost:8080. To test a squad, open a second tab, host in one and join with the code in the other.

## Run it with Docker

```
docker compose up -d --build
```

The game is on port 8080. `GET /healthz` reports the build and how many squads are open.

## Put it behind your Cloudflare Tunnel

Point a hostname at the container in your tunnel config, for example:

```yaml
ingress:
  - hostname: sector4.slothstudio.co.uk
    service: http://localhost:8080
  - service: http_status:404
```

Cloudflare Tunnel passes WebSockets through without extra settings. The squad relay lives at `/ws` on the same hostname.

## Deploying updates without wrecking fights

```
git pull
docker compose up -d --build
```

What players see:

- **During a fight:** the badge says "Server updating, reconnecting" for a few seconds. The fight carries on, because it runs in the host's browser. Everyone keeps their slot for 15 seconds on the server and 10 seconds on the host before a bot takes over, so a restart doesn't hand anyone to a bot.
- **New version available:** each page checks `/version.json` every minute. When a new build is out it shows a "Reload now" banner, but only on the briefing, lobby or end screen. It never reloads anyone mid-fight.
- **Mixed versions:** the build id is a hash of the game files, so every deploy gets a new one automatically. The lobby names anyone on a different version and won't start until everyone has reloaded.
- **Caching:** `index.html` is never cached. Scripts are fetched as `game.js?v=<build>` and cached for good, so nobody ends up with a mix of old and new files.

## Files

- `server.js`: Express static hosting plus the WebSocket squad relay (rooms, presence, messages, rate and size limits).
- `public/index.html`, `public/game.js`: rendering, HUD, lobby and netcode.
- `public/sim.js`: the combat simulation. Pure logic that runs in the browser and in Node.
- `public/config.js`: where the relay lives. Empty means the same server that serves the game.
- `scripts/build-pages.js`, `scripts/stamp.js`: build the static site for Pages and stamp the build id into the page.
- `public/net-ws.js`: the browser side of the relay. It offers the same calls as claude.ai's room capability, so the same game files also run as a claude.ai artifact.
- `render.yaml`: Render settings.
- `lib/stats.js`, `lib/store.js`: checking and storing fight records, and turning them into stats.
- `lib/simrun.js`, `scripts/balance-report.js`: simulated fights for the tests and the nightly report.
- `public/stats.html`: the stats page.
- `test/`: the automated checks (`npm test`).

## Limits worth knowing

- **The host's tab:** it runs the fight, so if the host closes it the squad ends. A hidden host tab keeps running, but browsers slow background timers, so the host should keep the game in front.
- **Accounts and names:** the server keeps no accounts or saves. Names are the callsigns people type in.
- **Rooms:** up to 8 people per squad room, and squad codes aren't secret.
