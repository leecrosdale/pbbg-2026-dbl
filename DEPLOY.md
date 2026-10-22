# Ubuntu + Nginx: dbl.crosdale.dev

The application runs as a single Node.js process under systemd. Your existing Nginx HTTPS site forwards requests to `127.0.0.1:3001`. The service starts at boot, restarts after process exits and writes logs to the journal.

## Install

Requires Ubuntu with systemd, Node.js **24+** and npm installed system-wide. Use a normal deployment user who can read the project. Node must be accessible under sudo and to that user; an installation under `/root/.nvm` will not work. See [Node's official downloads](https://nodejs.org/en/download) for installation options.

From the project directory, as your normal deployment user:

```bash
npm ci
npm test
npm run build
```

Stop any manually running `npm start` process first, using Ctrl+C in its terminal. Then:

```bash
sudo bash scripts/install-service.sh
```

The installer defaults to the project containing the script and the user who invoked sudo. You can provide both explicitly; replace this path and username with yours:

```bash
sudo bash scripts/install-service.sh /var/www/dbl ubuntu
```

The installer checks Node, the build, file access and port availability. It installs `/etc/systemd/system/dbl.service` from `deploy/dbl.service`, enables it at boot, starts it, and checks its health endpoint. Re-running it updates and restarts the service. The template contains `@...@` placeholders; use the installer instead of copying it directly.

The service runs as the selected non-root user with these settings:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
DATABASE_PATH=<project>/data/game.sqlite
ALLOWED_ORIGINS=https://dbl.crosdale.dev
SESSION_COOKIE_SECURE=true
```

Existing game data stays in place. The installer adjusts the database directory and SQLite file permissions for the service user. Keep `data/` across uploads. Run only one app instance, since the scheduler is not designed for multiple replicas. UK midday/1pm scheduling, including daylight-saving changes, is handled by the app; no cron job is needed.

## Existing Nginx HTTPS site

Keep your existing domain and TLS configuration. Inside the HTTPS `server` block for `dbl.crosdale.dev`, use:

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

Check for other locations intercepting `/api/` or `/ws`. Nginx should proxy the whole app; Node serves the built frontend too. Port 3001 stays private.

```bash
sudo nginx -t && sudo systemctl reload nginx
curl --fail http://127.0.0.1:3001/api/health
curl --fail https://dbl.crosdale.dev/api/health
```

Both health checks should return `{"ok":true}`. Confirm that `/ws` connects and usernames survive refreshes in your browser.

## Manage the service

```bash
sudo systemctl status dbl --no-pager
sudo journalctl -u dbl -f
sudo systemctl restart dbl
sudo systemctl stop dbl
sudo systemctl start dbl
```

`sudo systemctl disable --now dbl` stops it and disables automatic startup without deleting data. An intentional `systemctl stop` keeps the process stopped despite the restart policy. See the [systemd service documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) for service behaviour.

## Update

Upload source into the same project directory, preserving `data/`. As your deployment user:

```bash
npm ci
npm test
npm run build
sudo systemctl restart dbl
curl --fail http://127.0.0.1:3001/api/health
```

Run each step only after the previous one succeeds. The restart briefly disconnects visitors; browsers reconnect automatically. Prefer the midday–1pm UK results period. Rerun the installer if you move the project or change the service template.

## Admin: start a fresh game round

A service restart preserves the current round. To discard the current alarm set and start a fresh one, deploy this update and restart the service once to load the command handler. Then SSH into the server and run from the deployed project folder, as the deployment/service user:

```bash
npm run admin:restart
```

If SSH uses a different user, run the command as the user selected when installing the service, for example:

```bash
sudo -u ubuntu npm run admin:restart
```

Replace `ubuntu` with the actual service user. The command needs write access to the same SQLite database as the running game service. It defaults to `data/game.sqlite` in the current directory; if you changed the database path, set `DATABASE_PATH` to the service's database explicitly.

This command:

- Archives the old round as **Restarted by admin**. Saved alarms stay saved; unresolved alarms are recorded as lost.
- Preserves usernames, sessions, saved-alarm logs and leaderboard totals.
- Starts ten new disabled alarms with random activation times over the remaining period before midday UK time. Five-minute response windows and the usual 1pm daily restart still apply.
- Updates connected browsers immediately, without restarting the service.

It refuses to reset during the midday–1pm results hour or when fewer than five minutes remain before midday. Overlapping requests cannot reset the same round twice. Requests expire after ten seconds and are cancelled on command interruption or timeout, so a stopped service will not unexpectedly apply an old request later.

There is no public admin endpoint or browser reset button. SSH/filesystem access is the admin permission boundary, independent of player usernames. The command reports success only after the running server has archived the old round, saved the new round and acknowledged it. Keep SQLite files in place; deleting the database would also delete player records.

## Backups

Back up the complete `data/` directory before updates. To take a consistent backup, briefly stop the app and include the whole directory, including SQLite WAL files:

```bash
sudo systemctl stop dbl
tar -czf /path/to/private-backups/dbl-data.tar.gz data
sudo systemctl start dbl
```

Use an existing private backup directory writable by your deployment user. If archiving fails, restart the app and investigate before relying on the backup. Keep an off-server copy. Copying only a live `game.sqlite` file can miss data still in its WAL.

## Troubleshooting

- **Port 3001 in use:** stop your manually started app first. Inspect the listener with `sudo ss -ltnp 'sport = :3001'`.
- **Node not found:** ensure `sudo node --version` reports 24 or newer and the selected service user can run that executable.
- **Permission denied:** the service user must be able to traverse parent directories and read source, dependencies and build output. Avoid placing the project under `/root`.
- **Public 404 but local health works:** check that Nginx proxies `/api/` and `/ws` as well as `/`.
- **WebSocket 403:** use exactly `https://dbl.crosdale.dev` and preserve the browser's `Origin` header.
- **Audio silent on page load:** sound defaults on, but browsers may require the first click or keypress before playback is allowed. Game controls unlock it silently; it plays when an alarm rings. The toggle still mutes immediately.
