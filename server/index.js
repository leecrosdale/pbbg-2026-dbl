import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from './store.js';
import { activateAlarm, advanceRound, createRound, publicRound, roundBounds } from './game.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
const store = new Store(process.env.DATABASE_PATH || resolve('data/game.sqlite'));
let round;

function reconcile(now = Date.now()) {
  // Catch up rounds that elapsed during downtime before starting today's round.
  if (!round || round.id !== roundBounds(now).id) {
    for (const old of store.unfinished()) {
      if (old.end <= now) { advanceRound(old, now); store.save(old); }
    }
    const bounds = roundBounds(now);
    round = store.get(bounds.id) || createRound(bounds);
    advanceRound(round, now);
    store.save(round);
    return true;
  }
  if (advanceRound(round, now)) { store.save(round); return true; }
  return false;
}
reconcile();

function broadcast() {
  const message = JSON.stringify({ type: 'state', now: Date.now(), players: wss.clients.size, round: publicRound(round, Date.now()) });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
}

app.get('/api/history', (_req, res) => { reconcile(); res.set('Cache-Control', 'no-store').json(store.history()); });
function sessionToken(request) {
  return request.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('jit_player='))?.slice('jit_player='.length);
}
function sameOrigin(request) {
  const origin = request.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  try { return Boolean(origin) && (allowed.length ? allowed.includes(origin) : new URL(origin).host === request.headers.host); }
  catch { return false; }
}
app.get('/api/profile', (req, res) => {
  let player = store.playerForToken(sessionToken(req));
  if (!player) {
    const created = store.createPlayer();
    player = created.player;
    const secure = req.secure || process.env.SESSION_COOKIE_SECURE === 'true';
    res.cookie('jit_player', created.token, { httpOnly: true, sameSite: 'strict', secure, maxAge: 365 * 86400000, path: '/' });
  }
  res.set('Cache-Control', 'no-store').json(player);
});
app.post('/api/profile', express.json({ limit: '1kb' }), (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ message: 'Use the game site to update your name.' });
  const player = store.playerForToken(sessionToken(req));
  if (!player) return res.status(401).json({ message: 'Refresh the page to restore your player session.' });
  const result = store.renamePlayer(player.id, req.body?.username);
  if (!result.ok) return res.status(400).json(result);
  for (const client of wss.clients) {
    if (client.playerId === player.id && client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'profile', player: result.player }));
  }
  res.set('Cache-Control', 'no-store').json(result.player);
});
app.get('/api/community', (_req, res) => res.set('Cache-Control', 'no-store').json(store.community()));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(resolve('dist')));
app.get('/', (_req, res) => res.sendFile(resolve('dist/index.html')));

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws' || !sameOrigin(request)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request));
});

wss.on('connection', (client, request) => {
  const player = store.playerForToken(sessionToken(request)) || store.createPlayer().player;
  client.playerId = player.id;
  client.alive = true;
  client.lastAttempt = 0;
  client.on('pong', () => { client.alive = true; });
  client.send(JSON.stringify({ type: 'profile', player }));
  reconcile();
  broadcast();
  client.on('message', raw => {
    const now = Date.now();
    const changed = reconcile(now);
    if (changed) broadcast();
    if (now - client.lastAttempt < 1000) {
      client.send(JSON.stringify({ type: 'result', ok: false, message: 'Give it a second, then try again.' }));
      return;
    }
    client.lastAttempt = now;
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (data.type !== 'activate' || !Number.isInteger(data.alarmId) || typeof data.code !== 'string' || !/^\d{4}$/.test(data.code)) {
      client.send(JSON.stringify({ type: 'result', ok: false, message: 'Enter the four-digit code.' }));
      return;
    }
    const player = store.player(client.playerId);
    const previous = structuredClone(round);
    const result = activateAlarm(round, data.alarmId, data.code, player.username, now);
    if (result.ok) {
      try { store.recordSave(round, data.alarmId, player.id); }
      catch (error) {
        round = previous;
        console.error('Could not record alarm save:', error);
        client.send(JSON.stringify({ type: 'result', ok: false, message: 'Couldn’t record that save. Please try again.' }));
        return;
      }
      broadcast();
    }
    client.send(JSON.stringify({ type: 'result', ...result }));
  });
  client.on('error', () => {});
  client.on('close', broadcast);
});

const ticker = setInterval(() => { if (reconcile()) broadcast(); }, 500);
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (!client.alive) { client.terminate(); continue; }
    client.alive = false;
    client.ping();
  }
}, 30000);
const port = Number(process.env.PORT || 3001);
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Game server: http://127.0.0.1:${port}`));
function shutdown() {
  clearInterval(ticker); clearInterval(heartbeat);
  for (const client of wss.clients) client.terminate();
  wss.close(); server.close(() => { store.close(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
