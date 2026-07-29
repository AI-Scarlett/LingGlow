import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import test from 'node:test';
import {PERMISSION_MATRIX, encodeLicensePayload} from '../src/entitlements.mjs';
import {saveFreeBrand, saveProfile} from '../src/profile.mjs';
import {canUseScheduledSkin, existingStudio, StudioServer, startStudioServer} from '../src/server.mjs';
import {getUnionProfile, saveUnionProfile} from '../src/union-profile.mjs';
import {TARGET_CLIENT_IDS} from '../src/client-registry.mjs';
import {PRODUCT_CATALOG} from '../src/products.mjs';
import {createDirectDodoCommerceBridge} from '../src/direct-dodo-commerce.mjs';

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const goodComposerWebp = `data:image/webp;base64,${fs.readFileSync(
  new URL('../catalog/assets/baxian-ensemble-mascot.webp', import.meta.url),
).toString('base64')}`;

function unionProfile({
  id = 'bound-profile',
  name = 'Bound Profile',
  targetClientId = 'codex',
  values = {},
  ...metadata
} = {}) {
  return {id, name, targetClientId, schemaVersion: 1, values, ...metadata};
}

test('weekly reminders include only the exact paid custom skin slot', () => {
  const entitlement = {
    permissions: {...PERMISSION_MATRIX.free, custom: true},
    customProfileIds: ['my-custom-slot'],
  };
  assert.equal(canUseScheduledSkin(entitlement, {
    custom: true,
    skin: {id: 'my-custom-slot', tier: 'vip'},
  }), true);
  assert.equal(canUseScheduledSkin(entitlement, {
    custom: true,
    skin: {id: 'another-slot', tier: 'vip'},
  }), false);
  assert.equal(canUseScheduledSkin(entitlement, {
    custom: false,
    skin: {id: 'violet-nebula', tier: 'vip'},
  }), false);
});

function signedToken(value, privateKey) {
  const encoded = encodeLicensePayload(value);
  const signature = crypto.sign(null, Buffer.from(encoded, 'ascii'), privateKey).toString('base64url');
  return `${encoded}.${signature}`;
}

async function invokeApi(studio, pathname, {method = 'GET', body = null, token = studio.token} = {}) {
  studio.port ??= 32145;
  const bytes = body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const request = Readable.from(bytes.length ? [bytes] : []);
  request.method = method;
  request.headers = {
    host: `${studio.host}:${studio.port}`,
    ...(token === null ? {} : {authorization: `Bearer ${token}`}),
    ...(body === null ? {} : {'content-type': 'application/json', 'content-length': String(bytes.length)}),
  };
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: null,
      writeHead(statusCode) { this.statusCode = statusCode; },
      setHeader() {},
      end(value = '') {
        try { resolve({status: this.statusCode, body: JSON.parse(String(value))}); }
        catch (error) { reject(error); }
      },
    };
    studio.api(request, response, new URL(pathname, `http://${studio.host}:${studio.port}`)).catch(reject);
  });
}

function localOnlyCommerceBridge() {
  return {
    leaseSigningPublicKey: null,
    publicConfiguration() {
      return {
        productPortalUrls: {},
        redemptionEnabled: false,
        refreshEnabled: false,
        deactivationEnabled: false,
        secretStorage: null,
      };
    },
    async deactivate() { return {deactivated: 0}; },
    async purgeLocal() {},
  };
}

function memorySecretStore(initialValue = null) {
  let value = initialValue;
  return {
    available: true,
    async get() { return value; },
    async set(_service, _account, next) { value = next; },
    async delete() { value = null; },
  };
}

test('the zero-byte 2.3.10 Keychain bug migrates through the next verified redemption', async () => {
  const secretStore = memorySecretStore('');
  const skinProduct = PRODUCT_CATALOG.find((product) => product.offerType === 'skin_once');
  const bridge = createDirectDodoCommerceBridge({
    secretStore,
    fetchImpl: async (url) => {
      assert.match(String(url), /licenses\/activate$/u);
      return new Response(JSON.stringify({
        id: 'activation-instance-recovered',
        license_key_id: 'license-record-recovered',
        product: {product_id: skinProduct.dodoProductId},
      }), {status: 201, headers: {'content-type': 'application/json'}});
    },
    clock: () => new Date('2026-07-24T07:00:00.000Z'),
  });
  await bridge.initialize();
  assert.equal(bridge.legacyEmptyVaultDetected, true);
  assert.equal(bridge.currentEntitlement().status, 'missing');

  await bridge.redeem({
    licenseKey: 'TEST-RECOVER-ZERO-BYTE-VAULT',
    skinId: 'agent-codex-terminal-orbit',
  });
  const structured = JSON.parse(await secretStore.get());
  assert.equal(structured.schemaVersion, 1);
  assert.equal(structured.records.length, 1);
  assert.equal(structured.records[0].binding.skinId, 'agent-codex-terminal-orbit');
  assert.deepEqual(bridge.currentEntitlement().skinIds, ['agent-codex-terminal-orbit']);
});

test('a malformed Keychain authorization record cannot take down the embedded local service', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-keychain-degraded-start-'));
  let started;
  try {
    started = await startStudioServer({
      dataDir,
      runtimeIdentity: 'c'.repeat(64),
      commerceSecretStore: memorySecretStore('legacy-or-damaged-record'),
      commerceTransport: async () => new Response('{}', {status: 503}),
    });
  } catch (error) {
    if (error.code === 'EPERM' && String(error.message).includes('listen')) {
      t.skip('当前测试沙箱禁止监听 127.0.0.1');
      return;
    }
    throw error;
  }
  t.after(() => started.studio.shutdown());
  assert.equal(started.host, '127.0.0.1');
  assert.equal(started.studio.commerceInitializationError?.code, 'KEYCHAIN_VAULT_INVALID');
  assert.match(started.studio.commerceInitializationError?.message ?? '', /钥匙串授权库/u);
  const response = await fetch(`http://${started.host}:${started.port}/api/status`, {
    headers: {Authorization: `Bearer ${started.token}`},
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('resubmitting the exact legacy Keychain license upgrades it only after trusted activation', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-keychain-legacy-upgrade-'));
  const legacyCode = 'TEST-LEGACY-LICENSE-ONLY';
  const secretStore = memorySecretStore(legacyCode);
  const vipProduct = PRODUCT_CATALOG.find((product) => product.offerType === 'vip_subscription');
  let started;
  try {
    started = await startStudioServer({
      dataDir,
      runtimeIdentity: 'd'.repeat(64),
      commerceSecretStore: secretStore,
      commerceTransport: async (url) => {
        assert.match(String(url), /licenses\/activate$/u);
        return new Response(JSON.stringify({
          id: 'activation-instance-1',
          license_key_id: 'license-record-1',
          product: {product_id: vipProduct.dodoProductId},
        }), {status: 200, headers: {'content-type': 'application/json'}});
      },
    });
  } catch (error) {
    if (error.code === 'EPERM' && String(error.message).includes('listen')) {
      t.skip('当前测试沙箱禁止监听 127.0.0.1');
      return;
    }
    throw error;
  }
  t.after(() => started.studio.shutdown());
  assert.equal(started.studio.commerceInitializationError?.code, 'KEYCHAIN_VAULT_INVALID');
  const response = await fetch(`http://${started.host}:${started.port}/api/license/activate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${started.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({code: legacyCode}),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entitlement.tier, 'vip');
  assert.equal(started.studio.commerceInitializationError, null);
  const structured = JSON.parse(await secretStore.get());
  assert.equal(structured.schemaVersion, 1);
  assert.equal(structured.records.length, 1);
  assert.notEqual(structured.records[0].codeHash, legacyCode);
});

test('product cards return from immutable local metadata while remote redemption skins refresh in background', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-fast-products-'));
  const studio = new StudioServer({dataDir, commerceBridge: localOnlyCommerceBridge()});
  let finishCatalogRefresh;
  let catalogRefreshStarted = false;
  studio.catalogSkins = async () => new Promise((resolve) => {
    catalogRefreshStarted = true;
    finishCatalogRefresh = () => resolve([
      {id: 'remote-vip', name: 'Remote VIP', tier: 'vip'},
      {id: 'remote-free', name: 'Remote Free', tier: 'free'},
    ]);
  });

  const fastResponse = await Promise.race([
    invokeApi(studio, '/api/products'),
    new Promise((resolve) => setTimeout(() => resolve(null), 250)),
  ]);
  assert.notEqual(fastResponse, null, '商品卡片不能等待远程皮肤目录');
  assert.equal(fastResponse.status, 200);
  assert.equal(fastResponse.body.products.length, 4);
  assert.equal(catalogRefreshStarted, false, '商品响应必须先于皮肤目录物化');

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(catalogRefreshStarted, true);
  assert.equal(typeof finishCatalogRefresh, 'function');

  finishCatalogRefresh();
  await studio.productRedemptionSkinsRefresh;
  assert.deepEqual(studio.productRedemptionSkins.map(({id}) => id), ['remote-vip']);
});

test('first entitlement resolution grants one private seven-day local VIP trial without creating a paid lease', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-first-use-trial-server-'));
  let now = new Date('2026-07-17T00:00:00.000Z');
  const studio = new StudioServer({
    dataDir,
    clock: () => now,
    commerceBridge: localOnlyCommerceBridge(),
  });

  const first = studio.publicEntitlement();
  assert.equal(first.tier, 'vip');
  assert.equal(first.source, 'local-trial');
  assert.equal(first.status, 'trial-active');
  assert.equal(first.license, null);
  assert.equal(first.permissions.allFeatures, true);
  assert.equal(first.trial.kind, 'local-first-use');
  assert.equal(first.trial.state, 'active');
  assert.equal(first.trial.startedAt, '2026-07-17T00:00:00.000Z');
  assert.equal(first.trial.expiresAt, '2026-07-24T00:00:00.000Z');
  assert.equal(first.trial.remainingSeconds, 7 * 24 * 60 * 60);
  studio.skinTrialStore.consume('already-tried-vip', 'codex');
  assert.deepEqual(
    studio.skinAccess({id: 'already-tried-vip', tier: 'vip'}),
    {allowed: true, mode: 'owned'},
  );
  const trialPath = path.join(dataDir, 'local-vip-trial.json');
  const beforeRemoval = fs.readFileSync(trialPath, 'utf8');
  assert.equal(fs.lstatSync(trialPath).mode & 0o777, 0o600);

  // Neither ordinary device deactivation nor removing an authorization cache
  // is allowed to delete or recreate the first-use marker.
  const deactivated = await invokeApi(studio, '/api/license/deactivate', {method: 'POST', body: {}});
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.entitlement.source, 'local-trial');
  assert.equal(fs.readFileSync(trialPath, 'utf8'), beforeRemoval);

  const removed = await invokeApi(studio, '/api/license/remove', {method: 'POST', body: {}});
  assert.equal(removed.status, 200);
  assert.equal(removed.body.entitlement.source, 'local-trial');
  assert.equal(removed.body.entitlement.trial.startedAt, first.trial.startedAt);
  assert.equal(fs.readFileSync(trialPath, 'utf8'), beforeRemoval);

  now = new Date('2026-07-24T00:00:00.000Z');
  const expired = studio.publicEntitlement();
  assert.equal(expired.tier, 'free');
  assert.equal(expired.source, 'default');
  assert.equal(expired.trial.state, 'expired');
  assert.equal(expired.trial.remainingSeconds, 0);
});

test('an available per-skin trial never bypasses the VIP or permanent purchase gate', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-no-skin-trial-bypass-'));
  const studio = new StudioServer({
    dataDir,
    commerceBridge: localOnlyCommerceBridge(),
    trialStore: {
      resolve() {
        return {
          schemaVersion: 1,
          startedAt: '2026-07-01T00:00:00.000Z',
          expiresAt: '2026-07-08T00:00:00.000Z',
          maxObservedAt: '2026-07-24T00:00:00.000Z',
          state: 'expired',
          active: false,
          observedAt: '2026-07-24T00:00:00.000Z',
          remainingSeconds: 0,
          durationDays: 7,
        };
      },
    },
    skinTrialStore: {
      status() { return {state: 'available'}; },
      consume() { throw new Error('per-skin trial must not be consumed'); },
    },
  });
  assert.deepEqual(studio.skinAccess({id: 'free-skin', tier: 'free'}), {allowed: true, mode: 'owned'});
  assert.deepEqual(studio.skinAccess({id: 'vip-skin', tier: 'vip'}), {allowed: false, mode: 'denied'});
  assert.equal(studio.catalogAccessCard({id: 'vip-skin', tier: 'vip'}).vipTrialState, 'denied');
});

test('an active trial preserves permanent bindings, while a true paid VIP subscription takes precedence', () => {
  const now = new Date('2026-07-17T00:00:00.000Z');
  const permanentPair = crypto.generateKeyPairSync('ed25519');
  const permanentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-permanent-plus-trial-'));
  const permanentLease = signedToken({
    schemaVersion: 2,
    licenseId: 'permanent-trial-lease',
    audience: 'codex-skin-studio',
    subject: 'permanent-owner',
    issuedAt: '2026-07-17T00:00:00.000Z',
    notBefore: '2026-07-17T00:00:00.000Z',
    expiresAt: '2027-07-17T00:00:00.000Z',
    clientIds: ['codex', 'workbuddy', 'doubao'],
    grants: [{
      grantId: 'permanent-skin-grant',
      offerType: 'skin_once',
      status: 'active',
      productId: 'pdt_skin_once',
      binding: {skinId: 'violet-nebula'},
      boundAt: '2026-07-17T00:00:00.000Z',
      validUntil: null,
      revokedAt: null,
    }],
  }, permanentPair.privateKey);
  fs.writeFileSync(path.join(permanentDir, 'entitlement-lease.txt'), `${permanentLease}\n`, {mode: 0o600});
  let permanentNow = now;
  const permanentStudio = new StudioServer({
    dataDir: permanentDir,
    licensePublicKey: permanentPair.publicKey,
    clock: () => permanentNow,
    commerceBridge: localOnlyCommerceBridge(),
  });
  const combined = permanentStudio.publicEntitlement();
  assert.equal(combined.source, 'local-trial');
  assert.equal(combined.tier, 'vip');
  assert.equal(combined.license.licenseId, 'permanent-trial-lease');
  assert.deepEqual(combined.skinIds, ['violet-nebula']);
  assert.equal(combined.permissions.allFeatures, true);

  permanentNow = new Date('2026-07-25T00:00:00.000Z');
  const afterTrial = permanentStudio.publicEntitlement();
  assert.equal(afterTrial.source, 'license');
  assert.equal(afterTrial.tier, 'free');
  assert.deepEqual(afterTrial.skinIds, ['violet-nebula']);
  assert.equal(afterTrial.permissions.vipCatalog, false);

  const vipPair = crypto.generateKeyPairSync('ed25519');
  const vipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-paid-vip-precedence-'));
  const paidVip = signedToken({
    schemaVersion: 1,
    licenseId: 'paid-vip-lease',
    tier: 'vip',
    audience: 'codex-skin-studio',
    subject: 'vip-owner',
    issuedAt: '2026-07-17T00:00:00.000Z',
    notBefore: '2026-07-17T00:00:00.000Z',
    expiresAt: '2026-08-17T00:00:00.000Z',
    clientIds: ['codex', 'workbuddy', 'doubao'],
  }, vipPair.privateKey);
  fs.writeFileSync(path.join(vipDir, 'entitlement-lease.txt'), `${paidVip}\n`, {mode: 0o600});
  const vipStudio = new StudioServer({
    dataDir: vipDir,
    licensePublicKey: vipPair.publicKey,
    clock: () => now,
    commerceBridge: localOnlyCommerceBridge(),
  });
  const paid = vipStudio.publicEntitlement();
  assert.equal(paid.source, 'license');
  assert.equal(paid.status, 'valid');
  assert.equal(paid.tier, 'vip');
  assert.equal(paid.license.licenseId, 'paid-vip-lease');
  assert.equal(paid.trial.state, 'active');
});

test('commerce sync accepts a verified permanent lease composed with trial rights, never a bare trial', async () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-trial-commerce-sync-'));
  const lease = signedToken({
    schemaVersion: 2,
    licenseId: 'redeemed-permanent-lease',
    audience: 'codex-skin-studio',
    subject: 'redeemed-owner',
    issuedAt: '2026-07-17T00:00:00.000Z',
    notBefore: '2026-07-17T00:00:00.000Z',
    expiresAt: '2027-07-17T00:00:00.000Z',
    clientIds: ['codex', 'workbuddy', 'doubao'],
    grants: [{
      grantId: 'redeemed-permanent-skin',
      offerType: 'skin_once',
      status: 'active',
      productId: 'pdt_skin_once',
      binding: {skinId: 'violet-nebula'},
      boundAt: '2026-07-17T00:00:00.000Z',
      validUntil: null,
      revokedAt: null,
    }],
  }, pair.privateKey);
  const bridge = {
    ...localOnlyCommerceBridge(),
    async redeem() {
      fs.writeFileSync(path.join(dataDir, 'entitlement-lease.txt'), `${lease}\n`, {mode: 0o600});
    },
    async refresh() {
      fs.writeFileSync(path.join(dataDir, 'entitlement-lease.txt'), `${lease}\n`, {mode: 0o600});
    },
  };
  const studio = new StudioServer({
    dataDir,
    licensePublicKey: pair.publicKey,
    clock: () => new Date('2026-07-17T00:00:00.000Z'),
    commerceBridge: bridge,
  });

  const redeemed = await invokeApi(studio, '/api/license/activate', {
    method: 'POST', body: {code: 'test-permanent-license'},
  });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.body.entitlement.source, 'local-trial');
  assert.equal(redeemed.body.entitlement.status, 'trial-active');
  assert.equal(redeemed.body.entitlement.license.licenseId, 'redeemed-permanent-lease');
  assert.deepEqual(redeemed.body.entitlement.skinIds, ['violet-nebula']);

  const refreshed = await invokeApi(studio, '/api/license/refresh', {method: 'POST', body: {}});
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.entitlement.license.licenseId, 'redeemed-permanent-lease');

  const bareTrialDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-bare-trial-commerce-sync-'));
  const bareTrial = new StudioServer({
    dataDir: bareTrialDir,
    clock: () => new Date('2026-07-17T00:00:00.000Z'),
    commerceBridge: {...localOnlyCommerceBridge(), async redeem() {}},
  });
  const rejected = await invokeApi(bareTrial, '/api/license/activate', {
    method: 'POST', body: {code: 'does-not-write-a-lease'},
  });
  assert.notEqual(rejected.status, 200);
  assert.match(rejected.body.error, /已验签租约未能加载/u);
});

test('after the local trial expires, server exposes v2 permanent grants and still reads a legacy VIP license file', () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-entitlement-server-'));
  const token = signedToken({
    schemaVersion: 2,
    licenseId: 'lease-server-001',
    audience: 'codex-skin-studio',
    subject: 'customer-server-001',
    issuedAt: '2026-07-16T00:00:00Z',
    notBefore: '2026-07-16T00:00:00Z',
    expiresAt: '2099-07-17T00:00:00Z',
    clientIds: ['codex', 'workbuddy', 'doubao'],
    grants: [{
      grantId: 'grant-server-skin',
      offerType: 'skin_once',
      status: 'active',
      productId: 'pdt_violet_nebula',
      binding: {skinId: 'violet-nebula'},
      boundAt: '2026-07-01T00:00:00Z',
      validUntil: null,
      revokedAt: null,
    }],
  }, pair.privateKey);
  fs.writeFileSync(path.join(dataDir, 'entitlement-lease.txt'), `${token}\n`, {mode: 0o600});
  const expiredTrialStore = {
    resolve() {
      return {
        schemaVersion: 1,
        startedAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2026-07-08T00:00:00.000Z',
        maxObservedAt: '2026-07-17T00:00:00.000Z',
        state: 'expired',
        active: false,
        observedAt: '2026-07-17T00:00:00.000Z',
        remainingSeconds: 0,
        durationDays: 7,
      };
    },
  };
  const studio = new StudioServer({
    dataDir,
    licensePublicKey: pair.publicKey,
    trialStore: expiredTrialStore,
    commerceBridge: localOnlyCommerceBridge(),
  });
  const entitlement = studio.publicEntitlement();
  assert.equal(entitlement.tier, 'free');
  assert.deepEqual(entitlement.skinIds, ['violet-nebula']);
  assert.deepEqual(entitlement.customProfileIds, []);
  assert.equal(entitlement.license.schemaVersion, 2);
  assert.deepEqual(entitlement.license.grants[0].binding, {skinId: 'violet-nebula'});

  fs.unlinkSync(path.join(dataDir, 'entitlement-lease.txt'));
  const legacyToken = signedToken({
    schemaVersion: 1,
    licenseId: 'legacy-vip-001',
    tier: 'vip',
    audience: 'codex-skin-studio',
    subject: 'legacy-user',
    issuedAt: '2026-01-01T00:00:00Z',
    notBefore: '2026-01-01T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
    clientIds: ['codex', 'workbuddy', 'doubao'],
  }, pair.privateKey);
  fs.writeFileSync(path.join(dataDir, 'vip-license.txt'), `${legacyToken}\n`, {mode: 0o600});
  assert.equal(studio.publicEntitlement().tier, 'vip');
});

test('server keeps brand identity WorkBuddy-only but shares the free composer mascot across Agents', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-free-brand-server-'));
  saveFreeBrand({
    displayName: 'My Buddy',
    tagline: 'My superpower',
    iconImage: onePixelPng,
    composerAvatarImage: goodComposerWebp,
  }, dataDir);
  saveProfile({id: 'private-skin', name: 'Private Skin'}, dataDir);
  saveUnionProfile(unionProfile({
    id: 'union-workbuddy',
    name: 'Union WorkBuddy',
    targetClientId: 'workbuddy',
    values: {'brand.enabled': false, 'appearance.accent': '#123456'},
  }), dataDir);
  const studio = new StudioServer({dataDir});

  const builtIn = studio.resolveSkin('dream-portal', 'workbuddy');
  assert.equal(builtIn.profile.advanced.brand.enabled, true);
  assert.equal(builtIn.profile.advanced.brand.displayName, 'My Buddy');
  assert.equal(builtIn.profile.advanced.brand.iconImage, onePixelPng);
  assert.deepEqual(builtIn.profile.advanced.workbuddy.homeCopy, {title: 'My Buddy', subtitle: 'My superpower'});
  assert.equal(builtIn.profile.advanced.workbuddy.composerAvatar.image, goodComposerWebp);
  assert.equal(builtIn.profile.advanced.brand.shortMark, 'DP');
  assert.equal(builtIn.profile.advanced.brand.logoStyle, 'diamond');

  const custom = studio.resolveSkin('private-skin', 'workbuddy');
  assert.equal(custom.profile.advanced.brand.displayName, 'My Buddy');
  assert.equal(custom.profile.advanced.brand.iconImage, onePixelPng);

  const union = studio.resolveSkin('union-workbuddy', 'workbuddy');
  assert.equal(union.profileKind, 'union');
  assert.equal(union.profile.official.accent, '#123456');
  assert.equal(union.profile.advanced.brand.enabled, true);
  assert.equal(union.profile.advanced.brand.displayName, 'My Buddy');
  assert.equal(union.profile.advanced.brand.iconImage, onePixelPng);

  const codex = studio.resolveSkin('dream-portal', 'codex');
  assert.equal(codex.profile.advanced.brand.displayName, 'Dream Portal');
  assert.equal(codex.profile.advanced.brand.iconImage, null);
  assert.equal(codex.profile.advanced.workbuddy.composerAvatar.image, goodComposerWebp);

  const doubao = studio.resolveSkin('aurora-free', 'doubao');
  assert.equal(doubao.profile.advanced.workbuddy.composerAvatar.image, goodComposerWebp);
});

test('Codex official-theme export reads only a persisted Codex union profile and never needs a target session', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-codex-theme-export-'));
  const stored = saveUnionProfile(unionProfile({
    id: 'codex-theme-export',
    name: '只导出官方主题',
    targetClientId: 'codex',
    values: {
      'advanced.enabled': true,
      'appearance.variant': 'light',
      'appearance.accent': '#123456',
      'appearance.surface': '#FAFAFA',
      'appearance.ink': '#102030',
      'appearance.contrast': 62,
      'typography.codeFont': 'JetBrains Mono',
      'typography.uiFont': 'Inter',
      'window.opaque': false,
      'semantic.diffAdded': '#12AB34',
      'semantic.diffRemoved': '#CD3456',
      'semantic.skill': '#7654DC',
      'codex.codeThemeId': 'dracula',
      // These are valid union values, but they are intentionally not part of
      // the public Codex official-theme payload.
      'background.image': onePixelPng,
      'codex.banner.enabled': true,
    },
  }), dataDir);
  const before = fs.readFileSync(path.join(dataDir, 'union-profiles', `${stored.id}.json`), 'utf8');
  const studio = new StudioServer({dataDir});

  const denied = await invokeApi(
    studio,
    `/api/union-profiles/${stored.id}/codex-official-theme`,
    {token: null},
  );
  assert.equal(denied.status, 401);
  assert.equal(denied.body.ok, false);

  const result = await invokeApi(studio, `/api/union-profiles/${stored.id}/codex-official-theme`);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.profileId, stored.id);
  assert.equal(result.body.targetClientId, 'codex');
  assert.equal(result.body.format, 'codex-theme-v1');
  assert.equal(result.body.manualImport, true);
  assert.match(result.body.themeString, /^codex-theme-v1:/u);
  assert.match(result.body.instructions.join(' '), /手动导入/u);
  assert.match(result.body.instructions.join(' '), /不会启动、连接、重启、注入或修改 Codex/u);
  const theme = JSON.parse(result.body.themeString.slice('codex-theme-v1:'.length));
  assert.deepEqual(theme, {
    codeThemeId: 'dracula',
    theme: {
      accent: '#123456',
      contrast: 62,
      fonts: {code: 'JetBrains Mono', ui: 'Inter'},
      ink: '#102030',
      opaqueWindows: false,
      semanticColors: {diffAdded: '#12AB34', diffRemoved: '#CD3456', skill: '#7654DC'},
      surface: '#FAFAFA',
    },
    variant: 'light',
  });
  assert.equal(result.body.themeString.includes('data:image/'), false);
  assert.equal(result.body.themeString.includes('banner'), false);
  assert.ok(result.body.includedFieldIds.includes('codex.codeThemeId'));
  assert.ok(result.body.deferredFieldIds.includes('background.image'));
  assert.ok(result.body.deferredFieldIds.includes('codex.banner.enabled'));
  assert.equal(studio.managers.get('codex').status().mode, null);
  assert.equal(
    fs.readFileSync(path.join(dataDir, 'union-profiles', `${stored.id}.json`), 'utf8'),
    before,
    'export must not mutate the persisted profile',
  );
  assert.deepEqual(getUnionProfile(stored.id, dataDir), stored);

  saveUnionProfile(unionProfile({
    id: 'workbuddy-theme-export',
    targetClientId: 'workbuddy',
  }), dataDir);
  const crossClient = await invokeApi(
    studio,
    '/api/union-profiles/workbuddy-theme-export/codex-official-theme',
  );
  assert.equal(crossClient.status, 400);
  assert.equal(crossClient.body.code, 'CODEX_THEME_CLIENT_MISMATCH');

  const missing = await invokeApi(studio, '/api/union-profiles/not-saved/codex-official-theme');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'CODEX_THEME_PROFILE_NOT_FOUND');
});

test('server status keeps absent Doubao blocked while exposing only the exact random-loopback implementation', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-doubao-server-'));
  const studio = new StudioServer({dataDir});
  const status = studio.statusPayload();
  assert.deepEqual(Object.keys(status.clients), TARGET_CLIENT_IDS);
  assert.equal(status.clients.doubao.clientId, 'doubao');
  assert.equal(status.clients.doubao.displayName, '豆包');
  assert.deepEqual(status.clients.doubao.capabilities, []);
  assert.equal(status.clients.doubao.compatibility.level, 'blocked');
  assert.equal(status.safety.doubaoInternalPort49853Accepted, false);
  assert.equal(status.safety.doubaoLoopbackFallbackImplemented, true);
  assert.equal(status.safety.doubaoLoopbackPolicy, 'random-high-port-127.0.0.1-exact-adapter-only');
});

test('available Doubao accepts an exactly bound permanent custom-slot profile', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-blocked-union-save-'));
  const studio = new StudioServer({dataDir});
  studio.entitlementOverride = {
    tier: 'free',
    source: 'license',
    status: 'valid',
    license: null,
    permissions: {...PERMISSION_MATRIX.free, custom: true},
    activeGrants: [{
      grantId: 'blocked-slot-grant',
      offerType: 'custom_slot_once',
      status: 'active',
      productId: 'pdt_custom_slot',
      binding: {profileId: 'blocked-doubao-slot'},
      boundAt: '2026-07-17T00:00:00Z',
      validUntil: null,
      revokedAt: null,
    }],
    skinIds: [],
    customProfileIds: ['blocked-doubao-slot'],
  };
  const result = await invokeApi(studio, '/api/union-profiles', {
    method: 'POST',
    body: unionProfile({
      id: 'blocked-doubao-slot',
      name: '豆包预览草稿',
      targetClientId: 'doubao',
      values: {'appearance.accent': '#2F9E67'},
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.profile.id, 'blocked-doubao-slot');
  assert.equal(result.body.profile.targetClientId, 'doubao');
  assert.equal(fs.existsSync(path.join(dataDir, 'union-profiles', 'blocked-doubao-slot.json')), true);
  assert.equal(studio.resolveSkin('blocked-doubao-slot', 'doubao')?.profileKind, 'union');
});

test('available Doubao refuses the blocked-Agent draft-only store', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-blocked-union-draft-'));
  const studio = new StudioServer({dataDir});
  studio.entitlementOverride = {
    tier: 'free',
    source: 'license',
    status: 'valid',
    license: null,
    permissions: {...PERMISSION_MATRIX.free, custom: true},
    activeGrants: [{
      grantId: 'draft-slot-grant',
      offerType: 'custom_slot_once',
      status: 'active',
      productId: 'pdt_custom_slot',
      binding: {profileId: 'blocked-doubao-draft'},
      boundAt: '2026-07-17T00:00:00Z',
      validUntil: null,
      revokedAt: null,
    }],
    skinIds: [],
    customProfileIds: ['blocked-doubao-draft'],
  };
  const draft = unionProfile({
    id: 'blocked-doubao-draft',
    name: '豆包可保存草稿',
    targetClientId: 'doubao',
    futureMetadata: {editorRevision: 7},
    values: {
      'appearance.accent': '#2F9E67',
      'doubao.homeHero.image': onePixelPng,
      'future.renderer.option': {preserve: true},
    },
  });
  const saved = await invokeApi(studio, '/api/union-profile-drafts', {method: 'POST', body: draft});
  assert.equal(saved.status, 400);
  assert.match(saved.body.error, /已可安全应用/u);
  assert.equal(fs.existsSync(path.join(dataDir, 'union-profile-drafts', `${draft.id}.json`)), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'union-profiles', `${draft.id}.json`)), false);
});

test('catalog cards carry integrity-checked artwork and summary responses omit heavy previews', async () => {
  const studio = new StudioServer({dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-art-preview-'))});
  const workbuddyArtwork = (await studio.catalogSkins('workbuddy')).find((skin) => skin.id === 'dream-portal');
  const footballArtwork = (await studio.catalogSkins('codex')).find((skin) => skin.id === 'cr7-portugal');
  for (const card of [workbuddyArtwork, footballArtwork]) {
    assert.equal(card.hasArtwork, true);
    const preview = card.previewArtwork ?? card.previewArtworkURL;
    assert.match(preview, /^(?:data:image\/webp;base64,|https:\/\/raw\.githubusercontent\.com\/)/u);
  }
  const summary = await invokeApi(studio, '/api/catalog?clientId=workbuddy&artwork=summary');
  assert.equal(summary.status, 200);
  assert.ok(summary.body.skins.length > 0);
  assert.equal(summary.body.skins.every((skin) => skin.previewArtwork === null), true);
});

test('desktop direct commerce ignores merchant secrets and Product IDs can never activate entitlements', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-desktop-commerce-closed-'));
  const secretStore = memorySecretStore();
  const studio = new StudioServer({
    dataDir,
    // Trusted-service secrets are intentionally ignored by the desktop host.
    commerceEnv: {
      DODO_PAYMENTS_API_KEY: 'must-not-enable-desktop',
      DODO_PAYMENTS_WEBHOOK_KEY: 'must-not-enable-desktop',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
    commerceSecretStore: secretStore,
    commerceTransport: async () => new Response(JSON.stringify({error: 'not a license key'}), {
      status: 404,
      headers: {'content-type': 'application/json'},
    }),
  });
  assert.equal(studio.products.commerce.status, 'direct-live');
  assert.equal(studio.products.commerce.configured, true);
  assert.equal(studio.products.commerce.checkoutEnabled, true);
  assert.equal(studio.products.products.every((product) =>
    product.purchaseUrl?.startsWith('https://checkout.dodopayments.com/buy/') === true
  ), true);
  assert.equal(studio.products.redemptionSkins.every((skin) => skin.tier === 'vip'), true);
  assert.equal(studio.products.redemptionSkins.some((skin) => skin.id === 'dream-portal'), false);

  const attempt = await invokeApi(studio, '/api/license/activate', {
    method: 'POST',
    body: {code: 'pdt_0NjWZqz1TDby1TNwWNDrb'},
  });
  assert.equal(attempt.status, 400);
  assert.notEqual(attempt.body.ok, true);
  assert.equal(fs.existsSync(path.join(dataDir, 'entitlement-lease.txt')), false);
});

test('dashboard binds to loopback and API requires the in-memory token', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-server-'));
  const runtimeIdentity = 'a'.repeat(64);
  let started;
  try {
    started = await startStudioServer({
      dataDir,
      runtimeIdentity,
      commerceSecretStore: memorySecretStore(),
      commerceTransport: async () => new Response(JSON.stringify({error: 'unused'}), {status: 503}),
    });
  } catch (error) {
    if (error.code === 'EPERM' && String(error.message).includes('listen')) {
      t.skip('当前测试沙箱禁止监听 127.0.0.1');
      return;
    }
    throw error;
  }
  const {studio, host, port, token} = started;
  t.after(() => studio.shutdown());
  assert.equal(host, '127.0.0.1');
  const base = `http://${host}:${port}`;
  const unauthenticated = await fetch(`${base}/api/status`);
  assert.equal(unauthenticated.status, 401);
  const status = await fetch(`${base}/api/status`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  assert.equal(status.status, 200);
  const payload = await status.json();
  assert.equal(payload.safety.dashboardHost, '127.0.0.1');
  assert.equal(payload.studio.runtimeIdentity, runtimeIdentity);
  assert.equal(payload.safety.arbitraryJavaScriptAccepted, false);
  assert.equal(payload.safety.tcpFallbackAccepted, false);
  assert.equal(typeof payload.loginAgent.state, 'string');
  const sameRuntime = await existingStudio(dataDir, {runtimeIdentity});
  assert.equal(sameRuntime?.reused, true, '同一运行时身份才可复用本地后端');
  const differentRuntime = await existingStudio(dataDir, {runtimeIdentity: 'b'.repeat(64)});
  assert.equal(differentRuntime, null, '不同签名包的后端不得被复用');
  const products = await fetch(`${base}/api/products`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  assert.equal(products.status, 200);
  const productsPayload = await products.json();
  assert.equal(productsPayload.schemaVersion, 1);
  assert.equal(productsPayload.provider, 'dodo_payments');
  assert.equal(productsPayload.commerce.status, 'direct-live');
  assert.equal(productsPayload.commerce.checkoutEnabled, true);
  assert.deepEqual(productsPayload.products.map(({offerType}) => offerType), [
    'vip_subscription', 'vip_subscription', 'skin_once', 'custom_slot_once',
  ]);
  const workbuddyCatalog = await fetch(`${base}/api/catalog?clientId=workbuddy`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  assert.equal(workbuddyCatalog.status, 200);
  const workbuddyCatalogPayload = await workbuddyCatalog.json();
  assert.equal(workbuddyCatalogPayload.skins.length, 39);
  assert.equal(['cr7-portugal', 'messi-argentina', 'neymar-brazil'].every((id) =>
    workbuddyCatalogPayload.skins.some((skin) => skin.id === id && skin.kind === 'theme-pack')
  ), true);
  const doubaoCatalog = await fetch(`${base}/api/catalog?clientId=doubao`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  assert.equal(doubaoCatalog.status, 200);
  const doubaoCatalogPayload = await doubaoCatalog.json();
  assert.equal(doubaoCatalogPayload.skins.length, 32);
  assert.equal(['cr7-portugal', 'messi-argentina', 'neymar-brazil'].every((id) =>
    doubaoCatalogPayload.skins.some((skin) => skin.id === id)
  ), true);
  assert.equal(doubaoCatalogPayload.skins.every(({applySupported, designPreview}) =>
    applySupported === true && designPreview === false
  ), true);
  const capabilitySchema = await fetch(`${base}/api/capability-schema?clientId=workbuddy`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  assert.equal(capabilitySchema.status, 200);
  const capabilityPayload = await capabilitySchema.json();
  assert.equal(capabilityPayload.schemaVersion, 1);
  assert.deepEqual(capabilityPayload.clientIds, ['workbuddy', 'doubao', 'codex']);
  assert.equal(capabilityPayload.capabilityMap.clientId, 'workbuddy');
  assert.equal(capabilityPayload.editorProjection.targetClientId, 'workbuddy');
  assert.equal(capabilityPayload.editorProjection.fields.some((field) =>
    field.id === 'workbuddy.projectHero.image' && field.editable === true
  ), true);
  const doubaoSchema = await fetch(`${base}/api/capability-schema?clientId=doubao`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  const doubaoSchemaPayload = await doubaoSchema.json();
  assert.equal(doubaoSchemaPayload.capabilityMap.runtimeStatus, 'available');
  assert.deepEqual(doubaoSchemaPayload.capabilityMap.capabilities, [
    'background', 'palette', 'glass', 'composer-avatar',
  ]);
  assert.ok(doubaoSchemaPayload.editorProjection.fields.some((field) =>
    field.id === 'appearance.accent' && field.editable === true && field.supportStatus === 'supported'));
  assert.ok(doubaoSchemaPayload.editorProjection.fields.some((field) =>
    field.id === 'doubao.assistantAvatar.image' && field.supportStatus === 'pending'));

  const inMemoryProfile = unionProfile({
    id: 'memory-preview',
    name: 'Memory Preview',
    targetClientId: 'workbuddy',
    values: {'advanced.enabled': true, 'appearance.accent': '#102030'},
  });
  studio.entitlementOverride = {
    tier: 'free',
    source: 'none',
    status: 'missing',
    license: null,
    permissions: PERMISSION_MATRIX.free,
    activeGrants: [],
    skinIds: [],
    customProfileIds: [],
  };
  const freePreview = await fetch(`${base}/api/preview`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({clientId: 'workbuddy', unionProfile: inMemoryProfile}),
  });
  assert.equal(freePreview.status, 200);
  assert.equal((await freePreview.json()).profile.official.accent, '#102030');
  assert.equal(fs.existsSync(path.join(dataDir, 'union-profiles')), false);

  const deniedUnionSave = await fetch(`${base}/api/union-profiles`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(inMemoryProfile),
  });
  assert.equal(deniedUnionSave.status, 409);
  assert.equal((await deniedUnionSave.json()).code, 'VIP_REQUIRED');

  const customGrant = {
    grantId: 'grant-bound-profile',
    offerType: 'custom_slot_once',
    status: 'active',
    productId: 'pdt_custom_slot',
    binding: {profileId: 'bound-profile'},
    boundAt: '2026-07-01T00:00:00Z',
    validUntil: null,
    revokedAt: null,
  };
  studio.entitlementOverride = {
    tier: 'free',
    source: 'license',
    status: 'valid',
    license: null,
    permissions: {...PERMISSION_MATRIX.free, custom: true},
    activeGrants: [customGrant],
    skinIds: [],
    customProfileIds: ['bound-profile'],
  };
  const boundProfile = unionProfile({
    values: {
      'advanced.enabled': true,
      'appearance.accent': '#203040',
      'typography.uiFont': 'Future UI Font',
      'future.visual.sparkle': {enabled: true},
    },
    futureMetadata: {source: 'api-test'},
  });
  const savedBound = await fetch(`${base}/api/union-profiles`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({profile: boundProfile}),
  });
  assert.equal(savedBound.status, 200);
  const savedBoundPayload = await savedBound.json();
  assert.equal(savedBoundPayload.created, true);
  assert.deepEqual(savedBoundPayload.profile.values['future.visual.sparkle'], {enabled: true});
  assert.deepEqual(savedBoundPayload.profile.futureMetadata, {source: 'api-test'});
  const updatedBound = await fetch(`${base}/api/union-profiles`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      ...savedBoundPayload.profile,
      name: 'Bound Profile Updated',
      values: {...savedBoundPayload.profile.values, 'appearance.accent': '#304050'},
    }),
  });
  assert.equal(updatedBound.status, 200);
  const updatedBoundPayload = await updatedBound.json();
  assert.equal(updatedBoundPayload.created, false);
  assert.equal(updatedBoundPayload.profile.name, 'Bound Profile Updated');
  assert.deepEqual(updatedBoundPayload.profile.values['future.visual.sparkle'], {enabled: true});

  const deniedDifferentSlot = await fetch(`${base}/api/union-profiles`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(unionProfile({id: 'client-selected-id'})),
  });
  assert.equal(deniedDifferentSlot.status, 409);
  assert.equal((await deniedDifferentSlot.json()).code, 'VIP_REQUIRED');
  assert.equal(fs.existsSync(path.join(dataDir, 'union-profiles', 'client-selected-id.json')), false);

  const storedProfiles = await fetch(`${base}/api/union-profiles?clientId=codex`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  const storedProfilesPayload = await storedProfiles.json();
  assert.deepEqual(storedProfilesPayload.profiles.map((profile) => profile.id), ['bound-profile']);
  assert.equal(storedProfilesPayload.profiles[0].values['typography.uiFont'], 'Future UI Font');
  const storedProjection = await fetch(
    `${base}/api/capability-schema?clientId=codex&profileId=bound-profile`,
    {headers: {Authorization: `Bearer ${token}`}},
  );
  const storedProjectionPayload = await storedProjection.json();
  assert.equal(storedProjectionPayload.editorProjection.profileId, 'bound-profile');
  assert.equal(storedProjectionPayload.editorProjection.fields.find((field) =>
    field.id === 'appearance.accent'
  ).value, '#304050');

  studio.clients.set('codex', {
    app: {
      safeToLaunch: true,
      fingerprint: {bundleId: 'com.openai.codex', version: 'test', build: 'test'},
      codeThemeIds: ['codex'],
      path: '/Applications/Codex.app',
    },
    compatibility: {
      clientId: 'codex',
      level: 'exact',
      advancedAllowed: true,
      reason: 'test adapter',
      adapter: {capabilities: ['background', 'palette', 'glass']},
      capabilities: ['background', 'palette', 'glass'],
    },
  });
  studio.refreshDoctor = () => ({ok: true});
  const unionIntent = await fetch(`${base}/api/apply-intents`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({clientId: 'codex', operation: 'apply', skinId: 'bound-profile'}),
  });
  assert.equal(unionIntent.status, 200);
  const unionIntentPayload = await unionIntent.json();
  assert.equal(unionIntentPayload.intent.summary.skinId, 'bound-profile');
  assert.equal(unionIntentPayload.intent.summary.customProfile, true);

  studio.entitlementOverride = {
    tier: 'vip',
    source: 'license',
    status: 'valid',
    license: null,
    permissions: PERMISSION_MATRIX.vip,
    activeGrants: [],
    skinIds: [],
    customProfileIds: [],
  };
  const vipSave = await fetch(`${base}/api/union-profiles`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(unionProfile({id: 'vip-created', name: 'VIP Created'})),
  });
  assert.equal(vipSave.status, 200);
  const vipSavePayload = await vipSave.json();
  assert.equal(vipSavePayload.created, true);
  const vipUpdate = await fetch(`${base}/api/union-profiles`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({...vipSavePayload.profile, name: 'VIP Updated'}),
  });
  assert.equal(vipUpdate.status, 200);
  const vipUpdatePayload = await vipUpdate.json();
  assert.equal(vipUpdatePayload.created, false);
  assert.equal(vipUpdatePayload.profile.name, 'VIP Updated');
  studio.entitlementOverride = null;
  const initialBrand = await fetch(`${base}/api/free-brand?clientId=workbuddy`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  assert.equal(initialBrand.status, 200);
  assert.deepEqual((await initialBrand.json()).freeBrand, {
    schemaVersion: 1,
    displayName: null,
    tagline: null,
    iconImage: null,
    composerAvatarImage: null,
    composerAvatarMotion: null,
    codexHomeTitle: null,
    doubaoHomeTitle: null,
    workbuddyHomeTitle: null,
    updatedAt: null,
  });
  const savedBrand = await fetch(`${base}/api/free-brand`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      clientId: 'workbuddy',
      displayName: 'Local Buddy',
      tagline: 'Local superpower',
      iconImage: onePixelPng,
      composerAvatarImage: goodComposerWebp,
      composerAvatarMotion: 'roll',
    }),
  });
  assert.equal(savedBrand.status, 200);
  const savedBrandPayload = await savedBrand.json();
  assert.equal(savedBrandPayload.clientId, 'workbuddy');
  assert.equal(savedBrandPayload.freeBrand.displayName, 'Local Buddy');
  assert.equal(savedBrandPayload.freeBrand.iconImage, onePixelPng);
  assert.equal(savedBrandPayload.freeBrand.tagline, 'Local superpower');
  assert.equal(savedBrandPayload.freeBrand.composerAvatarImage, goodComposerWebp);
  assert.equal(savedBrandPayload.freeBrand.composerAvatarMotion, 'roll');
  const remoteBrand = await fetch(`${base}/api/free-brand`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({clientId: 'workbuddy', iconImage: 'https://evil.example/logo.png'}),
  });
  assert.equal(remoteBrand.status, 400);
  const wrongBrandClient = await fetch(`${base}/api/free-brand`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({clientId: 'codex', displayName: 'Wrong'}),
  });
  assert.equal(wrongBrandClient.status, 400);
  const clearedBrand = await fetch(`${base}/api/free-brand`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({clientId: 'workbuddy', displayName: null, tagline: null, iconImage: null, composerAvatarImage: null}),
  });
  assert.equal(clearedBrand.status, 200);
  assert.equal((await clearedBrand.json()).freeBrand.iconImage, null);
  assert.equal(fs.existsSync(path.join(dataDir, 'free-brand.json')), false);
  studio.entitlementOverride = {
    tier: 'free', source: 'none', status: 'missing', license: null,
    permissions: PERMISSION_MATRIX.free, activeGrants: [], skinIds: [], customProfileIds: [],
  };
  const deniedLoginAgent = await fetch(`${base}/api/login-agent`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({action: 'install'}),
  });
  assert.equal(deniedLoginAgent.status, 409);
  assert.equal((await deniedLoginAgent.json()).code, 'VIP_REQUIRED');
  const deniedSchedule = await fetch(`${base}/api/schedule`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({schedule: {}}),
  });
  assert.equal(deniedSchedule.status, 409);
  assert.equal((await deniedSchedule.json()).code, 'VIP_REQUIRED');
  const invalidIntent = await fetch(`${base}/api/apply-intents`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({clientId: 'codex', operation: 'unexpected'}),
  });
  assert.equal(invalidIntent.status, 400);
  assert.match((await invalidIntent.json()).error, /未知的皮肤操作/u);
  assert.match(status.headers.get('content-security-policy'), /script-src 'self'/u);
  assert.doesNotMatch(status.headers.get('content-security-policy'), /unsafe-inline/u);
  const wrongOrigin = await fetch(`${base}/api/status`, {
    headers: {Authorization: `Bearer ${token}`, Origin: 'https://evil.example'},
  });
  assert.equal(wrongOrigin.status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const request = http.request({
      host, port, path: '/api/status',
      headers: {Authorization: `Bearer ${token}`, Host: `localhost:${port}`},
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
  assert.equal(wrongHostStatus, 403);
  const wrongType = await fetch(`${base}/api/profiles`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain'},
    body: '{}',
  });
  assert.equal(wrongType.status, 400);
  assert.equal(fs.statSync(path.join(dataDir, 'studio-session.json')).mode & 0o077, 0);
  assert.equal(fs.statSync(path.join(dataDir, 'studio-owner.lock')).mode & 0o077, 0);
});

test('a waiting embedded backend claims the owner lock after an older runtime exits', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-owner-handoff-'));
  const secretStore = memorySecretStore();
  const oldRuntimeIdentity = 'a'.repeat(64);
  const newRuntimeIdentity = 'b'.repeat(64);
  let oldStart;
  try {
    oldStart = await startStudioServer({
      dataDir,
      runtimeIdentity: oldRuntimeIdentity,
      commerceSecretStore: secretStore,
    });
  } catch (error) {
    if (error.code === 'EPERM' && String(error.message).includes('listen')) {
      t.skip('当前测试沙箱禁止监听 127.0.0.1');
      return;
    }
    throw error;
  }

  const waitingStart = startStudioServer({
    dataDir,
    runtimeIdentity: newRuntimeIdentity,
    commerceSecretStore: secretStore,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await oldStart.studio.shutdown();

  const replacement = await waitingStart;
  t.after(() => replacement.studio?.shutdown());
  assert.ok(replacement.studio, '等待中的新版后台应在旧锁释放后直接取得所有权');
  assert.equal(replacement.studio.runtimeIdentity, newRuntimeIdentity);
  assert.equal(replacement.reused, undefined);
});
