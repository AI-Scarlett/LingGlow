import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveEntitlement} from '../src/entitlements.mjs';
import {
  DODO_PRODUCT_IDS,
  PRODUCT_CATALOG,
  productByCatalogId,
  productByDodoProductId,
  publicProductCatalog,
  requireTrustedCommerceConfiguration,
  trustedCommerceReadiness,
} from '../src/products.mjs';

const configuredEnv = Object.freeze({
  DODO_PAYMENTS_API_KEY: 'api-secret-must-never-leak',
  DODO_PAYMENTS_WEBHOOK_KEY: 'webhook-secret-must-never-leak',
  DODO_PAYMENTS_ENVIRONMENT: 'live_mode',
  SKIN_STUDIO_ENTITLEMENT_DATABASE_URL: 'postgres://secret@example.invalid/skin',
  SKIN_STUDIO_LEASE_SIGNING_KEY_REF: 'kms://secret-signing-key',
  SKIN_STUDIO_CHECKOUT_RETURN_URL: 'https://account.example.invalid/checkout/return',
  SKIN_STUDIO_PUBLIC_BASE_URL: 'https://account.example.invalid/',
});

test('Dodo product catalog is the single immutable four-product mapping', () => {
  assert.deepEqual(DODO_PRODUCT_IDS, {
    vipMonthly: 'pdt_0NjWZqz1TDby1TNwWNDrb',
    vipYearly: 'pdt_0NjWZq3bhAD1lTsmOK0jU',
    skinPermanent: 'pdt_0NjWZpRBh70r1nylL6Pjw',
    customSlotPermanent: 'pdt_0NjWZonG0ci4Cfuk68jmw',
  });
  assert.equal(PRODUCT_CATALOG.length, 4);
  assert.deepEqual(PRODUCT_CATALOG.map(({id, offerType}) => [id, offerType]), [
    ['vip-monthly', 'vip_subscription'],
    ['vip-yearly', 'vip_subscription'],
    ['skin-permanent', 'skin_once'],
    ['custom-slot-permanent', 'custom_slot_once'],
  ]);
  assert.equal(new Set(PRODUCT_CATALOG.map((product) => product.dodoProductId)).size, 4);
  assert.equal(Object.isFrozen(PRODUCT_CATALOG), true);
  assert.equal(Object.isFrozen(PRODUCT_CATALOG[0].billing), true);
  assert.equal(productByCatalogId('vip-yearly')?.dodoProductId, DODO_PRODUCT_IDS.vipYearly);
  assert.equal(productByDodoProductId(DODO_PRODUCT_IDS.skinPermanent)?.offerType, 'skin_once');
  assert.equal(productByCatalogId('../vip-yearly'), null);
  assert.equal(productByDodoProductId('pdt_unknown'), null);
});

test('trusted commerce fails closed until every server-only dependency is configured', () => {
  const empty = trustedCommerceReadiness({});
  assert.deepEqual(empty, {
    status: 'unconfigured',
    configured: false,
    environment: null,
    checkoutEnabled: false,
    redemptionEnabled: false,
    webhookVerificationEnabled: false,
    productDirectoryEnvironment: 'live_mode',
    reasonCode: 'TRUSTED_COMMERCE_UNCONFIGURED',
  });
  assert.throws(
    () => requireTrustedCommerceConfiguration({}),
    (error) => error.code === 'COMMERCE_NOT_CONFIGURED' && error.httpStatus === 503,
  );

  for (const required of [
    'DODO_PAYMENTS_API_KEY',
    'DODO_PAYMENTS_WEBHOOK_KEY',
    'DODO_PAYMENTS_ENVIRONMENT',
    'SKIN_STUDIO_ENTITLEMENT_DATABASE_URL',
    'SKIN_STUDIO_LEASE_SIGNING_KEY_REF',
    'SKIN_STUDIO_CHECKOUT_RETURN_URL',
    'SKIN_STUDIO_PUBLIC_BASE_URL',
  ]) {
    const incomplete = {...configuredEnv};
    delete incomplete[required];
    assert.equal(trustedCommerceReadiness(incomplete).configured, false, required);
    assert.equal(trustedCommerceReadiness(incomplete).checkoutEnabled, false, required);
  }

  const ready = requireTrustedCommerceConfiguration(configuredEnv);
  assert.equal(ready.status, 'configured');
  assert.equal(ready.checkoutEnabled, true);
  assert.equal(ready.redemptionEnabled, true);
});

test('public catalog reports configuration without leaking trusted service secrets', () => {
  const payload = publicProductCatalog({env: configuredEnv});
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.provider, 'dodo_payments');
  assert.equal(payload.commerce.configured, true);
  assert.equal(payload.products.length, 4);
  const json = JSON.stringify(payload);
  for (const secret of Object.values(configuredEnv).filter((value) => !value.startsWith('live_mode'))) {
    assert.equal(json.includes(secret), false, secret);
  }
  assert.equal(json.includes('DODO_PAYMENTS_API_KEY'), false);
  assert.equal(json.includes('DODO_PAYMENTS_WEBHOOK_KEY'), false);
});

test('a known Dodo Product ID can never self-authorize the desktop client', () => {
  for (const productId of Object.values(DODO_PRODUCT_IDS)) {
    const entitlement = resolveEntitlement({licenseToken: productId});
    assert.equal(entitlement.tier, 'free');
    assert.equal(entitlement.status, 'invalid-license');
    assert.deepEqual(entitlement.skinIds, []);
    assert.deepEqual(entitlement.customProfileIds, []);
  }
});
