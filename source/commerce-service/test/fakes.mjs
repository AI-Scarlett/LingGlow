import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {commerceError} from '../src/errors.mjs';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class MemoryRepository {
  configured = true;
  orders = new Map();
  idempotency = new Map();
  grants = new Map();
  licenseIdentities = new Map();
  bindings = new Map();
  devices = new Map();
  webhooks = new Map();
  audit = [];
  locks = new Map();

  async ping() {
    return true;
  }

  async createOrGetCheckoutOrder(input) {
    const key = `${input.customerId}:${input.idempotencyKeyHash}`;
    const existingRef = this.idempotency.get(key);
    if (existingRef) {
      const existing = this.orders.get(existingRef);
      if (existing.requestHash !== input.requestHash) {
        throw commerceError('IDEMPOTENCY_CONFLICT', 409, '幂等键已经用于不同请求');
      }
      return {created: false, order: clone(existing)};
    }
    const order = {
      ...clone(input),
      status: 'pending',
      checkoutSessionId: null,
      checkoutUrl: null,
      paidAt: null,
      revokedAt: null,
      updatedAt: input.createdAt,
    };
    this.orders.set(order.orderRef, order);
    this.idempotency.set(key, order.orderRef);
    this.audit.push({event: 'checkout-created', orderRef: order.orderRef});
    return {created: true, order: clone(order)};
  }

  async completeCheckoutOrder({orderRef, sessionId, checkoutUrl, updatedAt}) {
    const order = this.orders.get(orderRef);
    if (!order) throw commerceError('ORDER_NOT_FOUND', 404, '订单不存在');
    order.status = 'checkout_created';
    order.checkoutSessionId = sessionId;
    order.checkoutUrl = checkoutUrl;
    order.updatedAt = updatedAt;
    return clone(order);
  }

  async markOrderPaid({orderRef, occurredAt}) {
    const order = this.orders.get(orderRef);
    if (!order) throw commerceError('ORDER_NOT_FOUND', 404, '订单不存在');
    order.status = 'paid';
    order.paidAt = occurredAt;
    order.updatedAt = occurredAt;
    this.audit.push({event: 'order-paid', orderRef});
    return clone(order);
  }

  async findPaidOrder({orderRef, customerId, dodoProductId}) {
    const order = this.orders.get(orderRef);
    return order?.status === 'paid' && order.customerId === customerId &&
      order.dodoProductId === dodoProductId ? clone(order) : null;
  }

  async withLicenseLock(licenseKeyId, callback) {
    const prior = this.locks.get(licenseKeyId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = prior.then(() => current);
    this.locks.set(licenseKeyId, tail);
    await prior;
    try {
      return await callback();
    } finally {
      release();
      if (this.locks.get(licenseKeyId) === tail) this.locks.delete(licenseKeyId);
    }
  }

  async findLicenseIdentityByKeyHash(keyHash) {
    return clone(this.licenseIdentities.get(keyHash) ?? null);
  }

  async findLicenseIdentityByPurchaseReference({paymentId = null, subscriptionId = null} = {}) {
    if ((paymentId === null) === (subscriptionId === null)) {
      throw commerceError('PURCHASE_REFERENCE_INVALID', 500, '付款或订阅引用必须且只能提供一个');
    }
    const matches = [...this.licenseIdentities.values()].filter((identity) => paymentId !== null
      ? identity.paymentId === paymentId : identity.subscriptionId === subscriptionId);
    if (matches.length > 1) throw commerceError('PURCHASE_REFERENCE_AMBIGUOUS', 503, '购买引用不唯一');
    return clone(matches[0] ?? null);
  }

  async createLicenseIdentity(input) {
    if (this.licenseIdentities.has(input.licenseKeyHash) ||
        [...this.licenseIdentities.values()].some((value) => value.licenseKeyId === input.licenseKeyId ||
          input.paymentId !== null && value.paymentId === input.paymentId ||
          input.subscriptionId !== null && value.subscriptionId === input.subscriptionId)) {
      throw commerceError('BINDING_IMMUTABLE', 409, 'license identity 已存在');
    }
    this.licenseIdentities.set(input.licenseKeyHash, clone(input));
    return clone(input);
  }

  async findGrantByLicenseKeyId(licenseKeyId) {
    return clone(this.grants.get(licenseKeyId) ?? null);
  }

  async createGrant(record) {
    if (this.grants.has(record.licenseKeyId)) throw commerceError('BINDING_IMMUTABLE', 409, 'grant 已存在');
    this.grants.set(record.licenseKeyId, clone(record));
    this.audit.push({event: 'grant-created', licenseKeyId: record.licenseKeyId});
    return clone(record);
  }

  async updateGrant({licenseKeyId, grant}) {
    const record = this.grants.get(licenseKeyId);
    if (!record) throw commerceError('GRANT_NOT_FOUND', 404, 'grant 不存在');
    record.grant = clone(grant);
    this.audit.push({event: 'grant-updated', licenseKeyId});
    return clone(record);
  }

  async findBindingByLicenseKeyId(licenseKeyId) {
    return clone(this.bindings.get(licenseKeyId) ?? null);
  }

  async createBinding(binding) {
    if (this.bindings.has(binding.licenseKeyId)) throw commerceError('BINDING_IMMUTABLE', 409, 'binding 已存在');
    this.bindings.set(binding.licenseKeyId, clone(binding));
    this.audit.push({event: 'binding-created', licenseKeyId: binding.licenseKeyId});
    return clone(binding);
  }

  async findActiveDevice({licenseKeyId, deviceHash}) {
    const device = [...this.devices.values()].find((candidate) =>
      candidate.licenseKeyId === licenseKeyId && candidate.deviceHash === deviceHash &&
      candidate.deactivatedAt === null);
    return clone(device ?? null);
  }

  async activateDevice(device) {
    const active = await this.findActiveDevice(device);
    if (active) {
      if (active.dodoLicenseKeyInstanceId !== device.dodoLicenseKeyInstanceId) {
        throw commerceError('DEVICE_INSTANCE_IMMUTABLE', 409, 'Dodo device instance 不能换绑');
      }
      return active;
    }
    if (this.devices.has(device.dodoLicenseKeyInstanceId)) {
      throw commerceError('DEVICE_INSTANCE_IMMUTABLE', 409, 'Dodo device instance 已经绑定');
    }
    const stored = {...clone(device), deactivatedAt: null};
    this.devices.set(stored.dodoLicenseKeyInstanceId, stored);
    this.audit.push({event: 'device-activated', instanceId: stored.dodoLicenseKeyInstanceId});
    return clone(stored);
  }

  async deactivateDevice({licenseKeyId, deviceHash, dodoLicenseKeyInstanceId, deactivatedAt}) {
    const device = this.devices.get(dodoLicenseKeyInstanceId);
    if (!device || device.deactivatedAt) return false;
    if (device.licenseKeyId !== licenseKeyId || device.deviceHash !== deviceHash) {
      throw commerceError('DEVICE_INSTANCE_IMMUTABLE', 409, 'Dodo device instance 与设备记录不一致');
    }
    device.deactivatedAt = deactivatedAt;
    this.audit.push({event: 'device-deactivated', instanceId: dodoLicenseKeyInstanceId});
    return true;
  }

  async isDeviceActive({licenseKeyId, deviceHash}) {
    return Boolean(await this.findActiveDevice({licenseKeyId, deviceHash}));
  }

  async listGrantsByCustomer(customerId) {
    return [...this.grants.values()].filter((record) => record.customerId === customerId).map(clone);
  }

  async withWebhookEvent(metadata, callback) {
    if (this.webhooks.has(metadata.webhookId)) return {duplicate: true, result: null};
    this.webhooks.set(metadata.webhookId, clone(metadata));
    try {
      const result = await callback();
      this.webhooks.get(metadata.webhookId).processed = true;
      this.audit.push({event: 'webhook-processed', webhookId: metadata.webhookId});
      return {duplicate: false, result};
    } catch (error) {
      this.webhooks.delete(metadata.webhookId);
      throw error;
    }
  }

  async revokeGrantByLicenseKeyId({licenseKeyId, revokedAt, eventType, transitionGuard}) {
    const record = this.grants.get(licenseKeyId);
    if (!record) return null;
    if (record.grant.status === 'revoked') return clone(record);
    const next = {...record.grant, status: 'revoked', revokedAt};
    transitionGuard(record.grant, next, {event: eventType});
    record.grant = next;
    const binding = this.bindings.get(licenseKeyId);
    if (binding) {
      const resourceBefore = binding.boundResourceId;
      binding.status = 'revoked';
      binding.revokedAt = revokedAt;
      if (binding.boundResourceId !== resourceBefore) throw new Error('binding changed');
    }
    this.audit.push({event: 'grant-revoked', licenseKeyId, eventType});
    return clone(record);
  }

  snapshotGrant(licenseKeyId) {
    return clone(this.grants.get(licenseKeyId) ?? null);
  }

  assertGrantEquals(licenseKeyId, expected) {
    if (!isDeepStrictEqual(this.snapshotGrant(licenseKeyId), expected)) throw new Error('grant changed');
  }
}

export class FakeDodoClient {
  configured = true;
  licenses = new Map();
  checkouts = [];
  checkoutResult = null;
  validations = [];
  activations = [];
  deactivations = [];

  setLicense(licenseKey, proof) {
    const normalized = {
      licenseKeyId: proof.licenseKeyId,
      productId: proof.productId,
      customerId: proof.customerId,
      status: proof.status === 'paid' ? 'active' : proof.status,
      source: proof.source ?? 'auto',
      key: licenseKey,
      expiresAt: proof.expiresAt ?? proof.validUntil ?? null,
      paymentId: proof.paymentId ?? (proof.validUntil || proof.expiresAt ? null : `pay_${proof.licenseKeyId}`),
      subscriptionId: proof.subscriptionId ?? (proof.validUntil || proof.expiresAt ? `sub_${proof.licenseKeyId}` : null),
    };
    this.licenses.set(licenseKey, clone(normalized));
  }

  setCheckoutResult(result) {
    this.checkoutResult = clone(result);
  }

  async createCheckoutSession(input) {
    this.checkouts.push(clone(input));
    const index = this.checkouts.length;
    if (this.checkoutResult !== null) return clone(this.checkoutResult);
    return {
      checkoutUrl: `https://checkout.test/session/${index}`,
      sessionId: `session_${index}`,
    };
  }

  async validateLicense(input) {
    this.validations.push(clone(input));
    const {licenseKey} = input;
    const proof = this.licenses.get(licenseKey);
    return {valid: Boolean(proof && proof.status === 'active')};
  }

  async activateLicense(input) {
    this.activations.push(clone(input));
    const proof = this.licenses.get(input.licenseKey);
    if (!proof) throw commerceError('LICENSE_NOT_FOUND', 403, '授权码无效');
    return {
      licenseKeyInstanceId: `license_instance_${this.activations.length}`,
      licenseKeyId: proof.licenseKeyId,
      productId: proof.productId,
      customerId: proof.customerId,
    };
  }

  async retrieveLicense({licenseKeyId}) {
    const proof = [...this.licenses.values()].find((candidate) => candidate.licenseKeyId === licenseKeyId);
    if (!proof) throw commerceError('LICENSE_NOT_FOUND', 403, '授权码无效');
    return clone(proof);
  }

  async deactivateLicense(input) {
    this.deactivations.push(clone(input));
    return {ok: true};
  }
}

export class FakeWebhookVerifier {
  configured = true;
  calls = [];

  async unwrap({rawBodyText, headers, webhookKey}) {
    this.calls.push({rawBodyText, headers: clone(headers), webhookKey});
    for (const name of ['webhook-id', 'webhook-signature', 'webhook-timestamp']) {
      if (!headers[name]) throw commerceError('WEBHOOK_SIGNATURE_INVALID', 401, 'Webhook 签名头缺失');
    }
    if (headers['webhook-signature'] !== 'valid-test-signature') {
      throw commerceError('WEBHOOK_SIGNATURE_INVALID', 401, 'Webhook 签名无效');
    }
    return JSON.parse(rawBodyText);
  }
}

export function createTemporaryLeaseSigner() {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey,
    adapter: Object.freeze({
      configured: true,
      async signEd25519({keyRef, message}) {
        if (keyRef !== 'kms://test/lingglow-lease') throw new Error('unexpected key ref');
        return crypto.sign(null, message, privateKey);
      },
    }),
  };
}

export const fakeAuthenticator = Object.freeze({
  configured: true,
  async authenticate({headers}) {
    const value = headers.authorization;
    if (value !== 'Bearer test-session') throw commerceError('AUTHENTICATION_REQUIRED', 401, '客户会话无效');
    return {customerId: 'customer-http'};
  },
});

export function deterministicIds() {
  let counter = 0;
  return (prefix) => {
    counter += 1;
    return `${prefix}_${String(counter).padStart(24, '0')}`;
  };
}
