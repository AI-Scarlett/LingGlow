import crypto from 'node:crypto';

export const DEFAULT_APPLY_INTENT_TTL_MS = 2 * 60 * 1000;
export const MAX_APPLY_INTENTS = 128;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const OPERATIONS = new Set(['apply', 'restore']);

export class ApplyIntentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApplyIntentError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ApplyIntentError(code, message);
}

function identifier(value, label) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!ID_PATTERN.test(normalized)) fail('INVALID_INTENT_INPUT', `${label} 不合法`);
  return normalized;
}

function safeMessage(value) {
  if (value == null) return null;
  const message = String(value).trim();
  if (!message) return null;
  if (message.length > 240 || /[\p{Cc}\p{Cf}]/u.test(message)) {
    fail('INVALID_INTENT_INPUT', '影响说明不合法');
  }
  return message;
}

function normalizeImpact(input) {
  if (input == null) {
    return {requiresRestart: false, targetRunning: false, message: null};
  }
  if (typeof input === 'string') {
    return {requiresRestart: false, targetRunning: false, message: safeMessage(input)};
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_INTENT_INPUT', 'impact 必须是对象或简短文字');
  }
  for (const key of ['requiresRestart', 'targetRunning']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      fail('INVALID_INTENT_INPUT', `impact.${key} 必须是布尔值`);
    }
  }
  return {
    requiresRestart: input.requiresRestart ?? false,
    targetRunning: input.targetRunning ?? false,
    message: safeMessage(input.message),
  };
}

function canonicalJson(value, seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_INTENT_INPUT', '应用指纹包含无效数字');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') fail('INVALID_INTENT_INPUT', '应用指纹包含不支持的值');
  if (seen.has(value)) fail('INVALID_INTENT_INPUT', '应用指纹不能循环引用');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('INVALID_INTENT_INPUT', '应用指纹必须是普通对象');
    }
    result = `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`
    )).join(',')}}`;
  }
  seen.delete(value);
  return result;
}

function fingerprintText(fingerprint) {
  if (typeof fingerprint === 'string') {
    const value = fingerprint.trim();
    if (!value || value.length > 16 * 1024) fail('INVALID_INTENT_INPUT', '应用指纹不合法');
    return value;
  }
  if (!fingerprint || typeof fingerprint !== 'object' || Array.isArray(fingerprint)) {
    fail('INVALID_INTENT_INPUT', '缺少应用指纹');
  }
  const value = canonicalJson(fingerprint);
  if (value.length > 16 * 1024) fail('INVALID_INTENT_INPUT', '应用指纹过大');
  return value;
}

function publicSummary(entry) {
  return {
    clientId: entry.clientId,
    skinId: entry.skinId,
    operation: entry.operation,
    impact: {...entry.impact},
    customProfile: entry.customProfile,
  };
}

/**
 * In-memory confirmation gate for skin apply/restore operations.
 *
 * The service intentionally stores neither the supplied profile nor a raw app
 * fingerprint. Callers should resolve the skin/profile again by skinId after a
 * successful confirmation. This keeps image data and other profile secrets out
 * of the confirmation state while still binding the intent to an app build.
 */
export class ApplyIntentService {
  #entries = new Map();
  #fingerprintKey;
  #maxEntries;
  #now;
  #randomBytes;
  #ttlMs;

  constructor({
    ttlMs = DEFAULT_APPLY_INTENT_TTL_MS,
    maxEntries = MAX_APPLY_INTENTS,
    now = () => Date.now(),
    randomBytes = crypto.randomBytes,
  } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs 必须是正整数');
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0 || maxEntries > MAX_APPLY_INTENTS) {
      throw new TypeError(`maxEntries 必须在 1 到 ${MAX_APPLY_INTENTS} 之间`);
    }
    if (typeof now !== 'function' || typeof randomBytes !== 'function') {
      throw new TypeError('now 和 randomBytes 必须是函数');
    }
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = now;
    this.#randomBytes = randomBytes;
    this.#fingerprintKey = crypto.randomBytes(32);
  }

  get size() {
    return this.#entries.size;
  }

  #fingerprintDigest(fingerprint) {
    return crypto.createHmac('sha256', this.#fingerprintKey)
      .update(fingerprintText(fingerprint), 'utf8')
      .digest();
  }

  #newId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bytes = this.#randomBytes(32);
      if (!Buffer.isBuffer(bytes) || bytes.length < 24) {
        throw new TypeError('randomBytes 必须返回至少 24 字节的 Buffer');
      }
      const id = bytes.toString('base64url');
      if (!this.#entries.has(id)) return id;
    }
    fail('INTENT_ID_COLLISION', '无法生成唯一确认编号');
  }

  create({
    clientId,
    skinId,
    profile,
    appFingerprint,
    operation = 'apply',
    impact,
  } = {}) {
    const normalizedClientId = identifier(clientId, 'clientId');
    const normalizedSkinId = identifier(skinId, 'skinId');
    if (!OPERATIONS.has(operation)) fail('INVALID_INTENT_INPUT', 'operation 只支持 apply 或 restore');
    if (profile !== undefined && (!profile || typeof profile !== 'object' || Array.isArray(profile))) {
      fail('INVALID_INTENT_INPUT', 'profile 必须是对象');
    }
    const fingerprintDigest = this.#fingerprintDigest(appFingerprint);
    const normalizedImpact = normalizeImpact(impact);
    const now = this.#now();
    if (!Number.isFinite(now)) throw new TypeError('now 必须返回有效毫秒时间戳');
    this.cleanup(now);
    if (this.#entries.size >= this.#maxEntries) {
      fail('INTENT_CAPACITY', `待确认操作已达到 ${this.#maxEntries} 条上限`);
    }

    const id = this.#newId();
    const expiresAtMs = now + this.#ttlMs;
    const entry = {
      id,
      clientId: normalizedClientId,
      skinId: normalizedSkinId,
      operation,
      impact: normalizedImpact,
      customProfile: profile !== undefined,
      fingerprintDigest,
      createdAtMs: now,
      expiresAtMs,
    };
    this.#entries.set(id, entry);
    return {
      id,
      expiresAt: new Date(expiresAtMs).toISOString(),
      summary: publicSummary(entry),
    };
  }

  confirm(id, {clientId, appFingerprint} = {}) {
    const entry = this.#entries.get(String(id ?? ''));
    if (!entry) fail('INTENT_NOT_FOUND', '确认操作不存在、已取消或已使用');

    const now = this.#now();
    if (!Number.isFinite(now)) throw new TypeError('now 必须返回有效毫秒时间戳');
    if (now >= entry.expiresAtMs) {
      this.#entries.delete(entry.id);
      fail('INTENT_EXPIRED', '确认操作已过期');
    }
    if (identifier(clientId, 'clientId') !== entry.clientId) {
      fail('INTENT_CLIENT_MISMATCH', '确认操作不属于当前客户端');
    }
    const candidateDigest = this.#fingerprintDigest(appFingerprint);
    if (!crypto.timingSafeEqual(candidateDigest, entry.fingerprintDigest)) {
      fail('INTENT_FINGERPRINT_MISMATCH', '客户端版本已变化，请重新确认');
    }

    // JavaScript runs this method synchronously. Delete before returning so a
    // second caller cannot observe or consume the same successful intent.
    this.#entries.delete(entry.id);
    return {
      id: entry.id,
      confirmedAt: new Date(now).toISOString(),
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      summary: publicSummary(entry),
    };
  }

  cancel(id) {
    return this.#entries.delete(String(id ?? ''));
  }

  cleanup(now = this.#now()) {
    if (!Number.isFinite(now)) throw new TypeError('now 必须返回有效毫秒时间戳');
    let removed = 0;
    for (const [id, entry] of this.#entries) {
      if (now >= entry.expiresAtMs) {
        this.#entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
