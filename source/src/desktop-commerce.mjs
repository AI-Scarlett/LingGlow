import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyLicenseToken} from './entitlements.mjs';
import {DODO_PRODUCT_DIRECTORY_ENVIRONMENT, PRODUCT_CATALOG} from './products.mjs';
import {BUNDLED_COMMERCE_CONFIG_PUBLIC_KEY_SPKI} from './release-commerce-trust.mjs';

export const DESKTOP_COMMERCE_CONFIG_SCHEMA_VERSION = 1;
export const DESKTOP_COMMERCE_CLIENT_VERSION = '2.3.18';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG_PATH = path.join(moduleRoot, 'release', 'commerce-public.json');
const CONFIG_MAX_BYTES = 64 * 1024;
const RESPONSE_MAX_BYTES = 48 * 1024;
const LICENSE_MAX_CHARS = 1024;
const LEASE_MAX_CHARS = 16 * 1024;
const VAULT_MAX_CODES = 16;
const VAULT_MAX_BYTES = 24 * 1024;
const KEYCHAIN_CHUNK_BYTES = 96;
const KEYCHAIN_CHUNK_MANIFEST_VERSION = 1;
const KEYCHAIN_CHUNK_GENERATION = /^[a-f0-9]{16}$/u;
const KEYCHAIN_CHUNK_HASH = /^[a-f0-9]{64}$/u;
const DEFAULT_TIMEOUT_MS = 8_000;
const CONFIG_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const PRODUCT_IDS = Object.freeze(PRODUCT_CATALOG.map(({id}) => id));
const PRODUCT_ID_SET = new Set(PRODUCT_IDS);
const CONFIG_PAYLOAD_KEYS = Object.freeze([
  'schemaVersion', 'configId', 'environment', 'issuedAt', 'expiresAt',
  'accountPortalUrl', 'entitlementServiceBaseUrl', 'productPortalUrls',
  'leaseSigningPublicKeySpki',
]);

export class DesktopCommerceError extends Error {
  constructor(code, message, {httpStatus = 400, cause} = {}) {
    super(message, cause === undefined ? undefined : {cause});
    this.name = 'DesktopCommerceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function commerceError(code, message, options) {
  return new DesktopCommerceError(code, message, options);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw commerceError('RELEASE_CONFIG_INVALID', `${label} 必须是 JSON 对象`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  plainObject(value, label);
  const expected = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) {
    throw commerceError('RELEASE_CONFIG_INVALID', `${label} 字段不完整或包含未知字段`);
  }
}

function utcTimestamp(value, label) {
  if (typeof value !== 'string' || !value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw commerceError('RELEASE_CONFIG_INVALID', `${label} 必须是 UTC 时间`);
  }
  return new Date(value).toISOString();
}

function parsePublicHttpsUrl(value, label, {basePortal = null, rootOnly = false} = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw commerceError('RELEASE_CONFIG_INVALID', `${label} 不是有效 URL`);
  }
  const hostname = url.hostname.toLowerCase();
  const unsafeHost = hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') || hostname === '::1' || /^127(?:\.|$)/u.test(hostname) ||
    /^0(?:\.|$)/u.test(hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' ||
      !hostname || unsafeHost || url.hash || (rootOnly && (url.pathname !== '/' || url.search))) {
    throw commerceError('RELEASE_CONFIG_INVALID', `${label} 必须是无凭据的公网 HTTPS URL`);
  }
  if (basePortal) {
    const base = new URL(basePortal);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw commerceError('RELEASE_CONFIG_INVALID', `${label} 必须位于签名账户门户下`);
    }
  }
  return url.toString();
}

function publicEd25519Key(input, label) {
  if (!input) throw commerceError('RELEASE_TRUST_KEY_MISSING', `${label}尚未写入发行包`);
  let key;
  try {
    if (input instanceof crypto.KeyObject) {
      key = input;
    } else if (typeof input === 'string' && BASE64URL.test(input)) {
      const bytes = Buffer.from(input, 'base64url');
      if (bytes.toString('base64url') !== input || bytes.length > 256) throw new Error('invalid');
      key = crypto.createPublicKey({key: bytes, format: 'der', type: 'spki'});
    } else {
      key = crypto.createPublicKey(input);
    }
  } catch {
    throw commerceError('RELEASE_TRUST_KEY_INVALID', `${label}无法解析`);
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw commerceError('RELEASE_TRUST_KEY_INVALID', `${label}必须是 Ed25519 公钥`);
  }
  return key;
}

function canonicalProductUrls(value, accountPortalUrl) {
  exactKeys(value, PRODUCT_IDS, 'productPortalUrls');
  return Object.fromEntries(PRODUCT_IDS.map((id) => [
    id,
    parsePublicHttpsUrl(value[id], `productPortalUrls.${id}`, {basePortal: accountPortalUrl}),
  ]));
}

/** Fixed-field canonicalization is intentionally simple and independently reproducible. */
export function canonicalizeReleaseCommerceConfigPayload(input) {
  exactKeys(input, CONFIG_PAYLOAD_KEYS, '发行配置载荷');
  if (input.schemaVersion !== DESKTOP_COMMERCE_CONFIG_SCHEMA_VERSION) {
    throw commerceError('RELEASE_CONFIG_INVALID', '不支持的发行配置版本');
  }
  if (typeof input.configId !== 'string' || !CONFIG_ID.test(input.configId)) {
    throw commerceError('RELEASE_CONFIG_INVALID', 'configId 不合法');
  }
  if (!['live', 'test'].includes(input.environment)) {
    throw commerceError('RELEASE_CONFIG_INVALID', 'environment 只能是 live 或 test');
  }
  const accountPortalUrl = parsePublicHttpsUrl(input.accountPortalUrl, 'accountPortalUrl');
  const productPortalUrls = canonicalProductUrls(input.productPortalUrls, accountPortalUrl);
  const serviceUrl = parsePublicHttpsUrl(
    input.entitlementServiceBaseUrl,
    'entitlementServiceBaseUrl',
    {rootOnly: true},
  );
  const issuedAt = utcTimestamp(input.issuedAt, 'issuedAt');
  const expiresAt = utcTimestamp(input.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt) ||
      Date.parse(expiresAt) - Date.parse(issuedAt) > 370 * 24 * 60 * 60 * 1000) {
    throw commerceError('RELEASE_CONFIG_INVALID', '发行配置有效期必须大于 0 且不超过 370 天');
  }
  const leaseKey = publicEd25519Key(input.leaseSigningPublicKeySpki, '租约验签公钥');
  const normalizedLeaseKey = leaseKey.export({format: 'der', type: 'spki'}).toString('base64url');
  if (normalizedLeaseKey !== input.leaseSigningPublicKeySpki) {
    throw commerceError('RELEASE_CONFIG_INVALID', '租约验签公钥编码不规范');
  }
  const payload = {
    schemaVersion: input.schemaVersion,
    configId: input.configId,
    environment: input.environment,
    issuedAt,
    expiresAt,
    accountPortalUrl,
    entitlementServiceBaseUrl: serviceUrl,
    productPortalUrls,
    leaseSigningPublicKeySpki: normalizedLeaseKey,
  };
  return JSON.stringify(payload);
}

export function validateReleaseCommerceConfig(input, {
  configVerificationPublicKey = BUNDLED_COMMERCE_CONFIG_PUBLIC_KEY_SPKI,
  now = new Date(),
} = {}) {
  exactKeys(input, [...CONFIG_PAYLOAD_KEYS, 'signature'], '发行配置');
  if (typeof input.signature !== 'string' || !BASE64URL.test(input.signature)) {
    throw commerceError('RELEASE_CONFIG_SIGNATURE_INVALID', '发行配置签名格式无效');
  }
  const signature = Buffer.from(input.signature, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== input.signature) {
    throw commerceError('RELEASE_CONFIG_SIGNATURE_INVALID', '发行配置签名长度无效');
  }
  const canonical = canonicalizeReleaseCommerceConfigPayload(
    Object.fromEntries(CONFIG_PAYLOAD_KEYS.map((key) => [key, input[key]])),
  );
  const configKey = publicEd25519Key(configVerificationPublicKey, '发行配置验签公钥');
  if (!crypto.verify(null, Buffer.from(canonical, 'utf8'), configKey, signature)) {
    throw commerceError('RELEASE_CONFIG_SIGNATURE_INVALID', '发行配置签名验证失败');
  }
  const current = new Date(now).getTime();
  if (!Number.isFinite(current)) throw new Error('now 无效');
  const payload = JSON.parse(canonical);
  if (Date.parse(payload.issuedAt) > current + 5 * 60 * 1000) {
    throw commerceError('RELEASE_CONFIG_NOT_YET_VALID', '发行配置尚未生效');
  }
  if (Date.parse(payload.expiresAt) <= current) {
    throw commerceError('RELEASE_CONFIG_EXPIRED', '发行配置已经过期');
  }
  return Object.freeze({
    ...payload,
    productPortalUrls: Object.freeze(payload.productPortalUrls),
    signature: input.signature,
    leaseSigningPublicKey: publicEd25519Key(payload.leaseSigningPublicKeySpki, '租约验签公钥'),
  });
}

function safeConfigFile(configPath) {
  if (!fs.existsSync(configPath)) {
    throw commerceError('RELEASE_CONFIG_MISSING', '正式发行配置尚未部署');
  }
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0 ||
      stat.size > CONFIG_MAX_BYTES) {
    throw commerceError('RELEASE_CONFIG_FILE_UNSAFE', '发行配置文件不安全');
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    throw commerceError('RELEASE_CONFIG_INVALID', '发行配置不是有效 JSON');
  }
  return value;
}

export function loadBundledReleaseCommerceConfig({
  configPath = DEFAULT_CONFIG_PATH,
  configVerificationPublicKey = BUNDLED_COMMERCE_CONFIG_PUBLIC_KEY_SPKI,
  now = new Date(),
} = {}) {
  try {
    return Object.freeze({
      verified: true,
      configuration: validateReleaseCommerceConfig(safeConfigFile(configPath), {
        configVerificationPublicKey,
        now,
      }),
      reasonCode: null,
    });
  } catch (error) {
    return Object.freeze({
      verified: false,
      configuration: null,
      reasonCode: error instanceof DesktopCommerceError ? error.code : 'RELEASE_CONFIG_INVALID',
    });
  }
}

function validateRemoteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw commerceError('COMMERCE_ENDPOINT_UNSAFE', '授权服务地址不安全', {httpStatus: 503});
  }
  return url;
}

function sanitizedRemoteError(status, body) {
  const candidate = body && typeof body === 'object' && !Array.isArray(body) ? body.error : null;
  const code = candidate && typeof candidate === 'object' && !Array.isArray(candidate) &&
    typeof candidate.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(candidate.code)
    ? candidate.code
    : 'REMOTE_REQUEST_FAILED';
  const messages = {
    INVALID_REQUEST: '授权码或兑换参数格式不正确',
    LICENSE_NOT_ACTIVE: '授权码当前不可用',
    SUBSCRIPTION_NOT_ACTIVE: 'VIP 订阅当前未生效',
    BINDING_IMMUTABLE: '该授权码已经完成永久绑定，不能换绑',
    SELECTION_REQUIRED: '这是单套皮肤授权码，请先选择要永久绑定的皮肤',
    SKIN_NOT_ALLOWED: '该授权码不是单套皮肤授权码，请清除皮肤选择后重试',
    DEVICE_NOT_ACTIVE: '这台设备尚未激活或已经停用',
    RATE_LIMITED: '操作过于频繁，请稍后重试',
    COMMERCE_NOT_CONFIGURED: '可信授权服务尚未完成部署',
    TRUSTED_ADAPTERS_UNCONFIGURED: '可信授权服务尚未完成部署',
  };
  return commerceError(code, messages[code] ?? (status >= 500
    ? '可信授权服务暂时不可用'
    : '授权请求未通过可信服务验证'), {httpStatus: status});
}

export class SecureJsonTransport {
  constructor({fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = RESPONSE_MAX_BYTES} = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('缺少 fetch transport');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 20_000) {
      throw new Error('timeoutMs 必须在 1000 到 20000 之间');
    }
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 128 * 1024) {
      throw new Error('maxResponseBytes 不合法');
    }
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
  }

  async postJson(urlValue, body) {
    const url = validateRemoteUrl(urlValue);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {'accept': 'application/json', 'content-type': 'application/json'},
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw commerceError('COMMERCE_NETWORK_ERROR', '无法连接可信授权服务', {httpStatus: 502, cause: error});
    }
    if (response.status >= 300 && response.status < 400) {
      throw commerceError('COMMERCE_REDIRECT_REJECTED', '可信授权服务返回了未允许的跳转', {httpStatus: 502});
    }
    const type = String(response.headers?.get?.('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      throw commerceError('COMMERCE_RESPONSE_TOO_LARGE', '可信授权服务响应过大', {httpStatus: 502});
    }
    if (type !== 'application/json') {
      throw commerceError('COMMERCE_RESPONSE_INVALID', '可信授权服务响应格式无效', {httpStatus: 502});
    }
    const chunks = [];
    let total = 0;
    if (response.body && Symbol.asyncIterator in response.body) {
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        total += bytes.length;
        if (total > this.maxResponseBytes) {
          try { await response.body.cancel?.(); } catch {}
          throw commerceError('COMMERCE_RESPONSE_TOO_LARGE', '可信授权服务响应过大', {httpStatus: 502});
        }
        chunks.push(bytes);
      }
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > this.maxResponseBytes) {
        throw commerceError('COMMERCE_RESPONSE_TOO_LARGE', '可信授权服务响应过大', {httpStatus: 502});
      }
      chunks.push(bytes);
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw commerceError('COMMERCE_RESPONSE_INVALID', '可信授权服务响应不是有效 JSON', {httpStatus: 502});
    }
    if (!response.ok) throw sanitizedRemoteError(response.status, payload);
    return payload;
  }
}

export function createSecurityCommandRunner({spawnImpl = spawn} = {}) {
  return (args, {
    stdin = null,
    promptedSecret = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxStdoutBytes = 32 * 1024,
  } = {}) =>
    new Promise((resolve, reject) => {
      if (stdin !== null && promptedSecret !== null) {
        reject(commerceError('KEYCHAIN_SECRET_INVALID', '钥匙串写入参数冲突'));
        return;
      }
      let executable = '/usr/bin/security';
      let executableArgs = args;
      let input = stdin;
      if (promptedSecret !== null) {
        if (typeof promptedSecret !== 'string' || !promptedSecret || /[\r\n]/u.test(promptedSecret) ||
            args.at(-1) !== '-w') {
          reject(commerceError('KEYCHAIN_SECRET_INVALID', '拒绝保存无效钥匙串内容'));
          return;
        }
        // macOS `security ... -w` reads and confirms a password only from a
        // terminal. A regular stdin pipe silently creates an empty item. Use
        // the system Expect binary to provide a private pseudo-terminal while
        // keeping the secret out of both the shell and process argv.
        const encodedArgs = args.map((value) => Buffer.from(value, 'utf8').toString('hex'));
        const encodedSecret = Buffer.from(promptedSecret, 'utf8').toString('hex');
        input = [
          'log_user 0',
          `set timeout ${Math.max(1, Math.ceil(timeoutMs / 1_000))}`,
          'set command {}',
          ...encodedArgs.map((value) => `lappend command [binary format H* {${value}}]`),
          `set secret [binary format H* {${encodedSecret}}]`,
          'spawn -noecho /usr/bin/security {*}$command',
          'expect -re {password data for new item:}',
          'send -- "$secret\\r"',
          'expect -re {retype password for new item:}',
          'send -- "$secret\\r"',
          'expect eof',
          'set result [wait]',
          'exit [lindex $result 3]',
          '',
        ].join('\n');
        executable = '/usr/bin/expect';
        executableArgs = ['-f', '-'];
      }
      const child = spawnImpl(executable, executableArgs, {stdio: ['pipe', 'pipe', 'ignore']});
      let stdout = Buffer.alloc(0);
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        finish(() => reject(commerceError('KEYCHAIN_TIMEOUT', '系统钥匙串操作超时', {httpStatus: 503})));
      }, timeoutMs);
      child.once('error', (cause) => finish(() => reject(
        commerceError('KEYCHAIN_UNAVAILABLE', '系统钥匙串不可用', {httpStatus: 503, cause}),
      )));
      child.stdout.on('data', (chunk) => {
        if (stdout.length + chunk.length > maxStdoutBytes) {
          try { child.kill('SIGKILL'); } catch {}
          finish(() => reject(commerceError('KEYCHAIN_RESPONSE_INVALID', '系统钥匙串响应过大', {httpStatus: 503})));
          return;
        }
        stdout = Buffer.concat([stdout, chunk]);
      });
      child.once('exit', (code) => finish(() => {
        if (code === 0) return resolve(stdout.toString('utf8'));
        const error = commerceError('KEYCHAIN_COMMAND_FAILED', '系统钥匙串操作失败', {httpStatus: 503});
        error.exitCode = code;
        reject(error);
      }));
      if (input === null) child.stdin.end();
      else child.stdin.end(input, 'utf8');
    });
}

export class MacOSKeychainSecretStore {
  constructor(options = {}) {
    const injectedRunner = typeof options.runner === 'function';
    this.runner = options.runner ?? createSecurityCommandRunner();
    const platform = options.platform ?? process.platform;
    const securityPathExists = options.securityPathExists ?? fs.existsSync('/usr/bin/security');
    const expectPathExists = options.expectPathExists ?? (injectedRunner || fs.existsSync('/usr/bin/expect'));
    this.available = platform === 'darwin' && securityPathExists && expectPathExists;
  }

  assertAvailable() {
    if (!this.available) {
      throw commerceError('KEYCHAIN_UNAVAILABLE', '只允许使用 macOS 系统钥匙串保存授权材料', {httpStatus: 503});
    }
  }

  async readItem(service, account) {
    this.assertAvailable();
    try {
      const output = await this.runner(['find-generic-password', '-a', account, '-s', service, '-w']);
      return output.replace(/[\r\n]+$/u, '');
    } catch (error) {
      if (error.exitCode === 44) return null;
      throw error;
    }
  }

  async writeItem(service, account, secret) {
    // -w is deliberately last so macOS prompts twice inside the private PTY.
    // Each value is deliberately kept below the prompt's bounded input size.
    await this.runner(['add-generic-password', '-a', account, '-s', service, '-U', '-w'], {
      promptedSecret: secret,
    });
    const persisted = await this.readItem(service, account);
    const expected = Buffer.from(secret, 'utf8');
    const actual = Buffer.from(persisted ?? '', 'utf8');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      throw commerceError('KEYCHAIN_WRITE_FAILED', 'macOS 钥匙串未能完整保存授权记录', {httpStatus: 503});
    }
  }

  async deleteItem(service, account) {
    this.assertAvailable();
    try {
      await this.runner(['delete-generic-password', '-a', account, '-s', service]);
      return true;
    } catch (error) {
      if (error.exitCode === 44) return false;
      throw error;
    }
  }

  chunkManifest(value) {
    let manifest;
    try { manifest = JSON.parse(value); } catch { return null; }
    if (!manifest || Object.getPrototypeOf(manifest) !== Object.prototype ||
        Object.keys(manifest).sort().join(',') !== 'b,g,h,n,v' ||
        manifest.v !== KEYCHAIN_CHUNK_MANIFEST_VERSION ||
        !KEYCHAIN_CHUNK_GENERATION.test(manifest.g) || !KEYCHAIN_CHUNK_HASH.test(manifest.h) ||
        !Number.isInteger(manifest.n) || manifest.n < 1 ||
        manifest.n > Math.ceil((VAULT_MAX_BYTES * 4 / 3) / KEYCHAIN_CHUNK_BYTES) + 1 ||
        !Number.isInteger(manifest.b) || manifest.b < 1 || manifest.b > VAULT_MAX_BYTES) {
      return null;
    }
    return manifest;
  }

  chunkAccount(account, generation, index) {
    return `${account}.lgc.${generation}.${String(index).padStart(3, '0')}`;
  }

  async get(service, account) {
    const raw = await this.readItem(service, account);
    if (raw === null) return null;
    const manifest = this.chunkManifest(raw);
    if (!manifest) return raw;
    const chunks = [];
    for (let index = 0; index < manifest.n; index += 1) {
      const chunk = await this.readItem(service, this.chunkAccount(account, manifest.g, index));
      if (chunk === null || chunk.length < 1 || chunk.length > KEYCHAIN_CHUNK_BYTES) {
        throw commerceError('KEYCHAIN_VAULT_INVALID', '钥匙串授权分片缺失或无效', {httpStatus: 503});
      }
      chunks.push(chunk);
    }
    const encoded = chunks.join('');
    let bytes;
    try { bytes = Buffer.from(encoded, 'base64'); } catch {
      throw commerceError('KEYCHAIN_VAULT_INVALID', '钥匙串授权分片编码无效', {httpStatus: 503});
    }
    if (bytes.length !== manifest.b || bytes.toString('base64') !== encoded ||
        crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.h) {
      throw commerceError('KEYCHAIN_VAULT_INVALID', '钥匙串授权分片校验失败', {httpStatus: 503});
    }
    const secret = bytes.toString('utf8');
    if (!Buffer.from(secret, 'utf8').equals(bytes)) {
      throw commerceError('KEYCHAIN_VAULT_INVALID', '钥匙串授权内容不是有效 UTF-8', {httpStatus: 503});
    }
    return secret;
  }

  async set(service, account, secret) {
    this.assertAvailable();
    if (typeof secret !== 'string' || !secret || Buffer.byteLength(secret) > VAULT_MAX_BYTES || /[\r\n]/u.test(secret)) {
      throw commerceError('KEYCHAIN_SECRET_INVALID', '拒绝保存无效钥匙串内容');
    }
    const previousRaw = await this.readItem(service, account);
    const previousManifest = previousRaw === null ? null : this.chunkManifest(previousRaw);
    const bytes = Buffer.from(secret, 'utf8');
    if (bytes.length <= KEYCHAIN_CHUNK_BYTES) {
      await this.writeItem(service, account, secret);
      if (previousManifest) {
        for (let index = 0; index < previousManifest.n; index += 1) {
          await this.deleteItem(service, this.chunkAccount(account, previousManifest.g, index));
        }
      }
      return;
    }
    const encoded = bytes.toString('base64');
    const chunks = encoded.match(new RegExp(`.{1,${KEYCHAIN_CHUNK_BYTES}}`, 'gu')) ?? [];
    const generation = crypto.randomBytes(8).toString('hex');
    for (let index = 0; index < chunks.length; index += 1) {
      await this.writeItem(service, this.chunkAccount(account, generation, index), chunks[index]);
    }
    const manifest = JSON.stringify({
      v: KEYCHAIN_CHUNK_MANIFEST_VERSION,
      g: generation,
      n: chunks.length,
      b: bytes.length,
      h: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
    if (Buffer.byteLength(manifest) > 128) {
      throw commerceError('KEYCHAIN_WRITE_FAILED', '钥匙串授权清单超过系统输入上限', {httpStatus: 503});
    }
    await this.writeItem(service, account, manifest);
    const persisted = await this.get(service, account);
    const actual = Buffer.from(persisted ?? '', 'utf8');
    if (bytes.length !== actual.length || !crypto.timingSafeEqual(bytes, actual)) {
      throw commerceError('KEYCHAIN_WRITE_FAILED', 'macOS 钥匙串未能完整保存授权记录', {httpStatus: 503});
    }
    if (previousManifest) {
      for (let index = 0; index < previousManifest.n; index += 1) {
        await this.deleteItem(service, this.chunkAccount(account, previousManifest.g, index));
      }
    }
  }

  async delete(service, account) {
    const raw = await this.readItem(service, account);
    const manifest = raw === null ? null : this.chunkManifest(raw);
    const deleted = await this.deleteItem(service, account);
    if (manifest) {
      for (let index = 0; index < manifest.n; index += 1) {
        await this.deleteItem(service, this.chunkAccount(account, manifest.g, index));
      }
    }
    return deleted;
  }
}

function validateLicenseKey(value) {
  if (typeof value !== 'string') throw commerceError('LICENSE_KEY_INVALID', '授权码格式无效');
  const key = value.trim();
  if (!key || key.length > LICENSE_MAX_CHARS || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(key)) {
    throw commerceError('LICENSE_KEY_INVALID', '授权码格式无效');
  }
  return key;
}

class KeychainLicenseVault {
  constructor(secretStore) {
    this.store = secretStore;
    this.licenseService = 'com.lingglow.entitlements.licenses.v1';
    this.deviceService = 'com.lingglow.entitlements.device-seed.v1';
    this.licenseAccount = 'active-v1';
  }

  async codes() {
    const raw = await this.store.get(this.licenseService, this.licenseAccount);
    if (raw === null) return [];
    if (Buffer.byteLength(raw) > VAULT_MAX_BYTES) {
      throw commerceError('KEYCHAIN_VAULT_INVALID', '钥匙串授权库无效', {httpStatus: 503});
    }
    let value;
    try { value = JSON.parse(raw); } catch {
      throw commerceError('KEYCHAIN_VAULT_INVALID', '钥匙串授权库无效', {httpStatus: 503});
    }
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || value.schemaVersion !== 1 ||
        !Array.isArray(value.codes) || value.codes.length > VAULT_MAX_CODES ||
        Object.keys(value).some((key) => !['schemaVersion', 'codes'].includes(key))) {
      throw commerceError('KEYCHAIN_VAULT_INVALID', '钥匙串授权库无效', {httpStatus: 503});
    }
    const codes = value.codes.map(validateLicenseKey);
    if (new Set(codes).size !== codes.length) {
      throw commerceError('KEYCHAIN_VAULT_INVALID', '钥匙串授权库包含重复项目', {httpStatus: 503});
    }
    return codes;
  }

  async add(code) {
    const normalized = validateLicenseKey(code);
    const codes = await this.codes();
    if (!codes.includes(normalized)) codes.push(normalized);
    if (codes.length > VAULT_MAX_CODES) throw commerceError('KEYCHAIN_VAULT_FULL', '本机授权码数量已达安全上限');
    await this.store.set(this.licenseService, this.licenseAccount, JSON.stringify({schemaVersion: 1, codes}));
    return codes.length;
  }

  async clear() {
    return this.store.delete(this.licenseService, this.licenseAccount);
  }

  async stableDeviceId(serviceOrigin) {
    const account = 'device-v1';
    let seed = await this.store.get(this.deviceService, account);
    if (seed === null) {
      seed = crypto.randomBytes(32).toString('base64url');
      await this.store.set(this.deviceService, account, seed);
    }
    if (!/^[A-Za-z0-9_-]{43}$/u.test(seed) || Buffer.from(seed, 'base64url').toString('base64url') !== seed) {
      throw commerceError('DEVICE_SEED_INVALID', '本机匿名设备种子无效', {httpStatus: 503});
    }
    const digest = crypto.createHmac('sha256', Buffer.from(seed, 'base64url'))
      .update(`lingglow-device-v1\0${serviceOrigin}`, 'utf8')
      .digest('base64url');
    return `lgd_${digest}`;
  }
}

export class AtomicPrivateLeaseStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    if (!fs.existsSync(this.filePath)) return null;
    const stat = fs.lstatSync(this.filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > LEASE_MAX_CHARS ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0) {
      throw commerceError('LEASE_FILE_UNSAFE', '本机租约文件权限或所有者不安全', {httpStatus: 503});
    }
    return fs.readFileSync(this.filePath, 'utf8').trim() || null;
  }

  write(value) {
    const lease = typeof value === 'string' ? value.trim() : '';
    if (!lease || Buffer.byteLength(lease) > LEASE_MAX_CHARS || /[\r\n]/u.test(lease)) {
      throw commerceError('SIGNED_LEASE_INVALID', '签名租约格式无效', {httpStatus: 502});
    }
    // 覆盖写是原子替换，不需要旧内容；旧文件被外部工具改成不安全状态时直接移除，
    // 否则安全检查会把写入、删除和本机清理一起卡死，程序内再没有自愈路径。
    if (fs.existsSync(this.filePath)) {
      try {
        this.read();
      } catch (error) {
        // 只有『文件本身不可信』才允许自愈删除；EACCES 等权限/竞态错误原样抛出，
        // 绝不能因为读不到就删掉用户的付费凭证。删除自身的竞态失败也不改变对外错误类型。
        if (error?.code !== 'LEASE_FILE_UNSAFE') throw error;
        try {
          fs.unlinkSync(this.filePath);
        } catch (removalError) {
          if (removalError?.code !== 'ENOENT') throw error;
        }
      }
    }
    fs.mkdirSync(path.dirname(this.filePath), {recursive: true, mode: 0o700});
    fs.chmodSync(path.dirname(this.filePath), 0o700);
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, `${lease}\n`, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
      try {
        const dirFd = fs.openSync(path.dirname(this.filePath), 'r');
        try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      } catch {}
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
      if (fs.existsSync(temporary)) try { fs.unlinkSync(temporary); } catch {}
    }
  }

  delete() {
    if (!fs.existsSync(this.filePath)) return false;
    fs.unlinkSync(this.filePath);
    return true;
  }
}

function exactRemoteObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) {
    throw commerceError('COMMERCE_RESPONSE_INVALID', `${label}结构无效`, {httpStatus: 502});
  }
  return value;
}

function verifyPreviouslySignedLease(token, publicKey) {
  try {
    const encoded = String(token).split('.', 1)[0];
    const candidate = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const start = Date.parse(candidate.notBefore ?? candidate.issuedAt);
    const end = Date.parse(candidate.expiresAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
    return verifyLicenseToken(token, {
      publicKey,
      now: new Date(start + Math.min(1_000, Math.max(1, end - start - 1))),
    });
  } catch {
    return null;
  }
}

export class DesktopCommerceBridge {
  constructor({
    dataDir,
    configPath = DEFAULT_CONFIG_PATH,
    releaseConfig = null,
    configVerificationPublicKey = BUNDLED_COMMERCE_CONFIG_PUBLIC_KEY_SPKI,
    allowTestMode = false,
    transport = new SecureJsonTransport(),
    secretStore = new MacOSKeychainSecretStore(),
    leaseStore = null,
    productDirectoryEnvironment = DODO_PRODUCT_DIRECTORY_ENVIRONMENT,
    clock = () => new Date(),
  } = {}) {
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('dataDir 必须是绝对路径');
    this.clock = clock;
    this.transport = transport;
    this.secretStore = secretStore;
    this.allowTestMode = allowTestMode === true;
    if (!['test_mode', 'live_mode'].includes(productDirectoryEnvironment)) {
      throw new Error('productDirectoryEnvironment 不合法');
    }
    this.productDirectoryEnvironment = productDirectoryEnvironment;
    this.leaseStore = leaseStore ?? new AtomicPrivateLeaseStore(path.join(dataDir, 'entitlement-lease.txt'));
    let loaded;
    if (releaseConfig) {
      try {
        loaded = {verified: true, configuration: validateReleaseCommerceConfig(releaseConfig, {
          configVerificationPublicKey,
          now: clock(),
        }), reasonCode: null};
      } catch (error) {
        loaded = {verified: false, configuration: null,
          reasonCode: error instanceof DesktopCommerceError ? error.code : 'RELEASE_CONFIG_INVALID'};
      }
    } else {
      loaded = loadBundledReleaseCommerceConfig({
        configPath,
        configVerificationPublicKey,
        now: clock(),
      });
    }
    this.configuration = loaded.configuration;
    this.configurationVerified = loaded.verified;
    this.configurationReason = loaded.reasonCode;
    this.vault = this.configuration ? new KeychainLicenseVault(secretStore) : null;
  }

  get leaseSigningPublicKey() {
    return this.configuration?.leaseSigningPublicKey ?? null;
  }

  enabled() {
    const expectedDirectory = this.configuration?.environment === 'live' ? 'live_mode' : 'test_mode';
    return Boolean(this.configurationVerified && this.configuration && this.secretStore.available === true &&
      this.productDirectoryEnvironment === expectedDirectory &&
      (this.configuration.environment === 'live' || this.allowTestMode));
  }

  publicConfiguration() {
    const testBlocked = this.configuration?.environment === 'test' && !this.allowTestMode;
    const expectedDirectory = this.configuration?.environment === 'live' ? 'live_mode' : 'test_mode';
    const directoryMismatch = Boolean(this.configuration && this.productDirectoryEnvironment !== expectedDirectory);
    const keychainAvailable = this.secretStore.available === true;
    const configured = this.enabled();
    const reasonCode = configured ? null : testBlocked ? 'TEST_MODE_NOT_FOR_SALE' :
      directoryMismatch ?
        (this.configuration.environment === 'live' ? 'DODO_LIVE_PRODUCT_IDS_REQUIRED' : 'DODO_TEST_PRODUCT_IDS_REQUIRED') :
      !this.configurationVerified ? this.configurationReason :
        !keychainAvailable ? 'KEYCHAIN_UNAVAILABLE' : 'TRUSTED_COMMERCE_UNCONFIGURED';
    return Object.freeze({
      status: configured ? (this.configuration.environment === 'test' ? 'test-configured' : 'configured') :
        testBlocked ? 'test' : 'unconfigured',
      configured,
      environment: this.configuration?.environment ?? null,
      productDirectoryEnvironment: this.productDirectoryEnvironment,
      checkoutEnabled: configured,
      redemptionEnabled: configured,
      refreshEnabled: configured,
      deactivationEnabled: configured,
      portalConfigured: configured,
      releaseConfigVerified: this.configurationVerified,
      leaseVerifierConfigured: Boolean(this.leaseSigningPublicKey),
      keychainAvailable,
      secretStorage: 'macos_keychain',
      reasonCode,
      configId: this.configuration?.configId ?? null,
      configExpiresAt: this.configuration?.expiresAt ?? null,
      accountPortalUrl: configured ? this.configuration.accountPortalUrl : null,
      productPortalUrls: Object.freeze(configured ? {...this.configuration.productPortalUrls} : {}),
    });
  }

  assertEnabled() {
    const readiness = this.publicConfiguration();
    if (!readiness.configured) {
      throw commerceError(readiness.reasonCode ?? 'TRUSTED_COMMERCE_UNCONFIGURED',
        readiness.reasonCode === 'TEST_MODE_NOT_FOR_SALE'
          ? '当前仅有测试商品配置，正式购买与兑换尚未开放'
          : '可信购买与授权服务尚未完成发行配置', {httpStatus: 503});
    }
    return readiness;
  }

  endpoint(relativePath) {
    this.assertEnabled();
    if (!/^v1\/[a-z/-]+$/u.test(relativePath)) throw new Error('commerce relative path 无效');
    return new URL(relativePath, this.configuration.entitlementServiceBaseUrl).toString();
  }

  requestPayload(licenseKey, deviceId, skinId = null) {
    const payload = {
      licenseKey: validateLicenseKey(licenseKey),
      deviceId,
      clientVersion: DESKTOP_COMMERCE_CLIENT_VERSION,
      platform: 'macos',
    };
    if (skinId !== null) {
      if (typeof skinId !== 'string' || !SKIN_ID.test(skinId)) {
        throw commerceError('SKIN_SELECTION_INVALID', '兑换皮肤选择无效');
      }
      payload.skinId = skinId;
    }
    return payload;
  }

  verifyLeaseForPersistence(signedLease) {
    if (typeof signedLease !== 'string' || !signedLease || signedLease.length > LEASE_MAX_CHARS) {
      throw commerceError('SIGNED_LEASE_INVALID', '可信服务没有返回有效签名租约', {httpStatus: 502});
    }
    let verified;
    try {
      verified = verifyLicenseToken(signedLease, {
        publicKey: this.leaseSigningPublicKey,
        now: this.clock(),
      });
    } catch (cause) {
      throw commerceError('SIGNED_LEASE_INVALID', '可信服务返回的租约未通过本机 Ed25519 验签', {
        httpStatus: 502,
        cause,
      });
    }
    if (verified.payload.schemaVersion !== 2) {
      throw commerceError('SIGNED_LEASE_INVALID', '可信服务返回了不支持的租约版本', {httpStatus: 502});
    }
    const current = this.leaseStore.read();
    if (current) {
      const existing = verifyPreviouslySignedLease(current, this.leaseSigningPublicKey);
      if (existing && existing.payload.subject !== verified.payload.subject) {
        throw commerceError('ENTITLEMENT_ACCOUNT_MISMATCH', '本机已有另一账户的权益；请先停用设备', {httpStatus: 409});
      }
    }
    return verified;
  }

  verifyAndPersistLease(signedLease) {
    const verified = this.verifyLeaseForPersistence(signedLease);
    this.leaseStore.write(signedLease);
    return verified;
  }

  async redeem({licenseKey, skinId = null} = {}) {
    this.assertEnabled();
    const key = validateLicenseKey(licenseKey);
    const deviceId = await this.vault.stableDeviceId(new URL(this.configuration.entitlementServiceBaseUrl).origin);
    const response = exactRemoteObject(await this.transport.postJson(
      this.endpoint('v1/redemptions'),
      this.requestPayload(key, deviceId, skinId),
    ), ['ok', 'signedLease', 'redemption'], '兑换响应');
    if (response.ok !== true) throw commerceError('COMMERCE_RESPONSE_INVALID', '兑换响应无效', {httpStatus: 502});
    // The lease is the sole authority. Redemption metadata is deliberately not
    // used to grant access.
    const verified = this.verifyLeaseForPersistence(response.signedLease);
    await this.vault.add(key);
    // Raw material is safely in Keychain before the verified lease is written.
    // If this atomic write fails, the next refresh can recover without granting
    // from an unverified response.
    this.leaseStore.write(response.signedLease);
    return Object.freeze({verified, redemption: response.redemption});
  }

  async refresh() {
    this.assertEnabled();
    const codes = await this.vault.codes();
    if (codes.length === 0) throw commerceError('LICENSE_KEY_NOT_STORED', '钥匙串中没有可刷新的授权码', {httpStatus: 409});
    const deviceId = await this.vault.stableDeviceId(new URL(this.configuration.entitlementServiceBaseUrl).origin);
    let lastError = null;
    for (const code of codes) {
      try {
        const response = exactRemoteObject(await this.transport.postJson(
          this.endpoint('v1/leases/refresh'),
          this.requestPayload(code, deviceId),
        ), ['ok', 'signedLease'], '租约刷新响应');
        if (response.ok !== true) throw commerceError('COMMERCE_RESPONSE_INVALID', '租约刷新响应无效', {httpStatus: 502});
        const verified = this.verifyAndPersistLease(response.signedLease);
        return Object.freeze({verified});
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? commerceError('LEASE_REFRESH_FAILED', '无法刷新权益租约', {httpStatus: 502});
  }

  async deactivate() {
    this.assertEnabled();
    const codes = await this.vault.codes();
    if (codes.length === 0) {
      this.leaseStore.delete();
      return Object.freeze({deactivated: 0});
    }
    const deviceId = await this.vault.stableDeviceId(new URL(this.configuration.entitlementServiceBaseUrl).origin);
    let deactivated = 0;
    for (const code of codes) {
      const response = exactRemoteObject(await this.transport.postJson(
        this.endpoint('v1/devices/deactivate'),
        this.requestPayload(code, deviceId),
      ), ['ok', 'deactivated'], '设备停用响应');
      if (response.ok !== true || typeof response.deactivated !== 'boolean') {
        throw commerceError('COMMERCE_RESPONSE_INVALID', '设备停用响应无效', {httpStatus: 502});
      }
      if (response.deactivated) deactivated += 1;
    }
    await this.vault.clear();
    this.leaseStore.delete();
    return Object.freeze({deactivated});
  }

  async purgeLocal() {
    if (this.vault && this.secretStore.available === true) await this.vault.clear();
    this.leaseStore.delete();
  }
}

export function createDesktopCommerceBridge(options) {
  return new DesktopCommerceBridge(options);
}

export const desktopCommerceInternals = Object.freeze({
  DEFAULT_CONFIG_PATH,
  PRODUCT_IDS,
  sanitizedRemoteError,
  validateLicenseKey,
});
