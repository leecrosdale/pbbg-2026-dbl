import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { Store } from '../server/store.js';
import { activateAlarm, createRound, roundBounds, RESPONSE_MS } from '../server/game.js';
import { processAdminRestart, restartRound } from '../server/admin.js';

const uk = text => DateTime.fromISO(text, { zone: 'Europe/London' }).toMillis();
const now = uk('2026-10-22T18:00:00');

test('admin restart preserves records, archives unresolved alarms, and schedules within the remaining UK day', () => {
  const store = new Store(':memory:');
  try {
    const current = createRound(roundBounds(now));
    const player = store.createPlayer().player;
    const alarm = current.alarms[0];
    alarm.scheduledAt = now - 10000;
    alarm.deadline = now + 10000;
    assert.equal(activateAlarm(current, alarm.id, alarm.code, player.username, now).ok, true);
    store.recordSave(current, alarm.id, player.id);
    store.setCurrent(current);
    const stats = store.community();
    const request = store.requestAdminRestart(current.id, now);
    const fresh = processAdminRestart(store, current, now + 1);
    assert.notEqual(fresh.id, current.id);
    assert.equal(fresh.dayId, current.id);
    assert.equal(fresh.end, current.end);
    assert.equal(fresh.restart, current.restart);
    assert.equal(fresh.start, now + 1);
    assert.equal(fresh.alarms.length, 10);
    assert.ok(fresh.alarms.every(a => a.status === 'disabled' && a.scheduledAt >= fresh.start && a.deadline <= fresh.end));
    assert.deepEqual(store.current(current.id), fresh);
    assert.equal(store.adminAction(request).status, 'completed');
    const archived = store.get(current.id);
    assert.equal(archived.end, now + 1);
    assert.equal(archived.endReason, 'admin_restart');
    assert.equal(archived.alarms[0].status, 'activated');
    assert.equal(archived.alarms.filter(a => a.status === 'destroyed').length, 9);
    assert.equal(store.history()[0].endReason, 'admin_restart');
    assert.deepEqual(store.community(), stats);
    assert.equal(store.player(player.id).username, player.username);
    assert.equal(current.completedAt, null); // Planning the reset does not mutate the live object.
  } finally { store.close(); }
});

test('expired, cancelled and stale requests never create a new round', () => {
  const store = new Store(':memory:');
  try {
    const current = createRound(roundBounds(now));
    store.save(current);
    store.setCurrent(current);
    const expired = store.requestAdminRestart(current.id, now - 11000);
    assert.equal(processAdminRestart(store, current, now), null);
    assert.equal(store.adminAction(expired).status, 'failed');
    const cancelled = store.requestAdminRestart(current.id, now);
    store.failAdminAction(cancelled, 'Cancelled by administrator.');
    assert.equal(processAdminRestart(store, current, now), null);
    const first = store.requestAdminRestart(current.id, now);
    const second = store.requestAdminRestart(current.id, now + 1);
    const fresh = processAdminRestart(store, current, now + 2);
    assert.equal(store.adminAction(first).status, 'completed');
    assert.equal(processAdminRestart(store, fresh, now + 3), null);
    assert.equal(store.adminAction(second).status, 'failed');
    assert.deepEqual(store.current(current.id), fresh);
    assert.equal(store.history().length, 1);
  } finally { store.close(); }
});

test('admin restart cannot bypass the results hour or shorten an alarm response window', () => {
  const current = createRound(roundBounds(uk('2026-10-22T11:00:00')));
  assert.throws(() => restartRound(current, uk('2026-10-22T12:30:00')), /results hour/);
  assert.throws(() => restartRound(current, current.end - RESPONSE_MS + 1), /Less than five minutes/);
  assert.throws(() => restartRound(current, uk('2026-10-22T14:00:00')), /daily round changed/);
  assert.equal(current.completedAt, null);
});
