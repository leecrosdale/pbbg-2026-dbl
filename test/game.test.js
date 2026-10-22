import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { activateAlarm, advanceRound, createRound, publicRound, roundBounds, RESPONSE_MS } from '../server/game.js';
import { Store } from '../server/store.js';

const uk = text => DateTime.fromISO(text, { zone: 'Europe/London' }).toMillis();

test('UK rounds end at midday and restart at 1pm', () => {
  const before = roundBounds(uk('2026-10-22T11:59:59'));
  assert.equal(before.id, '2026-10-21');
  assert.equal(before.end, uk('2026-10-22T12:00:00'));
  assert.equal(before.phase, 'live');
  const results = roundBounds(uk('2026-10-22T12:00:00'));
  assert.equal(results.id, before.id);
  assert.equal(results.phase, 'results');
  assert.equal(results.restart, uk('2026-10-22T13:00:00'));
  assert.equal(roundBounds(uk('2026-10-22T12:59:59')).phase, 'results');
  const next = roundBounds(uk('2026-10-22T13:00:00'));
  assert.equal(next.id, '2026-10-22');
  assert.equal(next.phase, 'live');
});

test('DST changes preserve 1pm and midday UK, with a one-hour results period', () => {
  for (const [date, hours] of [['2026-03-28', 22], ['2026-10-24', 24], ['2026-10-22', 23]]) {
    const bounds = roundBounds(uk(`${date}T14:00:00`));
    assert.equal((bounds.end - bounds.start) / 3600000, hours);
    assert.equal(DateTime.fromMillis(bounds.end, { zone: 'Europe/London' }).hour, 12);
    assert.equal(DateTime.fromMillis(bounds.restart, { zone: 'Europe/London' }).hour, 13);
    assert.equal(bounds.restart - bounds.end, 3600000);
  }
});

test('ten random alarms fit entirely inside the round with secret future schedules', () => {
  const round = createRound(roundBounds(uk('2026-10-22T14:00:00')));
  assert.equal(round.alarms.length, 10);
  for (const a of round.alarms) {
    assert.ok(a.scheduledAt >= round.start);
    assert.ok(a.deadline <= round.end);
    assert.equal(a.deadline - a.scheduledAt, RESPONSE_MS);
    assert.match(a.code, /^\d{4}$/);
    assert.equal(a.status, 'disabled');
  }
  const view = publicRound(round, round.start);
  assert.ok(view.alarms.every(a => a.code === null && a.deadline === null && !('scheduledAt' in a)));
});

test('valid code wins once; wrong, early, replayed and late submissions fail', () => {
  const round = createRound(roundBounds(uk('2026-10-22T14:00:00')));
  const a = round.alarms[0];
  assert.equal(activateAlarm(round, a.id, a.code, 'A', a.scheduledAt - 1).ok, false);
  advanceRound(round, a.scheduledAt);
  assert.equal(a.status, 'ringing');
  assert.equal(publicRound(round, a.scheduledAt).alarms[0].code, a.code);
  assert.equal(activateAlarm(round, a.id, 'wrong', 'A', a.scheduledAt + 1).ok, false);
  assert.equal(activateAlarm(round, a.id, a.code, 'A', a.deadline - 1).ok, true);
  assert.equal(activateAlarm(round, a.id, a.code, 'B', a.deadline - 1).ok, false);
  assert.equal(a.activatedBy, 'A');
  const b = round.alarms[1];
  assert.equal(activateAlarm(round, b.id, b.code, 'B', b.deadline).ok, false);
  assert.equal(b.status, 'destroyed');
});

test('downtime catches missed alarms and records completion at midday only', () => {
  const round = createRound(roundBounds(uk('2026-10-22T14:00:00')));
  advanceRound(round, round.end - 1);
  assert.ok(round.alarms.every(a => a.status === 'destroyed'));
  assert.equal(round.completedAt, null);
  assert.equal(advanceRound(round, round.end), true);
  assert.equal(round.completedAt, round.end);
  assert.equal(publicRound(round, round.end).phase, 'results');
  assert.equal(advanceRound(round, round.end + 1), false);
});

test('SQLite preserves schedules, codes, winners and historical results', () => {
  const store = new Store(':memory:');
  try {
    const round = createRound(roundBounds(uk('2026-10-22T14:00:00')));
    const a = round.alarms[0];
    activateAlarm(round, a.id, a.code, 'Visitor ABCD', a.scheduledAt);
    store.save(round);
    assert.deepEqual(store.get(round.id), round);
    assert.equal(store.unfinished().length, 1);
    assert.equal(store.history().length, 0);
    advanceRound(round, round.end);
    store.save(round);
    store.save(round);
    assert.equal(store.unfinished().length, 0);
    assert.deepEqual(store.history(), [{ id: round.id, end: round.end, activated: 1, destroyed: 9 }]);
  } finally { store.close(); }
});
