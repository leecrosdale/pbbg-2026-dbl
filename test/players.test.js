import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { activateAlarm, createRound, roundBounds } from '../server/game.js';

test('private session tokens restore identity; names are validated and unique ignoring case', () => {
  const store = new Store(':memory:');
  try {
    const a = store.createPlayer();
    const b = store.createPlayer();
    assert.deepEqual({ ...store.playerForToken(a.token) }, a.player);
    assert.equal(store.playerForToken('not-a-session'), null);
    assert.equal(store.playerForToken('a'.repeat(64)), null);
    assert.equal('token' in store.playerForToken(a.token), false);
    assert.equal(store.renamePlayer(a.player.id, 'NightOwl').ok, true);
    assert.equal(store.renamePlayer(b.player.id, 'nightowl').ok, false);
    for (const name of ['ab', 'a'.repeat(21), '<img src=x>', '', null]) {
      assert.equal(store.renamePlayer(b.player.id, name).ok, false);
    }
    assert.equal(store.renamePlayer(a.player.id, 'NIGHTOWL').ok, true);
    assert.equal(store.playerForToken(a.token).username, 'NIGHTOWL');
  } finally { store.close(); }
});

test('logs retain the name used at save time while the leaderboard tracks stable player identity', () => {
  const store = new Store(':memory:');
  try {
    const { player } = store.createPlayer();
    store.renamePlayer(player.id, 'NightOwl');
    const bounds = roundBounds(Date.UTC(2026, 9, 22, 14));
    const round = createRound(bounds);
    const alarm = round.alarms[0];
    const savedAt = alarm.scheduledAt + 1234;
    assert.equal(activateAlarm(round, alarm.id, alarm.code, 'NightOwl', savedAt).ok, true);
    store.recordSave(round, alarm.id, player.id);
    assert.throws(() => store.recordSave(round, alarm.id, player.id));
    store.renamePlayer(player.id, 'EarlyBird');
    const community = store.community();
    assert.equal(community.leaders.length, 1);
    assert.equal(community.leaders[0].id, player.id);
    assert.equal(community.leaders[0].username, 'EarlyBird');
    assert.equal(community.leaders[0].saved, 1);
    assert.equal(community.leaders[0].rounds, 1);
    assert.equal(community.leaders[0].fastestMs, 1234);
    assert.equal(community.activity.length, 1);
    assert.equal(community.activity[0].username, 'NightOwl');
    assert.equal(community.activity[0].savedAt, savedAt);
    assert.equal(community.activity[0].roundId, round.id);
    assert.equal(community.activity[0].alarmId, alarm.id);
    assert.equal(store.get(round.id).alarms[0].status, 'activated');
  } finally { store.close(); }
});
