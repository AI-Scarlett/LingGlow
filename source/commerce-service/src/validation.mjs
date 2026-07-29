import crypto from 'node:crypto';
import {commerceError} from './errors.mjs';

const CATALOG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/u;
const CLIENT_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,39}$/u;
const LICENSE_KEY_MAX = 1024;

export function plainObject(value, label = 'request') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw commerceError('INVALID_REQUEST', 400, `${label} 必须是 JSON 对象`);
  }
  return value;
}

export function exactKeys(value, {required, optional = []}, label = 'request') {
  plainObject(value, label);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) {
    throw commerceError('INVALID_REQUEST', 400,
      `${label} 字段不合法${unknown.length ? `；不允许：${unknown.join(', ')}` : ''}` +
      `${missing.length ? `；缺少：${missing.join(', ')}` : ''}`);
  }
  return value;
}

function matches(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw commerceError('INVALID_REQUEST', 400, `${label} 不合法`);
  }
  return value;
}

export function validateCheckoutRequest(input) {
  const value = exactKeys(input, {
    required: ['catalogProductId', 'idempotencyKey'],
  }, 'checkout request');
  return Object.freeze({
    catalogProductId: matches(value.catalogProductId, CATALOG_ID, 'catalogProductId'),
    idempotencyKey: matches(value.idempotencyKey, IDEMPOTENCY_KEY, 'idempotencyKey'),
  });
}

function normalizedLicenseRequest(input, {allowSkinId = false} = {}) {
  const value = exactKeys(input, {
    required: ['licenseKey', 'deviceId', 'clientVersion', 'platform'],
    optional: allowSkinId ? ['skinId'] : [],
  }, 'license request');
  if (typeof value.licenseKey !== 'string' || !value.licenseKey.trim() ||
      value.licenseKey.length > LICENSE_KEY_MAX || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value.licenseKey)) {
    throw commerceError('INVALID_REQUEST', 400, 'licenseKey 不合法');
  }
  if (value.platform !== 'macos') throw commerceError('UNSUPPORTED_PLATFORM', 400, '当前服务只接受 macos');
  const result = {
    licenseKey: value.licenseKey,
    deviceId: matches(value.deviceId, DEVICE_ID, 'deviceId'),
    clientVersion: matches(value.clientVersion, CLIENT_VERSION, 'clientVersion'),
    platform: 'macos',
  };
  if (allowSkinId) {
    result.skinId = value.skinId === undefined ? null : matches(value.skinId, SKIN_ID, 'skinId');
  }
  return Object.freeze(result);
}

export function validateLicenseRequest(input) {
  return normalizedLicenseRequest(input);
}

export function validateRedemptionRequest(input) {
  return normalizedLicenseRequest(input, {allowSkinId: true});
}

export function validateCustomerId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /\p{Cc}/u.test(value)) {
    throw commerceError('AUTHENTICATION_REQUIRED', 401, '缺少有效客户会话');
  }
  return value;
}

export function deviceHash(deviceId) {
  return crypto.createHash('sha256').update(deviceId, 'utf8').digest('hex');
}

export function requestHash(value) {
  const canonical = JSON.stringify(value, Object.keys(value).sort());
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function idempotencyKeyHash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function licenseKeyHash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function utcTimestamp(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !value.endsWith('Z')) {
    throw commerceError('UPSTREAM_RESPONSE_INVALID', 502, `${label} 不是 UTC 时间`);
  }
  return new Date(value).toISOString();
}
