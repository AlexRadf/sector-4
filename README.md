# Sector-4: Skyscraper Ascent

A co-op raid prototype: Unreal Tournament as a tab-target MMO. One Node server serves the game and relays squad traffic. The fight itself runs in the host player's browser.

## Two ways to host it

- **GitHub Pages** serves the game for free. It can't run a server, so solo play works on its own, and squads need the relay (`server.js`) running somewhere else, such as your own box behind Cloudflare Tunnel.
- **Your own server** (`server.js`, or the Docker image) serves the game and the relay together. Nothing else is needed.

## GitHub Pages

1. In the repo, go to Settings, then Pages, and set Source to **GitHub Actions**.
2. Push to `main`. The workflow in `.github/workflows/pages.yml` builds the site and deploys it. Each deploy is stamped with the commit id, so open pages offer a reload when a new version is out.
3. For multiplayer, run the relay on your own server (see below) and put its address in `public/config.js`:

```js
window.S4_CONFIG = { relay: 'wss://sector4.slothstudio.co.uk/ws' };
```

Until that's set, the Pages site plays solo and the squad panel says a relay is needed.

The relay accepts connections from any site, so the Pages copy and a self-hosted copy can share it. Pages caches the page for up to 10 minutes, so a new deploy can take that long to show up as the "Reload now" banner.

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
- `test/`: balance and netcode checks you can run with Node, e.g. `node test/sweep.js`.

## Limits worth knowing

- **The host's tab:** it runs the fight, so if the host closes it the squad ends. A hidden host tab keeps running, but browsers slow background timers, so the host should keep the game in front.
- **Accounts and names:** the server keeps no accounts or saves. Names are the callsigns people type in.
- **Rooms:** up to 8 people per squad room, and squad codes aren't secret.
