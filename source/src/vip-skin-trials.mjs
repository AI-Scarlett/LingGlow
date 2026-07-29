import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const VIP_SKIN_TRIAL_FILE = 'vip-skin-trials.json';
const SCHEMA_VERSION = 1;
const MAX_BYTES = 64 * 1024;
const MAX_SKINS = 200;
const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const CLIENT_IDS = new Set(['codex', 'workbuddy', 'doubao']);

function privateDirectory(directory) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new Error('VIP 皮肤试用目录不安全');
  }
  fs.chmodSync(directory, 0o700);
}

function canonicalDate(value) {
  if (typeof value !== 'string' || value.length > 40 || !value.endsWith('Z')) {
    throw new Error('VIP 皮肤试用时间无效');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error('VIP 皮肤试用时间无效');
  }
  return value;
}

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'schemaVersion,trials') {
    throw new Error('VIP 皮肤试用记录格式无效');
  }
  if (input.schemaVersion !== SCHEMA_VERSION || !input.trials ||
      typeof input.trials !== 'object' || Array.isArray(input.trials)) {
    throw new Error('VIP 皮肤试用记录版本无效');
  }
  const entries = Object.entries(input.trials);
  if (entries.length > MAX_SKINS) throw new Error('VIP 皮肤试用记录超过限制');
  const trials = {};
  for (const [skinId, record] of entries) {
    if (!SKIN_ID.test(skinId) || !record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).sort().join(',') !== 'clientId,usedAt' ||
        !CLIENT_IDS.has(record.clientId)) {
      throw new Error('VIP 皮肤试用项目无效');
    }
    trials[skinId] = Object.freeze({usedAt: canonicalDate(record.usedAt), clientId: record.clientId});
  }
  return Object.freeze({schemaVersion: SCHEMA_VERSION, trials: Object.freeze(trials)});
}

function defaultRecord() {
  return Object.freeze({schemaVersion: SCHEMA_VERSION, trials: Object.freeze({})});
}

export class VipSkinTrialStore {
  constructor({filePath, clock = () => new Date()} = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) ||
        path.basename(filePath) !== VIP_SKIN_TRIAL_FILE || typeof clock !== 'function') {
      throw new Error('VIP 皮肤试用存储配置无效');
    }
    this.filePath = filePath;
    this.clock = clock;
  }

  read() {
    if (!fs.existsSync(this.filePath)) return defaultRecord();
    const stat = fs.lstatSync(this.filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 ||
        stat.size > MAX_BYTES || (stat.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new Error('VIP 皮肤试用记录权限或所有者不安全');
    }
    return normalize(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
  }

  status(skinId) {
    if (!SKIN_ID.test(skinId)) throw new Error('VIP 皮肤试用 ID 无效');
    const record = this.read().trials[skinId] ?? null;
    return Object.freeze(record
      ? {state: 'consumed', usedAt: record.usedAt, clientId: record.clientId}
      : {state: 'available', usedAt: null, clientId: null});
  }

  consume(skinId, clientId) {
    if (!SKIN_ID.test(skinId) || !CLIENT_IDS.has(clientId)) throw new Error('VIP 皮肤试用参数无效');
    const current = this.read();
    if (current.trials[skinId]) {
      const error = new Error('这套 VIP 皮肤的一次性试用已经使用');
      error.code = 'VIP_SKIN_TRIAL_CONSUMED';
      throw error;
    }
    if (Object.keys(current.trials).length >= MAX_SKINS) throw new Error('VIP 皮肤试用记录已满');
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('VIP 皮肤试用时钟无效');
    const next = normalize({
      schemaVersion: SCHEMA_VERSION,
      trials: {...current.trials, [skinId]: {usedAt: now.toISOString(), clientId}},
    });
    const parent = path.dirname(this.filePath);
    privateDirectory(parent);
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(next)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
      return this.status(skinId);
    } finally {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
      if (fs.existsSync(temporary)) try { fs.unlinkSync(temporary); } catch {}
    }
  }
}
