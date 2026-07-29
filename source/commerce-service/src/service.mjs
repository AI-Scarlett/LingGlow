import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertGrantTransition} from '../../src/entitlements.mjs';
import {loadTrustedCommerceConfig, publicReadiness} from './config.mjs';
import {commerceError} from './errors.mjs';
import {createLeaseIssuer} from './lease-issuer.mjs';
import {createProductDirectory} from './product-directory.mjs';
import {
  deviceHash,
  idempotencyKeyHash,
  licenseKeyHash,
  requestHash,
  utcTimestamp,
  validateCheckoutRequest,
  validateCustomerId,
  validateLicenseRequest,
  validateRedemptionRequest,
} from './validation.mjs';

const ACTIVE_LICENSE_STATUSES = new Set(['active']);
const UPSTREAM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const GENERATED_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const ORDER_REF = /^ord_[A-Za-z0-9_-]{20,80}$/u;
const WEBHOOK_TYPE = /^[a-z][a-z0-9._-]{0,99}$/u;
const OFFICIAL_DODO_EVENT_TYPES = new Set([
  'payment.succeeded',
  'payment.failed',
  'payment.processing',
  'payment.cancelled',
  'refund.succeeded',
  'refund.failed',
  'dispute.opened',
  'dispute.expired',
  'dispute.accepted',
  'dispute.cancelled',
  'dispute.challenged',
  'dispute.won',
  'dispute.lost',
  'subscription.active',
  'subscription.updated',
  'subscription.on_hold',
  'subscription.renewed',
  'subscription.plan_changed',
  'subscription.update_payment_method',
  'subscription.cancelled',
  'subscription.failed',
  'subscription.expired',
  'entitlement_grant.created',
  'entitlement_grant.delivered',
  'entitlement_grant.failed',
  'entitlement_grant.revoked',
  'license_key.created',
]);
const PAYMENT_SUCCESS_EVENTS = new Set(['payment.succeeded']);
const REVOCATION_EVENTS = new Set([
  'refund.succeeded',
  'dispute.accepted',
  'dispute.lost',
  'entitlement_grant.revoked',
  'subscription.expired',
]);

function nowIso(clock) {
  const now = new Date(clock());
  if (!Number.isFinite(now.getTime())) throw new Error('时钟返回无效时间');
  return now.toISOString();
}

function notLaterThan(timestamp, limit) {
  return Date.parse(timestamp) > Date.parse(limit) ? limit : timestamp;
}

function defaultRandomId(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`;
}

function generatedId(randomId, prefix, pattern = GENERATED_ID) {
  const value = randomId(prefix);
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw commerceError('RANDOM_ID_GENERATOR_INVALID', 503, '安全随机 ID 生成器返回无效标识');
  }
  return value;
}

function upstreamId(value, label) {
  if (typeof value !== 'string' || !UPSTREAM_ID.test(value)) {
    throw commerceError('DODO_RESPONSE_INVALID', 502, `Dodo 返回的 ${label} 无效`);
  }
  return value;
}

function upstreamCustomerId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /\p{Cc}/u.test(value)) {
    throw commerceError('DODO_RESPONSE_INVALID', 502, 'Dodo 返回的 customerId 无效');
  }
  return value;
}

function requirePort(port, methods, label) {
  if (!port || port.configured === false || methods.some((method) => typeof port[method] !== 'function')) {
    throw commerceError('TRUSTED_ADAPTERS_UNCONFIGURED', 503, `${label} adapter 尚未配置`);
  }
  return port;
}

function validateCheckoutResult(result) {
  if (!result || typeof result.checkoutUrl !== 'string' || typeof result.sessionId !== 'string') {
    throw commerceError('DODO_RESPONSE_INVALID', 502, 'Dodo checkout 响应无效');
  }
  let url;
  try {
    url = new URL(result.checkoutUrl);
  } catch {
    throw commerceError('DODO_RESPONSE_INVALID', 502, 'Dodo checkout URL 无效');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !result.sessionId.trim() ||
      result.sessionId.length > 200 || /\p{Cc}/u.test(result.sessionId)) {
    throw commerceError('DODO_RESPONSE_INVALID', 502, 'Dodo checkout 响应不安全');
  }
  return {checkoutUrl: url.toString(), sessionId: result.sessionId};
}

function validateLicenseActivation(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw commerceError('DODO_LICENSE_RESPONSE_INVALID', 502, 'Dodo 激活响应无效');
  }
  return Object.freeze({
    licenseKeyInstanceId: upstreamId(result.licenseKeyInstanceId, 'licenseKeyInstanceId'),
    licenseKeyId: upstreamId(result.licenseKeyId, 'licenseKeyId'),
    productId: upstreamId(result.productId, 'productId'),
    customerId: upstreamCustomerId(result.customerId),
  });
}

function deviceActivationName(hash) {
  return `LingGlow macOS ${hash.slice(0, 12)}`;
}

function decodeWebhookBody(rawBody) {
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(rawBody);
  } catch {
    throw commerceError('WEBHOOK_PAYLOAD_INVALID', 400, 'Webhook 原始字节不是有效 UTF-8');
  }
}

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateLicenseStatus(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.valid !== true) {
    throw commerceError('LICENSE_NOT_ACTIVE', 403, '授权码当前不可用');
  }
}

function validateLicenseProof(proof, {licenseKey, productDirectory, clock}) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    throw commerceError('DODO_LICENSE_RESPONSE_INVALID', 502, 'Dodo 授权验证响应无效');
  }
  for (const field of ['licenseKeyId', 'productId', 'customerId', 'status', 'source', 'key']) {
    if (typeof proof[field] !== 'string' || !proof[field].trim()) {
      throw commerceError('DODO_LICENSE_RESPONSE_INVALID', 502, `Dodo 授权缺少 ${field}`);
    }
  }
  const licenseKeyId = upstreamId(proof.licenseKeyId, 'licenseKeyId');
  const productId = upstreamId(proof.productId, 'productId');
  const customerId = upstreamCustomerId(proof.customerId);
  const product = productDirectory.requireTrustedProduct(productId);
  if (!sameSecret(proof.key, licenseKey)) {
    throw commerceError('DODO_LICENSE_RESPONSE_INVALID', 502, 'Dodo 授权身份与输入不一致');
  }
  if (!ACTIVE_LICENSE_STATUSES.has(proof.status)) {
    throw commerceError('LICENSE_NOT_ACTIVE', 403, '授权码当前不可用');
  }
  if (proof.source !== 'auto') {
    throw commerceError('LICENSE_NOT_PURCHASED', 403, '仅接受 Dodo 付款自动发放的授权码');
  }
  const validUntil = proof.expiresAt == null ? null : utcTimestamp(proof.expiresAt, 'expiresAt');
  if (product.offerType === 'vip_subscription') {
    if (validUntil === null || Date.parse(validUntil) <= new Date(clock()).getTime()) {
      throw commerceError('SUBSCRIPTION_NOT_ACTIVE', 403, 'VIP 订阅已经失效');
    }
    if (typeof proof.subscriptionId !== 'string' || !UPSTREAM_ID.test(proof.subscriptionId)) {
      throw commerceError('LICENSE_NOT_PURCHASED', 403, 'VIP 授权缺少可核验订阅记录');
    }
  } else {
    if (validUntil !== null) {
      throw commerceError('DODO_LICENSE_RESPONSE_INVALID', 502, '永久商品授权码不应设置过期时间');
    }
    if (typeof proof.paymentId !== 'string' || !UPSTREAM_ID.test(proof.paymentId)) {
      throw commerceError('LICENSE_NOT_PURCHASED', 403, '永久商品授权缺少可核验付款记录');
    }
  }
  return Object.freeze({
    licenseKeyId,
    productId,
    customerId,
    status: proof.status,
    source: proof.source,
    paymentId: proof.paymentId ?? null,
    subscriptionId: proof.subscriptionId ?? null,
    validUntil,
    product,
  });
}

// Persisted identities keep exactly the purchase reference that matches the
// offer type, which is also what the durable schema allows.
function purchaseReferenceFor(proof) {
  return proof.product.offerType === 'vip_subscription'
    ? {paymentId: null, subscriptionId: proof.subscriptionId}
    : {paymentId: proof.paymentId, subscriptionId: null};
}

function expectedBindingFor(existingGrant, product, requestedSkinId, productDirectory, randomId) {
  if (product.offerType === 'vip_subscription') return null;
  if (product.offerType === 'skin_once') {
    if (existingGrant) {
      if (requestedSkinId !== null && requestedSkinId !== existingGrant.binding?.skinId) {
        throw commerceError('BINDING_IMMUTABLE', 409, '授权码已绑定其他皮肤，不能更换');
      }
      return existingGrant.binding;
    }
    if (requestedSkinId === null) {
      throw commerceError('SELECTION_REQUIRED', 400, '单套皮肤授权首次兑换必须选择 skinId');
    }
    return {skinId: productDirectory.requireSellableSkin(requestedSkinId)};
  }
  if (existingGrant) return existingGrant.binding;
  const generated = generatedId(randomId, 'custom').toLowerCase().replace(/_/gu, '-').slice(0, 48);
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/u.test(generated)) {
    throw commerceError('RANDOM_ID_GENERATOR_INVALID', 503, '自定义皮肤位 ID 生成失败');
  }
  return {profileId: generated};
}

function assertExistingGrantMatches(record, proof, product, desiredBinding) {
  if (record.customerId !== proof.customerId || record.licenseKeyId !== proof.licenseKeyId ||
      record.grant.productId !== proof.productId || record.grant.offerType !== product.offerType ||
      !isDeepStrictEqual(record.grant.binding, desiredBinding)) {
    throw commerceError('BINDING_IMMUTABLE', 409, '授权码已经绑定，不能更换商品或资源');
  }
}

function publicRedemption(grant) {
  return Object.freeze({
    offerType: grant.offerType,
    status: grant.status,
    binding: grant.binding === null ? null : structuredClone(grant.binding),
  });
}

function validateVerifiedWebhookEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      typeof event.id !== 'string' || !UPSTREAM_ID.test(event.id) ||
      typeof event.type !== 'string' || !WEBHOOK_TYPE.test(event.type) ||
      typeof event.occurredAt !== 'string' || !event.occurredAt.endsWith('Z') ||
      !Number.isFinite(Date.parse(event.occurredAt)) ||
      !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
    throw commerceError('WEBHOOK_PAYLOAD_INVALID', 400, 'Webhook 解包结果无效');
  }
  return event;
}

function trustedRevocationReference(event) {
  if (typeof event.data.licenseKeyId === 'string' && UPSTREAM_ID.test(event.data.licenseKeyId)) {
    return Object.freeze({licenseKeyId: event.data.licenseKeyId});
  }
  if (event.type === 'subscription.expired') {
    return typeof event.data.subscriptionId === 'string' && UPSTREAM_ID.test(event.data.subscriptionId)
      ? Object.freeze({subscriptionId: event.data.subscriptionId}) : null;
  }
  if (event.type === 'refund.succeeded' || event.type === 'dispute.accepted' || event.type === 'dispute.lost') {
    return typeof event.data.paymentId === 'string' && UPSTREAM_ID.test(event.data.paymentId)
      ? Object.freeze({paymentId: event.data.paymentId}) : null;
  }
  if (event.type === 'entitlement_grant.revoked') {
    if (typeof event.data.subscriptionId === 'string' && UPSTREAM_ID.test(event.data.subscriptionId)) {
      return Object.freeze({subscriptionId: event.data.subscriptionId});
    }
    if (typeof event.data.paymentId === 'string' && UPSTREAM_ID.test(event.data.paymentId)) {
      return Object.freeze({paymentId: event.data.paymentId});
    }
  }
  return null;
}

export function createCommerceService({
  env = {},
  repository,
  dodoClient,
  webhookVerifier,
  leaseSigner,
  productDirectory = createProductDirectory(),
  clock = () => new Date(),
  randomId = defaultRandomId,
} = {}) {
  let catalogProbePromise = null;
  let catalogProbeExpiresAt = 0;

  async function probeCatalog(selectedPorts) {
    if (typeof selectedPorts.dodoClient.probeProductCatalog !== 'function') return;
    const now = Date.now();
    if (catalogProbePromise && now < catalogProbeExpiresAt) {
      await catalogProbePromise;
      return;
    }
    const current = selectedPorts.dodoClient.probeProductCatalog({products: productDirectory.products});
    catalogProbePromise = current;
    catalogProbeExpiresAt = now + 5_000;
    try {
      await current;
      if (catalogProbePromise === current) catalogProbeExpiresAt = Date.now() + 60_000;
    } catch (error) {
      if (catalogProbePromise === current) catalogProbeExpiresAt = Date.now() + 5_000;
      throw error;
    }
  }

  function config() {
    return loadTrustedCommerceConfig(env);
  }

  function ports({webhook = false} = {}) {
    const selected = {
      repository: requirePort(repository, [
        'createOrGetCheckoutOrder', 'completeCheckoutOrder', 'withLicenseLock',
        'findGrantByLicenseKeyId', 'createGrant', 'updateGrant', 'findBindingByLicenseKeyId',
        'createBinding', 'findPaidOrder', 'findActiveDevice', 'activateDevice', 'deactivateDevice',
        'findLicenseIdentityByKeyHash', 'findLicenseIdentityByPurchaseReference', 'createLicenseIdentity',
        'listGrantsByCustomer', 'withWebhookEvent', 'markOrderPaid',
        'revokeGrantByLicenseKeyId',
      ], 'PostgreSQL repository'),
      dodoClient: requirePort(dodoClient, [
        'createCheckoutSession', 'validateLicense', 'activateLicense', 'retrieveLicense', 'deactivateLicense',
      ], 'Dodo client'),
      leaseSigner: requirePort(leaseSigner, ['signEd25519'], 'KMS signer'),
    };
    if (webhook) selected.webhookVerifier = requirePort(webhookVerifier, ['unwrap'], 'Webhook verifier');
    return selected;
  }

  async function validateTrustedLicense({request, trustedConfig, selectedPorts, identity,
    licenseKeyInstanceId = null, verifiedProof = null}) {
    validateLicenseStatus(await selectedPorts.dodoClient.validateLicense({
      apiKey: trustedConfig.apiKey,
      environment: trustedConfig.environment,
      licenseKey: request.licenseKey,
      ...(licenseKeyInstanceId === null ? {} : {licenseKeyInstanceId}),
    }));
    const normalized = verifiedProof ?? validateLicenseProof(await selectedPorts.dodoClient.retrieveLicense({
      apiKey: trustedConfig.apiKey,
      environment: trustedConfig.environment,
      licenseKeyId: identity.licenseKeyId,
    }), {
      licenseKey: request.licenseKey,
      productDirectory,
      clock,
    });
    if (normalized.licenseKeyId !== identity.licenseKeyId || normalized.productId !== identity.productId ||
        normalized.customerId !== identity.customerId) {
      throw commerceError('BINDING_IMMUTABLE', 409, '授权码身份与首次记录不一致');
    }
    return normalized;
  }

  async function issueLease(customerId, trustedConfig, selectedPorts) {
    const records = await selectedPorts.repository.listGrantsByCustomer(customerId);
    const issuer = createLeaseIssuer({
      signer: selectedPorts.leaseSigner,
      keyRef: trustedConfig.leaseSigningKeyRef,
      clock,
      randomId,
    });
    return issuer.issue({customerId, grants: records.map(({grant}) => grant)});
  }

  const service = {
    readiness() {
      const readiness = publicReadiness(env);
      const adaptersConfigured = Boolean(repository?.configured === true && dodoClient?.configured === true &&
        webhookVerifier?.configured === true && leaseSigner?.configured === true);
      return Object.freeze({...readiness, adaptersConfigured});
    },

    assertReady(options) {
      config();
      ports(options);
      return true;
    },

    async probeReadiness() {
      try {
        config();
        const selectedPorts = ports({webhook: true});
        if (typeof selectedPorts.repository.ping !== 'function') {
          throw commerceError('TRUSTED_ADAPTERS_UNCONFIGURED', 503, 'PostgreSQL adapter 缺少 ping');
        }
        await selectedPorts.repository.ping();
        await probeCatalog(selectedPorts);
        return Object.freeze({ready: true, reasonCode: null});
      } catch (error) {
        return Object.freeze({ready: false, reasonCode: typeof error?.code === 'string'
          ? error.code : 'READINESS_CHECK_FAILED'});
      }
    },

    async createCheckout(input, {customerId} = {}) {
      const trustedConfig = config();
      const selectedPorts = ports();
      const customer = validateCustomerId(customerId);
      const request = validateCheckoutRequest(input);
      const product = productDirectory.requireCatalogProduct(request.catalogProductId);
      const lockedSkinId = null;
      const stableRequest = {catalogProductId: product.id};
      const createdAt = nowIso(clock);
      const claim = await selectedPorts.repository.createOrGetCheckoutOrder({
        id: crypto.randomUUID(),
        orderRef: generatedId(randomId, 'ord', ORDER_REF),
        customerId: customer,
        catalogProductId: product.id,
        dodoProductId: product.dodoProductId,
        offerType: product.offerType,
        lockedSkinId,
        idempotencyKeyHash: idempotencyKeyHash(request.idempotencyKey),
        requestHash: requestHash(stableRequest),
        createdAt,
      });
      if (!claim.created) {
        if (!claim.order.checkoutUrl || !claim.order.checkoutSessionId) {
          throw commerceError('IDEMPOTENCY_IN_PROGRESS', 409, '相同请求正在创建结账');
        }
        return Object.freeze({
          ok: true,
          reused: true,
          checkoutUrl: claim.order.checkoutUrl,
          sessionId: claim.order.checkoutSessionId,
        });
      }
      const checkout = validateCheckoutResult(await selectedPorts.dodoClient.createCheckoutSession({
        apiKey: trustedConfig.apiKey,
        environment: trustedConfig.environment,
        product_cart: [{product_id: product.dodoProductId, quantity: 1}],
        return_url: trustedConfig.checkoutReturnUrl,
        metadata: {order_ref: claim.order.orderRef},
      }));
      await selectedPorts.repository.completeCheckoutOrder({
        orderRef: claim.order.orderRef,
        sessionId: checkout.sessionId,
        checkoutUrl: checkout.checkoutUrl,
        updatedAt: nowIso(clock),
      });
      return Object.freeze({ok: true, reused: false, ...checkout});
    },

    async redeem(input) {
      const trustedConfig = config();
      const selectedPorts = ports();
      const request = validateRedemptionRequest(input);
      const keyHash = licenseKeyHash(request.licenseKey);
      const result = await selectedPorts.repository.withLicenseLock(`license-key-hash:${keyHash}`, async () => {
        let identity = await selectedPorts.repository.findLicenseIdentityByKeyHash(keyHash);
        let activation = null;
        let activationStored = false;
        let retrieved = null;
        try {
        if (!identity) {
          validateLicenseStatus(await selectedPorts.dodoClient.validateLicense({
            apiKey: trustedConfig.apiKey,
            environment: trustedConfig.environment,
            licenseKey: request.licenseKey,
          }));
          activation = validateLicenseActivation(await selectedPorts.dodoClient.activateLicense({
            environment: trustedConfig.environment,
            licenseKey: request.licenseKey,
            name: deviceActivationName(deviceHash(request.deviceId)),
          }));
          retrieved = validateLicenseProof(await selectedPorts.dodoClient.retrieveLicense({
            apiKey: trustedConfig.apiKey,
            environment: trustedConfig.environment,
            licenseKeyId: activation.licenseKeyId,
          }), {licenseKey: request.licenseKey, productDirectory, clock});
          if (retrieved.licenseKeyId !== activation.licenseKeyId || retrieved.productId !== activation.productId ||
              retrieved.customerId !== activation.customerId) {
            throw commerceError('DODO_LICENSE_RESPONSE_INVALID', 502, 'Dodo 激活与授权记录不一致');
          }
          identity = await selectedPorts.repository.createLicenseIdentity({
            id: crypto.randomUUID(),
            licenseKeyHash: keyHash,
            licenseKeyId: retrieved.licenseKeyId,
            customerId: retrieved.customerId,
            productId: retrieved.productId,
            source: retrieved.source,
            ...purchaseReferenceFor(retrieved),
            firstSeenAt: nowIso(clock),
          });
        }
        const proof = await validateTrustedLicense({request, trustedConfig, selectedPorts, identity,
          ...(activation === null ? {} : {licenseKeyInstanceId: activation.licenseKeyInstanceId,
            verifiedProof: retrieved})});
        if (proof.product.offerType !== 'skin_once' && request.skinId !== null) {
          throw commerceError('SKIN_NOT_ALLOWED', 400, '该授权码不接受 skinId');
        }
        const existing = await selectedPorts.repository.findGrantByLicenseKeyId(proof.licenseKeyId);
        const binding = expectedBindingFor(existing?.grant ?? null, proof.product, request.skinId,
          productDirectory, randomId);
        let record;
        if (existing) {
          assertExistingGrantMatches(existing, proof, proof.product, binding);
          record = existing;
        } else {
          const boundAt = nowIso(clock);
          if (proof.product.offerType !== 'vip_subscription') {
            const currentBinding = await selectedPorts.repository.findBindingByLicenseKeyId(proof.licenseKeyId);
            if (currentBinding) throw commerceError('BINDING_IMMUTABLE', 409, '授权码绑定已存在');
            await selectedPorts.repository.createBinding({
              id: crypto.randomUUID(),
              licenseKeyId: proof.licenseKeyId,
              customerId: proof.customerId,
              productId: proof.productId,
              offerType: proof.product.offerType,
              boundResourceId: proof.product.offerType === 'skin_once' ? binding.skinId : binding.profileId,
              boundAt,
              status: 'active',
              revokedAt: null,
            });
          }
          record = {
            licenseKeyId: proof.licenseKeyId,
            customerId: proof.customerId,
            grant: {
              grantId: generatedId(randomId, 'grant'),
              offerType: proof.product.offerType,
              status: 'active',
              productId: proof.productId,
              binding,
              boundAt,
              validUntil: proof.product.offerType === 'vip_subscription' ? proof.validUntil : null,
              revokedAt: null,
            },
          };
          await selectedPorts.repository.createGrant(record);
        }

        const hash = deviceHash(request.deviceId);
        let device = await selectedPorts.repository.findActiveDevice({
          licenseKeyId: proof.licenseKeyId,
          deviceHash: hash,
        });
        if (device) {
          upstreamId(device.dodoLicenseKeyInstanceId, 'persisted licenseKeyInstanceId');
        } else {
          if (activation === null) {
            activation = validateLicenseActivation(await selectedPorts.dodoClient.activateLicense({
              environment: trustedConfig.environment,
              licenseKey: request.licenseKey,
              name: deviceActivationName(hash),
            }));
            if (activation.licenseKeyId !== proof.licenseKeyId || activation.productId !== proof.productId ||
                activation.customerId !== proof.customerId) {
              throw commerceError('DODO_LICENSE_RESPONSE_INVALID', 502, 'Dodo 激活身份不一致');
            }
          }
          try {
            device = await selectedPorts.repository.activateDevice({
              id: crypto.randomUUID(),
              licenseKeyId: proof.licenseKeyId,
              dodoLicenseKeyInstanceId: activation.licenseKeyInstanceId,
              customerId: proof.customerId,
              deviceHash: hash,
              clientVersion: request.clientVersion,
              platform: request.platform,
              activatedAt: nowIso(clock),
            });
            activationStored = true;
          } catch (error) {
            throw error;
          }
        }
        return {record, device, customerId: proof.customerId};
        } catch (error) {
          if (activation !== null && !activationStored) {
            try {
              await selectedPorts.dodoClient.deactivateLicense({
                environment: trustedConfig.environment,
                licenseKey: request.licenseKey,
                licenseKeyInstanceId: activation.licenseKeyInstanceId,
              });
            } catch {
              // Deployment adapters must alert on this best-effort compensation failure.
            }
          }
          throw error;
        }
      });
      const lease = await issueLease(result.customerId, trustedConfig, selectedPorts);
      return Object.freeze({
        ok: true,
        signedLease: lease.signedLease,
        redemption: publicRedemption(result.record.grant),
      });
    },

    async refreshLease(input) {
      const trustedConfig = config();
      const selectedPorts = ports();
      const request = validateLicenseRequest(input);
      const keyHash = licenseKeyHash(request.licenseKey);
      const hash = deviceHash(request.deviceId);
      const customerId = await selectedPorts.repository.withLicenseLock(`license-key-hash:${keyHash}`, async () => {
        const identity = await selectedPorts.repository.findLicenseIdentityByKeyHash(keyHash);
        if (!identity) throw commerceError('LICENSE_NOT_FOUND', 403, '授权码未兑换');
        const device = await selectedPorts.repository.findActiveDevice({
          licenseKeyId: identity.licenseKeyId,
          deviceHash: hash,
        });
        if (!device) {
          throw commerceError('DEVICE_NOT_ACTIVE', 403, '设备未激活或已经停用');
        }
        const instanceId = upstreamId(device.dodoLicenseKeyInstanceId, 'persisted licenseKeyInstanceId');
        const proof = await validateTrustedLicense({request, trustedConfig, selectedPorts, identity,
          licenseKeyInstanceId: instanceId});
        const existing = await selectedPorts.repository.findGrantByLicenseKeyId(proof.licenseKeyId);
        if (!existing) throw commerceError('GRANT_NOT_FOUND', 404, '没有可刷新的授权记录');
        if (existing.customerId !== proof.customerId || existing.grant.productId !== proof.productId ||
            existing.grant.offerType !== proof.product.offerType) {
          throw commerceError('BINDING_IMMUTABLE', 409, '授权商品与既有绑定不一致');
        }
        if (existing.grant.offerType === 'vip_subscription' && existing.grant.status === 'active' &&
            existing.grant.validUntil !== proof.validUntil) {
          const next = {...existing.grant, validUntil: proof.validUntil};
          assertGrantTransition(existing.grant, next, {event: 'subscription_refresh'});
          await selectedPorts.repository.updateGrant({licenseKeyId: proof.licenseKeyId, grant: next});
        }
        return proof.customerId;
      });
      const lease = await issueLease(customerId, trustedConfig, selectedPorts);
      return Object.freeze({ok: true, signedLease: lease.signedLease});
    },

    async deactivateDevice(input) {
      const trustedConfig = config();
      const selectedPorts = ports();
      const request = validateLicenseRequest(input);
      const keyHash = licenseKeyHash(request.licenseKey);
      const hash = deviceHash(request.deviceId);
      return selectedPorts.repository.withLicenseLock(`license-key-hash:${keyHash}`, async () => {
        const identity = await selectedPorts.repository.findLicenseIdentityByKeyHash(keyHash);
        if (!identity) throw commerceError('LICENSE_NOT_FOUND', 403, '授权码未兑换');
        const proof = await validateTrustedLicense({request, trustedConfig, selectedPorts, identity});
        const before = await selectedPorts.repository.findGrantByLicenseKeyId(proof.licenseKeyId);
        const device = await selectedPorts.repository.findActiveDevice({
          licenseKeyId: proof.licenseKeyId,
          deviceHash: hash,
        });
        if (!device) return Object.freeze({ok: true, deactivated: false});
        const instanceId = upstreamId(device.dodoLicenseKeyInstanceId, 'persisted licenseKeyInstanceId');
        // The durable row is released first: a failing upstream call then rolls
        // the transaction back and the retry still finds a matching instance.
        const deactivated = await selectedPorts.repository.deactivateDevice({
          licenseKeyId: proof.licenseKeyId,
          deviceHash: hash,
          dodoLicenseKeyInstanceId: instanceId,
          deactivatedAt: nowIso(clock),
        });
        const after = await selectedPorts.repository.findGrantByLicenseKeyId(proof.licenseKeyId);
        if (!isDeepStrictEqual(before, after)) {
          throw commerceError('DEVICE_DEACTIVATION_ISOLATED', 500, '设备停用意外修改了 grant');
        }
        await selectedPorts.dodoClient.deactivateLicense({
          environment: trustedConfig.environment,
          licenseKey: request.licenseKey,
          licenseKeyInstanceId: instanceId,
        });
        return Object.freeze({ok: true, deactivated: Boolean(deactivated)});
      });
    },

    async processDodoWebhook(rawBody, headers) {
      const trustedConfig = config();
      const selectedPorts = ports({webhook: true});
      if (!Buffer.isBuffer(rawBody)) throw commerceError('WEBHOOK_RAW_BODY_REQUIRED', 400, 'Webhook 必须提供原始字节');
      const rawBodyText = decodeWebhookBody(rawBody);
      const event = validateVerifiedWebhookEvent(await selectedPorts.webhookVerifier.unwrap({
        rawBodyText,
        headers,
        webhookKey: trustedConfig.webhookKey,
      }));
      const outcome = await selectedPorts.repository.withWebhookEvent({
        webhookId: event.id,
        eventType: event.type,
        occurredAt: new Date(event.occurredAt).toISOString(),
        payloadSha256: crypto.createHash('sha256').update(rawBody).digest('hex'),
      }, async () => {
        if (!OFFICIAL_DODO_EVENT_TYPES.has(event.type)) {
          return {action: 'recorded-unsupported'};
        }
        if (PAYMENT_SUCCESS_EVENTS.has(event.type)) {
          // A payment that belongs to no local order is a permanent mismatch:
          // recording it keeps the replay guard instead of inviting retries.
          if (typeof event.data.orderRef !== 'string' || !ORDER_REF.test(event.data.orderRef)) {
            return {action: 'recorded-unmatched-payment'};
          }
          try {
            await selectedPorts.repository.markOrderPaid({
              orderRef: event.data.orderRef,
              webhookId: event.id,
              occurredAt: new Date(event.occurredAt).toISOString(),
            });
          } catch (error) {
            if (error?.code !== 'ORDER_NOT_FOUND') throw error;
            return {action: 'recorded-unmatched-payment'};
          }
          return {action: 'order-paid'};
        }
        if (REVOCATION_EVENTS.has(event.type)) {
          const reference = trustedRevocationReference(event);
          if (reference === null) {
            return {action: 'recorded-unmatched-revocation'};
          }
          let licenseKeyId = reference.licenseKeyId ?? null;
          if (licenseKeyId === null) {
            const identity = await selectedPorts.repository.findLicenseIdentityByPurchaseReference(reference);
            if (!identity) return {action: 'recorded-unmatched-revocation'};
            licenseKeyId = identity.licenseKeyId;
          }
          const revoked = await selectedPorts.repository.revokeGrantByLicenseKeyId({
            licenseKeyId,
            revokedAt: notLaterThan(new Date(event.occurredAt).toISOString(), nowIso(clock)),
            eventType: event.type,
            transitionGuard: assertGrantTransition,
          });
          return {action: revoked ? 'grant-revoked' : 'recorded-unmatched-revocation'};
        }
        return {action: 'recorded-noop'};
      });
      return Object.freeze({ok: true, duplicate: outcome.duplicate, action: outcome.result?.action ?? 'duplicate'});
    },
  };

  return Object.freeze(service);
}

export const commerceServiceInternals = Object.freeze({
  OFFICIAL_DODO_EVENT_TYPES,
  PAYMENT_SUCCESS_EVENTS,
  REVOCATION_EVENTS,
  validateLicenseProof,
  validateLicenseActivation,
  trustedRevocationReference,
});
