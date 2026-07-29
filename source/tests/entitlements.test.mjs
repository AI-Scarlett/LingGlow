import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  OFFER_TYPES,
  PERMISSION_MATRIX,
  assertGrantTransition,
  canUseFeature,
  canUseSkin,
  encodeLicensePayload,
  resolveEntitlement,
  validateLicensePayload,
  verifyLicenseToken,
} from '../src/entitlements.mjs';

function payload(overrides = {}) {
  return {
    schemaVersion: 1,
    licenseId: 'license-test-001',
    tier: 'vip',
    audience: 'codex-skin-studio',
    subject: 'user-001',
    issuedAt: '2026-01-01T00:00:00Z',
    notBefore: '2026-01-01T00:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z',
    clientIds: ['codex', 'workbuddy'],
    ...overrides,
  };
}

function signedToken(value, privateKey) {
  const encoded = encodeLicensePayload(value);
  const signature = crypto.sign(null, Buffer.from(encoded, 'ascii'), privateKey).toString('base64url');
  return `${encoded}.${signature}`;
}

function grant(overrides = {}) {
  return {
    grantId: 'grant-test-001',
    offerType: 'skin_once',
    status: 'active',
    productId: 'pdt_dream_portal',
    binding: {skinId: 'violet-nebula'},
    boundAt: '2026-06-01T00:00:00Z',
    validUntil: null,
    revokedAt: null,
    ...overrides,
  };
}

function lease(overrides = {}) {
  return {
    schemaVersion: 2,
    licenseId: 'lease-test-001',
    audience: 'codex-skin-studio',
    subject: 'customer-001',
    issuedAt: '2026-07-16T00:00:00Z',
    notBefore: '2026-07-16T00:00:00Z',
    expiresAt: '2026-08-16T00:00:00Z',
    clientIds: ['codex', 'workbuddy'],
    grants: [],
    ...overrides,
  };
}

test('free is the fail-closed default and cannot use VIP or custom skins', () => {
  const entitlement = resolveEntitlement();
  assert.equal(entitlement.tier, 'free');
  assert.equal(entitlement.status, 'no-license');
  assert.deepEqual(entitlement.permissions, PERMISSION_MATRIX.free);
  assert.equal(canUseSkin(entitlement, 'free'), true);
  assert.equal(canUseSkin(entitlement, 'vip'), false);
  assert.equal(canUseSkin(entitlement, null, {custom: true}), false);
});

test('an injected Ed25519 public key verifies a VIP license', () => {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const token = signedToken(payload(), privateKey);
  const verified = verifyLicenseToken(token, {
    publicKey,
    now: new Date('2026-07-16T00:00:00Z'),
    expectedClientId: 'workbuddy',
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.tier, 'vip');
  const entitlement = resolveEntitlement({
    licenseToken: token,
    publicKey,
    now: new Date('2026-07-16T00:00:00Z'),
    expectedClientId: 'codex',
  });
  assert.equal(entitlement.tier, 'vip');
  assert.equal(canUseSkin(entitlement, 'vip'), true);
  assert.equal(canUseSkin(entitlement, null, {custom: true}), true);
});

test('tampered, expired, wrong-client, and wrong-key licenses fall back to free', () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const otherPair = crypto.generateKeyPairSync('ed25519');
  const validToken = signedToken(payload(), pair.privateKey);
  const [body, signature] = validToken.split('.');
  const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  decoded.tier = 'free';
  const tampered = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
  assert.equal(resolveEntitlement({
    licenseToken: tampered,
    publicKey: pair.publicKey,
    now: '2026-07-16T00:00:00Z',
  }).tier, 'free');
  assert.equal(resolveEntitlement({
    licenseToken: validToken,
    publicKey: otherPair.publicKey,
    now: '2026-07-16T00:00:00Z',
  }).status, 'invalid-license');

  const expired = signedToken(payload({expiresAt: '2026-02-01T00:00:00Z'}), pair.privateKey);
  assert.equal(resolveEntitlement({
    licenseToken: expired,
    publicKey: pair.publicKey,
    now: '2026-07-16T00:00:00Z',
  }).tier, 'free');

  const codexOnly = signedToken(payload({clientIds: ['codex']}), pair.privateKey);
  assert.equal(resolveEntitlement({
    licenseToken: codexOnly,
    publicKey: pair.publicKey,
    now: '2026-07-16T00:00:00Z',
    expectedClientId: 'workbuddy',
  }).tier, 'free');
});

test('the verifier rejects private-key injection and non-Ed25519 keys', () => {
  const ed = crypto.generateKeyPairSync('ed25519');
  const rsa = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
  const token = signedToken(payload(), ed.privateKey);
  assert.throws(() => verifyLicenseToken(token, {
    publicKey: ed.privateKey,
    now: '2026-07-16T00:00:00Z',
  }), /只接受公钥/u);
  assert.throws(() => verifyLicenseToken(token, {
    publicKey: {key: ed.privateKey.export({format: 'pem', type: 'pkcs8'}), format: 'pem'},
    now: '2026-07-16T00:00:00Z',
  }), /只接受公钥/u);
  assert.throws(() => verifyLicenseToken(token, {
    publicKey: rsa.publicKey,
    now: '2026-07-16T00:00:00Z',
  }), /Ed25519/u);
});

test('schemaVersion 2 models the three offer types without turning one-time buyers into VIP', () => {
  assert.deepEqual(OFFER_TYPES, ['vip_subscription', 'skin_once', 'custom_slot_once']);
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const token = signedToken(lease({
    grants: [
      grant(),
      grant({
        grantId: 'grant-custom-001',
        offerType: 'custom_slot_once',
        productId: 'pdt_custom_slot',
        binding: {profileId: 'my-sakura-slot'},
      }),
    ],
  }), privateKey);
  const entitlement = resolveEntitlement({
    licenseToken: token,
    publicKey,
    now: '2026-07-20T00:00:00Z',
  });

  assert.equal(entitlement.tier, 'free');
  assert.equal(canUseFeature(entitlement, 'allFeatures'), false);
  assert.equal(canUseFeature(entitlement, 'weeklySchedule'), false);
  assert.equal(canUseSkin(entitlement, {id: 'violet-nebula', tier: 'vip'}), true);
  assert.equal(canUseSkin(entitlement, {id: 'aurora-glass', tier: 'vip'}), false);
  assert.equal(canUseSkin(entitlement, {id: 'my-sakura-slot', tier: 'vip'}, {custom: true}), true);
  assert.equal(canUseSkin(entitlement, {id: 'another-custom', tier: 'vip'}, {custom: true}), false);
  assert.deepEqual(entitlement.skinIds, ['violet-nebula']);
  assert.deepEqual(entitlement.customProfileIds, ['my-sakura-slot']);
  assert.equal(entitlement.permissions.custom, true);
});

test('an active monthly VIP grant unlocks all features only through its own validity window', () => {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const token = signedToken(lease({
    expiresAt: '2026-10-01T00:00:00Z',
    grants: [grant({
      grantId: 'grant-vip-001',
      offerType: 'vip_subscription',
      productId: 'pdt_vip_monthly',
      binding: null,
      boundAt: '2026-07-01T00:00:00Z',
      validUntil: '2026-08-01T00:00:00Z',
    })],
  }), privateKey);

  const active = resolveEntitlement({licenseToken: token, publicKey, now: '2026-07-20T00:00:00Z'});
  assert.equal(active.tier, 'vip');
  assert.equal(canUseFeature(active, 'weeklySchedule'), true);
  assert.equal(canUseFeature(active, 'loginReminder'), true);
  assert.equal(canUseSkin(active, {id: 'any-vip-skin', tier: 'vip'}), true);
  assert.equal(canUseSkin(active, {id: 'any-custom-profile', tier: 'vip'}, {custom: true}), true);

  const subscriptionExpired = resolveEntitlement({
    licenseToken: token,
    publicKey,
    now: '2026-08-02T00:00:00Z',
  });
  assert.equal(subscriptionExpired.status, 'valid');
  assert.equal(subscriptionExpired.tier, 'free');
  assert.equal(canUseFeature(subscriptionExpired, 'weeklySchedule'), false);
  assert.equal(canUseSkin(subscriptionExpired, {id: 'any-vip-skin', tier: 'vip'}), false);
});

test('an active local first-use VIP trial unlocks VIP skins without consuming per-skin trials', () => {
  const localTrial = {
    tier: 'vip',
    source: 'local-trial',
    status: 'trial-active',
    permissions: PERMISSION_MATRIX.vip,
    skinIds: [],
    customProfileIds: [],
  };
  assert.equal(canUseSkin(localTrial, {id: 'already-tried-vip', tier: 'vip'}), true);

  const expiredTrial = {
    ...localTrial,
    tier: 'free',
    status: 'trial-expired',
    permissions: PERMISSION_MATRIX.free,
  };
  assert.equal(canUseSkin(expiredTrial, {id: 'already-tried-vip', tier: 'vip'}), false);
});

test('refund/revoke keeps the immutable binding visible but removes its permission', () => {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const revokedGrant = grant({
    status: 'revoked',
    revokedAt: '2026-07-10T00:00:00Z',
  });
  const token = signedToken(lease({grants: [revokedGrant]}), privateKey);
  const entitlement = resolveEntitlement({
    licenseToken: token,
    publicKey,
    now: '2026-07-20T00:00:00Z',
  });

  assert.equal(entitlement.status, 'valid');
  assert.deepEqual(entitlement.skinIds, []);
  assert.equal(canUseSkin(entitlement, {id: 'violet-nebula', tier: 'vip'}), false);
  assert.deepEqual(entitlement.license.grants[0].binding, {skinId: 'violet-nebula'});
  assert.equal(entitlement.license.grants[0].status, 'revoked');
});

test('grant bindings and lifecycle fields are strict and fail closed', () => {
  assert.throws(() => validateLicensePayload(lease({expiresAt: null})), /必须包含 expiresAt/u);
  assert.throws(() => validateLicensePayload(lease({
    grants: [grant({binding: {skinId: 'violet-nebula', profileId: 'extra'}})],
  })), /未允许字段/u);
  assert.throws(() => validateLicensePayload(lease({
    grants: [grant({validUntil: '2027-01-01T00:00:00Z'})],
  })), /validUntil 必须为 null/u);
  assert.throws(() => validateLicensePayload(lease({
    grants: [grant({status: 'revoked', revokedAt: null})],
  })), /revokedAt 不能为空/u);
  assert.throws(() => validateLicensePayload(lease({
    grants: [grant(), grant()],
  })), /grantId 不能重复/u);
});

test('changing the skin bound to a signed one-time grant invalidates the lease signature', () => {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const token = signedToken(lease({grants: [grant()]}), privateKey);
  const [body, signature] = token.split('.');
  const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  decoded.grants[0].binding.skinId = 'aurora-glass';
  const tampered = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
  const entitlement = resolveEntitlement({
    licenseToken: tampered,
    publicKey,
    now: '2026-07-20T00:00:00Z',
  });
  assert.equal(entitlement.status, 'invalid-license');
  assert.equal(canUseSkin(entitlement, {id: 'aurora-glass', tier: 'vip'}), false);
});

test('service transition guard makes bindings immutable and keeps device deactivation separate', () => {
  const active = grant();
  const refunded = {...active, status: 'revoked', revokedAt: '2026-07-10T00:00:00Z'};
  assert.equal(assertGrantTransition(active, refunded, {event: 'refund'}), true);
  assert.throws(() => assertGrantTransition(active, {
    ...refunded,
    binding: {skinId: 'aurora-glass'},
  }, {event: 'refund'}), (error) => error.code === 'BINDING_IMMUTABLE');
  assert.equal(assertGrantTransition(active, {...active}, {event: 'device_deactivate'}), true);
  assert.throws(() => assertGrantTransition(active, refunded, {
    event: 'device_deactivate',
  }), (error) => error.code === 'DEVICE_DEACTIVATION_ISOLATED');
});
