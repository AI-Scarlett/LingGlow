import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// This is intentionally a local, offline trial rather than a synthetic Dodo
// lease.  It only grants the app's temporary VIP permission snapshot; it has
// no license id, customer identity, device activation, or server-side binding.
export const LOCAL_VIP_TRIAL_SCHEMA_VERSION = 1;
export const LOCAL_VIP_TRIAL_DURATION_DAYS = 7;
export const LOCAL_VIP_TRIAL_DURATION_MS = LOCAL_VIP_TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
export const LOCAL_VIP_TRIAL_FILE = 'local-vip-trial.json';

const RECORD_KEYS = Object.freeze([
  'schemaVersion', 'startedAt', 'expiresAt', 'maxObservedAt',
]);
const MAX_RECORD_BYTES = 4 * 1024;
const OBSERVED_PERSIST_INTERVAL_MS = 60 * 1000;

function ownedPrivateDirectory(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const information = fs.lstatSync(directory);
  if (!information.isDirectory() || information.isSymbolicLink() ||
      (typeof process.getuid === 'function' && information.uid !== process.getuid())) {
    throw new Error('本机 VIP 试用目录不安全');
  }
  fs.chmodSync(directory, 0o700);
}

function normalizedDate(value, label) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} 不是有效时间`);
  return date;
}

function canonicalTimestamp(value, label) {
  if (typeof value !== 'string' || value.length > 40 || !value.endsWith('Z')) {
    throw new Error(`${label} 不是规范 UTC 时间`);
  }
  const date = normalizedDate(value, label);
  if (date.toISOString() !== value) throw new Error(`${label} 不是规范 UTC 时间`);
  return date;
}

function privateRegularFile(filePath) {
  let information;
  try {
    information = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1 ||
      information.size <= 0 || information.size > MAX_RECORD_BYTES ||
      (typeof process.getuid === 'function' && information.uid !== process.getuid()) ||
      (information.mode & 0o077) !== 0) {
    throw new Error('本机 VIP 试用记录权限或所有者不安全');
  }
  return information;
}

function exactRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error('本机 VIP 试用记录格式无效');
  }
  const keys = Object.keys(input).sort();
  const expected = [...RECORD_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('本机 VIP 试用记录字段无效');
  }
  if (input.schemaVersion !== LOCAL_VIP_TRIAL_SCHEMA_VERSION) {
    throw new Error('本机 VIP 试用记录版本不支持');
  }
  const startedAt = canonicalTimestamp(input.startedAt, 'startedAt');
  const expiresAt = canonicalTimestamp(input.expiresAt, 'expiresAt');
  const maxObservedAt = canonicalTimestamp(input.maxObservedAt, 'maxObservedAt');
  const expectedExpiresAt = new Date(startedAt.getTime() + LOCAL_VIP_TRIAL_DURATION_MS);
  if (expiresAt.getTime() !== expectedExpiresAt.getTime() || maxObservedAt.getTime() < startedAt.getTime()) {
    throw new Error('本机 VIP 试用记录时间无效');
  }
  return Object.freeze({
    schemaVersion: LOCAL_VIP_TRIAL_SCHEMA_VERSION,
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maxObservedAt: maxObservedAt.toISOString(),
  });
}

function serialize(record) {
  return `${JSON.stringify(record)}\n`;
}

function freezeResolution(record, observedAt) {
  const observed = normalizedDate(observedAt, 'observedAt');
  const expires = Date.parse(record.expiresAt);
  const remainingMilliseconds = Math.max(0, expires - observed.getTime());
  return Object.freeze({
    ...record,
    state: remainingMilliseconds > 0 ? 'active' : 'expired',
    active: remainingMilliseconds > 0,
    observedAt: observed.toISOString(),
    remainingSeconds: Math.ceil(remainingMilliseconds / 1000),
    durationDays: LOCAL_VIP_TRIAL_DURATION_DAYS,
  });
}

/**
 * A private, append-safe local first-use record.  `maxObservedAt` is a small
 * offline clock-rollback guard: resolving the entitlement after the system
 * clock moves backwards never moves the trial clock backwards or extends its
 * expiration. A user with full control of their macOS account can still erase
 * local app data; that is why paid subscriptions remain server-issued leases.
 */
export class LocalVipTrialStore {
  constructor({filePath, clock = () => new Date()} = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.basename(filePath) !== LOCAL_VIP_TRIAL_FILE) {
      throw new Error('本机 VIP 试用文件路径无效');
    }
    if (typeof clock !== 'function') throw new Error('本机 VIP 试用时钟无效');
    this.filePath = filePath;
    this.clock = clock;
  }

  read() {
    if (!privateRegularFile(this.filePath)) return null;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      throw new Error('本机 VIP 试用记录格式无效');
    }
    return exactRecord(parsed);
  }

  create(record) {
    const normalized = exactRecord(record);
    const parent = path.dirname(this.filePath);
    ownedPrivateDirectory(parent);
    let descriptor;
    try {
      descriptor = fs.openSync(this.filePath, 'wx', 0o600);
      fs.writeFileSync(descriptor, serialize(normalized), 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.chmodSync(this.filePath, 0o600);
      this.syncDirectory(parent);
      return normalized;
    } finally {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
    }
  }

  replace(record) {
    const normalized = exactRecord(record);
    const parent = path.dirname(this.filePath);
    ownedPrivateDirectory(parent);
    // Do not treat a malformed existing record as a new install. It must stay
    // fail-closed rather than silently creating a fresh seven-day window.
    this.read();
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, serialize(normalized), 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
      this.syncDirectory(parent);
      return normalized;
    } finally {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
      if (fs.existsSync(temporary)) try { fs.unlinkSync(temporary); } catch {}
    }
  }

  syncDirectory(directory) {
    try {
      const descriptor = fs.openSync(directory, 'r');
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    } catch {
      // Some supported filesystems do not allow directory fsync. The record
      // itself has already been fsync'ed and remains private either way.
    }
  }

  resolve({now = this.clock()} = {}) {
    const current = normalizedDate(now, 'now');
    let record = this.read();
    if (!record) {
      const startedAt = current.toISOString();
      try {
        record = this.create({
          schemaVersion: LOCAL_VIP_TRIAL_SCHEMA_VERSION,
          startedAt,
          expiresAt: new Date(current.getTime() + LOCAL_VIP_TRIAL_DURATION_MS).toISOString(),
          maxObservedAt: startedAt,
        });
      } catch (error) {
        // A concurrent first resolution owns the record; use it rather than
        // minting a second timestamp. All other creation failures stay fatal.
        if (error.code !== 'EEXIST') throw error;
        record = this.read();
        if (!record) throw error;
      }
    }

    const persisted = Date.parse(record.maxObservedAt);
    const observedAt = Math.max(current.getTime(), persisted);
    // 每次权益读取都重写记录会带来两次 fsync。到期后 maxObservedAt 不再影响任何判定，
    // 停止重写；到期前只在明显前进时落盘，回拨保护最多损失一个写入间隔。
    if (persisted < Date.parse(record.expiresAt) && observedAt - persisted >= OBSERVED_PERSIST_INTERVAL_MS) {
      record = this.replace({...record, maxObservedAt: new Date(observedAt).toISOString()});
    }
    return freezeResolution(record, new Date(observedAt));
  }
}

export function publicLocalVipTrial(trial) {
  if (!trial || typeof trial !== 'object') return null;
  const state = trial.state === 'active' || trial.state === 'expired' ? trial.state : null;
  const startedAt = typeof trial.startedAt === 'string' ? trial.startedAt : null;
  const expiresAt = typeof trial.expiresAt === 'string' ? trial.expiresAt : null;
  const durationDays = Number.isInteger(trial.durationDays) ? trial.durationDays : null;
  const remainingSeconds = Number.isInteger(trial.remainingSeconds) && trial.remainingSeconds >= 0
    ? trial.remainingSeconds
    : null;
  if (!state || !startedAt || !expiresAt || durationDays !== LOCAL_VIP_TRIAL_DURATION_DAYS || remainingSeconds === null) {
    throw new Error('本机 VIP 试用状态无效');
  }
  return Object.freeze({
    kind: 'local-first-use',
    state,
    startedAt,
    expiresAt,
    remainingSeconds,
    durationDays,
  });
}
