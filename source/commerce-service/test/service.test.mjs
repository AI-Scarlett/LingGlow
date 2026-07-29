import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyLicenseToken} from '../../src/entitlements.mjs';
import {createProductDirectory} from '../src/product-directory.mjs';
import {commerceServiceInternals, createCommerceService} from '../src/service.mjs';
import {createUnavailableAdapters} from '../src/unavailable-adapters.mjs';
import {
  FakeDodoClient,
  FakeWebhookVerifier,
  MemoryRepository,
  createTemporaryLeaseSigner,
  deterministicIds,
} from './fakes.mjs';

const ENV = Object.freeze({
  DODO_PAYMENTS_API_KEY: 'test-api-key',
  DODO_PAYMENTS_WEBHOOK_KEY: 'test-webhook-key',
  DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
  SKIN_STUDIO_ENTITLEMENT_DATABASE_URL: 'postgresql://test.invalid/lingglow',
  SKIN_STUDIO_LEASE_SIGNING_KEY_REF: 'kms://test/lingglow-lease',
  SKIN_STUDIO_CHECKOUT_RETURN_URL: 'https://account.test/checkout/return',
  SKIN_STUDIO_PUBLIC_BASE_URL: 'https://commerce.test/',
});
const CLOCK = () => new Date('2026-07-16T12:00:00.000Z');
const LICENSE_REQUEST = Object.freeze({
  licenseKey: 'license-key-value',
  deviceId: 'device-000000000001',
  clientVersion: '2.0.0',
  platform: 'macos',
});

function harness() {
  const repository = new MemoryRepository();
  const dodoClient = new FakeDodoClient();
  const webhookVerifier = new FakeWebhookVerifier();
  const signer = createTemporaryLeaseSigner();
  const productDirectory = createProductDirectory();
  const service = createCommerceService({
    env: ENV,
    repository,
    dodoClient,
    webhookVerifier,
    leaseSigner: signer.adapter,
    productDirectory,
    clock: CLOCK,
    randomId: deterministicIds(),
  });
  return {service, repository, dodoClient, webhookVerifier, signer, productDirectory};
}

test('all trusted settings are required and missing configuration fails closed before adapters', async () => {
  const unavailable = createUnavailableAdapters();
  const service = createCommerceService({
    env: {},
    repository: unavailable.repository,
    dodoClient: unavailable.dodoClient,
    webhookVerifier: unavailable.webhookVerifier,
    leaseSigner: unavailable.leaseSigner,
  });
  await assert.rejects(() => service.createCheckout({
    catalogProductId: 'vip-monthly',
    idempotencyKey: 'checkout-idempotency-0001',
  }, {customerId: 'customer-1'}), (error) =>
    error.code === 'COMMERCE_NOT_CONFIGURED' && error.httpStatus === 503);
  assert.equal(service.readiness().configured, false);
});

test('monthly and yearly products both map to VIP without duplicating Dodo product ids', () => {
  const directory = createProductDirectory();
  assert.equal(directory.byCatalogId('vip-monthly').offerType, 'vip_subscription');
  assert.equal(directory.byCatalogId('vip-yearly').offerType, 'vip_subscription');
  assert.notEqual(directory.byCatalogId('vip-monthly').dodoProductId,
    directory.byCatalogId('vip-yearly').dodoProductId);
  assert.equal(directory.source, '../../src/products.mjs');
  for (const skinId of ['cr7-portugal', 'messi-argentina', 'neymar-brazil']) {
    assert.equal(directory.sellableSkinIds.includes(skinId), true, skinId);
  }
});

test('shared skin checkout never accepts or stores a skin selection and is idempotent', async () => {
  const h = harness();
  const request = {
    catalogProductId: 'skin-permanent',
    idempotencyKey: 'checkout-idempotency-0001',
  };
  const first = await h.service.createCheckout(request, {customerId: 'customer-skin'});
  const second = await h.service.createCheckout(request, {customerId: 'customer-skin'});
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(h.dodoClient.checkouts.length, 1);
  const sent = h.dodoClient.checkouts[0];
  assert.deepEqual(sent.product_cart, [{
    product_id: h.productDirectory.byCatalogId('skin-permanent').dodoProductId,
    quantity: 1,
  }]);
  assert.equal(sent.return_url, ENV.SKIN_STUDIO_CHECKOUT_RETURN_URL);
  assert.deepEqual(Object.keys(sent.metadata), ['order_ref']);
  assert.equal(Object.values(sent.metadata).every((value) => typeof value === 'string'), true);
  const order = h.repository.orders.get(sent.metadata.order_ref);
  assert.equal(order.lockedSkinId, null);
  await assert.rejects(() => h.service.createCheckout({...request, skinId: 'aurora-glass'}, {
    customerId: 'customer-skin',
  }), (error) => error.code === 'INVALID_REQUEST' && error.httpStatus === 400);
});

test('checkout fails closed when the normalized Dodo URL is null or unsafe', async () => {
  for (const [index, checkoutUrl] of [null, 'http://checkout.test/not-secure'].entries()) {
    const h = harness();
    h.dodoClient.setCheckoutResult({sessionId: `session_invalid_${index}`, checkoutUrl});
    await assert.rejects(() => h.service.createCheckout({
      catalogProductId: 'vip-monthly',
      idempotencyKey: `checkout-invalid-url-000${index}`,
    }, {customerId: 'customer-invalid-checkout'}), (error) =>
      error.code === 'DODO_RESPONSE_INVALID' && error.httpStatus === 502);
    assert.equal([...h.repository.orders.values()][0].checkoutSessionId, null);
  }
});

test('monthly and yearly redemptions issue active VIP grants and verifiable leases', async () => {
  for (const [index, catalogProductId] of ['vip-monthly', 'vip-yearly'].entries()) {
    const h = harness();
    const product = h.productDirectory.byCatalogId(catalogProductId);
    const licenseKey = `vip-license-${index}`;
    h.dodoClient.setLicense(licenseKey, {
      licenseKeyId: `license-vip-${index}`,
      productId: product.dodoProductId,
      customerId: `customer-vip-${index}`,
      status: 'active',
      orderRef: null,
      validUntil: '2026-08-16T12:00:00.000Z',
    });
    const result = await h.service.redeem({...LICENSE_REQUEST, licenseKey, deviceId: `device-vip-00000000${index}`});
    assert.equal(result.redemption.offerType, 'vip_subscription');
    assert.equal(result.redemption.binding, null);
    const verified = verifyLicenseToken(result.signedLease, {
      publicKey: h.signer.publicKey,
      now: CLOCK(),
      expectedClientId: 'codex',
    });
    assert.equal(verified.tier, 'vip');
    assert.equal(verified.payload.grants[0].productId, product.dodoProductId);
  }
});

test('a non-skin license rejects skinId only after trusted type discovery', async () => {
  const h = harness();
  const product = h.productDirectory.byCatalogId('vip-monthly');
  h.dodoClient.setLicense('vip-with-selection', {
    licenseKeyId: 'license-vip-selection', productId: product.dodoProductId,
    customerId: 'customer-vip-selection', status: 'active', validUntil: '2026-08-16T12:00:00.000Z',
  });
  await assert.rejects(() => h.service.redeem({...LICENSE_REQUEST, licenseKey: 'vip-with-selection',
    skinId: 'violet-nebula'}), (error) => error.code === 'SKIN_NOT_ALLOWED' && error.httpStatus === 400);
  assert.equal(h.repository.grants.size, 0);
});

test('custom slot first redemption creates one fixed profileId and repeat keeps it', async () => {
  const h = harness();
  const product = h.productDirectory.byCatalogId('custom-slot-permanent');
  h.dodoClient.setLicense(LICENSE_REQUEST.licenseKey, {
    licenseKeyId: 'license-custom-1',
    productId: product.dodoProductId,
    customerId: 'customer-custom',
    status: 'active',
    orderRef: null,
    validUntil: null,
  });
  const first = await h.service.redeem(LICENSE_REQUEST);
  const second = await h.service.redeem(LICENSE_REQUEST);
  assert.match(first.redemption.binding.profileId, /^custom-[a-z0-9-]+$/u);
  assert.deepEqual(second.redemption.binding, first.redemption.binding);
  assert.equal(h.repository.bindings.size, 1);
  assert.equal(h.repository.grants.size, 1);
  assert.equal(h.dodoClient.activations.length, 1);
  assert.equal(h.repository.devices.size, 1);
  assert.equal([...h.repository.devices.values()][0].dodoLicenseKeyInstanceId, 'license_instance_1');
});

test('skin license chooses from the catalog on first redemption and can never change binding', async () => {
  const h = harness();
  const product = h.productDirectory.byCatalogId('skin-permanent');
  h.dodoClient.setLicense(LICENSE_REQUEST.licenseKey, {
    licenseKeyId: 'license-skin-1',
    productId: product.dodoProductId,
    customerId: 'customer-skin',
    status: 'active',
    validUntil: null,
  });
  await assert.rejects(() => h.service.redeem(LICENSE_REQUEST),
    (error) => error.code === 'SELECTION_REQUIRED' && error.httpStatus === 400);
  const first = await h.service.redeem({...LICENSE_REQUEST, skinId: 'violet-nebula'});
  const repeat = await h.service.redeem(LICENSE_REQUEST);
  assert.deepEqual(first.redemption.binding, {skinId: 'violet-nebula'});
  assert.deepEqual(repeat.redemption.binding, first.redemption.binding);

  await assert.rejects(() => h.service.redeem({...LICENSE_REQUEST, skinId: 'aurora-glass'}),
    (error) => error.code === 'BINDING_IMMUTABLE' && error.httpStatus === 409);
  assert.deepEqual(h.repository.bindings.get('license-skin-1').boundResourceId, 'violet-nebula');
});

test('refund revokes but never clears binding, and webhook replay is idempotent', async () => {
  const h = harness();
  const product = h.productDirectory.byCatalogId('skin-permanent');
  h.dodoClient.setLicense(LICENSE_REQUEST.licenseKey, {
    licenseKeyId: 'license-skin-refund',
    productId: product.dodoProductId,
    customerId: 'customer-skin',
    status: 'active',
    validUntil: null,
  });
  await h.service.redeem({...LICENSE_REQUEST, skinId: 'violet-nebula'});
  const raw = Buffer.from(JSON.stringify({
    id: 'webhook-refund-1',
    type: 'refund.succeeded',
    occurredAt: '2026-07-16T12:00:00.000Z',
    data: {paymentId: 'pay_license-skin-refund'},
  }), 'utf8');
  const headers = {
    'webhook-id': 'webhook-refund-1',
    'webhook-signature': 'valid-test-signature',
    'webhook-timestamp': '1784289600',
  };
  const first = await h.service.processDodoWebhook(raw, headers);
  const replay = await h.service.processDodoWebhook(raw, headers);
  assert.equal(first.duplicate, false);
  assert.equal(first.action, 'grant-revoked');
  assert.equal(replay.duplicate, true);
  assert.equal(h.repository.webhooks.size, 1);
  const binding = h.repository.bindings.get('license-skin-refund');
  assert.equal(binding.status, 'revoked');
  assert.equal(binding.boundResourceId, 'violet-nebula');
  const grant = h.repository.grants.get('license-skin-refund').grant;
  assert.equal(grant.status, 'revoked');
  assert.deepEqual(grant.binding, {skinId: 'violet-nebula'});
  const retry = await h.service.redeem(LICENSE_REQUEST);
  assert.equal(retry.redemption.status, 'revoked');
  assert.deepEqual(retry.redemption.binding, {skinId: 'violet-nebula'});
});

test('subscription expiry resolves the immutable subscription reference and unmatched revocations are durable no-ops', async () => {
  const h = harness();
  const product = h.productDirectory.byCatalogId('vip-monthly');
  h.dodoClient.setLicense('vip-expiry-key', {
    licenseKeyId: 'license-vip-expiry', productId: product.dodoProductId,
    customerId: 'customer-vip-expiry', status: 'active',
    validUntil: '2026-08-16T12:00:00.000Z', subscriptionId: 'sub_vip_expiry',
  });
  await h.service.redeem({...LICENSE_REQUEST, licenseKey: 'vip-expiry-key'});
  const headers = {'webhook-id': 'webhook-sub-expiry',
    'webhook-signature': 'valid-test-signature', 'webhook-timestamp': '1784289600'};
  const expired = await h.service.processDodoWebhook(Buffer.from(JSON.stringify({
    id: 'webhook-sub-expiry', type: 'subscription.expired',
    occurredAt: '2026-07-16T12:00:00.000Z', data: {subscriptionId: 'sub_vip_expiry'},
  })), headers);
  assert.equal(expired.action, 'grant-revoked');
  assert.equal(h.repository.grants.get('license-vip-expiry').grant.status, 'revoked');

  const unmatched = await h.service.processDodoWebhook(Buffer.from(JSON.stringify({
    id: 'webhook-refund-unmatched', type: 'refund.succeeded',
    occurredAt: '2026-07-16T12:00:01.000Z', data: {paymentId: 'pay_unknown'},
  })), {...headers, 'webhook-id': 'webhook-refund-unmatched'});
  assert.deepEqual(unmatched, {ok: true, duplicate: false, action: 'recorded-unmatched-revocation'});
  assert.equal(h.repository.webhooks.get('webhook-refund-unmatched').processed, true);
});

test('device deactivation never mutates the grant or binding', async () => {
  const h = harness();
  const product = h.productDirectory.byCatalogId('custom-slot-permanent');
  h.dodoClient.setLicense(LICENSE_REQUEST.licenseKey, {
    licenseKeyId: 'license-device-1',
    productId: product.dodoProductId,
    customerId: 'customer-device',
    status: 'active',
    orderRef: null,
    validUntil: null,
  });
  await h.service.redeem(LICENSE_REQUEST);
  const grantBefore = h.repository.snapshotGrant('license-device-1');
  const bindingBefore = structuredClone(h.repository.bindings.get('license-device-1'));
  const result = await h.service.deactivateDevice(LICENSE_REQUEST);
  assert.equal(result.deactivated, true);
  assert.deepEqual(h.repository.snapshotGrant('license-device-1'), grantBefore);
  assert.deepEqual(h.repository.bindings.get('license-device-1'), bindingBefore);
  assert.equal(h.dodoClient.deactivations.length, 1);
  assert.equal(h.dodoClient.deactivations[0].licenseKeyInstanceId, 'license_instance_1');
  assert.equal(Object.hasOwn(h.dodoClient.deactivations[0], 'deviceId'), false);
  await assert.rejects(() => h.service.refreshLease(LICENSE_REQUEST),
    (error) => error.code === 'DEVICE_NOT_ACTIVE');

  const renewed = await h.service.redeem(LICENSE_REQUEST);
  assert.deepEqual(renewed.redemption.binding, bindingBefore.boundResourceId ?
    {profileId: bindingBefore.boundResourceId} : null);
  assert.equal(h.dodoClient.activations.length, 2);
  assert.equal(h.repository.devices.size, 2);
  assert.equal([...h.repository.devices.values()][0].dodoLicenseKeyInstanceId, 'license_instance_1');
  assert.equal([...h.repository.devices.values()][1].dodoLicenseKeyInstanceId, 'license_instance_2');
});

test('a persisted active device instance id cannot be replaced', async () => {
  const h = harness();
  const product = h.productDirectory.byCatalogId('custom-slot-permanent');
  h.dodoClient.setLicense(LICENSE_REQUEST.licenseKey, {
    licenseKeyId: 'license-device-immutable',
    productId: product.dodoProductId,
    customerId: 'customer-device-immutable',
    status: 'active',
    orderRef: null,
    validUntil: null,
  });
  await h.service.redeem(LICENSE_REQUEST);
  const active = await h.repository.findActiveDevice({
    licenseKeyId: 'license-device-immutable',
    deviceHash: [...h.repository.devices.values()][0].deviceHash,
  });
  await assert.rejects(() => h.repository.activateDevice({
    ...active,
    dodoLicenseKeyInstanceId: 'license_instance_replacement',
  }), (error) => error.code === 'DEVICE_INSTANCE_IMMUTABLE' && error.httpStatus === 409);
  assert.equal([...h.repository.devices.values()][0].dodoLicenseKeyInstanceId, 'license_instance_1');
});

test('lease refresh validates the persisted official device instance', async () => {
  const h = harness();
  const product = h.productDirectory.byCatalogId('custom-slot-permanent');
  h.dodoClient.setLicense(LICENSE_REQUEST.licenseKey, {
    licenseKeyId: 'license-device-refresh',
    productId: product.dodoProductId,
    customerId: 'customer-device-refresh',
    status: 'active',
    orderRef: null,
    validUntil: null,
  });
  await h.service.redeem(LICENSE_REQUEST);
  h.dodoClient.validations.length = 0;
  const result = await h.service.refreshLease(LICENSE_REQUEST);
  assert.equal(typeof result.signedLease, 'string');
  assert.equal(h.dodoClient.validations.length, 1);
  assert.equal(h.dodoClient.validations[0].licenseKeyInstanceId, 'license_instance_1');
});

test('only payment.succeeded can mark a checkout order paid', async () => {
  const h = harness();
  await h.service.createCheckout({
    catalogProductId: 'skin-permanent',
    idempotencyKey: 'checkout-payment-event-0001',
  }, {customerId: 'customer-skin'});
  const orderRef = h.dodoClient.checkouts[0].metadata.order_ref;
  const headers = {
    'webhook-id': 'webhook-payment-legacy',
    'webhook-signature': 'valid-test-signature',
    'webhook-timestamp': '1784289600',
  };
  const legacy = Buffer.from(JSON.stringify({
    id: 'webhook-payment-legacy',
    type: 'payment.paid',
    occurredAt: '2026-07-16T12:01:00.000Z',
    data: {orderRef},
  }));
  const ignored = await h.service.processDodoWebhook(legacy, headers);
  assert.equal(ignored.action, 'recorded-unsupported');
  assert.equal(h.repository.orders.get(orderRef).status, 'checkout_created');

  const succeeded = Buffer.from(JSON.stringify({
    id: 'webhook-payment-succeeded',
    type: 'payment.succeeded',
    occurredAt: '2026-07-16T12:02:00.000Z',
    data: {orderRef},
  }));
  const paid = await h.service.processDodoWebhook(succeeded, {
    ...headers,
    'webhook-id': 'webhook-payment-succeeded',
  });
  assert.equal(paid.action, 'order-paid');
  assert.equal(h.repository.orders.get(orderRef).status, 'paid');
});

test('legacy revocation names are durable no-ops and cannot mutate an immutable grant', async () => {
  const h = harness();
  const product = h.productDirectory.byCatalogId('custom-slot-permanent');
  h.dodoClient.setLicense(LICENSE_REQUEST.licenseKey, {
    licenseKeyId: 'license-legacy-events',
    productId: product.dodoProductId,
    customerId: 'customer-legacy-events',
    status: 'active',
    orderRef: null,
    validUntil: null,
  });
  await h.service.redeem(LICENSE_REQUEST);
  const before = h.repository.snapshotGrant('license-legacy-events');
  for (const [index, type] of ['payment.refunded', 'license.revoked', 'subscription.failed'].entries()) {
    const id = `webhook-legacy-revoke-${index}`;
    const result = await h.service.processDodoWebhook(Buffer.from(JSON.stringify({
      id,
      type,
      occurredAt: '2026-07-16T12:03:00.000Z',
      data: {licenseKeyId: 'license-legacy-events'},
    })), {
      'webhook-id': id,
      'webhook-signature': 'valid-test-signature',
      'webhook-timestamp': '1784289600',
    });
    assert.equal(result.action, commerceServiceInternals.OFFICIAL_DODO_EVENT_TYPES.has(type) ?
      'recorded-noop' : 'recorded-unsupported');
    assert.deepEqual(h.repository.snapshotGrant('license-legacy-events'), before);
  }
});

test('irreversible revocation allowlist exactly matches confirmed Dodo events', () => {
  assert.deepEqual([...commerceServiceInternals.PAYMENT_SUCCESS_EVENTS], ['payment.succeeded']);
  assert.deepEqual([...commerceServiceInternals.REVOCATION_EVENTS].sort(), [
    'dispute.accepted',
    'dispute.lost',
    'entitlement_grant.revoked',
    'refund.succeeded',
    'subscription.expired',
  ]);
});

test('client-supplied productId cannot self-authorize and unknown verified products fail closed', async () => {
  const h = harness();
  await assert.rejects(() => h.service.redeem({...LICENSE_REQUEST, productId: 'anything'}),
    (error) => error.code === 'INVALID_REQUEST' && error.httpStatus === 400);
  h.dodoClient.setLicense(LICENSE_REQUEST.licenseKey, {
    licenseKeyId: 'license-unknown',
    productId: 'unknown-provider-product',
    customerId: 'customer-unknown',
    status: 'active',
    orderRef: null,
    validUntil: null,
  });
  await assert.rejects(() => h.service.redeem(LICENSE_REQUEST),
    (error) => error.code === 'PRODUCT_NOT_ENTITLED' && error.httpStatus === 403);
});
