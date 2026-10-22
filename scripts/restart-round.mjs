import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Store } from '../server/store.js';
import { roundBounds } from '../server/game.js';

// SSH/filesystem access is the admin boundary. No public reset API is exposed.
const path = process.env.DATABASE_PATH || resolve('data/game.sqlite');
if (!existsSync(path)) {
  console.error(`No game database found at ${path}. Run from the deployed project folder, or set DATABASE_PATH to the service's database.`);
  process.exit(1);
}
let store;
let requestId;
for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    if (store && requestId) store.failAdminAction(requestId, 'Restart command cancelled by administrator.');
    store?.close();
    process.exit(exitCode);
  });
}
function result(action) {
  if (action.status === 'completed') { console.log(action.message); return true; }
  if (action.status === 'failed') throw new Error(action.message);
  return false;
}
try {
  store = new Store(path);
  const current = store.current(roundBounds(Date.now()).id);
  if (!current) throw new Error('No current round found. Start the game service first.');
  requestId = store.requestAdminRestart(current.id);
  console.log('Requesting a fresh round from the running game service…');
  for (let attempt = 0; attempt < 60; attempt++) {
    if (result(store.adminAction(requestId))) { requestId = null; break; }
    await setTimeout(200);
  }
  if (requestId) {
    store.failAdminAction(requestId, 'The service did not respond in time. Check sudo systemctl status dbl, then try again.');
    result(store.adminAction(requestId));
  }
} catch (error) {
  if (store && requestId) store.failAdminAction(requestId, 'Restart command stopped before completion.');
  console.error(error.message);
  process.exitCode = 1;
} finally { store?.close(); }
