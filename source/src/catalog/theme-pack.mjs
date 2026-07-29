import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  UNION_CLIENT_IDS,
  UNION_FIELDS,
  UNION_SCHEMA_VERSION,
  getClientCapabilityMap,
  getUnionField,
  normalizeUnionProfile,
} from '../capability-schema.mjs';
import {CATALOG_TIERS, GRADIENT_PRESETS, loadBuiltInCatalog} from '../catalog.mjs';
import {validateImageDataUrl} from '../profile.mjs';
import {normalizeUnionProfileRecord, unionProfileToLegacyV1} from '../union-profile.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const THEME_PACK_SCHEMA_VERSION = 1;
export const THEME_PACK_KIND = 'lingglow.theme-pack';
export const THEME_PACK_INDEX_KIND = 'lingglow.theme-pack-index';
export const THEME_PACK_CLIENT_IDS = UNION_CLIENT_IDS;
export const DEFAULT_THEME_PACK_CATALOG_DIR = path.resolve(MODULE_DIR, '..', '..', 'catalog');
export const THEME_PACK_INDEX_PATH = 'theme-packs/index.json';

const PACK_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SAFE_ASSET_PATH = /^assets\/[a-z0-9][a-z0-9-]{0,63}\.webp$/u;
const SAFE_PACK_PATH = /^theme-packs\/(?:[a-z0-9][a-z0-9-]{0,47}\/)*[a-z0-9][a-z0-9-]{0,47}\.json$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const FORBIDDEN_URI = /(?:https?|file|data|javascript|vbscript):/iu;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PACK_FILE_BYTES = 128 * 1024;
const MAX_PACK_INDEX_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 20_000;
const TIER_SET = new Set(CATALOG_TIERS);
const PREVIEW_SET = new Set(GRADIENT_PRESETS);
const CLIENT_ID_SET = new Set(THEME_PACK_CLIENT_IDS);
// Published v1 packs predate the per-pack mascot motion field. Migrate only
// those known IDs deterministically; current bundled packs declare the field.
const LEGACY_STATIC_MOTION_BY_PACK_ID = Object.freeze({
  'agent-antigravity-orbit-lab': 'roll',
  'agent-claude-code-clay': 'hop',
  'agent-codex-terminal-orbit': 'roll',
  'agent-cursor-cube': 'roll',
  'agent-grok-singularity': 'roll',
  'agent-hermes-memory': 'hop',
  'agent-openclaw-gateway': 'hop',
  'baxian-cao-guojiu': 'hop',
  'baxian-ensemble': 'float',
  'baxian-lan-caihe': 'hop',
  'baxian-tieguai-li': 'hop',
  'baxian-zhang-guolao': 'hop',
  'honor-canyon-inspired': 'hop',
  'kungfu-womens-football': 'hop',
  'last-circle-inspired': 'roll',
  'spain-2026-champions': 'still',
});
const ASSET_FIELD_BY_SLOT = new Map(
  UNION_FIELDS.filter((field) => field.type === 'asset').map((field) => [field.assetSlot, field]),
);

function cloneJson(value, state = {depth: 0, nodes: {count: 0}}) {
  state.nodes.count += 1;
  if (state.depth > MAX_JSON_DEPTH || state.nodes.count > MAX_JSON_NODES) {
    throw new Error('Theme Pack JSON 过深或节点过多');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Theme Pack 不能包含非有限数字');
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJson(entry, {depth: state.depth + 1, nodes: state.nodes}));
  }
  if (!value || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('Theme Pack 只能包含普通 JSON 值');
  }
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (RESERVED_KEYS.has(key)) throw new Error(`Theme Pack 包含保留键：${key}`);
    result[key] = cloneJson(nested, {depth: state.depth + 1, nodes: state.nodes});
  }
  return result;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label} 必须是普通对象`);
  }
  return value;
}

function exactKeys(value, required, optional, label) {
  plainObject(value, label);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length) throw new Error(`${label} 包含未允许字段：${unknown.join(', ')}`);
  if (missing.length) throw new Error(`${label} 缺少字段：${missing.join(', ')}`);
}

function safeText(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || [...normalized].length > maxLength || /[<>]/u.test(normalized) ||
      /\p{Cc}/u.test(normalized) || FORBIDDEN_URI.test(normalized)) {
    throw new Error(`${label} 不合法`);
  }
  return normalized;
}

function validateAssetReference(value, descriptor, assets, label) {
  if (value === null && descriptor.constraints.nullable === true) return null;
  exactKeys(value, ['assetId'], [], label);
  if (typeof value.assetId !== 'string' || !ASSET_ID.test(value.assetId)) {
    throw new Error(`${label}.assetId 不合法`);
  }
  const asset = assets[value.assetId];
  if (!asset) throw new Error(`${label} 引用了未声明资源：${value.assetId}`);
  if (asset.slot !== descriptor.assetSlot) {
    throw new Error(`${label} 的资源槽必须是 ${descriptor.assetSlot}`);
  }
  return {assetId: value.assetId};
}

function validateUnionValues(valuesInput, {assets, overrideClientId = null, label}) {
  const values = plainObject(valuesInput, label);
  const normalized = {};
  for (const [fieldId, sourceValue] of Object.entries(values)) {
    const descriptor = getUnionField(fieldId);
    if (!descriptor) throw new Error(`${label} 包含未知 Union 字段：${fieldId}`);
    if (overrideClientId !== null && !descriptor.clients.includes(overrideClientId)) {
      throw new Error(`${label}.${fieldId} 不适用于 ${overrideClientId}`);
    }
    if (descriptor.type === 'asset') {
      normalized[fieldId] = validateAssetReference(sourceValue, descriptor, assets, `${label}.${fieldId}`);
      continue;
    }
    normalized[fieldId] = normalizeUnionProfile({
      schemaVersion: UNION_SCHEMA_VERSION,
      values: {[fieldId]: sourceValue},
    }).values[fieldId];
  }
  return normalized;
}

function validateAssets(assetsInput) {
  const assets = plainObject(assetsInput, 'assets');
  const normalized = {};
  for (const [assetId, assetInput] of Object.entries(assets)) {
    if (!ASSET_ID.test(assetId)) throw new Error(`资源 ID 不合法：${assetId}`);
    const asset = plainObject(assetInput, `assets.${assetId}`);
    exactKeys(asset, ['slot', 'path', 'sha256'], [], `assets.${assetId}`);
    if (typeof asset.slot !== 'string' || !ASSET_FIELD_BY_SLOT.has(asset.slot)) {
      throw new Error(`assets.${assetId}.slot 不是 Union Schema 声明的图片槽`);
    }
    if (typeof asset.path !== 'string' || !SAFE_ASSET_PATH.test(asset.path) || FORBIDDEN_URI.test(asset.path)) {
      throw new Error(`assets.${assetId}.path 必须是 catalog/assets 下的安全 WebP`);
    }
    if (typeof asset.sha256 !== 'string' || !SHA256.test(asset.sha256)) {
      throw new Error(`assets.${assetId}.sha256 必须是小写 SHA-256`);
    }
    normalized[assetId] = {...asset};
  }
  return normalized;
}

function referencedAssetIds(pack) {
  const ids = new Set(pack.preview.assetId === null ? [] : [pack.preview.assetId]);
  const collect = (values) => {
    for (const [fieldId, value] of Object.entries(values)) {
      if (getUnionField(fieldId)?.type === 'asset' && value !== null) ids.add(value.assetId);
    }
  };
  collect(pack.base);
  for (const values of Object.values(pack.overrides)) collect(values);
  return ids;
}

export function validateThemePack(input) {
  const value = cloneJson(input);
  exactKeys(value, [
    'schemaVersion', 'kind', 'id', 'name', 'description', 'tier',
    'clientIds', 'preview', 'assets', 'base', 'overrides',
  ], [], 'Theme Pack');
  if (value.schemaVersion !== THEME_PACK_SCHEMA_VERSION) throw new Error('不支持的 Theme Pack schemaVersion');
  if (value.kind !== THEME_PACK_KIND) throw new Error('Theme Pack kind 不合法');
  if (typeof value.id !== 'string' || !PACK_ID.test(value.id)) throw new Error('Theme Pack id 不合法');
  value.name = safeText(value.name, 'Theme Pack name', 60);
  value.description = safeText(value.description, 'Theme Pack description', 240);
  if (!TIER_SET.has(value.tier)) throw new Error('Theme Pack tier 不合法');
  if (!Array.isArray(value.clientIds) || value.clientIds.length === 0 ||
      new Set(value.clientIds).size !== value.clientIds.length ||
      !value.clientIds.every((clientId) => CLIENT_ID_SET.has(clientId))) {
    throw new Error('Theme Pack clientIds 必须来自 capability union 且不能重复');
  }

  exactKeys(value.preview, ['gradientPreset', 'assetId'], [], 'preview');
  if (!PREVIEW_SET.has(value.preview.gradientPreset)) throw new Error('preview.gradientPreset 不在白名单');
  if (value.preview.assetId !== null &&
      (typeof value.preview.assetId !== 'string' || !ASSET_ID.test(value.preview.assetId))) {
    throw new Error('preview.assetId 不合法');
  }

  value.assets = validateAssets(value.assets);
  if (value.preview.assetId !== null && !value.assets[value.preview.assetId]) {
    throw new Error('preview.assetId 引用了未声明资源');
  }
  value.base = validateUnionValues(value.base, {assets: value.assets, label: 'base'});
  if (value.base['workbuddy.composerAvatar.image'] !== undefined &&
      value.base['workbuddy.composerAvatar.image'] !== null &&
      !Object.hasOwn(value.base, 'workbuddy.composerAvatar.activityMotion')) {
    value.base['workbuddy.composerAvatar.activityMotion'] =
      LEGACY_STATIC_MOTION_BY_PACK_ID[value.id] ?? 'float';
  }
  const overrideInput = plainObject(value.overrides, 'overrides');
  const overrides = {};
  for (const [clientId, fields] of Object.entries(overrideInput)) {
    if (!value.clientIds.includes(clientId)) {
      throw new Error(`overrides.${clientId} 未在 Theme Pack clientIds 中声明`);
    }
    overrides[clientId] = validateUnionValues(fields, {
      assets: value.assets,
      overrideClientId: clientId,
      label: `overrides.${clientId}`,
    });
  }
  value.overrides = overrides;

  const used = referencedAssetIds(value);
  const unused = Object.keys(value.assets).filter((assetId) => !used.has(assetId));
  if (unused.length) throw new Error(`Theme Pack 包含未使用资源：${unused.join(', ')}`);
  return deepFreeze(value);
}

export function getThemePackAuthoringSchema() {
  return deepFreeze({
    schemaVersion: UNION_SCHEMA_VERSION,
    clientIds: [...THEME_PACK_CLIENT_IDS],
    fields: UNION_FIELDS.map((field) => ({...field, clients: [...field.clients]})),
  });
}

export function getThemePackProjectionSchema(clientId) {
  if (!CLIENT_ID_SET.has(clientId)) throw new Error(`未知 capability union 客户端：${clientId}`);
  const capabilityMap = getClientCapabilityMap(clientId);
  return deepFreeze({
    schemaVersion: UNION_SCHEMA_VERSION,
    targetClientId: clientId,
    runtimeStatus: capabilityMap.runtimeStatus,
    transportVerified: capabilityMap.transportVerified,
    fields: UNION_FIELDS
      .filter((field) => field.clients.includes(clientId))
      .map((field) => ({
        ...field,
        clients: [...field.clients],
        support: {...capabilityMap.fields[field.id]},
      })),
  });
}

function assertDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label}不安全`);
  return directory;
}

function assertSafeDirectoryChain(root, directory) {
  const rootResolved = path.resolve(root);
  const target = path.resolve(directory);
  if (target !== rootResolved && !target.startsWith(`${rootResolved}${path.sep}`)) throw new Error('目录路径越界');
  assertDirectory(rootResolved, 'catalog 目录');
  let current = rootResolved;
  const relative = path.relative(rootResolved, target);
  if (!relative) return;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    assertDirectory(current, 'catalog 子目录');
  }
}

function readRegularFileNoFollow(filePath, {label, maxBytes}) {
  let fd = null;
  try {
    const before = fs.lstatSync(filePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
        before.size <= 0 || before.size > maxBytes) {
      throw new Error(`${label} 不安全或超过 ${maxBytes} 字节`);
    }
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size || opened.size <= 0 || opened.size > maxBytes) {
      throw new Error(`${label} 在打开时发生变化`);
    }
    const buffer = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
        buffer.length !== opened.size || buffer.length > maxBytes) {
      throw new Error(`${label} 大小在读取时发生变化`);
    }
    return buffer;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error(`${label} 不安全`, {cause: error});
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function readStaticWebP(buffer, label) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) {
    throw new Error(`${label} 不是完整 WebP`);
  }
  let offset = 12;
  let canvas = null;
  let canvasCount = 0;
  let primary = null;
  let primaryCount = 0;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const next = dataEnd + (size % 2);
    if (dataEnd > buffer.length || next > buffer.length) throw new Error(`${label} WebP chunk 越界`);
    if (type === 'ANIM' || type === 'ANMF') throw new Error(`${label} 必须是静态 WebP`);
    if (type === 'VP8X') {
      canvasCount += 1;
      if (size !== 10) throw new Error(`${label} VP8X 头无效`);
      if ((buffer[dataStart] & 0x02) !== 0) throw new Error(`${label} 必须是静态 WebP`);
      if ((buffer[dataStart] & 0xc1) !== 0) throw new Error(`${label} VP8X 保留位无效`);
      canvas = {
        width: buffer.readUIntLE(dataStart + 4, 3) + 1,
        height: buffer.readUIntLE(dataStart + 7, 3) + 1,
      };
    } else if (type === 'VP8 ') {
      primaryCount += 1;
      if (size < 10 || buffer[dataStart + 3] !== 0x9d ||
          buffer[dataStart + 4] !== 0x01 || buffer[dataStart + 5] !== 0x2a) {
        throw new Error(`${label} VP8 图像头无效`);
      }
      primary = {
        width: buffer.readUInt16LE(dataStart + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataStart + 8) & 0x3fff,
      };
    } else if (type === 'VP8L') {
      primaryCount += 1;
      if (size < 5 || buffer[dataStart] !== 0x2f) throw new Error(`${label} VP8L 图像头无效`);
      const bits = buffer.readUInt32LE(dataStart + 1);
      primary = {width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1};
    }
    offset = next;
  }
  if (offset !== buffer.length || primaryCount !== 1 || canvasCount > 1) {
    throw new Error(`${label} WebP 图像数据无效`);
  }
  if (canvas && (canvas.width !== primary.width || canvas.height !== primary.height)) {
    throw new Error(`${label} WebP 画布与主图尺寸不一致`);
  }
  const dimensions = canvas ?? primary;
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new Error(`${label} WebP 尺寸无效`);
  return dimensions;
}

function readLockedAsset(asset, {catalogDir, label}) {
  const catalogRoot = path.resolve(catalogDir);
  const assetsDirectory = path.join(catalogRoot, 'assets');
  assertSafeDirectoryChain(catalogRoot, assetsDirectory);
  const filePath = path.resolve(catalogRoot, asset.path);
  if (path.dirname(filePath) !== assetsDirectory || !SAFE_ASSET_PATH.test(asset.path)) {
    throw new Error(`${label} 路径越界`);
  }
  const descriptor = ASSET_FIELD_BY_SLOT.get(asset.slot);
  const maxBytes = descriptor.constraints.maxBytes;
  const buffer = readRegularFileNoFollow(filePath, {label, maxBytes});
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest !== asset.sha256) throw new Error(`${label} SHA-256 校验失败`);
  const dimensions = readStaticWebP(buffer, label);
  if (dimensions.width > descriptor.constraints.maxDimension ||
      dimensions.height > descriptor.constraints.maxDimension ||
      dimensions.width * dimensions.height > descriptor.constraints.maxPixels) {
    throw new Error(`${label} 尺寸超过 Union Schema 限制`);
  }
  return buffer;
}

export function loadThemePackFile(relativePath, {
  catalogDir = DEFAULT_THEME_PACK_CATALOG_DIR,
  expectedSha256 = null,
} = {}) {
  if (typeof relativePath !== 'string' || !SAFE_PACK_PATH.test(relativePath)) {
    throw new Error('Theme Pack 文件必须位于 catalog/theme-packs 下');
  }
  const catalogRoot = path.resolve(catalogDir);
  const filePath = path.resolve(catalogRoot, relativePath);
  const packRoot = path.join(catalogRoot, 'theme-packs');
  if (!filePath.startsWith(`${packRoot}${path.sep}`)) throw new Error('Theme Pack 文件路径越界');
  assertSafeDirectoryChain(catalogRoot, path.dirname(filePath));
  const contents = readRegularFileNoFollow(filePath, {label: 'Theme Pack 文件', maxBytes: MAX_PACK_FILE_BYTES});
  if (expectedSha256 !== null) {
    if (typeof expectedSha256 !== 'string' || !SHA256.test(expectedSha256)) {
      throw new Error('Theme Pack 预期 SHA-256 不合法');
    }
    const actualSha256 = createHash('sha256').update(contents).digest('hex');
    if (actualSha256 !== expectedSha256) throw new Error('Theme Pack 定义 SHA-256 校验失败');
  }
  const pack = validateThemePack(JSON.parse(contents.toString('utf8')));
  for (const [assetId, asset] of Object.entries(pack.assets)) {
    readLockedAsset(asset, {catalogDir: catalogRoot, label: `assets.${assetId}`});
  }
  return pack;
}

export function validateThemePackIndex(input) {
  const value = cloneJson(input);
  exactKeys(value, ['schemaVersion', 'kind', 'packs'], [], 'Theme Pack 索引');
  if (value.schemaVersion !== THEME_PACK_SCHEMA_VERSION) {
    throw new Error('不支持的 Theme Pack 索引 schemaVersion');
  }
  if (value.kind !== THEME_PACK_INDEX_KIND) throw new Error('Theme Pack 索引 kind 不合法');
  if (!Array.isArray(value.packs) || value.packs.length === 0) {
    throw new Error('Theme Pack 索引 packs 必须是非空数组');
  }
  const ids = new Set();
  const paths = new Set();
  value.packs = value.packs.map((entry, index) => {
    exactKeys(entry, ['id', 'path', 'sha256'], [], `Theme Pack 索引 packs[${index}]`);
    if (typeof entry.id !== 'string' || !PACK_ID.test(entry.id)) {
      throw new Error(`Theme Pack 索引 packs[${index}].id 不合法`);
    }
    if (typeof entry.path !== 'string' || !SAFE_PACK_PATH.test(entry.path) ||
        entry.path === THEME_PACK_INDEX_PATH || FORBIDDEN_URI.test(entry.path)) {
      throw new Error(`Theme Pack 索引 packs[${index}].path 不安全`);
    }
    if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) {
      throw new Error(`Theme Pack 索引 packs[${index}].sha256 不合法`);
    }
    if (ids.has(entry.id)) throw new Error(`Theme Pack 索引 ID 重复：${entry.id}`);
    if (paths.has(entry.path)) throw new Error(`Theme Pack 索引路径重复：${entry.path}`);
    ids.add(entry.id);
    paths.add(entry.path);
    return entry;
  });
  return deepFreeze(value);
}

export function loadThemePackRegistry({catalogDir = DEFAULT_THEME_PACK_CATALOG_DIR} = {}) {
  const catalogRoot = path.resolve(catalogDir);
  const indexPath = path.resolve(catalogRoot, THEME_PACK_INDEX_PATH);
  const packRoot = path.join(catalogRoot, 'theme-packs');
  if (path.dirname(indexPath) !== packRoot) throw new Error('Theme Pack 索引路径越界');
  assertSafeDirectoryChain(catalogRoot, packRoot);
  const indexBytes = readRegularFileNoFollow(indexPath, {
    label: 'Theme Pack 索引文件',
    maxBytes: MAX_PACK_INDEX_BYTES,
  });
  const index = validateThemePackIndex(JSON.parse(indexBytes.toString('utf8')));
  const legacyIds = new Set(loadBuiltInCatalog({catalogDir: catalogRoot}).skins.map((skin) => skin.id));
  const packs = index.packs.map((entry) => {
    const pack = loadThemePackFile(entry.path, {
      catalogDir: catalogRoot,
      expectedSha256: entry.sha256,
    });
    if (pack.id !== entry.id) {
      throw new Error(`Theme Pack 索引 ID 与定义不一致：${entry.id}`);
    }
    if (legacyIds.has(pack.id)) {
      throw new Error(`Theme Pack ID 与旧版内置皮肤冲突：${pack.id}`);
    }
    return pack;
  });
  return deepFreeze({
    schemaVersion: index.schemaVersion,
    kind: index.kind,
    entries: index.packs,
    packs,
  });
}

export function listRegisteredThemePacks({
  clientId,
  tier,
  catalogDir = DEFAULT_THEME_PACK_CATALOG_DIR,
} = {}) {
  if (clientId !== undefined && !CLIENT_ID_SET.has(clientId)) throw new Error('未知 Theme Pack 客户端');
  if (tier !== undefined && !TIER_SET.has(tier)) throw new Error('未知 Theme Pack 等级');
  const packs = loadThemePackRegistry({catalogDir}).packs.filter((pack) =>
    (clientId === undefined || pack.clientIds.includes(clientId)) &&
    (tier === undefined || pack.tier === tier));
  return deepFreeze(packs);
}

export function getRegisteredThemePack(id, {
  clientId,
  catalogDir = DEFAULT_THEME_PACK_CATALOG_DIR,
} = {}) {
  if (typeof id !== 'string' || !PACK_ID.test(id)) return null;
  if (clientId !== undefined && !CLIENT_ID_SET.has(clientId)) throw new Error('未知 Theme Pack 客户端');
  const pack = loadThemePackRegistry({catalogDir}).packs.find((entry) => entry.id === id) ?? null;
  if (!pack || (clientId !== undefined && !pack.clientIds.includes(clientId))) return null;
  return pack;
}

function projectedValue(values, fieldId) {
  if (Object.hasOwn(values, fieldId)) return values[fieldId];
  return getUnionField(fieldId).defaultValue;
}

export function themePackCatalogCard(packInput, clientId, {
  catalogDir = DEFAULT_THEME_PACK_CATALOG_DIR,
} = {}) {
  const pack = validateThemePack(packInput);
  const projection = projectThemePackValues(pack, clientId);
  const capabilityMap = getClientCapabilityMap(clientId);
  const values = projection.values;
  return deepFreeze({
    schemaVersion: pack.schemaVersion,
    kind: 'theme-pack',
    id: pack.id,
    name: pack.name,
    description: pack.description,
    tier: pack.tier,
    clientIds: pack.clientIds,
    preview: {gradientPreset: pack.preview.gradientPreset},
    // The catalog only ever exposes a data URL for an asset that has already
    // passed the Theme Pack's path, type, size, dimension and SHA-256 checks.
    // It gives the native menu a truthful visual card instead of a synthetic
    // gradient while preserving the no-remote-assets boundary.
    previewArtwork: materializeThemePackPreview(pack, {catalogDir}),
    hasArtwork: pack.preview.assetId !== null || projectedValue(values, 'background.image') !== null,
    hasProjectHero: Object.hasOwn(values, 'workbuddy.projectHero.image') &&
      values['workbuddy.projectHero.image'] !== null,
    hasComposerAvatar: Object.hasOwn(values, 'workbuddy.composerAvatar.image') &&
      values['workbuddy.composerAvatar.image'] !== null,
    hasBrand: projectedValue(values, 'brand.enabled') === true,
    // Keep the source feature separate from its runtime delivery.  A Codex
    // Theme Pack can carry a Banner asset even while the current renderer is
    // in generic-safe mode, where Banner is deliberately not compiled.  The
    // native catalog combines this honest source marker with the status
    // payload's effective capability list before it labels the card.
    hasBanner: Object.hasOwn(values, 'codex.banner.enabled') &&
      values['codex.banner.enabled'] === true &&
      Object.hasOwn(values, 'codex.banner.image') &&
      values['codex.banner.image'] !== null,
    colors: {
      accent: projectedValue(values, 'appearance.accent'),
      surface: projectedValue(values, 'appearance.surface'),
      ink: projectedValue(values, 'appearance.ink'),
    },
    runtimeStatus: capabilityMap.runtimeStatus,
    applySupported: capabilityMap.runtimeStatus === 'available',
    designPreview: capabilityMap.runtimeStatus !== 'available',
  });
}

export function projectThemePackValues(packInput, clientId) {
  const pack = validateThemePack(packInput);
  if (!CLIENT_ID_SET.has(clientId)) throw new Error(`未知 capability union 客户端：${clientId}`);
  if (!pack.clientIds.includes(clientId)) throw new Error('该 Theme Pack 不支持所选客户端');
  const merged = {...pack.base, ...(pack.overrides[clientId] ?? {})};
  const values = Object.fromEntries(
    Object.entries(merged).filter(([fieldId]) => getUnionField(fieldId).clients.includes(clientId)),
  );
  return deepFreeze({targetClientId: clientId, values});
}

function resolveProjectedAssets(projection, pack, catalogDir) {
  const values = {};
  for (const [fieldId, value] of Object.entries(projection.values)) {
    const descriptor = getUnionField(fieldId);
    if (descriptor.type !== 'asset' || value === null) {
      values[fieldId] = cloneJson(value);
      continue;
    }
    const asset = pack.assets[value.assetId];
    const buffer = readLockedAsset(asset, {catalogDir, label: `assets.${value.assetId}`});
    const dataURL = `data:image/webp;base64,${buffer.toString('base64')}`;
    if (descriptor.constraints.requireIsolatedSubject === true) {
      try {
        values[fieldId] = validateImageDataUrl(dataURL, {
          optional: descriptor.constraints.nullable === true,
          maxBytes: descriptor.constraints.maxBytes,
          maxDimension: descriptor.constraints.maxDimension,
          maxPixels: descriptor.constraints.maxPixels,
          label: fieldId,
          requireIsolatedSubject: true,
        });
      } catch {
        // A theme must remain usable even if an official or remote bundle
        // carries a background crop in the mascot slot.  Omitting the asset
        // makes WorkBuddy retain its native default robot.
        values[fieldId] = null;
      }
      continue;
    }
    values[fieldId] = dataURL;
  }
  return values;
}

export function materializeThemePackUnionProfile(packInput, clientId, {
  catalogDir = DEFAULT_THEME_PACK_CATALOG_DIR,
} = {}) {
  const pack = validateThemePack(packInput);
  const projection = projectThemePackValues(pack, clientId);
  const capabilityMap = getClientCapabilityMap(clientId);
  if (capabilityMap.runtimeStatus !== 'available') {
    const error = new Error(`${clientId} 当前 capability map 为 blocked，禁止物化 Theme Pack`);
    error.code = 'CLIENT_CAPABILITY_BLOCKED';
    throw error;
  }
  return deepFreeze(normalizeUnionProfileRecord({
    id: pack.id,
    name: pack.name,
    targetClientId: clientId,
    schemaVersion: UNION_SCHEMA_VERSION,
    sourceThemePackId: pack.id,
    values: resolveProjectedAssets(projection, pack, catalogDir),
  }));
}

export function materializeThemePack(packInput, clientId, options = {}) {
  const unionProfile = materializeThemePackUnionProfile(packInput, clientId, options);
  return unionProfileToLegacyV1(unionProfile, clientId);
}

export function materializeThemePackPreview(packInput, {
  catalogDir = DEFAULT_THEME_PACK_CATALOG_DIR,
} = {}) {
  const pack = validateThemePack(packInput);
  if (pack.preview.assetId === null) return null;
  const asset = pack.assets[pack.preview.assetId];
  return `data:image/webp;base64,${readLockedAsset(asset, {
    catalogDir,
    label: `assets.${pack.preview.assetId}`,
  }).toString('base64')}`;
}
