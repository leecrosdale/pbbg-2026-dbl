# Just in Time

A small cooperative browser game: ten alarms, one community, one daily chance to save them all.

For production at **dbl.crosdale.dev**, follow [DEPLOY.md](DEPLOY.md). An Ubuntu systemd service and installer are included for your existing Nginx setup.

## Run locally

Requires **Node.js 24+** (uses built-in SQLite).

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. Vite serves the PixiJS frontend and proxies WebSockets and API requests to the Node server on port 3001. Open two browser windows to see shared game state. “Try a practice round” runs a clearly labelled, local rehearsal with a first alarm immediately available; it does not affect the daily game or archive.

The rising-and-falling siren is **on by default**. Your first click or keypress silently unlocks browser audio; it sounds while an alarm is active and stops when all ringing alarms are saved or expire. The **Sound on** toggle mutes immediately. Turning sound back on plays a short preview. Sound also works in practice mode. Browsers may block audio until the first interaction.

```sh
npm test
npm run build
npm start
```

The production build is served at **http://127.0.0.1:3001**. For a remote deployment, set `HOST=0.0.0.0`, terminate HTTPS at a reverse proxy, forward WebSocket upgrades, and preserve the `Host` header. Run a **single Node server process** with a persistent writable data volume. The SQLite scheduler is not designed for multiple replicas.

## Daily rules

- A round begins at **13:00 Europe/London** and ends at **12:00 the next day**.
- Ten disabled alarms are assigned independent, cryptographically random activation times across that interval. Times remain secret. Multiple alarms can ring together.
- Each alarm has a **five-minute** response window. Its four-digit code is revealed to connected visitors when it rings. The first correct submission saves it and turns it green. Missing the deadline destroys it permanently for that round.
- All response windows finish by midday. Even if all alarms resolve early, the daily round stays displayed until midday.
- Results are recorded at **12:00** and shown until **13:00**, when a fresh round starts automatically. The latest 30 completed rounds are available in Past rounds.
- UK calendar times are preserved across daylight-saving changes. Most rounds last 23 hours; the spring and autumn transition rounds last 22 and 24 actual hours respectively. The results period is always one hour.
- The server owns the clock, checks deadlines on every submission, and persists schedules, outcomes, and winners to `data/game.sqlite`. A restart catches up elapsed alarms; it does not reschedule the round. Days when the server never ran do not produce invented archive rounds.

## Connection model

Admins with SSH access can start a fresh round using `npm run admin:restart` from the deployed project folder as the service user. The live service must be running the updated server. It archives the previous round and preserves player records and statistics. See [DEPLOY.md](DEPLOY.md#admin-start-a-fresh-game-round) for the timing rules and usage. Restarting the Node process alone preserves the current round.

Code entry is available only through an active same-origin WebSocket connection; there is no HTTP submission endpoint. Future codes and schedules are never sent to the browser. Submissions are rate-limited to one per second per connection, payloads are capped, and dead sockets are removed with heartbeat checks. The online count measures connected tabs.

## Player names and records

Players receive a stable server-generated ID and a private, HttpOnly, SameSite session cookie lasting a year. Only a SHA-256 hash of the random session token is stored in SQLite. A name can be set in the profile strip above the alarms: 3–20 letters, numbers, underscores or hyphens, unique without regard to letter case. Refreshes, reconnects and server restarts preserve the identity; tabs in the same browser share it. Clearing cookies or changing browser/device creates a new identity. This is browser-based identity, not a password-protected account or account recovery system.

Each successful live save is stored in `saves` with its round, alarm, player ID, name at the time, timestamp and response time. Saving the alarm state and its log entry is one SQLite transaction; a unique round/alarm key prevents duplicate credit. The server uses the session's player name and ignores client-supplied names on code submissions. Practice saves never reach this table.

The **Community** page shows the top 50 players by all-time saves, rounds contributed to, fastest response and the latest 50 saves. Full records remain in SQLite, beyond these display limits. Renaming keeps totals tied to the stable ID while activity records preserve the name used at the time. The read-only `/api/community` endpoint returns the displayed records. Existing rounds from before this feature remain intact, but their anonymous saves cannot be reliably attributed to these new persistent identities and are not backfilled into the leaderboard.

An origin check prevents normal cross-site browser submissions. It does **not** prove a human is physically present or prevent a custom bot from imitating a browser. Stronger identity or bot resistance would need authentication and additional controls.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Server port |
| `HOST` | `127.0.0.1` | Listening interface |
| `DATABASE_PATH` | `data/game.sqlite` | Persistent SQLite file |
| `ALLOWED_ORIGINS` | Request host | Optional comma-separated exact origins for reverse proxy deployments |
| `SESSION_COOKIE_SECURE` | `false` | Set to `true` when deploying behind HTTPS so session cookies use the Secure attribute |

## Implementation

PixiJS 8 renders animated alarm illustrations; HTML controls provide keyboard and screen reader access. Express and `ws` provide the server and live updates. SQLite stores rounds, and Luxon applies the Europe/London calendar. The interface supports narrow screens with a horizontally scrollable alarm row and respects reduced motion. Web fonts have local fallbacks; no image assets are required.

`npm test` covers UK date boundaries, both DST transitions, scheduling, deadlines, incorrect/replayed submissions, downtime reconciliation, SQLite records, actual multi-client WebSocket competition, origin rejection, persistent player sessions, username validation/uniqueness, server-owned attribution, immutable name snapshots, duplicate credit prevention, and persisted state after a server restart.
