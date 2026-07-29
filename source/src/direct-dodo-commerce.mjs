import crypto from 'node:crypto';
import {MacOSKeychainSecretStore} from './desktop-commerce.mjs';
import {EncryptedAuthorizationVault} from './encrypted-authorization-vault.mjs';
import {PERMISSION_MATRIX} from './entitlements.mjs';
import {TARGET_CLIENT_IDS} from './client-registry.mjs';
import {
  DODO_PRODUCT_DIRECTORY_ENVIRONMENT,
  PRODUCT_CATALOG,
  productByDodoProductId,
} from './products.mjs';

const DODO_API_BASE = 'https://live.dodopayments.com/';
const DODO_CHECKOUT_BASE = 'https://checkout.dodopayments.com/buy/';
const PURCHASE_RETURN_URL = 'https://github.com/AI-Scarlett/LingGlow';
const KEYCHAIN_SERVICE = 'com.lingglow.dodo.direct-licenses.v1';
const KEYCHAIN_ACCOUNT = 'active-licenses-v1';
const DEVICE_KEYCHAIN_SERVICE = 'com.lingglow.authorization.device.v1';
const DEVICE_KEYCHAIN_ACCOUNT = 'stable-device-seed-v1';
const RECOVERY_KEYCHAIN_SERVICE = 'com.lingglow.authorization.recovery-index.v1';
const RECOVERY_KEYCHAIN_ACCOUNT = 'active-instance-index-v1';
const RECORD_SCHEMA_VERSION = 1;
const RECOVERY_SCHEMA_VERSION = 1;
const MAX_RECORDS = 16;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;
// 买断授权不套用订阅的 72 小时离线窗口，但也不能在服务器长期不可达（网络故障、
// 持续 5xx——这类错误不会写回 active=false）时永不撤销。30 天是兜底期限：远比订阅宽松，
// 足以覆盖长途旅行式的离线使用，同时保证已退款的买断记录最终会被要求重新联网续验。
const PERPETUAL_REVALIDATION_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const CODE_HASH = /^[a-f0-9]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

function directError(code, message, {httpStatus = 400, cause} = {}) {
  const error = new Error(message, cause === undefined ? undefined : {cause});
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function licenseKey(value) {
  if (typeof value !== 'string') throw directError('LICENSE_KEY_INVALID', '授权码格式无效');
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_024 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(normalized)) {
    throw directError('LICENSE_KEY_INVALID', '授权码格式无效');
  }
  return normalized;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\p{Cc}\s]/u.test(value)) {
    throw directError('DODO_LICENSE_RESPONSE_INVALID', `Dodo ${label} 无效`, {httpStatus: 502});
  }
  return value;
}

function codeHash(code) {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

function checkoutUrl(productId) {
  const url = new URL(encodeURIComponent(productId), DODO_CHECKOUT_BASE);
  url.searchParams.set('quantity', '1');
  url.searchParams.set('redirect_url', PURCHASE_RETURN_URL);
  return url.toString();
}

function profileIdFor(code) {
  return `dodo-${codeHash(code).slice(0, 24)}`;
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function normalizeBinding(value, product, code) {
  if (product.offerType === 'vip_subscription') return null;
  if (product.offerType === 'custom_slot_once') {
    const profileId = value?.profileId ?? profileIdFor(code);
    if (typeof profileId !== 'string' || !PROFILE_ID.test(profileId)) {
      throw directError('KEYCHAIN_VAULT_INVALID', '自定义位绑定无效');
    }
    return {profileId};
  }
  if (value === null || value === undefined) return null;
  if (typeof value?.skinId !== 'string' || !PROFILE_ID.test(value.skinId)) {
    throw directError('KEYCHAIN_VAULT_INVALID', '皮肤绑定无效');
  }
  return {skinId: value.skinId};
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw directError('KEYCHAIN_VAULT_INVALID', '钥匙串授权记录无效', {httpStatus: 503});
  }
  const code = licenseKey(value.code);
  const product = productByDodoProductId(value.productId);
  if (!product || value.codeHash !== codeHash(code) || !validDate(value.activatedAt) ||
      !validDate(value.lastVerifiedAt) || typeof value.active !== 'boolean') {
    throw directError('KEYCHAIN_VAULT_INVALID', '钥匙串授权记录无效', {httpStatus: 503});
  }
  return {
    code,
    codeHash: value.codeHash,
    activationInstanceId: identifier(value.activationInstanceId, '激活实例'),
    licenseKeyId: identifier(value.licenseKeyId, '授权记录'),
    productId: product.dodoProductId,
    binding: normalizeBinding(value.binding, product, code),
    activatedAt: new Date(value.activatedAt).toISOString(),
    lastVerifiedAt: new Date(value.lastVerifiedAt).toISOString(),
    active: value.active,
  };
}

function normalizeRecoveryBinding(value, product) {
  if (product.offerType === 'vip_subscription') {
    if (value !== null) throw directError('AUTHORIZATION_RECOVERY_INVALID', '本机授权恢复索引无效', {httpStatus: 503});
    return null;
  }
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw directError('AUTHORIZATION_RECOVERY_INVALID', '本机授权恢复索引无效', {httpStatus: 503});
  }
  const field = product.offerType === 'custom_slot_once' ? 'profileId' : 'skinId';
  if (Object.keys(value).length !== 1 || typeof value[field] !== 'string' || !PROFILE_ID.test(value[field])) {
    throw directError('AUTHORIZATION_RECOVERY_INVALID', '本机授权恢复索引无效', {httpStatus: 503});
  }
  return {[field]: value[field]};
}

function normalizeRecoveryEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'activatedAt,activationInstanceId,binding,codeHash,licenseKeyId,productId') {
    throw directError('AUTHORIZATION_RECOVERY_INVALID', '本机授权恢复索引无效', {httpStatus: 503});
  }
  const product = productByDodoProductId(value.productId);
  if (!product || !CODE_HASH.test(value.codeHash) || !validDate(value.activatedAt)) {
    throw directError('AUTHORIZATION_RECOVERY_INVALID', '本机授权恢复索引无效', {httpStatus: 503});
  }
  return {
    codeHash: value.codeHash,
    activationInstanceId: identifier(value.activationInstanceId, '恢复激活实例'),
    licenseKeyId: identifier(value.licenseKeyId, '恢复授权记录'),
    productId: product.dodoProductId,
    binding: normalizeRecoveryBinding(value.binding, product),
    activatedAt: new Date(value.activatedAt).toISOString(),
  };
}

function productIdFromActivation(response) {
  return response?.product?.product_id ?? response?.product_id ?? null;
}

function publicCheckoutUrls() {
  return Object.freeze(Object.fromEntries(PRODUCT_CATALOG.map((product) => [
    product.id,
    checkoutUrl(product.dodoProductId),
  ])));
}

export class DirectDodoCommerceBridge {
  constructor({
    secretStore = null,
    keychainStore = null,
    dataDir = null,
    fetchImpl = globalThis.fetch,
    clock = () => new Date(),
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('缺少 HTTPS fetch 实现');
    const resolvedKeychainStore = keychainStore ?? (secretStore === null ? new MacOSKeychainSecretStore() : null);
    this.deviceStore = resolvedKeychainStore;
    this.secretStore = secretStore ?? (typeof dataDir === 'string'
      ? new EncryptedAuthorizationVault({dataDir, keychainStore: resolvedKeychainStore, clock})
      : resolvedKeychainStore);
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.records = [];
    this.initialized = false;
    this.legacyEmptyVaultDetected = false;
    this.legacyTruncatedVaultDetected = false;
    this.leaseSigningPublicKey = null;
    this.productPortalUrls = publicCheckoutUrls();
  }

  publicConfiguration() {
    const keychainAvailable = this.secretStore.available === true;
    return Object.freeze({
      status: keychainAvailable ? 'direct-live' : 'unavailable',
      configured: keychainAvailable,
      environment: 'live',
      productDirectoryEnvironment: DODO_PRODUCT_DIRECTORY_ENVIRONMENT,
      checkoutEnabled: keychainAvailable,
      redemptionEnabled: keychainAvailable,
      refreshEnabled: keychainAvailable,
      deactivationEnabled: keychainAvailable,
      portalConfigured: true,
      releaseConfigVerified: false,
      leaseVerifierConfigured: false,
      keychainAvailable,
      secretStorage: this.secretStore instanceof EncryptedAuthorizationVault
        ? 'aes_256_gcm_file_plus_macos_keychain'
        : 'macos_keychain',
      reasonCode: keychainAvailable ? null : 'KEYCHAIN_UNAVAILABLE',
      accountPortalUrl: 'https://checkout.dodopayments.com/',
      productPortalUrls: this.productPortalUrls,
      directLicenseValidation: true,
    });
  }

  assertEnabled() {
    if (this.secretStore.available !== true) {
      throw directError('KEYCHAIN_UNAVAILABLE', 'macOS 系统钥匙串不可用', {httpStatus: 503});
    }
  }

  async request(pathname, payload) {
    const url = new URL(pathname, DODO_API_BASE);
    if (url.origin !== new URL(DODO_API_BASE).origin) throw new Error('Dodo API 路径无效');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    let buffer;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {'content-type': 'application/json', accept: 'application/json'},
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: controller.signal,
      });
      // 超时必须覆盖响应体读取：只等到响应头就撤掉定时器时，挂起的响应体会让
      // 启动阶段的 initialize()/refresh() 永远无法返回。
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (cause) {
      throw directError('DODO_LICENSE_SERVICE_UNAVAILABLE', '暂时无法连接 Dodo 授权服务', {
        httpStatus: 503,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }
    // 状态码先于响应体判定：空体或非 JSON 体的 4xx 同样是确定性的『授权无效』，
    // 归类成 RESPONSE_INVALID 会让续验的吊销判定和 deactivate 的容错一起失效。
    if (!response.ok) {
      const invalid = [400, 401, 403, 404, 409, 422].includes(response.status);
      throw directError(invalid ? 'LICENSE_NOT_ACTIVE' : 'DODO_LICENSE_SERVICE_UNAVAILABLE',
        invalid ? '授权码无效、已停用或已在其他设备激活' : 'Dodo 授权服务暂时不可用',
        {httpStatus: invalid ? 400 : 503});
    }
    if (buffer.length === 0 || buffer.length > MAX_RESPONSE_BYTES) {
      throw directError('DODO_LICENSE_RESPONSE_INVALID', 'Dodo 授权响应无效', {httpStatus: 502});
    }
    let body;
    try { body = JSON.parse(buffer.toString('utf8')); } catch {
      throw directError('DODO_LICENSE_RESPONSE_INVALID', 'Dodo 授权响应不是有效 JSON', {httpStatus: 502});
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw directError('DODO_LICENSE_RESPONSE_INVALID', 'Dodo 授权响应无效', {httpStatus: 502});
    }
    return body;
  }

  async loadRecords() {
    this.assertEnabled();
    const raw = await this.secretStore.get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (raw === null) return [];
    // LingGlow 2.3.10 briefly invoked `security ... -w` through a plain stdin
    // pipe. macOS ignores that pipe and creates a zero-byte Keychain item.
    // Treat only that exact impossible vault value as the known upgrade bug;
    // all other malformed values still fail closed and remain untouched.
    if (raw.length === 0) {
      this.legacyEmptyVaultDetected = true;
      return [];
    }
    if (raw.length === 128 && raw.startsWith('{"schemaVersion":1,"records":[')) {
      this.legacyTruncatedVaultDetected = true;
      return [];
    }
    let value;
    try { value = JSON.parse(raw); } catch {
      throw directError('KEYCHAIN_VAULT_INVALID', '钥匙串授权库不是有效 JSON', {httpStatus: 503});
    }
    if (!value || value.schemaVersion !== RECORD_SCHEMA_VERSION || !Array.isArray(value.records) ||
        value.records.length > MAX_RECORDS) {
      throw directError('KEYCHAIN_VAULT_INVALID', '钥匙串授权库无效', {httpStatus: 503});
    }
    const records = value.records.map(normalizeRecord);
    if (new Set(records.map((record) => record.codeHash)).size !== records.length) {
      throw directError('KEYCHAIN_VAULT_INVALID', '钥匙串授权库包含重复记录', {httpStatus: 503});
    }
    return records;
  }

  async anonymousDeviceName() {
    if (!this.deviceStore) return 'LingGlow macOS';
    let encoded = await this.deviceStore.get(DEVICE_KEYCHAIN_SERVICE, DEVICE_KEYCHAIN_ACCOUNT);
    if (encoded === null) {
      encoded = crypto.randomBytes(32).toString('base64url');
      await this.deviceStore.set(DEVICE_KEYCHAIN_SERVICE, DEVICE_KEYCHAIN_ACCOUNT, encoded);
    }
    if (typeof encoded !== 'string' || !BASE64URL.test(encoded)) {
      throw directError('DEVICE_IDENTITY_INVALID', '本机匿名设备标识无效', {httpStatus: 503});
    }
    const seed = Buffer.from(encoded, 'base64url');
    if (seed.length !== 32 || seed.toString('base64url') !== encoded) {
      throw directError('DEVICE_IDENTITY_INVALID', '本机匿名设备标识无效', {httpStatus: 503});
    }
    const fingerprint = crypto.createHmac('sha256', seed)
      .update('lingglow-dodo-device-v1', 'utf8').digest('base64url');
    return `LingGlow macOS [lgd_${fingerprint.slice(0, 16)}]`;
  }

  async loadRecoveryIndex() {
    if (!this.deviceStore) return [];
    const raw = await this.deviceStore.get(RECOVERY_KEYCHAIN_SERVICE, RECOVERY_KEYCHAIN_ACCOUNT);
    if (raw === null) return [];
    let value;
    try { value = JSON.parse(raw); } catch {
      throw directError('AUTHORIZATION_RECOVERY_INVALID', '本机授权恢复索引不是有效 JSON', {httpStatus: 503});
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'records,schemaVersion' ||
        value.schemaVersion !== RECOVERY_SCHEMA_VERSION || !Array.isArray(value.records) ||
        value.records.length > MAX_RECORDS) {
      throw directError('AUTHORIZATION_RECOVERY_INVALID', '本机授权恢复索引无效', {httpStatus: 503});
    }
    const records = value.records.map(normalizeRecoveryEntry);
    if (new Set(records.map((record) => record.codeHash)).size !== records.length) {
      throw directError('AUTHORIZATION_RECOVERY_INVALID', '本机授权恢复索引包含重复记录', {httpStatus: 503});
    }
    return records;
  }

  async saveRecoveryIndex(records) {
    if (!this.deviceStore) return;
    if (records.length === 0) {
      await this.deviceStore.delete(RECOVERY_KEYCHAIN_SERVICE, RECOVERY_KEYCHAIN_ACCOUNT);
      return;
    }
    const entries = records.map((record) => normalizeRecoveryEntry({
      codeHash: record.codeHash,
      activationInstanceId: record.activationInstanceId,
      licenseKeyId: record.licenseKeyId,
      productId: record.productId,
      binding: record.binding,
      activatedAt: record.activatedAt,
    }));
    await this.deviceStore.set(RECOVERY_KEYCHAIN_SERVICE, RECOVERY_KEYCHAIN_ACCOUNT, JSON.stringify({
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      records: entries,
    }));
  }

  async recoverRecord(code, hash) {
    const entry = (await this.loadRecoveryIndex()).find((candidate) => candidate.codeHash === hash) ?? null;
    if (!entry) return null;
    const response = await this.request('licenses/validate', {
      license_key: code,
      license_key_instance_id: entry.activationInstanceId,
    });
    if (response.valid !== true) return null;
    const now = this.clock().toISOString();
    return normalizeRecord({
      code,
      ...entry,
      lastVerifiedAt: now,
      active: true,
    });
  }

  async saveRecords(records) {
    if (records.length === 0) {
      await this.secretStore.delete(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      this.records = [];
      return;
    }
    if (records.length > MAX_RECORDS) throw directError('KEYCHAIN_VAULT_FULL', '本机授权码数量已达上限');
    const normalized = records.map(normalizeRecord);
    await this.secretStore.set(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, JSON.stringify({
      schemaVersion: RECORD_SCHEMA_VERSION,
      records: normalized,
    }));
    await this.saveRecoveryIndex(normalized);
    this.records = normalized;
  }

  async initialize() {
    if (this.initialized) return;
    this.records = await this.loadRecords();
    this.initialized = true;
    if (this.records.length > 0) {
      try { await this.refresh(); } catch {}
    }
  }

  async validateRecord(record) {
    const response = await this.request('licenses/validate', {
      license_key: record.code,
      license_key_instance_id: record.activationInstanceId,
    });
    return {
      ...record,
      active: response.valid === true,
      lastVerifiedAt: this.clock().toISOString(),
    };
  }

  async redeem({licenseKey: input, skinId = null} = {}) {
    this.assertEnabled();
    const code = licenseKey(input);
    let upgradingMatchingLegacyRecord = false;
    if (!this.initialized) {
      try {
        await this.initialize();
      } catch (error) {
        if (error?.code !== 'KEYCHAIN_VAULT_INVALID') throw error;
        // Some pre-direct-Dodo builds stored one raw license string under the
        // account now used by the structured vault. Only recover when the user
        // explicitly submits that exact same value. Keep the old Keychain item
        // untouched until Dodo activation succeeds and saveRecords atomically
        // replaces it with the verified structured record.
        const legacyRaw = await this.secretStore.get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
        if (legacyRaw?.trim() !== code) throw error;
        this.records = [];
        this.initialized = true;
        upgradingMatchingLegacyRecord = true;
      }
    }
    const hash = codeHash(code);
    let record = this.records.find((candidate) => candidate.codeHash === hash) ?? null;
    if (record) {
      record = await this.validateRecord(record);
      if (!record.active) {
        await this.saveRecords([...this.records.filter((item) => item.codeHash !== hash), record]);
        throw directError('LICENSE_NOT_ACTIVE', '授权码无效、已停用或已在其他设备激活');
      }
    } else {
      record = await this.recoverRecord(code, hash);
    }
    if (!record) {
      let response;
      try {
        response = await this.request('licenses/activate', {
          license_key: code,
          name: await this.anonymousDeviceName(),
        });
      } catch (error) {
        if (upgradingMatchingLegacyRecord) this.initialized = false;
        throw error;
      }
      const product = productByDodoProductId(productIdFromActivation(response));
      if (!product) {
        throw directError('LICENSE_PRODUCT_NOT_SUPPORTED', '该授权码不属于灵妆正式商品目录');
      }
      const now = this.clock().toISOString();
      record = normalizeRecord({
        code,
        codeHash: hash,
        activationInstanceId: response.id,
        licenseKeyId: response.license_key_id,
        productId: product.dodoProductId,
        binding: product.offerType === 'custom_slot_once' ? {profileId: profileIdFor(code)} : null,
        activatedAt: now,
        lastVerifiedAt: now,
        active: true,
      });
    }

    const product = productByDodoProductId(record.productId);
    if (product.offerType === 'skin_once') {
      if (record.binding?.skinId && skinId && record.binding.skinId !== skinId) {
        throw directError('SKIN_NOT_ALLOWED', '此授权码已绑定其他皮肤，不能换绑');
      }
      if (!record.binding?.skinId) {
        if (skinId === null) {
          await this.saveRecords([...this.records.filter((item) => item.codeHash !== hash), record]);
          throw directError('SELECTION_REQUIRED', '请选择要永久绑定的皮肤', {httpStatus: 409});
        }
        if (!PROFILE_ID.test(skinId)) throw directError('SKIN_SELECTION_INVALID', '皮肤选择无效');
        record = {...record, binding: {skinId}};
      }
    }
    await this.saveRecords([...this.records.filter((item) => item.codeHash !== hash), record]);
    return Object.freeze({ok: true, productId: product.id});
  }

  async refresh() {
    this.assertEnabled();
    if (!this.initialized) {
      this.records = await this.loadRecords();
      this.initialized = true;
    }
    if (this.records.length === 0) {
      throw directError('LICENSE_KEY_NOT_STORED', '钥匙串中没有可刷新的授权码', {httpStatus: 409});
    }
    const pending = this.records;
    const settled = await Promise.allSettled(pending.map((record) => this.validateRecord(record)));
    // 一条坏授权码不能拖垮其余记录的续验：确定性的 4xx 只把该条标记失效，
    // 网络类错误保留原值等待下次续验。
    const records = settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      return result.reason?.code === 'LICENSE_NOT_ACTIVE'
        ? {...pending[index], active: false}
        : pending[index];
    });
    // 落盘必须早于抛错：全部记录都失败时也要保住刚拿到的确定性吊销结论，
    // 否则单条已退款的买断授权（不受离线宽限约束）在本机永远撤销不掉。
    await this.saveRecords(records);
    if (settled.every((result) => result.status === 'rejected')) throw settled[0].reason;
    if (!records.some((record) => record.active)) {
      throw directError('LICENSE_NOT_ACTIVE', '授权码均已失效、退款、取消或被停用');
    }
    return Object.freeze({ok: true});
  }

  async deactivate() {
    this.assertEnabled();
    if (!this.initialized) await this.initialize();
    const settled = await Promise.allSettled(this.records.map((record) => this.request('licenses/deactivate', {
      license_key: record.code,
      license_key_instance_id: record.activationInstanceId,
    })));
    // 远端已停用或已退款的实例返回 4xx，对『停用本机』而言就是已经达成目标；
    // 只有网络或服务端故障才中止清理并保留本机记录。
    const blocking = settled.find((result) => result.status === 'rejected' &&
      result.reason?.code !== 'LICENSE_NOT_ACTIVE');
    if (blocking) throw blocking.reason;
    const deactivated = this.records.length;
    await this.saveRecords([]);
    await this.saveRecoveryIndex([]);
    return Object.freeze({deactivated});
  }

  async purgeLocal() {
    this.assertEnabled();
    await this.saveRecords([]);
  }

  currentEntitlement() {
    const now = this.clock();
    const current = now.getTime();
    const active = this.records.filter((record) => {
      if (!record.active) return false;
      const offerType = productByDodoProductId(record.productId)?.offerType;
      if (offerType === 'skin_once' && !record.binding?.skinId) return false;
      const elapsed = current - Date.parse(record.lastVerifiedAt);
      // 时钟被拨到未来续验一次再拨回来时 elapsed 为负，不能让它恒定通过离线宽限；
      // 这类记录必须重新联网续验。单次买断是永久授权，不套用订阅的 72 小时窗口，
      // 但仍有一个远为宽松的最长未成功续验期限兜底：否则授权服务长期不可达
      // （网络错误或 5xx 都不会写回 active=false）时，已退款的买断记录永不撤销。
      if (elapsed < -CLOCK_SKEW_TOLERANCE_MS) return false;
      const deadline = offerType === 'vip_subscription'
        ? OFFLINE_GRACE_MS
        : PERPETUAL_REVALIDATION_DEADLINE_MS;
      return elapsed <= deadline;
    });
    if (active.length === 0) {
      return Object.freeze({
        tier: 'free', source: 'none', status: 'missing', reason: '尚无有效 Dodo 授权码',
        permissions: PERMISSION_MATRIX.free, activeGrants: [], skinIds: [], customProfileIds: [], license: null,
      });
    }
    const grants = active.map((record) => {
      const product = productByDodoProductId(record.productId);
      const validUntil = product.offerType === 'vip_subscription'
        ? new Date(Date.parse(record.lastVerifiedAt) + OFFLINE_GRACE_MS).toISOString() : null;
      return Object.freeze({
        grantId: `dodo-${record.codeHash.slice(0, 32)}`,
        offerType: product.offerType,
        status: 'active',
        productId: record.productId,
        binding: record.binding,
        boundAt: record.activatedAt,
        validUntil,
        revokedAt: null,
      });
    });
    const vip = grants.some((grant) => grant.offerType === 'vip_subscription');
    const skinIds = grants.filter((grant) => grant.offerType === 'skin_once').map((grant) => grant.binding.skinId);
    const customProfileIds = grants.filter((grant) => grant.offerType === 'custom_slot_once')
      .map((grant) => grant.binding.profileId);
    const base = vip ? PERMISSION_MATRIX.vip : PERMISSION_MATRIX.free;
    const permissions = vip || customProfileIds.length === 0 ? base : Object.freeze({...base, custom: true});
    const issuedAt = now.toISOString();
    const expiresAt = vip
      ? new Date(Math.max(...grants.filter((grant) => grant.validUntil).map((grant) => Date.parse(grant.validUntil)))).toISOString()
      : null;
    const license = Object.freeze({
      schemaVersion: 2,
      licenseId: `dodo-${crypto.createHash('sha256').update(active.map((record) => record.codeHash).sort().join(':')).digest('hex').slice(0, 40)}`,
      audience: 'codex-skin-studio',
      subject: 'Dodo Payments License',
      issuedAt,
      notBefore: null,
      expiresAt,
      clientIds: [...TARGET_CLIENT_IDS],
      grants,
    });
    return Object.freeze({
      tier: vip ? 'vip' : 'free', source: 'license', status: 'valid', reason: null,
      permissions, activeGrants: grants, skinIds, customProfileIds, license,
    });
  }
}

export function createDirectDodoCommerceBridge(options) {
  return new DirectDodoCommerceBridge(options);
}
