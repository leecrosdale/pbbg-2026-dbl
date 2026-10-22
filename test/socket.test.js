import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Store } from '../server/store.js';
import { createRound, roundBounds } from '../server/game.js';
import { createServer } from 'node:net';

async function availablePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
function message(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', handler); reject(new Error('WebSocket message timed out')); }, 5000);
    function handler(raw) {
      const data = JSON.parse(raw.toString());
      if (predicate(data)) { clearTimeout(timeout); socket.off('message', handler); resolve(data); }
    }
    socket.on('message', handler);
  });
}

test('real clients share a winner; originless clients are refused; restart preserves result', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jit-test-'));
  const path = join(dir, 'test.sqlite');
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const bounds = roundBounds(Date.now());
  // This fixture remains a live round even when the real test clock is in results hour.
  const round = createRound({ ...bounds, end: Date.now() + 3600000 });
  for (const [i, alarm] of round.alarms.entries()) {
    alarm.scheduledAt = Date.now() + (i + 1) * 60000;
    alarm.deadline = alarm.scheduledAt + 60000;
  }
  round.alarms[0].scheduledAt = Date.now() - 1000;
  round.alarms[0].deadline = Date.now() + 60000;
  const store = new Store(path); store.save(round); store.close();
  let server;
  const clients = [];
  async function start() {
    server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DATABASE_PATH: path }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
      server.stdout.on('data', output => { if (output.toString().includes('Game server:')) { clearTimeout(timer); resolve(); } });
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    });
  }
  async function stop() { const exited = once(server, 'exit'); server.kill(); await exited; }
  try {
    await start();
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
    const profileResponse = await fetch(`${url}/api/profile`);
    const cookie = profileResponse.headers.get('set-cookie').split(';')[0];
    assert.match(profileResponse.headers.get('set-cookie'), /HttpOnly/i);
    const profile = await profileResponse.json();
    assert.equal((await (await fetch(`${url}/api/profile`, { headers: { Cookie: cookie } })).json()).id, profile.id);
    const rename = await fetch(`${url}/api/profile`, {
      method: 'POST', headers: { Cookie: cookie, Origin: url, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'NightOwl' }),
    });
    assert.equal(rename.status, 200);
    assert.equal((await rename.json()).username, 'NightOwl');
    assert.equal((await fetch(`${url}/api/profile`, {
      method: 'POST', headers: { Cookie: cookie, Origin: 'https://other.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Impostor' }),
    })).status, 403);
    const invalid = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const rejected = await new Promise(resolve => { invalid.on('unexpected-response', (_r, res) => { resolve(res.statusCode); res.destroy(); }); invalid.on('error', () => {}); });
    assert.equal(rejected, 403);
    const a = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: url, headers: { Cookie: cookie } }); clients.push(a);
    const first = await message(a, m => m.type === 'state');
    assert.equal(first.round.alarms[0].status, 'ringing');
    assert.equal(first.round.alarms[1].code, null);
    const b = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: url }); clients.push(b);
    await message(b, m => m.type === 'state' && m.players === 2);
    const resultA = message(a, m => m.type === 'result');
    const resultB = message(b, m => m.type === 'result');
    const shared = message(b, m => m.type === 'state' && m.round.alarms[0].status === 'activated');
    const payload = JSON.stringify({ type: 'activate', alarmId: 1, code: first.round.alarms[0].code, username: 'Impostor' });
    a.send(payload); b.send(payload);
    const results = await Promise.all([resultA, resultB]);
    assert.equal(results.filter(r => r.ok).length, 1);
    const sharedState = await shared;
    assert.equal(sharedState.round.alarms[0].status, 'activated');
    const community = await (await fetch(`${url}/api/community`)).json();
    assert.equal(community.leaders.length, 1);
    assert.equal(community.leaders[0].saved, 1);
    assert.equal(community.activity.length, 1);
    assert.equal(community.activity[0].username, sharedState.round.alarms[0].activatedBy);
    assert.notEqual(community.activity[0].username, 'Impostor');
    if (results[0].ok) assert.equal(community.activity[0].username, 'NightOwl');
    for (const c of clients) c.terminate();
    await stop();
    await start();
    assert.equal((await (await fetch(`${url}/api/profile`, { headers: { Cookie: cookie } })).json()).username, 'NightOwl');
    assert.deepEqual(await (await fetch(`${url}/api/community`)).json(), community);
    const c = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: url }); clients.push(c);
    assert.equal((await message(c, m => m.type === 'state')).round.alarms[0].status, 'activated');
    // Exercise the real SSH command against the running server, without altering real data.
    if (bounds.phase === 'live' && bounds.end - Date.now() > 300000) {
      const resetState = message(c, m => m.type === 'state' && m.round.id !== round.id);
      const command = spawn(process.execPath, ['scripts/restart-round.mjs'], {
        env: { ...process.env, DATABASE_PATH: path }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      command.stdout.on('data', chunk => { output += chunk; });
      command.stderr.on('data', chunk => { output += chunk; });
      assert.equal((await once(command, 'exit'))[0], 0, output);
      assert.match(output, /Fresh round started/);
      const fresh = (await resetState).round;
      assert.equal(fresh.alarms.length, 10);
      assert.ok(fresh.alarms.every(alarm => alarm.status === 'disabled'));
      assert.deepEqual(await (await fetch(`${url}/api/community`)).json(), community);
      assert.equal((await (await fetch(`${url}/api/history`)).json())[0].endReason, 'admin_restart');
      c.terminate();
      await stop();
      await start();
      const d = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: url }); clients.push(d);
      assert.equal((await message(d, m => m.type === 'state')).round.id, fresh.id);
    }
  } finally {
    for (const c of clients) c.terminate();
    if (server && server.exitCode === null) await stop();
    // Only the specific temporary directory created above is removed.
    rmSync(dir, { recursive: true, force: true });
  }
});
