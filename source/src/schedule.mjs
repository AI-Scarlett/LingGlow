import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LEGACY_CATALOG_CLIENT_IDS, SCHEDULE_CLIENT_IDS} from './client-registry.mjs';

export const WEEK_DAYS = Object.freeze([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);
export const SCHEDULE_SCHEMA_VERSION = 2;
// State v3 adds durable per-client snoozes.  A schedule reminder must survive
// a local service restart while the user has explicitly asked to see it later.
export const SCHEDULE_STATE_SCHEMA_VERSION = 3;

// Version 1 predated Doubao's product-model slot.  It remains loadable and is
// normalized into v2, so an existing paid WorkBuddy/Codex schedule is never
// discarded merely because the target registry grew.
const LEGACY_SCHEDULE_CLIENT_IDS = LEGACY_CATALOG_CLIENT_IDS;
const CLIENT_ID_SET = new Set(SCHEDULE_CLIENT_IDS);
const WEEK_DAY_SET = new Set(WEEK_DAYS);
const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_FILE_BYTES = 32 * 1024;
const SCHEDULE_FILE = 'weekly-schedule.json';
const STATE_FILE = 'weekly-schedule-state.json';

function defaultDataDir() {
  return process.env.CODEX_SKIN_STUDIO_DATA ||
    path.join(os.homedir(), 'Library/Application Support/Codex Skin Studio');
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} 必须是普通对象`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  plainObject(value, label);
  const expected = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length) throw new Error(`${label} 包含未允许字段：${unknown.join(', ')}`);
  if (missing.length) throw new Error(`${label} 缺少字段：${missing.join(', ')}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function safeTimeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 80 || /[\p{Cc}<>]/u.test(value)) {
    throw new Error('timeZone 不合法');
  }
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: value}).format(new Date(0));
  } catch {
    throw new Error('timeZone 不是系统支持的时区');
  }
  return value;
}

function emptyWeek() {
  return Object.fromEntries(WEEK_DAYS.map((day) => [day, null]));
}

function resolvedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function defaultWeeklySchedule({timeZone = resolvedTimeZone()} = {}) {
  safeTimeZone(timeZone);
  return deepFreeze({
    schemaVersion: SCHEDULE_SCHEMA_VERSION,
    enabled: false,
    remindOnLaunch: true,
    timeZone,
    clients: Object.fromEntries(SCHEDULE_CLIENT_IDS.map((clientId) => [clientId, emptyWeek()])),
  });
}

function validateScheduleWeek(value, clientId) {
  exactKeys(value, WEEK_DAYS, `周计划 ${clientId}`);
  for (const day of WEEK_DAYS) {
    const skinId = value[day];
    if (skinId !== null && (typeof skinId !== 'string' || !SKIN_ID.test(skinId))) {
      throw new Error(`${clientId}.${day} 的皮肤 ID 不合法`);
    }
  }
  return value;
}

export function validateWeeklySchedule(input) {
  const value = clone(plainObject(input, '周计划'));
  exactKeys(value, ['schemaVersion', 'enabled', 'remindOnLaunch', 'timeZone', 'clients'], '周计划');
  if (![1, SCHEDULE_SCHEMA_VERSION].includes(value.schemaVersion)) throw new Error('不支持的周计划 schemaVersion');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
  if (typeof value.remindOnLaunch !== 'boolean') throw new Error('remindOnLaunch 必须是布尔值');
  safeTimeZone(value.timeZone);
  const expectedClients = value.schemaVersion === 1 ? LEGACY_SCHEDULE_CLIENT_IDS : SCHEDULE_CLIENT_IDS;
  exactKeys(value.clients, expectedClients, '周计划 clients');
  for (const clientId of expectedClients) validateScheduleWeek(value.clients[clientId], clientId);
  return deepFreeze({
    schemaVersion: SCHEDULE_SCHEMA_VERSION,
    enabled: value.enabled,
    remindOnLaunch: value.remindOnLaunch,
    timeZone: value.timeZone,
    clients: Object.fromEntries(SCHEDULE_CLIENT_IDS.map((clientId) => [
      clientId,
      clientId in value.clients ? value.clients[clientId] : emptyWeek(),
    ])),
  });
}

export function defaultScheduleState() {
  return deepFreeze({
    schemaVersion: SCHEDULE_STATE_SCHEMA_VERSION,
    lastReminderDateByClient: Object.fromEntries(SCHEDULE_CLIENT_IDS.map((clientId) => [clientId, null])),
    snoozeUntilByClient: Object.fromEntries(SCHEDULE_CLIENT_IDS.map((clientId) => [clientId, null])),
  });
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validSnoozeUntil(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS;
}

export function validateScheduleState(input) {
  const value = clone(plainObject(input, '周计划状态'));
  if (![1, 2, SCHEDULE_STATE_SCHEMA_VERSION].includes(value.schemaVersion)) {
    throw new Error('不支持的周计划状态 schemaVersion');
  }
  exactKeys(value, value.schemaVersion === SCHEDULE_STATE_SCHEMA_VERSION
    ? ['schemaVersion', 'lastReminderDateByClient', 'snoozeUntilByClient']
    : ['schemaVersion', 'lastReminderDateByClient'], '周计划状态');
  const expectedClients = value.schemaVersion === 1 ? LEGACY_SCHEDULE_CLIENT_IDS : SCHEDULE_CLIENT_IDS;
  exactKeys(value.lastReminderDateByClient, expectedClients, 'lastReminderDateByClient');
  for (const clientId of expectedClients) {
    const date = value.lastReminderDateByClient[clientId];
    if (date !== null && !validCalendarDate(date)) throw new Error(`${clientId} 的提醒日期无效`);
  }
  if (value.schemaVersion === SCHEDULE_STATE_SCHEMA_VERSION) {
    exactKeys(value.snoozeUntilByClient, expectedClients, 'snoozeUntilByClient');
    for (const clientId of expectedClients) {
      const until = value.snoozeUntilByClient[clientId];
      if (until !== null && !validSnoozeUntil(until)) throw new Error(`${clientId} 的稍后提醒时间无效`);
    }
  }
  return deepFreeze({
    schemaVersion: SCHEDULE_STATE_SCHEMA_VERSION,
    lastReminderDateByClient: Object.fromEntries(SCHEDULE_CLIENT_IDS.map((clientId) => [
      clientId,
      clientId in value.lastReminderDateByClient ? value.lastReminderDateByClient[clientId] : null,
    ])),
    snoozeUntilByClient: Object.fromEntries(SCHEDULE_CLIENT_IDS.map((clientId) => [
      clientId,
      value.schemaVersion === SCHEDULE_STATE_SCHEMA_VERSION && clientId in value.snoozeUntilByClient
        ? value.snoozeUntilByClient[clientId]
        : null,
    ])),
  });
}

function ensurePrivateDirectory(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`计划数据目录不安全：${directory}`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`计划数据目录不属于当前用户：${directory}`);
  }
  fs.chmodSync(directory, 0o700);
}

function scheduleDirectory(dataDir) {
  ensurePrivateDirectory(dataDir);
  const directory = path.join(dataDir, 'schedule');
  ensurePrivateDirectory(directory);
  return directory;
}

function safeExistingFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0 || stat.size > MAX_FILE_BYTES) {
    throw new Error(`计划文件不安全：${path.basename(filePath)}`);
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`计划文件不属于当前用户：${path.basename(filePath)}`);
  }
  return stat;
}

function readJsonFile(filePath) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`无法安全打开计划文件：${error.message}`);
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size > MAX_FILE_BYTES) {
      throw new Error('计划文件类型或大小无效');
    }
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('计划文件不属于当前用户');
    return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } finally {
    fs.closeSync(descriptor);
  }
}

function atomicWriteJson(filePath, value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(contents) > MAX_FILE_BYTES) throw new Error('计划文件超过 32 KB');
  if (fs.existsSync(filePath)) safeExistingFile(filePath);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (fs.existsSync(filePath)) safeExistingFile(filePath);
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
    let directoryDescriptor;
    try {
      directoryDescriptor = fs.openSync(path.dirname(filePath), fs.constants.O_RDONLY);
      fs.fsyncSync(directoryDescriptor);
    } catch {
      // The rename remains atomic even on platforms that reject directory fsync.
    } finally {
      if (directoryDescriptor !== undefined) fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function loadWeeklySchedule(dataDir = defaultDataDir()) {
  const directory = scheduleDirectory(dataDir);
  const raw = readJsonFile(path.join(directory, SCHEDULE_FILE));
  return raw === null ? defaultWeeklySchedule() : validateWeeklySchedule(raw);
}

export function saveWeeklySchedule(input, dataDir = defaultDataDir()) {
  const schedule = validateWeeklySchedule(input);
  const directory = scheduleDirectory(dataDir);
  atomicWriteJson(path.join(directory, SCHEDULE_FILE), schedule);
  return schedule;
}

export function loadScheduleState(dataDir = defaultDataDir()) {
  const directory = scheduleDirectory(dataDir);
  const raw = readJsonFile(path.join(directory, STATE_FILE));
  return raw === null ? defaultScheduleState() : validateScheduleState(raw);
}

export function saveScheduleState(input, dataDir = defaultDataDir()) {
  const state = validateScheduleState(input);
  const directory = scheduleDirectory(dataDir);
  atomicWriteJson(path.join(directory, STATE_FILE), state);
  return state;
}

function zonedDay(now, timeZone) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('now 不是有效时间');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  const day = parts.weekday.toLowerCase();
  if (!WEEK_DAY_SET.has(day)) throw new Error('无法解析周计划日期');
  return {day, dateKey: `${parts.year}-${parts.month}-${parts.day}`};
}

export function scheduledSkinFor(scheduleInput, {clientId, now = new Date()} = {}) {
  const schedule = validateWeeklySchedule(scheduleInput);
  if (!CLIENT_ID_SET.has(clientId)) throw new Error('未知客户端');
  const {day, dateKey} = zonedDay(now, schedule.timeZone);
  return deepFreeze({clientId, day, dateKey, skinId: schedule.clients[clientId][day]});
}

export function evaluateLaunchReminder(scheduleInput, stateInput, {clientId, now = new Date()} = {}) {
  const schedule = validateWeeklySchedule(scheduleInput);
  const state = validateScheduleState(stateInput);
  const selection = scheduledSkinFor(schedule, {clientId, now});
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('now 不是有效时间');
  let reason = 'ready';
  if (!schedule.enabled) reason = 'schedule-disabled';
  else if (!schedule.remindOnLaunch) reason = 'launch-reminders-disabled';
  else if (!selection.skinId) reason = 'no-skin-for-today';
  else if (state.lastReminderDateByClient[clientId] === selection.dateKey) reason = 'already-reminded-today';
  else if ((state.snoozeUntilByClient[clientId] ?? 0) > nowMs) reason = 'snoozed';
  const shouldRemind = reason === 'ready';
  const nextState = clone(state);
  if ((nextState.snoozeUntilByClient[clientId] ?? 0) <= nowMs) {
    nextState.snoozeUntilByClient[clientId] = null;
  }
  if (shouldRemind) nextState.lastReminderDateByClient[clientId] = selection.dateKey;
  return deepFreeze({
    ...selection,
    shouldRemind,
    reason,
    nextState: validateScheduleState(nextState),
  });
}

function expectedReminderMatches(result, {expectedSkinId, expectedDateKey} = {}) {
  if (expectedSkinId !== undefined && result.skinId !== expectedSkinId) return false;
  if (expectedDateKey !== undefined && result.dateKey !== expectedDateKey) return false;
  return true;
}

export function claimLaunchReminder(scheduleInput, {
  clientId,
  now = new Date(),
  dataDir = defaultDataDir(),
  expectedSkinId = undefined,
  expectedDateKey = undefined,
} = {}) {
  const result = evaluateLaunchReminder(scheduleInput, loadScheduleState(dataDir), {clientId, now});
  if (result.shouldRemind && expectedReminderMatches(result, {expectedSkinId, expectedDateKey})) {
    saveScheduleState(result.nextState, dataDir);
  }
  return result;
}

/**
 * Persist a bounded per-client snooze only while the same reminder is ready.
 * The state write is private and atomic, so a server restart cannot turn a
 * user's explicit “remind me later” into an immediate duplicate prompt.
 */
export function snoozeLaunchReminder(scheduleInput, {
  clientId,
  until,
  now = new Date(),
  dataDir = defaultDataDir(),
  expectedSkinId = undefined,
  expectedDateKey = undefined,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('now 不是有效时间');
  if (!validSnoozeUntil(until) || until <= nowMs) throw new Error('稍后提醒时间无效');
  const state = loadScheduleState(dataDir);
  const result = evaluateLaunchReminder(scheduleInput, state, {clientId, now});
  if (!result.shouldRemind) return deepFreeze({...result, snoozed: false});
  if (!expectedReminderMatches(result, {expectedSkinId, expectedDateKey})) {
    return deepFreeze({...result, snoozed: false, reason: 'reminder-no-longer-current'});
  }
  const nextState = clone(state);
  nextState.snoozeUntilByClient[clientId] = until;
  const saved = saveScheduleState(nextState, dataDir);
  return deepFreeze({
    ...result,
    shouldRemind: false,
    reason: 'snoozed',
    nextState: saved,
    snoozed: true,
  });
}

/**
 * Claim a reminder only after the bound Apply Intent has successfully launched
 * the scheduled skin.  The expected date and skin prevent a long-running
 * restart from consuming a newly edited schedule or the next calendar day.
 */
export function claimSuccessfulScheduleApply(scheduleInput, {
  clientId,
  skinId,
  dateKey,
  now = new Date(),
  dataDir = defaultDataDir(),
} = {}) {
  if (typeof skinId !== 'string' || !SKIN_ID.test(skinId) || !validCalendarDate(dateKey)) {
    throw new Error('排程提醒凭据无效');
  }
  const result = evaluateLaunchReminder(scheduleInput, loadScheduleState(dataDir), {clientId, now});
  if (!result.shouldRemind) return deepFreeze({...result, claimed: false});
  if (result.skinId !== skinId || result.dateKey !== dateKey) {
    return deepFreeze({...result, claimed: false, reason: 'reminder-no-longer-current'});
  }
  saveScheduleState(result.nextState, dataDir);
  return deepFreeze({...result, claimed: true});
}
