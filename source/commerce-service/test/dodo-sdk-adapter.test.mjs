import assert from 'node:assert/strict';
import test from 'node:test';
import {createOfficialDodoAdapters, dodoSdkAdapterInternals} from '../src/dodo-sdk-adapter.mjs';

function harness() {
  const calls = [];
  const client = {
    checkoutSessions: {async create(input) {
      calls.push(['checkout', structuredClone(input)]);
      return {session_id: 'cks_123', checkout_url: 'https://test.checkout.dodopayments.com/session/123'};
    }},
    licenses: {
      async validate(input) { calls.push(['validate', structuredClone(input)]); return {valid: true}; },
      async activate(input) {
        calls.push(['activate', structuredClone(input)]);
        return {id: 'lki_123', license_key_id: 'lic_123',
          product: {product_id: 'pdt_test'}, customer: {customer_id: 'cus_123'}};
      },
      async deactivate(input) { calls.push(['deactivate', structuredClone(input)]); },
    },
    licenseKeys: {async retrieve(id) {
      calls.push(['retrieve', id]);
      return {id, product_id: 'pdt_test', customer_id: 'cus_123', status: 'active', source: 'auto',
        key: 'LICENSE-SECRET', expires_at: null, payment_id: 'pay_123', subscription_id: null};
    }},
    products: {async retrieve(id) {
      calls.push(['product', id]);
      return {product_id: id, is_recurring: false,
        price: {type: 'one_time_price', price: 10, currency: 'USD', pay_what_you_want: false,
          suggested_price: null},
        entitlements: [{integration_type: 'license_key',
          integration_config: {fulfillment_mode: 'auto', activations_limit: 1}}]};
    }},
    webhooks: {async unwrap(rawBody, options) {
      calls.push(['unwrap', rawBody, structuredClone(options)]);
      return {type: 'payment.succeeded', timestamp: '2026-07-16T12:00:00.000Z',
        data: {metadata: {order_ref: 'ord_12345678901234567890'}}};
    }},
  };
  const adapters = createOfficialDodoAdapters({client, apiKey: 'api-secret', webhookKey: 'whsec-secret',
    environment: 'test_mode'});
  return {calls, client, ...adapters};
}

test('official SDK adapter maps checkout and all license calls to exact snake_case fields', async () => {
  const h = harness();
  assert.deepEqual(await h.dodoClient.createCheckoutSession({
    apiKey: 'api-secret', environment: 'test_mode',
    product_cart: [{product_id: 'pdt_test', quantity: 1}],
    return_url: 'https://account.test/return', metadata: {order_ref: 'ord_12345678901234567890'},
  }), {sessionId: 'cks_123', checkoutUrl: 'https://test.checkout.dodopayments.com/session/123'});
  assert.deepEqual(await h.dodoClient.validateLicense({apiKey: 'api-secret', environment: 'test_mode',
    licenseKey: 'LICENSE-SECRET', licenseKeyInstanceId: 'lki_123'}), {valid: true});
  assert.deepEqual(await h.dodoClient.activateLicense({environment: 'test_mode', licenseKey: 'LICENSE-SECRET',
    name: 'LingGlow macOS device'}), {
    licenseKeyInstanceId: 'lki_123', licenseKeyId: 'lic_123', productId: 'pdt_test', customerId: 'cus_123',
  });
  assert.equal((await h.dodoClient.retrieveLicense({apiKey: 'api-secret', environment: 'test_mode',
    licenseKeyId: 'lic_123'})).paymentId, 'pay_123');
  await h.dodoClient.deactivateLicense({environment: 'test_mode', licenseKey: 'LICENSE-SECRET',
    licenseKeyInstanceId: 'lki_123'});
  assert.deepEqual(h.calls[1][1], {license_key: 'LICENSE-SECRET', license_key_instance_id: 'lki_123'});
  assert.deepEqual(h.calls[2][1], {license_key: 'LICENSE-SECRET', name: 'LingGlow macOS device'});
  assert.deepEqual(h.calls[4][1], {license_key: 'LICENSE-SECRET', license_key_instance_id: 'lki_123'});
});

test('webhook adapter passes the exact raw string only to unwrap and derives id from signed header', async () => {
  const h = harness();
  const raw = '{ "type": "payment.succeeded", "data": {"metadata":{"order_ref":"ord_12345678901234567890"}} }';
  const headers = {'webhook-id': 'wh_123', 'webhook-signature': 'v1,signed', 'webhook-timestamp': '1784203200'};
  const event = await h.webhookVerifier.unwrap({rawBodyText: raw, headers, webhookKey: 'whsec-secret'});
  assert.deepEqual(event, {id: 'wh_123', type: 'payment.succeeded', occurredAt: '2026-07-16T12:00:00.000Z',
    data: {orderRef: 'ord_12345678901234567890'}});
  assert.equal(h.calls[0][1], raw);
  assert.deepEqual(h.calls[0][2], {headers});
  assert.equal(Object.hasOwn(h.client.webhooks, 'unsafeUnwrap'), false);
});

test('adapter rejects mismatched secrets/environments and missing signature headers before SDK calls', async () => {
  const h = harness();
  await assert.rejects(() => h.dodoClient.validateLicense({apiKey: 'wrong', environment: 'test_mode',
    licenseKey: 'LICENSE-SECRET'}), (error) => error.code === 'DODO_ADAPTER_CONFIGURATION_MISMATCH');
  await assert.rejects(() => h.webhookVerifier.unwrap({rawBodyText: '{}', headers: {},
    webhookKey: 'whsec-secret'}), (error) => error.code === 'WEBHOOK_SIGNATURE_INVALID');
  assert.equal(h.calls.length, 0);
});

test('official webhook payloads normalize purchase references without inventing a license key id', () => {
  assert.deepEqual(dodoSdkAdapterInternals.normalizedWebhookData({
    type: 'refund.succeeded', data: {payment_id: 'pay_refund_1'},
  }), {paymentId: 'pay_refund_1'});
  assert.deepEqual(dodoSdkAdapterInternals.normalizedWebhookData({
    type: 'dispute.lost', data: {payment_id: 'pay_dispute_1'},
  }), {paymentId: 'pay_dispute_1'});
  assert.deepEqual(dodoSdkAdapterInternals.normalizedWebhookData({
    type: 'subscription.expired', data: {subscription_id: 'sub_expired_1'},
  }), {subscriptionId: 'sub_expired_1'});
  assert.deepEqual(dodoSdkAdapterInternals.normalizedWebhookData({
    type: 'subscription.expired', data: {id: 'sub_legacy_shape_1'},
  }), {subscriptionId: 'sub_legacy_shape_1'});
  assert.deepEqual(dodoSdkAdapterInternals.normalizedWebhookData({
    type: 'entitlement_grant.revoked',
    data: {payment_id: 'pay_grant_1', subscription_id: 'sub_grant_1', license_key: {key: 'secret'}},
  }), {paymentId: 'pay_grant_1', subscriptionId: 'sub_grant_1'});
});
