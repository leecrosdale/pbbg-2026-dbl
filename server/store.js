import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const validUsername = value => typeof value === 'string' && /^[A-Za-z0-9_-]{3,20}$/.test(value);
const tokenHash = token => createHash('sha256').update(token).digest('hex');

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS rounds (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        finished INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS saves (
        round_id TEXT NOT NULL REFERENCES rounds(id),
        alarm_id INTEGER NOT NULL,
        player_id TEXT NOT NULL REFERENCES players(id),
        username TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        response_ms INTEGER NOT NULL,
        PRIMARY KEY (round_id, alarm_id)
      );
      CREATE INDEX IF NOT EXISTS saves_player ON saves(player_id);
      CREATE INDEX IF NOT EXISTS saves_time ON saves(saved_at DESC);
      CREATE TABLE IF NOT EXISTS active_rounds (
        day_id TEXT PRIMARY KEY,
        round_id TEXT NOT NULL REFERENCES rounds(id)
      );
      CREATE TABLE IF NOT EXISTS admin_actions (
        id TEXT PRIMARY KEY,
        expected_round_id TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        message TEXT
      );
    `);
  }
  get(id) {
    const row = this.db.prepare('SELECT state FROM rounds WHERE id = ?').get(id);
    return row ? JSON.parse(row.state) : null;
  }
  save(round) {
    this.db.prepare(`INSERT INTO rounds (id, state, finished) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state = excluded.state, finished = excluded.finished`)
      .run(round.id, JSON.stringify(round), round.completedAt ? 1 : 0);
  }
  current(dayId) {
    const active = this.db.prepare('SELECT round_id FROM active_rounds WHERE day_id = ?').get(dayId);
    return this.get(active?.round_id || dayId);
  }
  setCurrent(round) {
    this.db.prepare(`INSERT INTO active_rounds (day_id, round_id) VALUES (?, ?)
      ON CONFLICT(day_id) DO UPDATE SET round_id = excluded.round_id`).run(round.dayId || round.id, round.id);
  }
  requestAdminRestart(roundId, now = Date.now()) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO admin_actions (id, expected_round_id, requested_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(id, roundId, now, now + 10000);
    return id;
  }
  adminAction(id) {
    return this.db.prepare('SELECT * FROM admin_actions WHERE id = ?').get(id);
  }
  nextAdminAction() {
    return this.db.prepare("SELECT * FROM admin_actions WHERE status = 'pending' ORDER BY requested_at, id LIMIT 1").get();
  }
  failAdminAction(id, message) {
    return this.db.prepare("UPDATE admin_actions SET status = 'failed', message = ? WHERE id = ? AND status = 'pending'").run(message, id);
  }
  finishAdminRestart(id, archived, next, now) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const action = this.adminAction(id);
      if (action?.status !== 'pending' || action.expires_at <= now) {
        this.db.exec('ROLLBACK');
        return false;
      }
      this.save(archived);
      this.save(next);
      this.setCurrent(next);
      this.db.prepare("UPDATE admin_actions SET status = 'completed', message = ? WHERE id = ?")
        .run(`Fresh round started: ${next.id}. Player records and history were preserved.`, id);
      this.db.exec('COMMIT');
      return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  unfinished() {
    return this.db.prepare('SELECT state FROM rounds WHERE finished = 0').all().map(row => JSON.parse(row.state));
  }
  history() {
    return this.db.prepare('SELECT state FROM rounds WHERE finished = 1 ORDER BY id DESC LIMIT 30').all()
      .map(({ state }) => {
        const round = JSON.parse(state);
        return {
          id: round.id, end: round.end,
          activated: round.alarms.filter(a => a.status === 'activated').length,
          destroyed: round.alarms.filter(a => a.status === 'destroyed').length,
          ...(round.endReason ? { endReason: round.endReason } : {}),
        };
      });
  }
  playerForToken(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.prepare('SELECT id, username FROM players WHERE token_hash = ?').get(tokenHash(token)) || null;
  }
  createPlayer() {
    const token = randomBytes(32).toString('hex');
    const id = randomUUID();
    const username = `Visitor-${id.slice(0, 12)}`;
    this.db.prepare('INSERT INTO players (id, token_hash, username, created_at) VALUES (?, ?, ?, ?)')
      .run(id, tokenHash(token), username, Date.now());
    return { player: { id, username }, token };
  }
  player(id) {
    return this.db.prepare('SELECT id, username FROM players WHERE id = ?').get(id) || null;
  }
  renamePlayer(id, username) {
    if (!validUsername(username)) return { ok: false, message: 'Use 3–20 letters, numbers, underscores or hyphens.' };
    const taken = this.db.prepare('SELECT id FROM players WHERE username = ? COLLATE NOCASE').get(username);
    if (taken && taken.id !== id) return { ok: false, message: 'That name is taken. Try another.' };
    this.db.prepare('UPDATE players SET username = ? WHERE id = ?').run(username, id);
    return { ok: true, player: this.player(id) };
  }
  recordSave(round, alarmId, playerId) {
    const alarm = round.alarms.find(a => a.id === alarmId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.save(round);
      this.db.prepare(`INSERT INTO saves (round_id, alarm_id, player_id, username, saved_at, response_ms)
        VALUES (?, ?, ?, ?, ?, ?)`).run(round.id, alarm.id, playerId, alarm.activatedBy,
        alarm.resolvedAt, Math.max(0, alarm.resolvedAt - alarm.scheduledAt));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  community() {
    return {
      leaders: this.db.prepare(`SELECT p.id, p.username, COUNT(*) AS saved,
        COUNT(DISTINCT s.round_id) AS rounds, MIN(s.response_ms) AS fastestMs
        FROM saves s JOIN players p ON p.id = s.player_id
        GROUP BY p.id ORDER BY saved DESC, MIN(s.saved_at) ASC, p.id ASC LIMIT 50`).all(),
      activity: this.db.prepare(`SELECT round_id AS roundId, alarm_id AS alarmId,
        player_id AS playerId, username, saved_at AS savedAt, response_ms AS responseMs
        FROM saves ORDER BY saved_at DESC, round_id DESC, alarm_id DESC LIMIT 50`).all(),
    };
  }
  close() { this.db.close(); }
}
