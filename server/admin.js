import { randomUUID } from 'node:crypto';
import { createRound, RESPONSE_MS, roundBounds } from './game.js';

export function restartRound(current, now) {
  const bounds = roundBounds(now);
  if (bounds.phase !== 'live') throw new Error('The results hour is in progress. A fresh round starts at 1pm UK time.');
  if (bounds.end - now < RESPONSE_MS) throw new Error('Less than five minutes remain before midday. Wait for the next round at 1pm UK time.');
  if ((current.dayId || current.id) !== bounds.id) throw new Error('The daily round changed. Try the command again.');

  const archived = structuredClone(current);
  archived.end = now;
  archived.completedAt = now;
  archived.endReason = 'admin_restart';
  for (const alarm of archived.alarms) {
    if (alarm.status === 'disabled' || alarm.status === 'ringing') {
      alarm.status = 'destroyed';
      alarm.resolvedAt = now;
    }
  }
  const next = createRound({
    ...bounds, dayId: bounds.id,
    id: `${bounds.id}-r${now}-${randomUUID().slice(0, 8)}`,
    start: now,
  });
  return { archived, next };
}

export function processAdminRestart(store, current, now = Date.now()) {
  const action = store.nextAdminAction();
  if (!action) return null;
  try {
    if (now >= action.expires_at) throw new Error('Restart request expired. Run the command again while the service is running.');
    if (action.expected_round_id !== current.id) throw new Error('The round has already changed. Run the command again if another restart is intended.');
    const { archived, next } = restartRound(current, now);
    return store.finishAdminRestart(action.id, archived, next, now) ? next : null;
  } catch (error) {
    store.failAdminAction(action.id, error.message);
    return null;
  }
}
