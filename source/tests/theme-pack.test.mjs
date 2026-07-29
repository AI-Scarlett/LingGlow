import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {UNION_CLIENT_IDS, UNION_FIELDS, getUnionField} from '../src/capability-schema.mjs';
import {loadBuiltInCatalog} from '../src/catalog.mjs';
import {
  DEFAULT_THEME_PACK_CATALOG_DIR,
  THEME_PACK_CLIENT_IDS,
  getThemePackAuthoringSchema,
  getThemePackProjectionSchema,
  loadThemePackFile,
  materializeThemePack,
  materializeThemePackPreview,
  materializeThemePackUnionProfile,
  projectThemePackValues,
  validateThemePack,
} from '../src/catalog/theme-pack.mjs';

const SAMPLE_PATH = 'theme-packs/fixtures/cross-agent-sample.json';
const SOURCE_WEBP = path.join(DEFAULT_THEME_PACK_CATALOG_DIR, 'assets', 'dream-portal.webp');

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function minimalPack({assetPath = 'assets/sample.webp', assetSha256 = '0'.repeat(64)} = {}) {
  return {
    schemaVersion: 1,
    kind: 'lingglow.theme-pack',
    id: 'security-fixture',
    name: '安全资源样例',
    description: '验证 Theme Pack 本地静态 WebP 安全边界。',
    tier: 'vip',
    clientIds: ['workbuddy'],
    preview: {gradientPreset: 'aurora', assetId: 'background'},
    assets: {
      background: {slot: 'background.main', path: assetPath, sha256: assetSha256},
    },
    base: {
      'advanced.enabled': true,
      'background.image': {assetId: 'background'},
      'appearance.accent': '#123456',
    },
    overrides: {},
  };
}

function temporaryCatalog(buffer, {fileName = 'sample.webp'} = {}) {
  const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-theme-pack-'));
  fs.mkdirSync(path.join(catalogDir, 'assets'));
  fs.writeFileSync(path.join(catalogDir, 'assets', fileName), buffer);
  return catalogDir;
}

function animatedWebPHeader() {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer[20] = 0x02;
  buffer.writeUIntLE(99, 24, 3);
  buffer.writeUIntLE(99, 27, 3);
  return buffer;
}

function mismatchedCanvasWebPHeader() {
  const buffer = Buffer.alloc(48);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(40, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(0, 24, 3);
  buffer.writeUIntLE(0, 27, 3);
  buffer.write('VP8 ', 30, 'ascii');
  buffer.writeUInt32LE(10, 34);
  buffer[41] = 0x9d;
  buffer[42] = 0x01;
  buffer[43] = 0x2a;
  buffer.writeUInt16LE(4096, 44);
  buffer.writeUInt16LE(4096, 46);
  return buffer;
}

test('Theme Pack sample is parallel to catalog v1 and does not migrate the existing seven skins', () => {
  const before = loadBuiltInCatalog();
  const pack = loadThemePackFile(SAMPLE_PATH);
  const after = loadBuiltInCatalog();
  assert.equal(pack.id, 'cross-agent-sample');
  assert.equal(pack.tier, 'vip');
  assert.deepEqual(pack.clientIds, ['workbuddy', 'doubao', 'codex']);
  assert.equal(before.schemaVersion, 1);
  assert.equal(after.schemaVersion, 1);
  assert.equal(before.skins.length, 7);
  assert.deepEqual(after, before);
  assert.equal(before.skins.some((skin) => Object.hasOwn(skin, 'base')), false);
});

test('one source projects shared, two-client, and one-client Union fields with per-client overrides', () => {
  const pack = loadThemePackFile(SAMPLE_PATH);
  const workbuddy = projectThemePackValues(pack, 'workbuddy');
  const codex = projectThemePackValues(pack, 'codex');
  const doubao = projectThemePackValues(pack, 'doubao');

  // Three-client field, overridden independently without copying a legacy profile.
  assert.equal(workbuddy.values['appearance.accent'], '#D94668');
  assert.equal(codex.values['appearance.accent'], '#C241A5');
  assert.equal(doubao.values['appearance.accent'], '#7C3AED');

  // Two-client field is present only in the two conceptual projections.
  assert.equal(workbuddy.values['semantic.skill'], '#F59E0B');
  assert.equal(codex.values['semantic.skill'], '#F59E0B');
  assert.equal(Object.hasOwn(doubao.values, 'semantic.skill'), false);

  // Single-client fields remain in the one source but only enter their client projection.
  assert.equal(workbuddy.values['workbuddy.projectHero.fit'], 'cover');
  assert.equal(Object.hasOwn(codex.values, 'workbuddy.projectHero.fit'), false);
  assert.equal(codex.values['codex.codeThemeId'], 'codex');
  assert.equal(Object.hasOwn(workbuddy.values, 'codex.codeThemeId'), false);
  assert.equal(doubao.values['doubao.assistantAvatar.shape'], 'rounded');
  assert.equal(Object.hasOwn(codex.values, 'doubao.assistantAvatar.shape'), false);
});

test('materialization retains the full Union document and then uses the existing target bridge', () => {
  const pack = loadThemePackFile(SAMPLE_PATH);
  const union = materializeThemePackUnionProfile(pack, 'workbuddy');
  assert.equal(union.id, pack.id);
  assert.equal(union.name, pack.name);
  assert.equal(union.targetClientId, 'workbuddy');
  assert.equal(union.sourceThemePackId, pack.id);
  assert.match(union.values['background.image'], /^data:image\/webp;base64,/u);
  assert.match(union.values['workbuddy.projectHero.image'], /^data:image\/webp;base64,/u);
  // Saved/customizable profiles retain every known union default.  The target
  // bridge below is still the only place where WorkBuddy consumes fields.
  assert.equal(union.values['codex.codeThemeId'], 'codex');
  assert.equal(union.values['doubao.assistantAvatar.shape'], 'circle');

  const workbuddy = materializeThemePack(pack, 'workbuddy');
  assert.equal(workbuddy.schemaVersion, 1);
  assert.equal(workbuddy.id, pack.id);
  assert.equal(workbuddy.official.accent, '#D94668');
  assert.match(workbuddy.advanced.background.image, /^data:image\/webp;base64,/u);
  assert.match(workbuddy.advanced.workbuddy.projectHero.image, /^data:image\/webp;base64,/u);
  // semantic.skill is conceptually shared by WorkBuddy/Codex, but WorkBuddy's map marks it unsupported.
  assert.equal(workbuddy.official.semanticColors.skill, '#A78BFA');

  const codex = materializeThemePack(pack, 'codex');
  assert.equal(codex.official.accent, '#C241A5');
  assert.equal(codex.official.semanticColors.skill, '#F59E0B');
  assert.equal(codex.official.codeThemeId, 'codex');

  const preview = materializeThemePackPreview(pack);
  assert.match(preview, /^data:image\/webp;base64,/u);
  assert.equal(digest(Buffer.from(preview.slice('data:image/webp;base64,'.length), 'base64')),
    pack.assets['main-background'].sha256);
});

test('Doubao materializes reviewed Theme Packs with its exact capability map', () => {
  const pack = loadThemePackFile(SAMPLE_PATH);
  const designProjection = projectThemePackValues(pack, 'doubao');
  assert.equal(designProjection.targetClientId, 'doubao');
  assert.equal(designProjection.values['appearance.accent'], '#7C3AED');
  assert.doesNotThrow(() => materializeThemePackUnionProfile(pack, 'doubao'));
  const profile = materializeThemePack(pack, 'doubao');
  assert.equal(profile.official.accent, '#7C3AED');
});

test('unknown fields and inapplicable per-client overrides are rejected, while base is a full Union source', () => {
  const pack = structuredClone(loadThemePackFile(SAMPLE_PATH));
  const unknown = structuredClone(pack);
  unknown.base['future.rawCss'] = 'body { display: none }';
  assert.throws(() => validateThemePack(unknown), /未知 Union 字段/u);

  const inapplicable = structuredClone(pack);
  inapplicable.overrides.workbuddy['window.opaque'] = false;
  assert.throws(() => validateThemePack(inapplicable), /不适用于 workbuddy/u);

  const undeclaredOverride = structuredClone(pack);
  undeclaredOverride.clientIds = ['workbuddy', 'codex'];
  assert.throws(() => validateThemePack(undeclaredOverride), /overrides\.doubao.*未在/u);

  const directImage = structuredClone(pack);
  directImage.base['background.image'] = 'data:image/webp;base64,AAAA';
  assert.throws(() => validateThemePack(directImage), /必须是普通对象/u);

  const remoteImage = structuredClone(pack);
  remoteImage.assets['main-background'].path = 'https://evil.example/a.webp';
  assert.throws(() => validateThemePack(remoteImage), /catalog\/assets/u);

  const traversal = structuredClone(pack);
  traversal.assets['main-background'].path = 'assets/../outside.webp';
  assert.throws(() => validateThemePack(traversal), /catalog\/assets/u);

  // A full production source may keep all known one-client fields in base.
  assert.doesNotThrow(() => validateThemePack(pack));
  assert.equal(Object.hasOwn(projectThemePackValues(pack, 'codex').values, 'workbuddy.projectHero.fit'), false);
});

test('asset slots must be declared, compatible with the Union field, used, and SHA locked', () => {
  const source = fs.readFileSync(SOURCE_WEBP);
  const catalogDir = temporaryCatalog(source);
  const valid = minimalPack({assetSha256: digest(source)});
  assert.match(materializeThemePack(valid, 'workbuddy', {catalogDir}).advanced.background.image,
    /^data:image\/webp;base64,/u);

  const undeclared = structuredClone(valid);
  undeclared.base['background.image'] = {assetId: 'missing'};
  assert.throws(() => validateThemePack(undeclared), /未声明资源/u);

  const wrongSlot = structuredClone(valid);
  wrongSlot.assets.background.slot = 'brand.icon';
  assert.throws(() => validateThemePack(wrongSlot), /资源槽必须是 background\.main/u);

  const unknownSlot = structuredClone(valid);
  unknownSlot.assets.background.slot = 'future.unregistered';
  assert.throws(() => validateThemePack(unknownSlot), /Union Schema/u);

  const unused = structuredClone(valid);
  unused.assets.extra = {
    slot: 'brand.icon',
    path: 'assets/extra.webp',
    sha256: '0'.repeat(64),
  };
  assert.throws(() => validateThemePack(unused), /未使用资源/u);

  const mismatch = structuredClone(valid);
  mismatch.assets.background.sha256 = '0'.repeat(64);
  assert.throws(
    () => materializeThemePack(mismatch, 'workbuddy', {catalogDir}),
    /SHA-256 校验失败/u,
  );
});

test('asset materializer rejects symlinks, oversized files, animation, and malformed WebP', () => {
  const source = fs.readFileSync(SOURCE_WEBP);

  const symlinkCatalog = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-theme-pack-link-'));
  fs.mkdirSync(path.join(symlinkCatalog, 'assets'));
  fs.symlinkSync(SOURCE_WEBP, path.join(symlinkCatalog, 'assets', 'sample.webp'));
  const symlinkPack = minimalPack({assetSha256: digest(source)});
  assert.throws(
    () => materializeThemePack(symlinkPack, 'workbuddy', {catalogDir: symlinkCatalog}),
    /不安全/u,
  );

  const linkedDirectoryCatalog = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-theme-pack-dir-link-'));
  fs.symlinkSync(path.dirname(SOURCE_WEBP), path.join(linkedDirectoryCatalog, 'assets'));
  assert.throws(
    () => materializeThemePack(symlinkPack, 'workbuddy', {catalogDir: linkedDirectoryCatalog}),
    /目录.*不安全/u,
  );

  const oversized = Buffer.alloc(4 * 1024 * 1024 + 1);
  const oversizedCatalog = temporaryCatalog(oversized);
  const oversizedPack = minimalPack({assetSha256: digest(oversized)});
  assert.throws(
    () => materializeThemePack(oversizedPack, 'workbuddy', {catalogDir: oversizedCatalog}),
    /超过 4194304 字节/u,
  );

  const animated = animatedWebPHeader();
  const animatedCatalog = temporaryCatalog(animated);
  const animatedPack = minimalPack({assetSha256: digest(animated)});
  assert.throws(
    () => materializeThemePack(animatedPack, 'workbuddy', {catalogDir: animatedCatalog}),
    /必须是静态 WebP/u,
  );

  const malformed = Buffer.from('not a webp', 'utf8');
  const malformedCatalog = temporaryCatalog(malformed);
  const malformedPack = minimalPack({assetSha256: digest(malformed)});
  assert.throws(
    () => materializeThemePack(malformedPack, 'workbuddy', {catalogDir: malformedCatalog}),
    /不是完整 WebP/u,
  );

  const mismatched = mismatchedCanvasWebPHeader();
  const mismatchedCatalog = temporaryCatalog(mismatched);
  const mismatchedPack = minimalPack({assetSha256: digest(mismatched)});
  assert.throws(
    () => materializeThemePack(mismatchedPack, 'workbuddy', {catalogDir: mismatchedCatalog}),
    /画布与主图尺寸不一致/u,
  );
});

test('safe loader rejects pack path traversal and symlinked definition files', () => {
  assert.throws(() => loadThemePackFile('../outside.json'), /catalog\/theme-packs/u);

  const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-theme-pack-file-link-'));
  fs.mkdirSync(path.join(catalogDir, 'assets'));
  fs.mkdirSync(path.join(catalogDir, 'theme-packs'));
  const outside = path.join(catalogDir, 'outside.json');
  fs.writeFileSync(outside, JSON.stringify(minimalPack()));
  fs.symlinkSync(outside, path.join(catalogDir, 'theme-packs', 'linked.json'));
  assert.throws(
    () => loadThemePackFile('theme-packs/linked.json', {catalogDir}),
    /文件.*不安全/u,
  );
});

test('authoring and user projections derive from the capability union without client-specific switches', () => {
  const authoring = getThemePackAuthoringSchema();
  assert.strictEqual(THEME_PACK_CLIENT_IDS, UNION_CLIENT_IDS);
  assert.deepEqual(authoring.clientIds, UNION_CLIENT_IDS);
  assert.deepEqual(authoring.fields.map((field) => field.id), UNION_FIELDS.map((field) => field.id));

  for (const clientId of UNION_CLIENT_IDS) {
    const projection = getThemePackProjectionSchema(clientId);
    assert.equal(projection.targetClientId, clientId);
    assert.deepEqual(
      projection.fields.map((field) => field.id),
      UNION_FIELDS.filter((field) => field.clients.includes(clientId)).map((field) => field.id),
    );
    for (const field of projection.fields) {
      assert.equal(getUnionField(field.id).clients.includes(clientId), true);
      assert.equal(field.support.fieldId, field.id);
    }
  }

  const moduleSource = fs.readFileSync(
    new URL('../src/catalog/theme-pack.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(moduleSource, /clientId\s*===\s*['"](?:workbuddy|doubao|codex)['"]/u);
  assert.doesNotMatch(moduleSource, /switch\s*\(\s*clientId\s*\)/u);
});
