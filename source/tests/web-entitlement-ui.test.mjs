import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

import {
  boundCustomProfileIds,
  canAccessCustomStudio,
  canPersistCustomProfile,
  canUseCatalogSkin,
  hasEntitlementPermission,
  purchasedSkinIds,
} from '../public/entitlement-ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePermissions = {
  freeCatalog: true,
  vipCatalog: false,
  custom: false,
  weeklySchedule: false,
  loginReminder: false,
  allFeatures: false,
};

test('web catalog gate uses signed permission fields and only the permanently bound skin ID', () => {
  const entitlement = {
    tier: 'free',
    permissions: freePermissions,
    skinIds: ['violet-nebula', 'violet-nebula', 7],
    customProfileIds: [],
  };

  assert.equal(canUseCatalogSkin(entitlement, {id: 'graphite-focus', tier: 'free'}), true);
  assert.equal(canUseCatalogSkin(entitlement, {id: 'violet-nebula', tier: 'vip'}), true);
  assert.equal(canUseCatalogSkin(entitlement, {id: 'aurora-glass', tier: 'vip'}), false);
  assert.deepEqual(purchasedSkinIds(entitlement), ['violet-nebula']);
  assert.equal(hasEntitlementPermission(entitlement, 'vipCatalog'), false);
});

test('web custom gate permits VIP or the exact permanent custom-slot profileId only', () => {
  const slot = {
    tier: 'free',
    status: 'valid',
    permissions: {...freePermissions, custom: true},
    skinIds: [],
    customProfileIds: ['bound-profile', 'bound-profile', null],
  };
  assert.equal(canAccessCustomStudio(slot), true);
  assert.equal(canPersistCustomProfile(slot, 'bound-profile'), true);
  assert.equal(canPersistCustomProfile(slot, 'different-profile'), false);
  assert.deepEqual(boundCustomProfileIds(slot), ['bound-profile']);

  const vip = {
    tier: 'vip',
    permissions: Object.fromEntries(Object.keys(freePermissions).map((key) => [key, true])),
    skinIds: [],
    customProfileIds: [],
  };
  assert.equal(canAccessCustomStudio(vip), true);
  assert.equal(canPersistCustomProfile(vip, 'any-valid-profile'), true);
});

test('IDs never grant UI access when the service permission snapshot denies it', () => {
  const denied = {
    tier: 'vip',
    status: 'invalid-license',
    permissions: freePermissions,
    skinIds: [],
    customProfileIds: ['bound-profile'],
  };
  assert.equal(canAccessCustomStudio(denied), false);
  assert.equal(canPersistCustomProfile(denied, 'bound-profile'), false);
  assert.equal(canUseCatalogSkin(denied, {id: 'any-vip-skin', tier: 'vip'}), false);
});

test('dashboard copy and module wiring describe both custom entitlement paths', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  assert.match(html, /<script src="app\.js" type="module"><\/script>/u);
  assert.match(html, /VIP \/ 永久位/u);
  assert.match(html, /永久自定义位授权可持续编辑并应用与其 profileId 绑定的那一套皮肤/u);
  assert.doesNotMatch(html, /VIP 解锁完整自定义/u);
  assert.doesNotMatch(app, /保存自定义皮肤需要 VIP/u);
  assert.match(app, /canPersistCustomProfile\(state\.entitlement, profile\.id\)/u);
  assert.match(app, /canUseCatalogSkin\(state\.entitlement, skin\)/u);
  assert.match(app, /body: \{code\}/u);
  assert.doesNotMatch(app, /body: \{token\}/u);
  assert.match(app, /if \(payload\.intent\)/u,
    'the web reminder flow must reuse the server-prepared schedule intent');
});

test('dashboard renders first-use trial time honestly without calling it a paid Dodo subscription', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  assert.match(app, /function localTrialCopy\(trial\)/u);
  assert.match(app, /trial\.kind !== 'local-first-use'/u);
  assert.match(app, /state\.entitlement\.source === 'local-trial'/u);
  assert.match(app, /本机首次使用免费 VIP · 剩余/u);
  assert.match(app, /不是 Dodo 订阅或授权码/u);
  assert.match(app, /移除本机授权缓存不会重置试用/u);
});
