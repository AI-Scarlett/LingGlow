import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AtomicPrivateLeaseStore,
  DESKTOP_COMMERCE_CLIENT_VERSION,
  DesktopCommerceBridge,
  MacOSKeychainSecretStore,
  SecureJsonTransport,
  canonicalizeReleaseCommerceConfigPayload,
  loadBundledReleaseCommerceConfig,
  validateReleaseCommerceConfig,
} from '../src/desktop-commerce.mjs';
import {encodeLicensePayload} from '../src/entitlements.mjs';

const NOW = new Date('2026-07-17T00:00:00.000Z');

function spki(publicKey) {
  return publicKey.export({format: 'der', type: 'spki'}).toString('base64url');
}

function releaseConfig({environment = 'live', overrides = {}} = {}) {
  const configPair = crypto.generateKeyPairSync('ed25519');
  const leasePair = crypto.generateKeyPairSync('ed25519');
  const payload = {
    schemaVersion: 1,
    configId: `lingglow-${environment}-2026-07`,
    environment,
    issuedAt: '2026-07-16T00:00:00.000Z',
    expiresAt: '2027-07-16T00:00:00.000Z',
    accountPortalUrl: 'https://account.lingglow.example/store/',
    entitlementServiceBaseUrl: 'https://entitlements.lingglow.example/',
    productPortalUrls: {
      'vip-monthly': 'https://account.lingglow.example/store/vip-monthly',
      'vip-yearly': 'https://account.lingglow.example/store/vip-yearly',
      'skin-permanent': 'https://account.lingglow.example/store/skin-permanent',
      'custom-slot-permanent': 'https://account.lingglow.example/store/custom-slot-permanent',
    },
    leaseSigningPublicKeySpki: spki(leasePair.publicKey),
    ...overrides,
  };
  const canonical = canonicalizeReleaseCommerceConfigPayload(payload);
  const signature = crypto.sign(null, Buffer.from(canonical), configPair.privateKey).toString('base64url');
  return {
    config: {...payload, signature},
    configPublicKey: configPair.publicKey,
    leasePrivateKey: leasePair.privateKey,
  };
}

function leaseToken(privateKey, overrides = {}) {
  const payload = {
    schemaVersion: 2,
    licenseId: 'lease-desktop-001',
    audience: 'codex-skin-studio',
    subject: 'customer-desktop-001',
    issuedAt: '2026-07-17T00:00:00.000Z',
    notBefore: '2026-07-17T00:00:00.000Z',
    expiresAt: '2026-07-18T00:00:00.000Z',
    clientIds: ['codex', 'workbuddy'],
    grants: [],
    ...overrides,
  };
  const encoded = encodeLicensePayload(payload);
  const signature = crypto.sign(null, Buffer.from(encoded, 'ascii'), privateKey).toString('base64url');
  return `${encoded}.${signature}`;
}

class MemorySecretStore {
  constructor({available = true} = {}) {
    this.available = available;
    this.values = new Map();
  }

  key(service, account) { return `${service}\0${account}`; }
  async get(service, account) { return this.values.get(this.key(service, account)) ?? null; }
  async set(service, account, value) { this.values.set(this.key(service, account), value); }
  async delete(service, account) { return this.values.delete(this.key(service, account)); }
}

class FakeTransport {
  constructor(responses) {
    this.responses = [...responses];
    this.calls = [];
  }

  async postJson(url, body) {
    this.calls.push({url, body: structuredClone(body)});
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return structuredClone(response);
  }
}

test('only an unexpired Ed25519-signed, same-origin portal configuration is accepted', () => {
  const {config, configPublicKey} = releaseConfig();
  const verified = validateReleaseCommerceConfig(config, {configVerificationPublicKey: configPublicKey, now: NOW});
  assert.equal(verified.environment, 'live');
  assert.equal(verified.accountPortalUrl, 'https://account.lingglow.example/store/');
  assert.equal(verified.productPortalUrls['skin-permanent'],
    'https://account.lingglow.example/store/skin-permanent');

  assert.throws(() => validateReleaseCommerceConfig({
    ...config,
    accountPortalUrl: 'https://evil.example/store/',
  }, {configVerificationPublicKey: configPublicKey, now: NOW}),
  (error) => ['RELEASE_CONFIG_INVALID', 'RELEASE_CONFIG_SIGNATURE_INVALID'].includes(error.code));

  const unsafe = {...config,
    entitlementServiceBaseUrl: 'https://user:pass@entitlements.lingglow.example/'};
  assert.throws(() => validateReleaseCommerceConfig(unsafe, {
    configVerificationPublicKey: configPublicKey,
    now: NOW,
  }), /无凭据/u);

  const crossOrigin = {...config, productPortalUrls: {
    'vip-monthly': 'https://checkout.evil.example/vip-monthly',
    'vip-yearly': 'https://account.lingglow.example/store/vip-yearly',
    'skin-permanent': 'https://account.lingglow.example/store/skin-permanent',
    'custom-slot-permanent': 'https://account.lingglow.example/store/custom-slot-permanent',
  }};
  assert.throws(() => validateReleaseCommerceConfig(crossOrigin, {
    configVerificationPublicKey: configPublicKey,
    now: NOW,
  }), /账户门户/u);
});

test('source builds and signed test-mode configs remain fail-closed for sale', () => {
  const missing = loadBundledReleaseCommerceConfig({
    configPath: path.join(os.tmpdir(), `missing-commerce-${crypto.randomUUID()}.json`),
  });
  assert.equal(missing.verified, false);
  assert.equal(missing.reasonCode, 'RELEASE_CONFIG_MISSING');

  const {config, configPublicKey} = releaseConfig({environment: 'test'});
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-commerce-test-mode-'));
  const bridge = new DesktopCommerceBridge({
    dataDir,
    releaseConfig: config,
    configVerificationPublicKey: configPublicKey,
    secretStore: new MemorySecretStore(),
    clock: () => NOW,
  });
  assert.deepEqual(bridge.publicConfiguration().status, 'test');
  assert.equal(bridge.publicConfiguration().configured, false);
  assert.equal(bridge.publicConfiguration().checkoutEnabled, false);
  assert.deepEqual(bridge.publicConfiguration().productPortalUrls, {});
  assert.throws(() => bridge.assertEnabled(), (error) => error.code === 'TEST_MODE_NOT_FOR_SALE');

  const live = releaseConfig({environment: 'live'});
  const liveAgainstCurrentTestIds = new DesktopCommerceBridge({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-commerce-live-mismatch-')),
    releaseConfig: live.config,
    configVerificationPublicKey: live.configPublicKey,
    secretStore: new MemorySecretStore(),
    productDirectoryEnvironment: 'test_mode',
    clock: () => NOW,
  });
  assert.equal(liveAgainstCurrentTestIds.publicConfiguration().configured, false);
  assert.equal(liveAgainstCurrentTestIds.publicConfiguration().reasonCode, 'DODO_LIVE_PRODUCT_IDS_REQUIRED');
  assert.deepEqual(liveAgainstCurrentTestIds.publicConfiguration().productPortalUrls, {});
});

test('secure transport omits credentials, rejects redirects, bounds responses, and sanitizes remote errors', async () => {
  const calls = [];
  const transport = new SecureJsonTransport({fetchImpl: async (url, options) => {
    calls.push({url: String(url), options});
    return new Response(JSON.stringify({ok: true}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  }});
  assert.deepEqual(await transport.postJson('https://api.example.com/v1/redemptions', {licenseKey: 'secret'}), {ok: true});
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(Object.hasOwn(calls[0].options.headers, 'authorization'), false);
  assert.equal(Object.hasOwn(calls[0].options.headers, 'cookie'), false);

  const redirect = new SecureJsonTransport({fetchImpl: async () => new Response(null, {
    status: 302,
    headers: {location: 'https://evil.example/'},
  })});
  await assert.rejects(() => redirect.postJson('https://api.example.com/v1/redemptions', {}),
    (error) => error.code === 'COMMERCE_REDIRECT_REJECTED');

  const large = new SecureJsonTransport({maxResponseBytes: 1024, fetchImpl: async () => new Response(
    JSON.stringify({data: 'x'.repeat(2048)}),
    {status: 200, headers: {'content-type': 'application/json'}},
  )});
  await assert.rejects(() => large.postJson('https://api.example.com/v1/redemptions', {}),
    (error) => error.code === 'COMMERCE_RESPONSE_TOO_LARGE');

  const echoedSecret = 'DODO-SECRET-MUST-NOT-LEAK';
  const remote = new SecureJsonTransport({fetchImpl: async () => new Response(JSON.stringify({
    ok: false,
    error: {code: 'INTERNAL_ERROR', message: echoedSecret},
  }), {status: 500, headers: {'content-type': 'application/json'}})});
  await assert.rejects(() => remote.postJson('https://api.example.com/v1/redemptions', {licenseKey: echoedSecret}),
    (error) => error.code === 'INTERNAL_ERROR' && !error.message.includes(echoedSecret));
});

test('macOS Keychain writes through the hidden double prompt, verifies the result, and never uses process argv', async () => {
  const calls = [];
  const persisted = new Map();
  const store = new MacOSKeychainSecretStore({
    platform: 'darwin',
    securityPathExists: true,
    runner: async (args, options = {}) => {
      calls.push({args: [...args], options: {...options}});
      const account = args[args.indexOf('-a') + 1];
      if (args[0] === 'add-generic-password') {
        persisted.set(account, options.promptedSecret);
        return '';
      }
      if (args[0] === 'find-generic-password') {
        if (!persisted.has(account)) {
          const error = new Error('missing');
          error.exitCode = 44;
          throw error;
        }
        return persisted.get(account);
      }
      if (args[0] === 'delete-generic-password') {
        if (persisted.delete(account)) return '';
        const error = new Error('missing');
        error.exitCode = 44;
        throw error;
      }
      throw new Error('unexpected Keychain test command');
    },
  });
  const secret = JSON.stringify({schemaVersion: 1, records: [{
    code: 'license-secret-not-in-argv',
    payload: 'x'.repeat(420),
  }]});
  await store.set('com.lingglow.test', 'account', secret);
  assert.equal(calls.some((call) => call.args.includes(secret)), false);
  assert.equal(calls.filter((call) => call.args[0] === 'add-generic-password')
    .every((call) => call.args.at(-1) === '-w' && call.options.stdin === undefined), true);
  assert.equal([...persisted.values()].every((value) => Buffer.byteLength(value) <= 128), true);
  assert.equal(await store.get('com.lingglow.test', 'account'), secret);
  assert.equal(await store.delete('com.lingglow.test', 'account'), true);
  assert.equal(persisted.size, 0);
});

test('redemption sends an anonymous stable device ID, does not infer offer type, and persists only a verified lease', async () => {
  const {config, configPublicKey, leasePrivateKey} = releaseConfig();
  const signedLease = leaseToken(leasePrivateKey);
  const transport = new FakeTransport([
    {ok: true, signedLease, redemption: {offerType: 'vip_subscription', status: 'active', binding: null}},
    {ok: true, signedLease, redemption: {offerType: 'skin_once', status: 'active', binding: {skinId: 'violet-nebula'}}},
  ]);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-desktop-redeem-'));
  const secretStore = new MemorySecretStore();
  const bridge = new DesktopCommerceBridge({
    dataDir,
    releaseConfig: config,
    configVerificationPublicKey: configPublicKey,
    secretStore,
    transport,
    productDirectoryEnvironment: 'live_mode',
    clock: () => NOW,
  });

  await bridge.redeem({licenseKey: 'vip-license-key'});
  assert.equal(Object.hasOwn(transport.calls[0].body, 'skinId'), false);
  assert.match(transport.calls[0].body.deviceId, /^lgd_[A-Za-z0-9_-]{43}$/u);
  assert.equal(transport.calls[0].body.platform, 'macos');
  assert.equal(transport.calls[0].body.clientVersion, DESKTOP_COMMERCE_CLIENT_VERSION);

  await bridge.redeem({licenseKey: 'skin-license-key', skinId: 'violet-nebula'});
  assert.equal(transport.calls[1].body.skinId, 'violet-nebula');
  assert.equal(transport.calls[1].body.deviceId, transport.calls[0].body.deviceId);
  assert.equal(new AtomicPrivateLeaseStore(path.join(dataDir, 'entitlement-lease.txt')).read(), signedLease);
  assert.equal(fs.statSync(path.join(dataDir, 'entitlement-lease.txt')).mode & 0o077, 0);
  assert.equal(fs.readdirSync(dataDir).some((name) => name.includes('license-key')), false);
  assert.equal([...secretStore.values.values()].some((value) => value.includes('skin-license-key')), true);
});

test('tampered remote JSON and Product IDs never create local entitlement state', async () => {
  const {config, configPublicKey, leasePrivateKey} = releaseConfig();
  const valid = leaseToken(leasePrivateKey);
  const [payload, signature] = valid.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  decoded.grants = [{
    grantId: 'grant-forged', offerType: 'vip_subscription', status: 'active',
    productId: 'pdt_forged', binding: null, boundAt: '2026-07-17T00:00:00.000Z',
    validUntil: '2026-08-17T00:00:00.000Z', revokedAt: null,
  }];
  const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
  const transport = new FakeTransport([
    {ok: true, signedLease: forged, redemption: {offerType: 'vip_subscription', status: 'active', binding: null}},
  ]);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-desktop-tampered-'));
  const secretStore = new MemorySecretStore();
  const bridge = new DesktopCommerceBridge({
    dataDir,
    releaseConfig: config,
    configVerificationPublicKey: configPublicKey,
    secretStore,
    transport,
    productDirectoryEnvironment: 'live_mode',
    clock: () => NOW,
  });
  await assert.rejects(() => bridge.redeem({licenseKey: 'pdt_0NjWZqz1TDby1TNwWNDrb'}),
    (error) => error.code === 'SIGNED_LEASE_INVALID');
  assert.equal(fs.existsSync(path.join(dataDir, 'entitlement-lease.txt')), false);
  assert.equal([...secretStore.values.values()].some((value) => value.includes('pdt_0NjWZqz1TDby1TNwWNDrb')), false);
});

test('a different-account lease is rejected before raw license Keychain or lease mutation', async () => {
  const {config, configPublicKey, leasePrivateKey} = releaseConfig();
  const oldLease = leaseToken(leasePrivateKey, {
    licenseId: 'lease-old-account',
    subject: 'customer-old',
    issuedAt: '2026-07-15T00:00:00.000Z',
    notBefore: '2026-07-15T00:00:00.000Z',
    expiresAt: '2026-07-16T00:00:00.000Z',
  });
  const otherLease = leaseToken(leasePrivateKey, {
    licenseId: 'lease-other-account',
    subject: 'customer-other',
  });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-desktop-account-mismatch-'));
  const leaseStore = new AtomicPrivateLeaseStore(path.join(dataDir, 'entitlement-lease.txt'));
  leaseStore.write(oldLease);
  const secretStore = new MemorySecretStore();
  const bridge = new DesktopCommerceBridge({
    dataDir,
    releaseConfig: config,
    configVerificationPublicKey: configPublicKey,
    secretStore,
    transport: new FakeTransport([{
      ok: true,
      signedLease: otherLease,
      redemption: {offerType: 'vip_subscription', status: 'active', binding: null},
    }]),
    productDirectoryEnvironment: 'live_mode',
    clock: () => NOW,
  });
  const attemptedCode = 'different-customer-license';
  await assert.rejects(() => bridge.redeem({licenseKey: attemptedCode}),
    (error) => error.code === 'ENTITLEMENT_ACCOUNT_MISMATCH');
  assert.equal(leaseStore.read(), oldLease);
  assert.equal([...secretStore.values.values()].some((value) => value.includes(attemptedCode)), false);
  assert.equal([...secretStore.values.keys()].some((key) => key.includes('licenses')), false);
});

test('refresh and deactivation use Keychain material and clear only after all trusted calls succeed', async () => {
  const {config, configPublicKey, leasePrivateKey} = releaseConfig();
  const signedLease = leaseToken(leasePrivateKey);
  const transport = new FakeTransport([
    {ok: true, signedLease, redemption: {offerType: 'vip_subscription', status: 'active', binding: null}},
    {ok: true, signedLease},
    {ok: true, deactivated: true},
  ]);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-desktop-lifecycle-'));
  const secretStore = new MemorySecretStore();
  const bridge = new DesktopCommerceBridge({
    dataDir,
    releaseConfig: config,
    configVerificationPublicKey: configPublicKey,
    secretStore,
    transport,
    productDirectoryEnvironment: 'live_mode',
    clock: () => NOW,
  });
  await bridge.redeem({licenseKey: 'lifecycle-license'});
  await bridge.refresh();
  assert.match(transport.calls[1].url, /\/v1\/leases\/refresh$/u);
  assert.equal(transport.calls[1].body.licenseKey, 'lifecycle-license');
  const result = await bridge.deactivate();
  assert.equal(result.deactivated, 1);
  assert.match(transport.calls[2].url, /\/v1\/devices\/deactivate$/u);
  assert.equal(fs.existsSync(path.join(dataDir, 'entitlement-lease.txt')), false);
  assert.equal([...secretStore.values.keys()].some((key) => key.includes('licenses')), false);
});
