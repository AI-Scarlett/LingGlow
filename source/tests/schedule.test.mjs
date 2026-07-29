import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  WEEK_DAYS,
  SCHEDULE_STATE_SCHEMA_VERSION,
  claimSuccessfulScheduleApply,
  claimLaunchReminder,
  defaultScheduleState,
  defaultWeeklySchedule,
  evaluateLaunchReminder,
  loadScheduleState,
  loadWeeklySchedule,
  saveWeeklySchedule,
  snoozeLaunchReminder,
  validateScheduleState,
  validateWeeklySchedule,
} from '../src/schedule.mjs';
import {LEGACY_CATALOG_CLIENT_IDS, SCHEDULE_CLIENT_IDS} from '../src/client-registry.mjs';

function activeSchedule() {
  const schedule = structuredClone(defaultWeeklySchedule({timeZone: 'Asia/Shanghai'}));
  schedule.enabled = true;
  schedule.clients.codex.thursday = 'graphite-focus';
  schedule.clients.workbuddy.thursday = 'aurora-glass';
  return schedule;
}

test('weekly schedule has exactly seven days for each supported client', () => {
  const schedule = defaultWeeklySchedule({timeZone: 'UTC'});
  assert.equal(schedule.enabled, false);
  assert.equal(schedule.remindOnLaunch, true);
  assert.deepEqual(Object.keys(schedule.clients), SCHEDULE_CLIENT_IDS);
  for (const clientId of SCHEDULE_CLIENT_IDS) {
    assert.deepEqual(Object.keys(schedule.clients[clientId]), WEEK_DAYS);
  }
});

test('strict schedule and state validation reject missing, unknown, and mistyped fields', () => {
  const missingDay = structuredClone(defaultWeeklySchedule({timeZone: 'UTC'}));
  delete missingDay.clients.codex.sunday;
  assert.throws(() => validateWeeklySchedule(missingDay), /缺少字段/u);

  const stringBoolean = structuredClone(defaultWeeklySchedule({timeZone: 'UTC'}));
  stringBoolean.enabled = 'true';
  assert.throws(() => validateWeeklySchedule(stringBoolean), /布尔值/u);

  const unknown = structuredClone(defaultWeeklySchedule({timeZone: 'UTC'}));
  unknown.clients.codex.monday = '../escape';
  assert.throws(() => validateWeeklySchedule(unknown), /皮肤 ID/u);

  const badState = structuredClone(defaultScheduleState());
  badState.lastReminderDateByClient.codex = '2026-02-30';
  assert.throws(() => validateScheduleState(badState), /日期无效/u);

  const badSnooze = structuredClone(defaultScheduleState());
  badSnooze.snoozeUntilByClient.codex = -1;
  assert.throws(() => validateScheduleState(badSnooze), /稍后提醒时间无效/u);
});

test('schedule writes are atomic, private, and refuse symlink targets', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-schedule-'));
  const schedule = activeSchedule();
  saveWeeklySchedule(schedule, directory);
  assert.deepEqual(loadWeeklySchedule(directory), validateWeeklySchedule(schedule));
  const filePath = path.join(directory, 'schedule', 'weekly-schedule.json');
  assert.equal(fs.statSync(filePath).mode & 0o077, 0);
  assert.equal(fs.readdirSync(path.dirname(filePath)).some((name) => name.endsWith('.tmp')), false);

  const outside = path.join(directory, 'outside.json');
  fs.writeFileSync(outside, '{}');
  fs.unlinkSync(filePath);
  fs.symlinkSync(outside, filePath);
  assert.throws(() => saveWeeklySchedule(schedule, directory), /不安全/u);
  assert.throws(() => loadWeeklySchedule(directory), /安全打开/u);
});

test('launch reminders are claimed once per day and separately per client', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-schedule-state-'));
  const schedule = activeSchedule();
  const now = new Date('2026-07-16T02:00:00Z');
  const first = claimLaunchReminder(schedule, {clientId: 'codex', now, dataDir: directory});
  assert.equal(first.shouldRemind, true);
  assert.equal(first.skinId, 'graphite-focus');
  assert.equal(first.day, 'thursday');

  const second = claimLaunchReminder(schedule, {clientId: 'codex', now, dataDir: directory});
  assert.equal(second.shouldRemind, false);
  assert.equal(second.reason, 'already-reminded-today');

  const workbuddy = claimLaunchReminder(schedule, {clientId: 'workbuddy', now, dataDir: directory});
  assert.equal(workbuddy.shouldRemind, true);
  assert.equal(workbuddy.skinId, 'aurora-glass');
  assert.deepEqual(loadScheduleState(directory).lastReminderDateByClient, {
    workbuddy: '2026-07-16',
    doubao: null,
    codex: '2026-07-16',
  });
});

test('v1 two-Agent schedules and reminder state migrate to the full registry without losing assignments', () => {
  const legacyClients = Object.fromEntries(LEGACY_CATALOG_CLIENT_IDS.map((clientId) => [
    clientId,
    Object.fromEntries(WEEK_DAYS.map((day) => [day, null])),
  ]));
  legacyClients.codex.friday = 'graphite-focus';
  legacyClients.workbuddy.friday = 'aurora-glass';

  const schedule = validateWeeklySchedule({
    schemaVersion: 1,
    enabled: true,
    remindOnLaunch: true,
    timeZone: 'UTC',
    clients: legacyClients,
  });
  assert.equal(schedule.schemaVersion, 2);
  assert.deepEqual(Object.keys(schedule.clients), SCHEDULE_CLIENT_IDS);
  assert.equal(schedule.clients.codex.friday, 'graphite-focus');
  assert.equal(schedule.clients.workbuddy.friday, 'aurora-glass');
  assert.deepEqual(schedule.clients.doubao, Object.fromEntries(WEEK_DAYS.map((day) => [day, null])));

  const state = validateScheduleState({
    schemaVersion: 1,
    lastReminderDateByClient: {
      codex: '2026-07-16',
      workbuddy: null,
    },
  });
  assert.equal(state.schemaVersion, SCHEDULE_STATE_SCHEMA_VERSION);
  assert.deepEqual(state.lastReminderDateByClient, {
    workbuddy: null,
    doubao: null,
    codex: '2026-07-16',
  });
  assert.deepEqual(state.snoozeUntilByClient, {
    workbuddy: null,
    doubao: null,
    codex: null,
  });
});

test('disabled or unassigned schedules do not advance reminder state', () => {
  const schedule = defaultWeeklySchedule({timeZone: 'UTC'});
  const state = defaultScheduleState();
  const result = evaluateLaunchReminder(schedule, state, {
    clientId: 'codex',
    now: '2026-07-16T12:00:00Z',
  });
  assert.equal(result.shouldRemind, false);
  assert.equal(result.reason, 'schedule-disabled');
  assert.deepEqual(result.nextState, state);
});

test('snoozes persist across a restart and successful apply claims only the bound reminder', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-schedule-atomic-'));
  const schedule = activeSchedule();
  const now = new Date('2026-07-16T02:00:00Z');
  const ready = evaluateLaunchReminder(schedule, defaultScheduleState(), {clientId: 'codex', now});
  assert.equal(ready.shouldRemind, true);

  const snoozed = snoozeLaunchReminder(schedule, {
    clientId: 'codex',
    until: now.getTime() + 60 * 60 * 1000,
    now,
    dataDir: directory,
  });
  assert.equal(snoozed.snoozed, true);
  assert.equal(loadScheduleState(directory).snoozeUntilByClient.codex, now.getTime() + 60 * 60 * 1000);
  assert.equal(evaluateLaunchReminder(schedule, loadScheduleState(directory), {
    clientId: 'codex', now: new Date(now.getTime() + 30 * 60 * 1000),
  }).reason, 'snoozed');

  const wrongSkin = claimSuccessfulScheduleApply(schedule, {
    clientId: 'codex',
    skinId: 'aurora-glass',
    dateKey: ready.dateKey,
    now: new Date(now.getTime() + 60 * 60 * 1000 + 1),
    dataDir: directory,
  });
  assert.equal(wrongSkin.claimed, false);
  assert.equal(loadScheduleState(directory).lastReminderDateByClient.codex, null);

  const claimed = claimSuccessfulScheduleApply(schedule, {
    clientId: 'codex',
    skinId: ready.skinId,
    dateKey: ready.dateKey,
    now: new Date(now.getTime() + 60 * 60 * 1000 + 1),
    dataDir: directory,
  });
  assert.equal(claimed.claimed, true);
  const persisted = loadScheduleState(directory);
  assert.equal(persisted.lastReminderDateByClient.codex, ready.dateKey);
  assert.equal(persisted.snoozeUntilByClient.codex, null);
});
