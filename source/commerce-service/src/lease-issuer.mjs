import {encodeLicensePayload} from '../../src/entitlements.mjs';
import {TARGET_CLIENT_IDS} from '../../src/client-registry.mjs';
import {commerceError} from './errors.mjs';

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 72 * 60 * 60;
const LEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;

function iso(date) {
  return new Date(date).toISOString();
}

export function createLeaseIssuer({
  signer,
  keyRef,
  clock = () => new Date(),
  randomId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
} = {}) {
  if (!signer || typeof signer.signEd25519 !== 'function') throw new Error('缺少 Ed25519 KMS signer 端口');
  if (typeof keyRef !== 'string' || !keyRef.trim()) throw new Error('缺少 KMS key ref');
  if (typeof randomId !== 'function') throw new Error('缺少安全随机 ID 生成器');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error('租约 TTL 必须为 300 秒到 72 小时');
  }

  return Object.freeze({
    async issue({customerId, grants}) {
      const issued = new Date(clock());
      if (!Number.isFinite(issued.getTime())) throw new Error('时钟返回无效时间');
      const licenseId = randomId('lease');
      if (typeof licenseId !== 'string' || !LEASE_ID.test(licenseId)) {
        throw commerceError('RANDOM_ID_GENERATOR_INVALID', 503, '租约 ID 生成失败');
      }
      const payload = {
        schemaVersion: 2,
        licenseId,
        audience: 'codex-skin-studio',
        subject: customerId,
        issuedAt: iso(issued),
        notBefore: iso(issued),
        expiresAt: iso(issued.getTime() + ttlSeconds * 1000),
        // A lease is a product entitlement, not a statement that every Agent
        // is presently runtime-compatible.  Include the full registry so a
        // later verified target does not require customers to repurchase or
        // receive a format-incompatible lease refresh.
        clientIds: [...TARGET_CLIENT_IDS],
        grants: structuredClone(grants),
      };
      const encoded = encodeLicensePayload(payload);
      const signature = await signer.signEd25519({
        keyRef,
        message: Buffer.from(encoded, 'ascii'),
      });
      if (!Buffer.isBuffer(signature) || signature.length !== 64) {
        throw commerceError('LEASE_SIGNER_INVALID_RESPONSE', 503, 'KMS 没有返回有效 Ed25519 签名');
      }
      return Object.freeze({
        signedLease: `${encoded}.${signature.toString('base64url')}`,
        payload: Object.freeze(payload),
      });
    },
  });
}
