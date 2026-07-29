import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequestOriginPolicy} from '../src/request-origin.mjs';
import {loadRuntimeConfig} from '../src/runtime-config.mjs';
import {trustedCommerceReadiness} from '../../src/products.mjs';
import {assertTestProductConfiguration, normalizeDodoProduct} from '../src/test-product-expectations.mjs';

test('current four Dodo Product IDs are fail-closed in live_mode', () => {
  const status = trustedCommerceReadiness({
    DODO_PAYMENTS_API_KEY: 'secret', DODO_PAYMENTS_WEBHOOK_KEY: 'secret',
    DODO_PAYMENTS_ENVIRONMENT: 'live_mode',
    SKIN_STUDIO_ENTITLEMENT_DATABASE_URL: 'postgresql://db.example/lingglow',
    SKIN_STUDIO_LEASE_SIGNING_KEY_REF: 'kms://key',
    SKIN_STUDIO_CHECKOUT_RETURN_URL: 'https://account.example/return',
    SKIN_STUDIO_PUBLIC_BASE_URL: 'https://commerce.example/',
  });
  assert.equal(status.configured, false);
  assert.equal(status.productDirectoryEnvironment, 'test_mode');
  assert.equal(status.reasonCode, 'DODO_LIVE_PRODUCT_IDS_REQUIRED');
});

test('proxy policy trusts only exact configured peer and rejects spoofed or ambiguous forwarded headers', () => {
  const policy = createRequestOriginPolicy({publicBaseUrl: 'https://commerce.example/',
    trustedProxyAddresses: ['127.0.0.1']});
  assert.equal(policy.assertPublicHttps({socket: {remoteAddress: '127.0.0.1'}, headers: {
    'x-forwarded-proto': 'https', 'x-forwarded-host': 'commerce.example',
  }}), true);
  assert.throws(() => policy.assertPublicHttps({socket: {remoteAddress: '203.0.113.10'}, headers: {
    'x-forwarded-proto': 'https', 'x-forwarded-host': 'commerce.example',
  }}), (error) => error.code === 'PROXY_HEADERS_NOT_TRUSTED');
  assert.throws(() => policy.assertPublicHttps({socket: {remoteAddress: '127.0.0.1'}, headers: {
    'x-forwarded-proto': 'http, https', 'x-forwarded-host': 'commerce.example',
  }}), (error) => error.code === 'PROXY_HEADERS_INVALID');
  assert.throws(() => policy.assertPublicHttps({socket: {remoteAddress: '127.0.0.1'}, headers: {
    'x-forwarded-proto': 'https', 'x-forwarded-host': 'commerce.example/not-an-authority',
  }}), (error) => error.code === 'PUBLIC_ORIGIN_MISMATCH');
});

test('runtime config rejects hostnames and CIDR-like proxy shortcuts instead of broad trust', () => {
  assert.throws(() => loadRuntimeConfig({COMMERCE_HOST: 'commerce.example'}), /COMMERCE_HOST/u);
  assert.throws(() => loadRuntimeConfig({COMMERCE_TRUSTED_PROXY_ADDRESSES: '10.0.0.0\/8'}),
    /COMMERCE_TRUSTED_PROXY_ADDRESSES/u);
  assert.deepEqual(loadRuntimeConfig({PORT: '9000'}).trustedProxyAddresses, []);
});

test('test product deployment fixture requires the modern license entitlement and ignores legacy flag', () => {
  const product = {id: 'custom-slot-permanent', dodoProductId: 'fixture-product-id'};
  const response = {product_info: {
    product_id: 'fixture-product-id', is_recurring: false, license_key_enabled: false,
    price: {type: 'one_time_price', price: 10, currency: 'USD', pay_what_you_want: false,
      suggested_price: null},
    entitlements: [{integration_type: 'license_key', integration_config: {
      fulfillment_mode: 'auto', activations_limit: 1,
    }}],
  }};
  assert.equal(assertTestProductConfiguration(product, response), true);
  assert.equal(normalizeDodoProduct(response).hasLicenseEntitlement, true);
  assert.throws(() => assertTestProductConfiguration(product, {
    product_info: {...response.product_info, entitlements: []},
  }), (error) => error.code === 'DODO_PRODUCT_CONFIGURATION_DRIFT');
});
