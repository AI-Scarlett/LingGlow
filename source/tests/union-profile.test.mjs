import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {PERMISSION_MATRIX, canPersistUnionProfile} from '../src/entitlements.mjs';
import {ensureDataDir} from '../src/profile.mjs';
import {
  UNION_PROFILE_STORE_DIR,
  UNION_PROFILE_DRAFT_STORE_DIR,
  deleteUnionProfileDraft,
  ensureUnionProfileStore,
  ensureUnionProfileDraftStore,
  getUnionProfileDraft,
  getUnionProfile,
  listUnionProfileDrafts,
  listUnionProfiles,
  promoteUnionProfileDraft,
  saveUnionProfileDraft,
  saveUnionProfile,
  unionProfileToLegacyV1,
} from '../src/union-profile.mjs';

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function temporaryDataDir(prefix = 'lingglow-union-profile-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function profile(overrides = {}) {
  return {
    id: 'union-alpha',
    name: 'Union Alpha',
    targetClientId: 'workbuddy',
    schemaVersion: 1,
    values: {},
    ...overrides,
  };
}

test('union profile store is private, atomic, and round-trips future and inapplicable fields', () => {
  const dataDir = temporaryDataDir();
  const input = profile({
    futureMetadata: {editorRevision: 7},
    values: {
      'appearance.accent': '#123456',
      'typography.uiFont': 'Inter',
      'codex.banner.enabled': true,
      'future.visual.sparkle': {enabled: true, density: 0.4},
    },
  });
  const saved = saveUnionProfile(input, dataDir);
  assert.deepEqual(saved.futureMetadata, {editorRevision: 7});
  assert.deepEqual(saved.values['future.visual.sparkle'], {enabled: true, density: 0.4});
  assert.equal(saved.values['codex.banner.enabled'], true);

  const directory = path.join(dataDir, UNION_PROFILE_STORE_DIR);
  const filePath = path.join(directory, 'union-alpha.json');
  assert.equal(fs.statSync(directory).mode & 0o077, 0);
  assert.equal(fs.statSync(filePath).mode & 0o077, 0);
  assert.equal(fs.lstatSync(filePath).isSymbolicLink(), false);
  assert.deepEqual(fs.readdirSync(directory), ['union-alpha.json']);

  const updated = saveUnionProfile({
    ...saved,
    name: 'Union Alpha 2',
    values: {...saved.values, 'appearance.surface': '#010203'},
  }, dataDir);
  assert.equal(updated.name, 'Union Alpha 2');
  assert.equal(getUnionProfile('union-alpha', dataDir).values['appearance.surface'], '#010203');
  assert.equal(listUnionProfiles(dataDir).length, 1);
  assert.deepEqual(fs.readdirSync(directory), ['union-alpha.json']);
  assert.throws(
    () => saveUnionProfile({...input, targetClientId: 'windows'}, dataDir),
    /targetClientId/u,
  );
  const {targetClientId: _removed, ...missingTarget} = input;
  assert.throws(() => saveUnionProfile(missingTarget, dataDir), /缺少元数据.*targetClientId/u);
});

test('legacy invalid composer artwork degrades to empty without hiding other stored-profile errors', () => {
  const dataDir = temporaryDataDir('lingglow-union-legacy-mascot-');
  saveUnionProfile(profile({id: 'legacy-mascot'}), dataDir);
  const filePath = path.join(dataDir, UNION_PROFILE_STORE_DIR, 'legacy-mascot.json');
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  record.values['workbuddy.composerAvatar.image'] = onePixelPng;
  fs.writeFileSync(filePath, `${JSON.stringify(record)}\n`, {mode: 0o600});

  const loaded = getUnionProfile('legacy-mascot', dataDir);
  assert.equal(loaded.values['workbuddy.composerAvatar.image'], null);
  assert.equal(listUnionProfiles(dataDir)[0].values['workbuddy.composerAvatar.image'], null);
  assert.equal(
    JSON.parse(fs.readFileSync(filePath, 'utf8')).values['workbuddy.composerAvatar.image'],
    onePixelPng,
    'read-time compatibility must not rewrite user data implicitly',
  );

  record.values['appearance.accent'] = 'not-a-color';
  fs.writeFileSync(filePath, `${JSON.stringify(record)}\n`, {mode: 0o600});
  assert.throws(() => getUnionProfile('legacy-mascot', dataDir), /appearance\.accent/u);
});

test('union profile store rejects symlinked directories, files, and unsafe file modes', () => {
  const directoryLinkRoot = temporaryDataDir('lingglow-union-dir-link-');
  const outside = temporaryDataDir('lingglow-union-outside-');
  ensureDataDir(directoryLinkRoot);
  fs.symlinkSync(outside, path.join(directoryLinkRoot, UNION_PROFILE_STORE_DIR));
  assert.throws(() => ensureUnionProfileStore(directoryLinkRoot), /目录不安全/u);

  const dataDir = temporaryDataDir('lingglow-union-file-link-');
  saveUnionProfile(profile(), dataDir);
  const directory = path.join(dataDir, UNION_PROFILE_STORE_DIR);
  const filePath = path.join(directory, 'union-alpha.json');
  const victim = path.join(dataDir, 'victim.json');
  fs.writeFileSync(victim, '{}\n', {mode: 0o600});
  fs.unlinkSync(filePath);
  fs.symlinkSync(victim, filePath);
  assert.throws(() => getUnionProfile('union-alpha', dataDir), /文件不安全/u);
  assert.throws(() => saveUnionProfile(profile(), dataDir), /文件不安全/u);
  assert.equal(fs.readFileSync(victim, 'utf8'), '{}\n');

  fs.unlinkSync(filePath);
  saveUnionProfile(profile(), dataDir);
  fs.chmodSync(filePath, 0o644);
  assert.throws(() => listUnionProfiles(dataDir), /文件不安全/u);
});

test('blocked-Agent drafts use a separate private store and preserve the complete union schema', () => {
  const dataDir = temporaryDataDir('lingglow-union-draft-');
  const input = profile({
    id: 'doubao-draft-slot',
    name: '豆包设计草稿',
    targetClientId: 'doubao',
    futureMetadata: {designer: 'local-only'},
    values: {
      'appearance.accent': '#2F9E67',
      'doubao.homeHero.image': onePixelPng,
      'future.visual.sparkle': {enabled: true, density: 0.4},
    },
  });
  const saved = saveUnionProfileDraft(input, dataDir);
  assert.equal(saved.id, input.id);
  assert.deepEqual(saved.futureMetadata, {designer: 'local-only'});
  assert.deepEqual(saved.values['future.visual.sparkle'], {enabled: true, density: 0.4});
  assert.equal(getUnionProfile(input.id, dataDir), null);
  assert.deepEqual(getUnionProfileDraft(input.id, dataDir), saved);
  assert.deepEqual(listUnionProfileDrafts(dataDir), [saved]);

  const directory = path.join(dataDir, UNION_PROFILE_DRAFT_STORE_DIR);
  const filePath = path.join(directory, `${input.id}.json`);
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(record.id, input.id);
  assert.deepEqual(record.futureMetadata, {designer: 'local-only'});
  assert.equal(fs.statSync(directory).mode & 0o077, 0);
  assert.equal(fs.statSync(filePath).mode & 0o077, 0);
  assert.equal(fs.existsSync(path.join(dataDir, UNION_PROFILE_STORE_DIR, `${input.id}.json`)), false);

  const updated = saveUnionProfileDraft({
    ...saved,
    name: '豆包设计草稿 2',
    values: {...saved.values, 'appearance.surface': '#102030'},
  }, dataDir);
  assert.equal(updated.name, '豆包设计草稿 2');
  const updatedRecord = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(updatedRecord.name, '豆包设计草稿 2');

  assert.deepEqual(deleteUnionProfileDraft(input.id, dataDir), updated);
  assert.equal(getUnionProfileDraft(input.id, dataDir), null);
});

test('draft store rejects symlink targets and malformed full profiles', () => {
  const directoryLinkRoot = temporaryDataDir('lingglow-union-draft-dir-link-');
  const outside = temporaryDataDir('lingglow-union-draft-outside-');
  ensureDataDir(directoryLinkRoot);
  fs.symlinkSync(outside, path.join(directoryLinkRoot, UNION_PROFILE_DRAFT_STORE_DIR));
  assert.throws(() => ensureUnionProfileDraftStore(directoryLinkRoot), /目录不安全/u);

  const dataDir = temporaryDataDir('lingglow-union-draft-envelope-');
  const saved = saveUnionProfileDraft(profile({id: 'draft-envelope', targetClientId: 'doubao'}), dataDir);
  const filePath = path.join(dataDir, UNION_PROFILE_DRAFT_STORE_DIR, 'draft-envelope.json');
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  delete record.targetClientId;
  fs.writeFileSync(filePath, `${JSON.stringify(record)}\n`, {mode: 0o600});
  assert.throws(() => getUnionProfileDraft(saved.id, dataDir), /缺少元数据.*targetClientId/u);
});

test('draft promotion moves an unchanged available-Agent profile into the executable store without overwriting', () => {
  const dataDir = temporaryDataDir('lingglow-union-draft-promote-');
  const saved = saveUnionProfileDraft(profile({
    id: 'draft-promote',
    targetClientId: 'workbuddy',
    futureMetadata: {future: true},
    values: {'future.renderer.option': {preserve: true}},
  }), dataDir);
  const promoted = promoteUnionProfileDraft(saved.id, dataDir);
  assert.deepEqual(promoted, saved);
  assert.equal(getUnionProfileDraft(saved.id, dataDir), null);
  assert.deepEqual(getUnionProfile(saved.id, dataDir), saved);
  assert.equal(fs.existsSync(path.join(dataDir, UNION_PROFILE_DRAFT_STORE_DIR, `${saved.id}.json`)), false);
  assert.equal(fs.existsSync(path.join(dataDir, UNION_PROFILE_STORE_DIR, `${saved.id}.json`)), true);
});

test('draft promotion supports available Doubao, preserves no-replace semantics, and respects executable quotas', () => {
  const doubaoDataDir = temporaryDataDir('lingglow-union-draft-doubao-promote-');
  const doubao = saveUnionProfileDraft(profile({id: 'doubao-promote', targetClientId: 'doubao'}), doubaoDataDir);
  assert.deepEqual(promoteUnionProfileDraft(doubao.id, doubaoDataDir), doubao);
  assert.equal(getUnionProfileDraft(doubao.id, doubaoDataDir), null);
  assert.deepEqual(getUnionProfile(doubao.id, doubaoDataDir), doubao);

  const conflictDataDir = temporaryDataDir('lingglow-union-draft-conflict-promote-');
  const draft = saveUnionProfileDraft(profile({id: 'promotion-conflict', targetClientId: 'workbuddy'}), conflictDataDir);
  const executable = saveUnionProfile(profile({
    id: 'promotion-conflict', name: 'Existing Executable', targetClientId: 'workbuddy',
  }), conflictDataDir);
  assert.throws(() => promoteUnionProfileDraft(draft.id, conflictDataDir), /ID 已存在/u);
  assert.deepEqual(getUnionProfileDraft(draft.id, conflictDataDir), draft);
  assert.deepEqual(getUnionProfile(executable.id, conflictDataDir), executable);

  const quotaDataDir = temporaryDataDir('lingglow-union-draft-quota-promote-');
  for (let index = 0; index < 24; index += 1) {
    saveUnionProfile(profile({
      id: `executable-${String(index).padStart(2, '0')}`,
      targetClientId: 'workbuddy',
    }), quotaDataDir);
  }
  const quotaDraft = saveUnionProfileDraft(profile({id: 'draft-over-quota', targetClientId: 'workbuddy'}), quotaDataDir);
  assert.throws(() => promoteUnionProfileDraft(quotaDraft.id, quotaDataDir), /最多保存 24 个/u);
  assert.deepEqual(getUnionProfileDraft(quotaDraft.id, quotaDataDir), quotaDraft);
  assert.equal(getUnionProfile(quotaDraft.id, quotaDataDir), null);
});

test('fixed union bridge consumes supported WorkBuddy fields and preserves Codex home artwork', () => {
  const workbuddy = unionProfileToLegacyV1(profile({
    values: {
      'advanced.enabled': true,
      'appearance.variant': 'light',
      'appearance.accent': '#123456',
      'semantic.diffRemoved': '#AABBCC',
      'typography.uiFont': 'Inter',
      'workbuddy.projectHero.image': onePixelPng,
      'workbuddy.projectHero.fit': 'contain',
      'workbuddy.projectHero.position': 'top right',
      'codex.banner.enabled': true,
      'future.visual.sparkle': true,
    },
  }), 'workbuddy');
  assert.equal(workbuddy.advanced.enabled, true);
  assert.equal(workbuddy.official.accent, '#123456');
  assert.equal(workbuddy.official.semanticColors.diffRemoved, '#AABBCC');
  assert.equal(workbuddy.advanced.workbuddy.projectHero.image, onePixelPng);
  assert.equal(workbuddy.advanced.workbuddy.projectHero.fit, 'contain');
  assert.equal(workbuddy.advanced.workbuddy.projectHero.position, 'top right');
  assert.equal(workbuddy.official.variant, 'dark');
  assert.equal(workbuddy.official.fonts.ui, null);
  assert.equal(workbuddy.advanced.banner.enabled, false);

  const codex = unionProfileToLegacyV1(profile({
    id: 'union-codex',
    targetClientId: 'codex',
    values: {
      'advanced.enabled': true,
      'appearance.variant': 'light',
      'appearance.accent': '#654321',
      'codex.banner.enabled': true,
      'codex.banner.image': onePixelPng,
      'brand.enabled': true,
      'brand.displayName': 'Pending Brand',
    },
  }), 'codex');
  assert.equal(codex.official.variant, 'light');
  assert.equal(codex.official.accent, '#654321');
  assert.equal(codex.advanced.banner.enabled, true);
  assert.equal(codex.advanced.banner.image, onePixelPng);
  assert.equal(codex.advanced.brand.enabled, false);
});

test('union bridge rejects cross-client projection and materializes available Doubao', () => {
  assert.throws(
    () => unionProfileToLegacyV1(profile(), 'codex'),
    (error) => error.code === 'UNION_PROFILE_CLIENT_MISMATCH',
  );
  const doubao = unionProfileToLegacyV1(profile({
    id: 'union-doubao',
    targetClientId: 'doubao',
    values: {'appearance.accent': '#2F9E67'},
  }), 'doubao');
  assert.equal(doubao.id, 'union-doubao');
  assert.equal(doubao.official.accent, '#2F9E67');
});

test('union persistence permission requires VIP or the exact active custom-slot binding', () => {
  const vip = {status: 'valid', permissions: PERMISSION_MATRIX.vip, customProfileIds: [], activeGrants: []};
  assert.equal(canPersistUnionProfile(vip, 'any-profile'), true);
  assert.equal(canPersistUnionProfile({...vip, status: 'invalid-license'}, 'any-profile'), false);

  const customSlot = {
    status: 'valid',
    permissions: {...PERMISSION_MATRIX.free, custom: true},
    customProfileIds: ['bound-profile'],
    activeGrants: [{
      offerType: 'custom_slot_once',
      status: 'active',
      binding: {profileId: 'bound-profile'},
    }],
  };
  assert.equal(canPersistUnionProfile(customSlot, 'bound-profile'), true);
  assert.equal(canPersistUnionProfile(customSlot, 'another-profile'), false);
  assert.equal(canPersistUnionProfile({...customSlot, permissions: PERMISSION_MATRIX.free}, 'bound-profile'), false);
  assert.equal(canPersistUnionProfile({...customSlot, activeGrants: []}, 'bound-profile'), false);
  assert.equal(canPersistUnionProfile({status: 'no-license', permissions: PERMISSION_MATRIX.free}, 'bound-profile'), false);
  assert.equal(canPersistUnionProfile({
    status: 'valid',
    permissions: PERMISSION_MATRIX.free,
    customProfileIds: [],
    activeGrants: [{offerType: 'skin_once', status: 'active', binding: {skinId: 'bound-profile'}}],
  }, 'bound-profile'), false);
});
