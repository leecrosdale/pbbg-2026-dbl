import { randomInt } from 'node:crypto';
import { DateTime } from 'luxon';

export const ZONE = 'Europe/London';
export const ALARM_COUNT = 10;
export const RESPONSE_MS = 5 * 60 * 1000;

// Calendar days, rather than 24-hour arithmetic, preserve UK wall-clock times at DST.
export function roundBounds(now) {
  const local = DateTime.fromMillis(now, { zone: ZONE });
  const todayStart = local.startOf('day').set({ hour: 13 });
  const start = local < todayStart ? todayStart.minus({ days: 1 }) : todayStart;
  const end = start.plus({ days: 1 }).set({ hour: 12 });
  const restart = end.set({ hour: 13 });
  return {
    id: start.toISODate(), start: start.toMillis(), end: end.toMillis(),
    restart: restart.toMillis(), phase: now >= end.toMillis() ? 'results' : 'live',
  };
}

export function createRound(bounds, windowMs = RESPONSE_MS) {
  const latest = bounds.end - windowMs;
  const times = Array.from({ length: ALARM_COUNT }, () => randomInt(bounds.start, latest + 1)).sort((a, b) => a - b);
  return {
    ...bounds, responseMs: windowMs, completedAt: null,
    alarms: times.map((scheduledAt, i) => ({
      id: i + 1, scheduledAt, deadline: scheduledAt + windowMs,
      code: String(randomInt(0, 10000)).padStart(4, '0'),
      status: 'disabled', resolvedAt: null, activatedBy: null,
    })),
  };
}

export function advanceRound(round, now) {
  let changed = false;
  for (const alarm of round.alarms) {
    if ((alarm.status === 'disabled' || alarm.status === 'ringing') && now >= alarm.deadline) {
      alarm.status = 'destroyed';
      alarm.resolvedAt = alarm.deadline;
      changed = true;
    } else if (alarm.status === 'disabled' && now >= alarm.scheduledAt) {
      alarm.status = 'ringing';
      changed = true;
    }
  }
  if (now >= round.end && round.completedAt === null) {
    round.completedAt = round.end;
    changed = true;
  }
  return changed;
}

export function activateAlarm(round, alarmId, code, player, now) {
  advanceRound(round, now);
  if (now < round.start || now >= round.end) return { ok: false, message: 'This round has ended.' };
  const alarm = round.alarms.find(a => a.id === alarmId);
  if (!alarm || alarm.status !== 'ringing') return { ok: false, message: 'That alarm is no longer ringing.' };
  if (code !== alarm.code) return { ok: false, message: 'That code isn’t right. Try again.' };
  alarm.status = 'activated';
  alarm.resolvedAt = now;
  alarm.activatedBy = player;
  return { ok: true, message: `Alarm ${String(alarm.id).padStart(2, '0')} saved. Just in time.` };
}

export function publicRound(round, now) {
  return {
    id: round.id, start: round.start, end: round.end, restart: round.restart,
    phase: now >= round.end ? 'results' : 'live', responseMs: round.responseMs,
    alarms: round.alarms.map(({ scheduledAt, code, ...alarm }) => ({
      ...alarm,
      // Future schedules and inactive codes stay on the server.
      deadline: alarm.status === 'ringing' ? alarm.deadline : null,
      code: alarm.status === 'ringing' ? code : null,
    })),
  };
}
