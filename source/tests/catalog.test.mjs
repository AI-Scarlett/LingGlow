import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_CATALOG_DIR,
  GRADIENT_PRESETS,
  getBuiltInSkin,
  listBuiltInSkins,
  loadBuiltInCatalog,
  materializeCatalogProfile,
  validateCatalogSkin,
} from '../src/catalog.mjs';

test('built-in catalog contains four free and three VIP skins for both clients', () => {
  const catalog = loadBuiltInCatalog();
  assert.ok(Object.isFrozen(catalog));
  assert.equal(catalog.skins.length, 7);
  assert.equal(catalog.skins.filter((skin) => skin.tier === 'free').length, 4);
  assert.equal(catalog.skins.filter((skin) => skin.tier === 'vip').length, 3);
  assert.equal(listBuiltInSkins({clientId: 'codex'}).length, 7);
  assert.equal(listBuiltInSkins({clientId: 'workbuddy', tier: 'vip'}).length, 3);
  for (const skin of catalog.skins) {
    assert.deepEqual(skin.clientIds, ['codex', 'workbuddy']);
    assert.ok(GRADIENT_PRESETS.includes(skin.preview.gradientPreset));
    assert.deepEqual(Object.keys(skin.preview), ['gradientPreset']);
    assert.equal(skin.profile.advanced.background.image, null);
    assert.equal(skin.profile.advanced.banner.image, null);
    assert.equal(skin.profile.advanced.banner.enabled, false);
    assert.equal(skin.composerAvatarAsset.kind, 'composer-avatar-webp');
  }
  const artworkSkin = getBuiltInSkin('dream-portal');
  assert.deepEqual(artworkSkin.asset, {
    kind: 'background-webp',
    path: 'assets/dream-portal.webp',
    sha256: '2154717eedf080ea6ab608638022ecef67116c445e076a55bb02377d1cb415ba',
  });
  assert.deepEqual(artworkSkin.projectHeroAsset, {
    kind: 'project-hero-webp',
    path: 'assets/dream-portal.webp',
    sha256: '2154717eedf080ea6ab608638022ecef67116c445e076a55bb02377d1cb415ba',
  });
  assert.equal(artworkSkin.composerAvatarAsset.path, 'assets/dream-portal-mascot.webp');
  assert.deepEqual(artworkSkin.profile.advanced.brand, {
    enabled: true,
    displayName: 'Dream Portal',
    shortMark: 'DP',
    logoStyle: 'diamond',
  });
});

test('catalog profiles materialize into the existing declarative profile schema', () => {
  const skin = getBuiltInSkin('aurora-glass', {clientId: 'workbuddy'});
  const profile = materializeCatalogProfile(skin, {clientId: 'workbuddy'});
  assert.equal(profile.id, 'aurora-glass');
  assert.equal(profile.name, '极光玻璃');
  assert.equal(profile.official.accent, '#67E8F9');
  assert.equal(profile.advanced.banner.enabled, false);
  assert.deepEqual(profile.advanced.brand, {
    enabled: false,
    displayName: null,
    shortMark: null,
    logoStyle: 'original',
    iconImage: null,
  });
  assert.deepEqual(profile.advanced.workbuddy.projectHero, {
    image: null,
    fit: 'cover',
    position: 'center',
  });
  assert.match(profile.advanced.workbuddy.composerAvatar.image, /^data:image\/webp;base64,/u);
  assert.equal(profile.advanced.workbuddy.composerAvatar.fit, 'contain');
  assert.equal(profile.advanced.workbuddy.composerAvatar.shape, 'square');
  assert.equal(getBuiltInSkin('../escape'), null);
});

test('bundled Dream Portal WebP materializes only after path, size, and SHA checks', () => {
  const skin = getBuiltInSkin('dream-portal', {clientId: 'workbuddy'});
  const profile = materializeCatalogProfile(skin, {clientId: 'workbuddy'});
  assert.match(profile.advanced.background.image, /^data:image\/webp;base64,/u);
  const payload = profile.advanced.background.image.slice('data:image/webp;base64,'.length);
  const digest = createHash('sha256').update(Buffer.from(payload, 'base64')).digest('hex');
  assert.equal(digest, skin.asset.sha256);
  assert.equal(profile.advanced.background.opacity, 1);
  assert.equal(profile.advanced.background.overlay, 0.12);
  assert.match(profile.advanced.workbuddy.projectHero.image, /^data:image\/webp;base64,/u);
  const heroPayload = profile.advanced.workbuddy.projectHero.image.slice('data:image/webp;base64,'.length);
  assert.equal(createHash('sha256').update(Buffer.from(heroPayload, 'base64')).digest('hex'), skin.projectHeroAsset.sha256);
  assert.equal(profile.advanced.workbuddy.projectHero.fit, 'cover');
  assert.equal(profile.advanced.workbuddy.projectHero.position, 'center');
  assert.match(profile.advanced.workbuddy.composerAvatar.image, /^data:image\/webp;base64,/u);
  const mascotPayload = profile.advanced.workbuddy.composerAvatar.image.slice('data:image/webp;base64,'.length);
  assert.equal(
    createHash('sha256').update(Buffer.from(mascotPayload, 'base64')).digest('hex'),
    skin.composerAvatarAsset.sha256,
  );
  assert.deepEqual(profile.advanced.brand, {
    enabled: true,
    displayName: 'Dream Portal',
    shortMark: 'DP',
    logoStyle: 'diamond',
    iconImage: null,
  });
});

test('catalog validator rejects arbitrary source, remote assets, and unknown previews', () => {
  const original = structuredClone(getBuiltInSkin('graphite-focus'));
  const rawCss = structuredClone(original);
  rawCss.profile.rawCss = 'body { display: none }';
  assert.throws(() => validateCatalogSkin(rawCss), /未允许字段/u);

  const remote = structuredClone(original);
  remote.profile.advanced.background.image = 'https://evil.example/background.webp';
  assert.throws(() => validateCatalogSkin(remote), /不允许携带图片/u);

  const traversalAsset = structuredClone(original);
  traversalAsset.asset = {
    kind: 'background-webp',
    path: 'assets/../outside.webp',
    sha256: '0'.repeat(64),
  };
  assert.throws(() => validateCatalogSkin(traversalAsset), /asset\.path/u);

  const badPreview = structuredClone(original);
  badPreview.preview = {gradientPreset: 'url-remote', imageUrl: 'https://evil.example'};
  assert.throws(() => validateCatalogSkin(badPreview), /未允许字段|白名单/u);

  const scriptName = structuredClone(original);
  scriptName.name = '<script>alert(1)</script>';
  assert.throws(() => validateCatalogSkin(scriptName), /不合法/u);

  const unsafeBrand = structuredClone(getBuiltInSkin('dream-portal'));
  unsafeBrand.profile.advanced.brand.displayName = 'https://evil.example';
  assert.throws(() => validateCatalogSkin(unsafeBrand), /brand\.displayName/u);

  const arbitraryBrand = structuredClone(getBuiltInSkin('dream-portal'));
  arbitraryBrand.profile.advanced.brand.rawCss = 'body { display: none }';
  assert.throws(() => validateCatalogSkin(arbitraryBrand), /未允许字段/u);

  const invalidMark = structuredClone(getBuiltInSkin('dream-portal'));
  invalidMark.profile.advanced.brand.shortMark = 'DP!';
  assert.throws(() => validateCatalogSkin(invalidMark), /brand\.shortMark/u);

  const embeddedBrandIcon = structuredClone(getBuiltInSkin('dream-portal'));
  embeddedBrandIcon.profile.advanced.brand.iconImage = 'data:image/png;base64,SGVsbG8=';
  assert.throws(() => validateCatalogSkin(embeddedBrandIcon), /brand\.iconImage/u);

  const remoteHero = structuredClone(getBuiltInSkin('dream-portal'));
  remoteHero.profile.advanced.workbuddy.projectHero.image = 'https://evil.example/hero.webp';
  assert.throws(() => validateCatalogSkin(remoteHero), /projectHero\.image/u);

  const scriptHero = structuredClone(getBuiltInSkin('dream-portal'));
  scriptHero.profile.advanced.workbuddy.projectHero.onload = 'alert(1)';
  assert.throws(() => validateCatalogSkin(scriptHero), /未允许字段/u);

  const invalidHeroAsset = structuredClone(getBuiltInSkin('dream-portal'));
  invalidHeroAsset.projectHeroAsset.kind = 'remote-image';
  assert.throws(() => validateCatalogSkin(invalidHeroAsset), /projectHeroAsset\.kind/u);

  const invalidComposerAsset = structuredClone(getBuiltInSkin('dream-portal'));
  invalidComposerAsset.composerAvatarAsset.kind = 'background-webp';
  assert.throws(() => validateCatalogSkin(invalidComposerAsset), /composerAvatarAsset\.kind/u);
});

test('catalog materializer rejects mismatched, symlinked, and oversized artwork', () => {
  const skin = structuredClone(getBuiltInSkin('dream-portal'));
  const wrongDigest = structuredClone(skin);
  wrongDigest.asset.sha256 = '0'.repeat(64);
  assert.throws(
    () => materializeCatalogProfile(wrongDigest, {clientId: 'workbuddy'}),
    /SHA-256 校验失败/u,
  );

  const wrongHeroDigest = structuredClone(skin);
  wrongHeroDigest.projectHeroAsset.sha256 = '0'.repeat(64);
  assert.throws(
    () => materializeCatalogProfile(wrongHeroDigest, {clientId: 'workbuddy'}),
    /SHA-256 校验失败/u,
  );

  const wrongComposerDigest = structuredClone(skin);
  wrongComposerDigest.composerAvatarAsset.sha256 = '0'.repeat(64);
  assert.throws(
    () => materializeCatalogProfile(wrongComposerDigest, {clientId: 'workbuddy'}),
    /SHA-256 校验失败/u,
  );

  const source = path.join(DEFAULT_CATALOG_DIR, skin.asset.path);
  const symlinkCatalog = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-catalog-asset-link-'));
  fs.mkdirSync(path.join(symlinkCatalog, 'assets'));
  fs.symlinkSync(source, path.join(symlinkCatalog, 'assets', 'dream-portal.webp'));
  assert.throws(
    () => materializeCatalogProfile(skin, {clientId: 'workbuddy', catalogDir: symlinkCatalog}),
    /资源不安全/u,
  );

  const oversizedCatalog = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-catalog-asset-large-'));
  fs.mkdirSync(path.join(oversizedCatalog, 'assets'));
  fs.writeFileSync(
    path.join(oversizedCatalog, 'assets', 'dream-portal.webp'),
    Buffer.alloc(4 * 1024 * 1024 + 1),
  );
  assert.throws(
    () => materializeCatalogProfile(skin, {clientId: 'workbuddy', catalogDir: oversizedCatalog}),
    /资源不安全/u,
  );
});

test('catalog loader refuses a symlinked catalog root', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-catalog-link-'));
  const linked = path.join(directory, 'catalog');
  fs.symlinkSync(DEFAULT_CATALOG_DIR, linked);
  assert.throws(() => loadBuiltInCatalog({catalogDir: linked}), /不安全/u);
});
