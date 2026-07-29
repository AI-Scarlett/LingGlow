import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {CATALOG_TIERS} from './catalog.mjs';
import {TARGET_CLIENT_IDS} from './client-registry.mjs';

export const LICENSE_AUDIENCE = 'codex-skin-studio';
export const OFFER_TYPES = Object.freeze([
  'vip_subscription',
  'skin_once',
  'custom_slot_once',
]);
export const GRANT_STATUSES = Object.freeze(['active', 'revoked']);
export const PERMISSION_MATRIX = Object.freeze({
  free: Object.freeze({
    freeCatalog: true,
    vipCatalog: false,
    custom: false,
    weeklySchedule: false,
    loginReminder: false,
    allFeatures: false,
  }),
  vip: Object.freeze({
    freeCatalog: true,
    vipCatalog: true,
    custom: true,
    weeklySchedule: true,
    loginReminder: true,
    allFeatures: true,
  }),
});

// A lease covers the complete target registry, including an Agent that is
// temporarily runtime-blocked.  Runtime compatibility still decides whether
// it can be applied; the entitlement format must not make a future verified
// Agent impossible to activate.
const CLIENT_ID_SET = new Set(TARGET_CLIENT_IDS);
const TIER_SET = new Set(CATALOG_TIERS);
const OFFER_TYPE_SET = new Set(OFFER_TYPES);
const GRANT_STATUS_SET = new Set(GRANT_STATUSES);
const LICENSE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const AUDIENCE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const TOKEN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u;
const MAX_TOKEN_CHARS = 16 * 1024;
const MAX_PAYLOAD_BYTES = 8 * 1024;
const MAX_GRANTS = 128;

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

function timestamp(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} 必须是 UTC ISO 时间`);
  }
  return value;
}

function identifier(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label} 不合法`);
  return value;
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

function validateSharedPayload(value, {expiresRequired = false} = {}) {
  identifier(value.licenseId, LICENSE_ID, 'licenseId');
  if (typeof value.audience !== 'string' || !AUDIENCE.test(value.audience)) throw new Error('许可证 audience 不合法');
  if (typeof value.subject !== 'string' || !value.subject.trim() || value.subject.length > 200 || /\p{Cc}/u.test(value.subject)) {
    throw new Error('许可证 subject 不合法');
  }
  timestamp(value.issuedAt, 'issuedAt');
  timestamp(value.notBefore, 'notBefore', {nullable: true});
  timestamp(value.expiresAt, 'expiresAt', {nullable: true});
  if (expiresRequired && value.expiresAt === null) throw new Error('schemaVersion 2 租约必须包含 expiresAt');
  if (value.notBefore && Date.parse(value.notBefore) < Date.parse(value.issuedAt)) {
    throw new Error('notBefore 不能早于 issuedAt');
  }
  if (value.expiresAt && Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    throw new Error('expiresAt 必须晚于 issuedAt');
  }
  if (!Array.isArray(value.clientIds) || value.clientIds.length === 0 ||
      new Set(value.clientIds).size !== value.clientIds.length ||
      !value.clientIds.every((id) => CLIENT_ID_SET.has(id))) {
    throw new Error('许可证 clientIds 必须是已注册 Agent 的非重复列表');
  }
}

function validateBinding(binding, offerType, label) {
  if (offerType === 'vip_subscription') {
    if (binding !== null) throw new Error(`${label}.binding 必须为 null`);
    return;
  }
  const key = offerType === 'skin_once' ? 'skinId' : 'profileId';
  exactKeys(binding, [key], `${label}.binding`);
  identifier(binding[key], PROFILE_ID, `${label}.binding.${key}`);
}

function validateGrant(input, index, issuedAt) {
  const label = `许可证 grants[${index}]`;
  const grant = plainObject(input, label);
  exactKeys(grant, [
    'grantId', 'offerType', 'status', 'productId', 'binding',
    'boundAt', 'validUntil', 'revokedAt',
  ], label);
  identifier(grant.grantId, LICENSE_ID, `${label}.grantId`);
  identifier(grant.productId, PRODUCT_ID, `${label}.productId`);
  if (!OFFER_TYPE_SET.has(grant.offerType)) throw new Error(`${label}.offerType 不合法`);
  if (!GRANT_STATUS_SET.has(grant.status)) throw new Error(`${label}.status 不合法`);
  timestamp(grant.boundAt, `${label}.boundAt`);
  timestamp(grant.validUntil, `${label}.validUntil`, {nullable: true});
  timestamp(grant.revokedAt, `${label}.revokedAt`, {nullable: true});
  validateBinding(grant.binding, grant.offerType, label);

  if (Date.parse(grant.boundAt) > Date.parse(issuedAt)) throw new Error(`${label}.boundAt 不能晚于 issuedAt`);
  if (grant.offerType === 'vip_subscription') {
    if (grant.validUntil === null) throw new Error(`${label}.validUntil 不能为空`);
    if (Date.parse(grant.validUntil) <= Date.parse(grant.boundAt)) {
      throw new Error(`${label}.validUntil 必须晚于 boundAt`);
    }
  } else if (grant.validUntil !== null) {
    throw new Error(`${label}.validUntil 必须为 null`);
  }
  if (grant.status === 'active' && grant.revokedAt !== null) throw new Error(`${label}.revokedAt 必须为 null`);
  if (grant.status === 'revoked') {
    if (grant.revokedAt === null) throw new Error(`${label}.revokedAt 不能为空`);
    if (Date.parse(grant.revokedAt) < Date.parse(grant.boundAt) || Date.parse(grant.revokedAt) > Date.parse(issuedAt)) {
      throw new Error(`${label}.revokedAt 必须位于 boundAt 与 issuedAt 之间`);
    }
  }
  return grant;
}

function validateV1Payload(value) {
  exactKeys(value, [
    'schemaVersion', 'licenseId', 'tier', 'audience', 'subject',
    'issuedAt', 'notBefore', 'expiresAt', 'clientIds',
  ], '许可证载荷');
  if (!TIER_SET.has(value.tier)) throw new Error('许可证等级不合法');
  validateSharedPayload(value);
  return value;
}

function validateV2Payload(value) {
  exactKeys(value, [
    'schemaVersion', 'licenseId', 'audience', 'subject',
    'issuedAt', 'notBefore', 'expiresAt', 'clientIds', 'grants',
  ], '许可证租约载荷');
  validateSharedPayload(value, {expiresRequired: true});
  if (!Array.isArray(value.grants) || value.grants.length > MAX_GRANTS) {
    throw new Error(`许可证 grants 必须是最多 ${MAX_GRANTS} 项的列表`);
  }
  value.grants.forEach((grant, index) => validateGrant(grant, index, value.issuedAt));
  if (new Set(value.grants.map((grant) => grant.grantId)).size !== value.grants.length) {
    throw new Error('许可证 grantId 不能重复');
  }
  return value;
}

export function validateLicensePayload(input) {
  const value = clone(plainObject(input, '许可证载荷'));
  if (value.schemaVersion === 1) return deepFreeze(validateV1Payload(value));
  if (value.schemaVersion === 2) return deepFreeze(validateV2Payload(value));
  throw new Error('不支持的许可证 schemaVersion');
}

const IMMUTABLE_GRANT_FIELDS = Object.freeze([
  'grantId', 'offerType', 'productId', 'binding', 'boundAt',
]);

// Shared transition guard for the entitlement service implementation. Device
// activation is deliberately outside the grant lifecycle and may never mutate
// a purchase binding.
export function assertGrantTransition(previousInput, nextInput, {event = 'grant_refresh'} = {}) {
  const previous = plainObject(previousInput, 'previous grant');
  const next = plainObject(nextInput, 'next grant');
  if (typeof event !== 'string' || !event) throw new Error('grant event 不合法');
  for (const field of IMMUTABLE_GRANT_FIELDS) {
    if (!isDeepStrictEqual(previous[field], next[field])) {
      const error = new Error(`grant ${field} 不可换绑`);
      error.code = 'BINDING_IMMUTABLE';
      throw error;
    }
  }
  if (event === 'device_deactivate' && !isDeepStrictEqual(previous, next)) {
    const error = new Error('设备停用不得修改或撤销购买 grant');
    error.code = 'DEVICE_DEACTIVATION_ISOLATED';
    throw error;
  }
  return true;
}

export function encodeLicensePayload(payload) {
  return Buffer.from(JSON.stringify(validateLicensePayload(payload)), 'utf8').toString('base64url');
}

function decodeBase64Url(segment, label, maxBytes) {
  const buffer = Buffer.from(segment, 'base64url');
  if (buffer.length === 0 || buffer.length > maxBytes || buffer.toString('base64url') !== segment) {
    throw new Error(`${label} 的 Base64URL 编码无效`);
  }
  return buffer;
}

function plainObjectCandidate(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function containsPrivateKeyMaterial(value) {
  if (value instanceof crypto.KeyObject) return value.type !== 'public';
  if (typeof value === 'string' || Buffer.isBuffer(value)) return /PRIVATE KEY/u.test(String(value));
  if (!plainObjectCandidate(value)) return false;
  if (Object.hasOwn(value, 'd') || ['pkcs8', 'sec1'].includes(value.type)) return true;
  return Object.hasOwn(value, 'key') && containsPrivateKeyMaterial(value.key);
}

function injectedEd25519PublicKey(publicKey) {
  if (!publicKey) throw new Error('必须注入 Ed25519 公钥');
  if (containsPrivateKeyMaterial(publicKey)) throw new Error('只接受公钥，不接受私钥');
  let key;
  try {
    key = publicKey instanceof crypto.KeyObject ? publicKey : crypto.createPublicKey(publicKey);
  } catch {
    throw new Error('无法解析注入的许可证公钥');
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error('许可证公钥必须是 Ed25519 公钥');
  }
  return key;
}

function dateValue(value, label) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} 不是有效时间`);
  return date;
}

function grantIsActive(grant, current) {
  if (grant.status !== 'active') return false;
  return grant.offerType !== 'vip_subscription' || Date.parse(grant.validUntil) > current;
}

function permissionSnapshot(payload, current) {
  if (payload.schemaVersion === 1) {
    return {
      tier: payload.tier,
      permissions: PERMISSION_MATRIX[payload.tier],
      activeGrants: [],
      skinIds: [],
      customProfileIds: [],
    };
  }
  const activeGrants = payload.grants.filter((grant) => grantIsActive(grant, current));
  const vip = activeGrants.some((grant) => grant.offerType === 'vip_subscription');
  const skinIds = [...new Set(activeGrants
    .filter((grant) => grant.offerType === 'skin_once')
    .map((grant) => grant.binding.skinId))];
  const customProfileIds = [...new Set(activeGrants
    .filter((grant) => grant.offerType === 'custom_slot_once')
    .map((grant) => grant.binding.profileId))];
  const base = vip ? PERMISSION_MATRIX.vip : PERMISSION_MATRIX.free;
  const permissions = vip || customProfileIds.length === 0
    ? base
    : deepFreeze({...base, custom: true});
  return {
    tier: vip ? 'vip' : 'free',
    permissions,
    activeGrants: deepFreeze(activeGrants),
    skinIds: deepFreeze(skinIds),
    customProfileIds: deepFreeze(customProfileIds),
  };
}

export function verifyLicenseToken(token, {
  publicKey,
  now = new Date(),
  expectedAudience = LICENSE_AUDIENCE,
  expectedClientId,
  clockToleranceSeconds = 30,
} = {}) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) throw new Error('许可证令牌格式无效');
  const match = token.match(TOKEN);
  if (!match) throw new Error('许可证令牌格式无效');
  if (typeof expectedAudience !== 'string' || !AUDIENCE.test(expectedAudience)) throw new Error('expectedAudience 不合法');
  if (expectedClientId !== undefined && !CLIENT_ID_SET.has(expectedClientId)) throw new Error('expectedClientId 不合法');
  if (typeof clockToleranceSeconds !== 'number' || !Number.isFinite(clockToleranceSeconds) ||
      clockToleranceSeconds < 0 || clockToleranceSeconds > 300) {
    throw new Error('clockToleranceSeconds 必须在 0 到 300 秒之间');
  }
  const payloadBytes = decodeBase64Url(match[1], '许可证载荷', MAX_PAYLOAD_BYTES);
  const signature = decodeBase64Url(match[2], '许可证签名', 128);
  if (signature.length !== 64) throw new Error('Ed25519 签名长度无效');
  const key = injectedEd25519PublicKey(publicKey);
  if (!crypto.verify(null, Buffer.from(match[1], 'ascii'), key, signature)) throw new Error('许可证签名验证失败');
  let rawPayload;
  try {
    rawPayload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw new Error('许可证载荷不是有效 JSON');
  }
  const payload = validateLicensePayload(rawPayload);
  if (payload.audience !== expectedAudience) throw new Error('许可证 audience 不匹配');
  if (expectedClientId && !payload.clientIds.includes(expectedClientId)) throw new Error('许可证不适用于该客户端');
  const current = dateValue(now, 'now').getTime();
  const tolerance = clockToleranceSeconds * 1000;
  if (Date.parse(payload.issuedAt) > current + tolerance) throw new Error('许可证签发时间晚于本机时间');
  if (payload.notBefore && Date.parse(payload.notBefore) > current + tolerance) throw new Error('许可证尚未生效');
  if (payload.expiresAt && Date.parse(payload.expiresAt) <= current - tolerance) throw new Error('许可证已过期');
  const snapshot = permissionSnapshot(payload, current);
  return deepFreeze({
    valid: true,
    tier: snapshot.tier,
    payload,
    permissions: snapshot.permissions,
    activeGrants: snapshot.activeGrants,
    skinIds: snapshot.skinIds,
    customProfileIds: snapshot.customProfileIds,
  });
}

function freeEntitlement(status, reason) {
  return deepFreeze({
    tier: 'free',
    source: 'default',
    status,
    ...(reason ? {reason} : {}),
    license: null,
    permissions: PERMISSION_MATRIX.free,
    activeGrants: [],
    skinIds: [],
    customProfileIds: [],
  });
}

export function resolveEntitlement({
  licenseToken,
  publicKey,
  now = new Date(),
  expectedAudience = LICENSE_AUDIENCE,
  expectedClientId,
} = {}) {
  if (!licenseToken) return freeEntitlement('no-license');
  try {
    const license = verifyLicenseToken(licenseToken, {
      publicKey, now, expectedAudience, expectedClientId,
    });
    return deepFreeze({
      tier: license.tier,
      source: 'license',
      status: 'valid',
      license: license.payload,
      permissions: license.permissions,
      activeGrants: license.activeGrants,
      skinIds: license.skinIds,
      customProfileIds: license.customProfileIds,
    });
  } catch (error) {
    return freeEntitlement('invalid-license', error.message);
  }
}

export function canUseFeature(entitlement, feature) {
  if (typeof feature !== 'string' || !Object.hasOwn(PERMISSION_MATRIX.free, feature)) return false;
  return entitlement?.permissions?.[feature] === true;
}

export function canUseSkin(entitlement, skinOrTier, {custom = false, customProfileId} = {}) {
  if (!entitlement || !canUseFeature(entitlement, 'freeCatalog')) return false;
  const skinTier = typeof skinOrTier === 'string' ? skinOrTier : skinOrTier?.tier;
  const skinId = typeof skinOrTier === 'object' && skinOrTier ? skinOrTier.id : null;
  if (custom) {
    if (canUseFeature(entitlement, 'allFeatures')) return true;
    const profileId = customProfileId ?? skinId;
    return typeof profileId === 'string' && entitlement.customProfileIds?.includes(profileId) === true;
  }
  if (skinTier === 'free') return true;
  if (skinTier === 'vip') {
    const fullVip = entitlement.tier === 'vip' &&
      canUseFeature(entitlement, 'vipCatalog') &&
      canUseFeature(entitlement, 'allFeatures') &&
      ((entitlement.source === 'license' && entitlement.status === 'valid') ||
       (entitlement.source === 'local-trial' && entitlement.status === 'trial-active'));
    return fullVip ||
      (typeof skinId === 'string' && entitlement.skinIds?.includes(skinId) === true);
  }
  return false;
}

export function canPersistUnionProfile(entitlement, profileId) {
  if (typeof profileId !== 'string' || !PROFILE_ID.test(profileId)) return false;
  // A local first-use trial is intentionally a real, time-bounded VIP
  // entitlement for product features, but it is never a Dodo lease. Keep the
  // explicit status allowlist narrow so invalid/revoked license snapshots can
  // never persist a custom profile merely because they contain stale fields.
  if (!['valid', 'trial-active'].includes(entitlement?.status)) return false;
  if (canUseFeature(entitlement, 'allFeatures')) return true;
  if (!canUseFeature(entitlement, 'custom')) return false;
  if (!entitlement?.customProfileIds?.includes(profileId)) return false;
  return entitlement.activeGrants?.some((grant) =>
    grant?.offerType === 'custom_slot_once' &&
    grant?.status === 'active' &&
    grant?.binding?.profileId === profileId
  ) === true;
}

export function assertSkinPermission(entitlement, skinOrTier, options) {
  if (!canUseSkin(entitlement, skinOrTier, options)) throw new Error('当前授权无权使用该皮肤能力');
  return true;
}
