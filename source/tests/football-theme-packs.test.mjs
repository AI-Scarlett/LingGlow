import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_THEME_PACK_CATALOG_DIR,
  loadThemePackFile,
  materializeThemePack,
  materializeThemePackUnionProfile,
  projectThemePackValues,
} from '../src/catalog/theme-pack.mjs';
import {UNION_FIELDS} from '../src/capability-schema.mjs';

const PACKS = [
  {
    file: 'cr7-portugal.json',
    id: 'cr7-portugal',
    assetPath: 'assets/cr7-portugal.webp',
    sha256: '0970c2866c337f4785656dd970c8375d6debb71bdd80ac57bf4a1e0b62996aad',
    shortMark: 'CR7',
    storeName: 'C罗灵感·葡萄牙7号星夜',
    country: '葡萄牙',
    accents: {workbuddy: '#D64A4A', doubao: '#2F9E67', codex: '#E3B341'},
  },
  {
    file: 'messi-argentina.json',
    id: 'messi-argentina',
    assetPath: 'assets/messi-argentina.webp',
    sha256: '96b90a688244702754f35c5fb8db30048f8a6b210aaa809c0cce125b7af5ae8d',
    shortMark: 'M10',
    storeName: '梅西灵感·阿根廷10号月光',
    country: '阿根廷',
    accents: {workbuddy: '#73C6F2', doubao: '#E6C66E', codex: '#9CD8F5'},
  },
  {
    file: 'neymar-brazil.json',
    id: 'neymar-brazil',
    assetPath: 'assets/neymar-brazil.webp',
    sha256: 'c26515d02fe552482f908314ef02a0ed922928aa79816d6e1a6ff0152adab0b7',
    shortMark: 'N10',
    storeName: '内马尔灵感·巴西10号热浪',
    country: '巴西',
    accents: {workbuddy: '#F5C842', doubao: '#29A66B', codex: '#4C93E8'},
  },
];

const SHARED_REQUIRED_FIELDS = [
  'advanced.enabled',
  'appearance.variant',
  'appearance.accent',
  'appearance.surface',
  'appearance.ink',
  'appearance.contrast',
  'semantic.diffAdded',
  'semantic.diffRemoved',
  'semantic.skill',
  'background.image',
  'background.opacity',
  'background.overlay',
  'background.blur',
  'background.position',
  'glass.enabled',
  'glass.opacity',
  'glass.blur',
  'brand.enabled',
  'brand.displayName',
  'brand.shortMark',
  'brand.logoStyle',
  'brand.iconImage',
  'shape.radius',
];

const ASSET_FIELD_SLOTS = {
  'background.image': 'background.main',
  'workbuddy.projectHero.image': 'workbuddy.project-hero',
  'workbuddy.composerAvatar.image': 'workbuddy.composer-avatar',
  'codex.banner.image': 'codex.banner',
  'doubao.homeHero.image': 'doubao.home-hero',
};

function load(meta) {
  return loadThemePackFile(`theme-packs/${meta.file}`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('three football VIP Theme Packs are unique, store-ready, SHA locked, and explicit full Union sources', () => {
  const ids = new Set();
  const names = new Set();
  const assetIds = new Set();

  for (const meta of PACKS) {
    const pack = load(meta);
    ids.add(pack.id);
    names.add(pack.name);
    assert.equal(pack.id, meta.id);
    assert.equal(pack.tier, 'vip');
    assert.deepEqual(pack.clientIds, ['workbuddy', 'doubao', 'codex']);
    assert.equal(pack.name, meta.storeName);
    assert.match(pack.description, new RegExp(meta.country, 'u'));
    assert.match(pack.description, /原创匿名/u);
    assert.match(pack.description, /不含肖像、队徽或官方合作标识/u);
    assert.equal(pack.base['brand.shortMark'], meta.shortMark);
    assert.equal(pack.base['brand.iconImage'], null);
    assert.equal(pack.base['appearance.variant'], 'dark');
    assert.equal(pack.base['typography.codeFont'], null);
    assert.equal(pack.base['typography.uiFont'], null);
    assert.equal(pack.base['window.opaque'], true);
    assert.equal(pack.base['motion.preset'], 'subtle');
    assert.equal(pack.base['layout.sidebarWidth'], 280);
    assert.equal(pack.base['codex.codeThemeId'], 'codex');
    assert.equal(pack.base['doubao.assistantAvatar.image'], null);
    assert.equal(pack.base['doubao.assistantAvatar.fit'], 'cover');
    assert.equal(pack.base['doubao.assistantAvatar.shape'], 'circle');

    assert.deepEqual(
      Object.keys(pack.base).sort(),
      UNION_FIELDS.map((field) => field.id).sort(),
      `${pack.id} 必须显式定义完整 Union Schema`,
    );

    for (const fieldId of SHARED_REQUIRED_FIELDS) {
      assert.equal(Object.hasOwn(pack.base, fieldId), true, `${pack.id} 缺少 ${fieldId}`);
    }
    for (const [fieldId, slot] of Object.entries(ASSET_FIELD_SLOTS)) {
      const reference = pack.base[fieldId];
      assert.equal(typeof reference.assetId, 'string');
      const asset = pack.assets[reference.assetId];
      assert.equal(asset.slot, slot);
      const assetFile = path.join(DEFAULT_THEME_PACK_CATALOG_DIR, asset.path);
      const stat = fs.lstatSync(assetFile);
      assert.equal(stat.isFile(), true);
      assert.equal(stat.isSymbolicLink(), false);
      assert.ok(stat.size > 0 && stat.size < 4 * 1024 * 1024);
      assert.equal(sha256(fs.readFileSync(assetFile)), asset.sha256);
    }

    assert.equal(Object.keys(pack.assets).length, 5);
    const backgroundReference = pack.base['background.image'];
    assert.equal(pack.assets[backgroundReference.assetId].path, meta.assetPath);
    assert.equal(pack.assets[backgroundReference.assetId].sha256, meta.sha256);
    const mascotReference = pack.base['workbuddy.composerAvatar.image'];
    assert.notEqual(pack.assets[mascotReference.assetId].path, meta.assetPath);
    for (const assetId of Object.keys(pack.assets)) {
      assert.equal(assetIds.has(assetId), false, `重复 assetId: ${assetId}`);
      assetIds.add(assetId);
    }

    const assetFile = path.join(DEFAULT_THEME_PACK_CATALOG_DIR, meta.assetPath);
    const stat = fs.lstatSync(assetFile);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.ok(stat.size > 0 && stat.size < 4 * 1024 * 1024);
    const bytes = fs.readFileSync(assetFile);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.equal(sha256(bytes), meta.sha256);

    const rawPack = fs.readFileSync(
      path.join(DEFAULT_THEME_PACK_CATALOG_DIR, 'theme-packs', meta.file),
      'utf8',
    );
    assert.doesNotMatch(rawPack, /(?:https?|file|data|javascript|vbscript):/iu);
    assert.doesNotMatch(rawPack, /"(?:css|js|url)"\s*:/iu);
  }

  assert.equal(ids.size, PACKS.length);
  assert.equal(names.size, PACKS.length);
  assert.equal(assetIds.size, PACKS.length * 5);
});

test('each football Theme Pack projects to all three clients and materializes WorkBuddy and Codex', () => {
  for (const meta of PACKS) {
    const pack = load(meta);
    const workbuddyProjection = projectThemePackValues(pack, 'workbuddy');
    const codexProjection = projectThemePackValues(pack, 'codex');
    const doubaoProjection = projectThemePackValues(pack, 'doubao');

    for (const projection of [workbuddyProjection, codexProjection, doubaoProjection]) {
      assert.deepEqual(
        Object.keys(projection.values).sort(),
        UNION_FIELDS.filter((field) => field.clients.includes(projection.targetClientId))
          .map((field) => field.id)
          .sort(),
        `${pack.id} 到 ${projection.targetClientId} 的投影必须没有隐式默认字段`,
      );
    }

    assert.equal(workbuddyProjection.values['appearance.accent'], meta.accents.workbuddy);
    assert.equal(codexProjection.values['appearance.accent'], meta.accents.codex);
    assert.equal(doubaoProjection.values['appearance.accent'], meta.accents.doubao);
    assert.equal(Object.hasOwn(workbuddyProjection.values, 'workbuddy.projectHero.image'), true);
    assert.equal(Object.hasOwn(workbuddyProjection.values, 'codex.banner.image'), false);
    assert.equal(Object.hasOwn(workbuddyProjection.values, 'doubao.homeHero.image'), false);
    assert.equal(Object.hasOwn(codexProjection.values, 'codex.banner.image'), true);
    assert.equal(Object.hasOwn(codexProjection.values, 'workbuddy.projectHero.image'), false);
    assert.equal(Object.hasOwn(codexProjection.values, 'doubao.homeHero.image'), false);
    assert.equal(Object.hasOwn(doubaoProjection.values, 'doubao.homeHero.image'), true);
    assert.equal(Object.hasOwn(doubaoProjection.values, 'workbuddy.projectHero.image'), false);
    assert.equal(Object.hasOwn(doubaoProjection.values, 'codex.banner.image'), false);

    const workbuddyUnion = materializeThemePackUnionProfile(pack, 'workbuddy');
    assert.match(workbuddyUnion.values['background.image'], /^data:image\/webp;base64,/u);
    assert.match(workbuddyUnion.values['workbuddy.projectHero.image'], /^data:image\/webp;base64,/u);
    assert.equal(workbuddyUnion.values['brand.shortMark'], meta.shortMark);
    const workbuddyLegacy = materializeThemePack(pack, 'workbuddy');
    assert.equal(workbuddyLegacy.official.accent, meta.accents.workbuddy);
    assert.equal(workbuddyLegacy.advanced.brand.shortMark, meta.shortMark);
    assert.match(workbuddyLegacy.advanced.background.image, /^data:image\/webp;base64,/u);
    assert.match(workbuddyLegacy.advanced.workbuddy.projectHero.image, /^data:image\/webp;base64,/u);

    const codexUnion = materializeThemePackUnionProfile(pack, 'codex');
    assert.match(codexUnion.values['background.image'], /^data:image\/webp;base64,/u);
    assert.match(codexUnion.values['codex.banner.image'], /^data:image\/webp;base64,/u);
    assert.equal(codexUnion.values['codex.banner.enabled'], true);
    const codexLegacy = materializeThemePack(pack, 'codex');
    assert.equal(codexLegacy.official.accent, meta.accents.codex);
    assert.match(codexLegacy.advanced.background.image, /^data:image\/webp;base64,/u);
  }
});

test('Doubao receives design projection and materializes supported visual fields', () => {
  for (const meta of PACKS) {
    const pack = load(meta);
    const design = projectThemePackValues(pack, 'doubao');
    assert.equal(design.targetClientId, 'doubao');
    assert.equal(design.values['appearance.accent'], meta.accents.doubao);
    assert.equal(design.values['doubao.homeHero.fit'], 'cover');
    assert.equal(design.values['doubao.homeHero.position'], 'right');
    assert.equal(
      pack.assets[design.values['doubao.homeHero.image'].assetId].slot,
      'doubao.home-hero',
    );
    const union = materializeThemePackUnionProfile(pack, 'doubao');
    assert.equal(union.values['appearance.accent'], meta.accents.doubao);
    assert.match(union.values['background.image'], /^data:image\/webp;base64,/u);
    const legacy = materializeThemePack(pack, 'doubao');
    assert.equal(legacy.official.accent, meta.accents.doubao);
    assert.match(legacy.advanced.background.image, /^data:image\/webp;base64,/u);
  }
});
