import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_THEME_PACK_CATALOG_DIR,
  THEME_PACK_INDEX_KIND,
  THEME_PACK_INDEX_PATH,
  getRegisteredThemePack,
  listRegisteredThemePacks,
  loadThemePackRegistry,
  themePackCatalogCard,
  validateThemePackIndex,
} from '../src/catalog/theme-pack.mjs';
import {PERMISSION_MATRIX, canUseFeature, canUseSkin} from '../src/entitlements.mjs';
import {defaultWeeklySchedule, validateWeeklySchedule} from '../src/schedule.mjs';
import {StudioServer} from '../src/server.mjs';

const REGISTERED_IDS = ['cr7-portugal', 'messi-argentina', 'neymar-brazil'];
const STORE_CARD_COPY = [
  {id: 'cr7-portugal', name: 'C罗灵感·葡萄牙7号星夜', country: '葡萄牙'},
  {id: 'messi-argentina', name: '梅西灵感·阿根廷10号月光', country: '阿根廷'},
  {id: 'neymar-brazil', name: '内马尔灵感·巴西10号热浪', country: '巴西'},
];
const CATALOG_REGISTERED_IDS = JSON.parse(fs.readFileSync(
  path.join(DEFAULT_THEME_PACK_CATALOG_DIR, THEME_PACK_INDEX_PATH),
  'utf8',
)).packs.map(({id}) => id);
const AGENT_GAME_IDS = [
  'agent-codex-terminal-orbit',
  'agent-claude-code-clay',
  'agent-grok-singularity',
  'agent-openclaw-gateway',
  'agent-hermes-memory',
  'agent-cursor-cube',
  'einstein-relativity',
  'honor-canyon-inspired',
  'last-circle-inspired',
  'radiant-arena-inspired',
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function copyCatalog() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-theme-registry-'));
  const catalogDir = path.join(root, 'catalog');
  fs.cpSync(DEFAULT_THEME_PACK_CATALOG_DIR, catalogDir, {recursive: true});
  return catalogDir;
}

function readIndex(catalogDir) {
  return JSON.parse(fs.readFileSync(path.join(catalogDir, THEME_PACK_INDEX_PATH), 'utf8'));
}

function writeIndex(catalogDir, index) {
  fs.writeFileSync(
    path.join(catalogDir, THEME_PACK_INDEX_PATH),
    `${JSON.stringify(index, null, 2)}\n`,
  );
}

test('strict Theme Pack registry lists exactly the release packs and projects safe catalog cards', () => {
  const registry = loadThemePackRegistry();
  const allRegisteredIds = CATALOG_REGISTERED_IDS;
  assert.equal(registry.kind, THEME_PACK_INDEX_KIND);
  assert.deepEqual(registry.entries.map((entry) => entry.id), allRegisteredIds);
  assert.deepEqual(registry.packs.map((pack) => pack.id), allRegisteredIds);
  assert.equal(AGENT_GAME_IDS.every((id) => allRegisteredIds.includes(id)), true);
  assert.equal(Object.isFrozen(registry), true);
  assert.deepEqual(listRegisteredThemePacks({clientId: 'workbuddy'}).map((pack) => pack.id), allRegisteredIds);
  const vipIds = registry.packs.filter((pack) => pack.tier === 'vip').map((pack) => pack.id);
  assert.deepEqual(listRegisteredThemePacks({clientId: 'codex', tier: 'vip'}).map((pack) => pack.id), vipIds);
  assert.equal(REGISTERED_IDS.every((id) => vipIds.includes(id)), true);
  assert.equal(getRegisteredThemePack('missing-pack'), null);

  const workbuddyCards = listRegisteredThemePacks({clientId: 'workbuddy', tier: 'vip'})
    .filter((pack) => REGISTERED_IDS.includes(pack.id))
    .map((pack) => themePackCatalogCard(pack, 'workbuddy'));
  assert.deepEqual(
    workbuddyCards.map((card) => ({id: card.id, name: card.name})),
    STORE_CARD_COPY.map(({id, name}) => ({id, name})),
  );
  assert.equal(workbuddyCards.every((card) => card.tier === 'vip'), true);
  assert.equal(workbuddyCards.every((card) => card.runtimeStatus === 'available'), true);
  assert.equal(workbuddyCards.every((card) => card.applySupported && !card.designPreview), true);
  assert.equal(workbuddyCards.every((card) => card.hasArtwork && card.hasBrand), true);
  assert.equal(workbuddyCards.every((card) => card.hasProjectHero && card.hasBanner === false), true,
    'WorkBuddy 的项目 Hero 是其可投影资产；Codex Banner 不能被伪装成 WorkBuddy 功能');
  assert.equal(workbuddyCards.every((card) => card.hasComposerAvatar === true), true,
    'WorkBuddy 目录卡必须标记经过透明主体校验的输入框悬浮素材');
  assert.equal(workbuddyCards.every((card) =>
    typeof card.previewArtwork === 'string' && card.previewArtwork.startsWith('data:image/webp;base64,')
  ), true, '目录卡必须使用校验后的本地真实素材预览');
  assert.equal(
    workbuddyCards.every((card, index) => card.description.includes(STORE_CARD_COPY[index].country)),
    true,
    '商店卡必须保留球星灵感的国家队识别与完整本地素材标记',
  );
  assert.equal(new Set(workbuddyCards.map((card) => card.preview.gradientPreset)).size, 3);

  const codexCards = listRegisteredThemePacks({clientId: 'codex', tier: 'vip'})
    .filter((pack) => REGISTERED_IDS.includes(pack.id))
    .map((pack) => themePackCatalogCard(pack, 'codex'));
  assert.equal(codexCards.length, 3);
  assert.equal(codexCards.every((card) => card.hasArtwork && card.hasBrand && card.hasBanner), true,
    'Codex 卡必须诚实携带来源 Brand/Banner 标记，供原生端与有效 capability 交集后再标注是否可应用');
  assert.equal(codexCards.every((card) => card.hasProjectHero === false), true,
    'WorkBuddy 项目 Hero 不应被投影到 Codex 卡');
  assert.equal(codexCards.every((card) => card.hasComposerAvatar === true), true,
    '共享输入框机器人必须投影到 Codex 卡');

  const doubaoCards = listRegisteredThemePacks({clientId: 'doubao', tier: 'vip'})
    .filter((pack) => REGISTERED_IDS.includes(pack.id))
    .map((pack) => themePackCatalogCard(pack, 'doubao'));
  assert.equal(doubaoCards.length, 3);
  assert.equal(doubaoCards.every((card) => card.kind === 'theme-pack'), true);
  assert.equal(doubaoCards.every((card) => card.runtimeStatus === 'available'), true);
  assert.equal(doubaoCards.every((card) => card.applySupported === true && card.designPreview === false), true);
  assert.equal(doubaoCards.every((card) => card.hasArtwork && card.hasBrand), true);
  assert.equal(doubaoCards.every((card) => card.hasComposerAvatar === true), true,
    '共享输入框机器人必须投影到豆包卡');
  assert.equal(doubaoCards.every((card) =>
    typeof card.previewArtwork === 'string' && card.previewArtwork.startsWith('data:image/webp;base64,')
  ), true, '豆包 exact 已开放基础三能力，预览素材与可应用能力一致');
});

test('registry rejects duplicate IDs, duplicate paths, and definition hash drift', () => {
  const duplicateIdCatalog = copyCatalog();
  const duplicateId = readIndex(duplicateIdCatalog);
  duplicateId.packs.push({...duplicateId.packs[0], path: 'theme-packs/fixtures/cross-agent-sample.json'});
  assert.throws(() => validateThemePackIndex(duplicateId), /ID 重复/u);

  const duplicatePathCatalog = copyCatalog();
  const duplicatePath = readIndex(duplicatePathCatalog);
  duplicatePath.packs.push({...duplicatePath.packs[0], id: 'another-pack'});
  assert.throws(() => validateThemePackIndex(duplicatePath), /路径重复/u);

  const driftCatalog = copyCatalog();
  const driftIndex = readIndex(driftCatalog);
  const definitionPath = path.join(driftCatalog, driftIndex.packs[0].path);
  fs.appendFileSync(definitionPath, '\n');
  assert.throws(() => loadThemePackRegistry({catalogDir: driftCatalog}), /定义 SHA-256 校验失败/u);
});

test('registry rejects index/definition ID mismatch and collisions with legacy catalog IDs', () => {
  const mismatchCatalog = copyCatalog();
  const mismatch = readIndex(mismatchCatalog);
  mismatch.packs[0].id = 'index-says-another-id';
  writeIndex(mismatchCatalog, mismatch);
  assert.throws(() => loadThemePackRegistry({catalogDir: mismatchCatalog}), /ID 与定义不一致/u);

  const collisionCatalog = copyCatalog();
  const source = JSON.parse(fs.readFileSync(
    path.join(collisionCatalog, 'theme-packs', 'cr7-portugal.json'),
    'utf8',
  ));
  source.id = 'dream-portal';
  const definition = Buffer.from(`${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const relativePath = 'theme-packs/legacy-id-conflict.json';
  fs.writeFileSync(path.join(collisionCatalog, relativePath), definition);
  writeIndex(collisionCatalog, {
    schemaVersion: 1,
    kind: THEME_PACK_INDEX_KIND,
    packs: [{id: source.id, path: relativePath, sha256: sha256(definition)}],
  });
  assert.throws(() => loadThemePackRegistry({catalogDir: collisionCatalog}), /旧版内置皮肤冲突/u);
});

test('server merges legacy and Theme Pack catalogs including apply-ready Doubao packs', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-theme-server-'));
  const studio = new StudioServer({dataDir});
  const workbuddy = await studio.catalogSkins('workbuddy');
  const codex = await studio.catalogSkins('codex');
  const doubao = await studio.catalogSkins('doubao');

  const allRegisteredIds = CATALOG_REGISTERED_IDS;
  assert.equal(new Set(workbuddy.map(({id}) => id)).size, workbuddy.length);
  assert.equal(new Set(codex.map(({id}) => id)).size, codex.length);
  assert.equal(new Set(doubao.map(({id}) => id)).size, doubao.length);
  assert.equal(allRegisteredIds.every((id) => workbuddy.some((skin) => skin.id === id)), true);
  assert.equal(allRegisteredIds.every((id) => codex.some((skin) => skin.id === id)), true);
  assert.equal(allRegisteredIds.every((id) => doubao.some((skin) => skin.id === id)), true);
  assert.equal(workbuddy.filter((skin) => skin.kind === 'legacy-v1').length, 7);
  assert.equal(codex.filter((skin) => skin.kind === 'legacy-v1').length, 7);
  assert.equal(doubao.every((skin) => skin.applySupported === true && skin.designPreview === false), true);
});

test('registered packs resolve for WorkBuddy/Codex/Doubao and obey entitlements', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-theme-resolve-'));
  const studio = new StudioServer({dataDir});
  const workbuddy = studio.resolveSkin('cr7-portugal', 'workbuddy');
  const codex = studio.resolveSkin('messi-argentina', 'codex');
  assert.equal(workbuddy.profileKind, 'theme-pack');
  assert.match(workbuddy.profile.advanced.background.image, /^data:image\/webp;base64,/u);
  assert.match(workbuddy.profile.advanced.workbuddy.projectHero.image, /^data:image\/webp;base64,/u);
  assert.equal(codex.profileKind, 'theme-pack');
  assert.match(codex.profile.advanced.background.image, /^data:image\/webp;base64,/u);
  const doubao = studio.resolveSkin('neymar-brazil', 'doubao');
  assert.equal(doubao.profileKind, 'theme-pack');
  assert.match(doubao.profile.advanced.background.image, /^data:image\/webp;base64,/u);
  assert.equal(doubao.profile.official.accent.length > 0, true);

  const pack = getRegisteredThemePack('cr7-portugal');
  const free = {permissions: PERMISSION_MATRIX.free, skinIds: []};
  const purchased = {permissions: PERMISSION_MATRIX.free, skinIds: ['cr7-portugal']};
  const vip = {
    tier: 'vip',
    source: 'license',
    status: 'valid',
    permissions: PERMISSION_MATRIX.vip,
    skinIds: [],
  };
  assert.equal(canUseSkin(free, pack), false);
  assert.equal(canUseSkin(purchased, pack), true);
  assert.equal(canUseSkin(vip, pack), true);
  assert.equal(canUseFeature(free, 'weeklySchedule'), false);
  assert.equal(canUseFeature(vip, 'weeklySchedule'), true);
});

test('weekly schedule accepts registered Theme Pack IDs for both schedulable clients', () => {
  const schedule = structuredClone(defaultWeeklySchedule({timeZone: 'Asia/Shanghai'}));
  schedule.enabled = true;
  schedule.clients.workbuddy.monday = 'cr7-portugal';
  schedule.clients.codex.monday = 'messi-argentina';
  const validated = validateWeeklySchedule(schedule);
  assert.equal(validated.clients.workbuddy.monday, 'cr7-portugal');
  assert.equal(validated.clients.codex.monday, 'messi-argentina');
  assert.equal(getRegisteredThemePack(validated.clients.workbuddy.monday, {clientId: 'workbuddy'}).tier, 'vip');
  assert.equal(getRegisteredThemePack(validated.clients.codex.monday, {clientId: 'codex'}).tier, 'vip');
});
