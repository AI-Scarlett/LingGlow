import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {getClientCapabilityMap} from './capability-schema.mjs';
import {materializeCatalogProfile, validateCatalogSkin} from './catalog.mjs';
import {
  materializeThemePack,
  themePackCatalogCard,
  validateThemePack,
} from './catalog/theme-pack.mjs';

const DEFAULT_INDEX_URL =
  'https://raw.githubusercontent.com/AI-Scarlett/LingGlow/main/catalog/v1/index.json';
const INDEX_MAX_BYTES = 512 * 1024;
const BUNDLE_MAX_BYTES = 32 * 1024 * 1024;
const DEFINITION_MAX_BYTES = 128 * 1024;
const ASSET_MAX_BYTES = 4 * 1024 * 1024;
const TOTAL_ASSET_MAX_BYTES = 24 * 1024 * 1024;
export const REMOTE_CATALOG_AUTO_REFRESH_MS = 60 * 60 * 1000;
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const HEX = /^#[0-9A-Fa-f]{6}$/u;
const ASSET_PATH = /^assets\/[a-z0-9][a-z0-9-]{0,63}\.webp$/u;
const FORBIDDEN_URI = /(?:https?|file|data|javascript|vbscript):/iu;

// The bundled catalog runs every displayed string through catalog.mjs's
// safeText.  The GitHub pipeline is the weaker trust anchor of the two, so it
// must not be allowed to hand the local UI a string the bundled one rejects.
function displayText(value, {minLength = 1, maxLength}) {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength &&
    !/\p{Cc}/u.test(value) && !FORBIDDEN_URI.test(value) && !/[<>]/u.test(value);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

function exactKeys(value, required, label) {
  const keys = Object.keys(object(value, label)).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} 字段不符合远程目录协议`);
  }
}

function exactKeysWithOptional(value, required, optional, label) {
  const keys = Object.keys(object(value, label));
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !allowed.has(key))) {
    throw new Error(`${label} 字段不符合远程目录协议`);
  }
}

function officialPreviewURL(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' ||
      !url.pathname.startsWith('/AI-Scarlett/LingGlow/main/catalog/v1/previews/')) {
    throw new Error('预览图地址不属于官方 LingGlow GitHub 目录');
  }
  return url.toString();
}

function officialPackageURL(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
      !url.pathname.startsWith('/AI-Scarlett/LingGlow/releases/download/skin-catalog-v1/')) {
    throw new Error('皮肤包地址不属于官方 LingGlow GitHub Release');
  }
  return url.toString();
}

function validateRemoteEntry(input) {
  exactKeysWithOptional(input, [
    'id', 'kind', 'version', 'name', 'description', 'tier', 'appearanceMode',
    'clientIds', 'category', 'series', 'tags', 'preview', 'colors', 'features', 'package',
  ], ['publishedAt'], 'skins[]');
  if (!ID.test(input.id)) throw new Error('远程皮肤 ID 不合法');
  if (!['legacy-v1', 'theme-pack'].includes(input.kind)) throw new Error('远程皮肤类型不合法');
  if (!VERSION.test(input.version)) throw new Error('远程皮肤版本不合法');
  if (!displayText(input.name, {maxLength: 80})) throw new Error('远程皮肤名称不合法');
  if (!displayText(input.description, {minLength: 0, maxLength: 500})) {
    throw new Error('远程皮肤描述不合法');
  }
  if (!['free', 'vip'].includes(input.tier)) throw new Error('远程皮肤等级不合法');
  if (input.publishedAt !== undefined &&
      (typeof input.publishedAt !== 'string' || Number.isNaN(Date.parse(input.publishedAt)))) {
    throw new Error('远程皮肤发布时间不合法');
  }
  if (!['light', 'dark'].includes(input.appearanceMode)) throw new Error('远程皮肤明暗模式不合法');
  if (!['sports', 'fantasy', 'nature', 'minimal', 'art', 'seasonal', 'other'].includes(input.category)) {
    throw new Error('远程皮肤分类不合法');
  }
  if (typeof input.series !== 'string' || !ID.test(input.series)) throw new Error('远程皮肤系列不合法');
  if (!Array.isArray(input.tags) || input.tags.length > 12 ||
      input.tags.some((tag) => !displayText(tag, {maxLength: 24})) ||
      new Set(input.tags).size !== input.tags.length) {
    throw new Error('远程皮肤标签不合法');
  }
  if (!Array.isArray(input.clientIds) || input.clientIds.length < 1 ||
      input.clientIds.some((id) => !['codex', 'workbuddy', 'doubao'].includes(id)) ||
      new Set(input.clientIds).size !== input.clientIds.length) {
    throw new Error('远程皮肤 Agent 列表不合法');
  }
  exactKeys(input.preview, ['url', 'sha256'], 'preview');
  officialPreviewURL(input.preview.url);
  if (!SHA256.test(input.preview.sha256)) throw new Error('预览图 SHA-256 不合法');
  exactKeys(input.colors, ['accent', 'surface', 'ink'], 'colors');
  for (const value of Object.values(input.colors)) {
    if (!HEX.test(value)) throw new Error('远程皮肤颜色不合法');
  }
  const featureKeys = ['artwork', 'projectHero', 'brand', 'banner'];
  exactKeys(
    input.features,
    Object.hasOwn(input.features, 'composerAvatar')
      ? [...featureKeys, 'composerAvatar']
      : featureKeys,
    'features',
  );
  if (Object.values(input.features).some((value) => typeof value !== 'boolean')) {
    throw new Error('远程皮肤能力标记不合法');
  }
  exactKeys(input.package, ['url', 'sha256', 'bytes'], 'package');
  officialPackageURL(input.package.url);
  if (!SHA256.test(input.package.sha256)) throw new Error('皮肤包 SHA-256 不合法');
  if (!Number.isSafeInteger(input.package.bytes) || input.package.bytes < 1 ||
      input.package.bytes > BUNDLE_MAX_BYTES) {
    throw new Error('皮肤包大小不合法');
  }
  return Object.freeze(structuredClone(input));
}

export function validateRemoteThemeCatalog(input) {
  exactKeys(input, ['schemaVersion', 'catalogVersion', 'generatedAt', 'minimumAppVersion', 'skins'], 'catalog');
  if (input.schemaVersion !== 2) throw new Error('不支持的远程皮肤目录版本');
  if (typeof input.catalogVersion !== 'string' || input.catalogVersion.length > 64) {
    throw new Error('远程目录版本不合法');
  }
  if (typeof input.generatedAt !== 'string' || Number.isNaN(Date.parse(input.generatedAt))) {
    throw new Error('远程目录时间不合法');
  }
  if (!VERSION.test(input.minimumAppVersion)) throw new Error('最低 App 版本不合法');
  if (!Array.isArray(input.skins) || input.skins.length > 200) throw new Error('远程皮肤列表不合法');
  const skins = input.skins.map(validateRemoteEntry);
  if (new Set(skins.map(({id}) => id)).size !== skins.length) throw new Error('远程皮肤 ID 重复');
  return Object.freeze({...structuredClone(input), skins});
}

function catalogRoot(dataDir) {
  return path.join(dataDir, 'remote-skin-catalog');
}

function installRoot(dataDir) {
  return path.join(dataDir, 'remote-theme-packs');
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('远程皮肤目录不安全');
  fs.chmodSync(directory, 0o700);
}

function atomicWrite(filePath, buffer) {
  ensurePrivateDirectory(path.dirname(filePath));
  const temporary = `${filePath}.tmp-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, buffer, {flag: 'wx', mode: 0o600});
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function boundedFile(filePath, maximum) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > maximum) {
    throw new Error('本地远程皮肤缓存不安全');
  }
  return fs.readFileSync(filePath);
}

function cachedCatalog(cachePath) {
  let stat;
  try {
    stat = fs.lstatSync(cachePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const buffer = boundedFile(cachePath, INDEX_MAX_BYTES);
  return Object.freeze({
    catalog: validateRemoteThemeCatalog(JSON.parse(buffer.toString('utf8'))),
    updatedAt: stat.mtimeMs,
  });
}

function refreshMode(value) {
  if (value === 'automatic' || value === 'manual') return value;
  throw new Error('远程模板同步模式不合法');
}

async function fetchBuffer(url, maximum) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {'User-Agent': 'LingGlow/remote-skin-catalog-v1'},
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maximum) throw new Error('远程文件超过大小限制');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1 || buffer.length > maximum) throw new Error('远程文件大小不合法');
  return buffer;
}

export async function loadRemoteThemeCatalog({
  dataDir,
  indexURL = DEFAULT_INDEX_URL,
  refresh = 'automatic',
  now = Date.now(),
} = {}) {
  const cachePath = path.join(catalogRoot(dataDir), 'index.json');
  const mode = refreshMode(refresh);
  const timestamp = Number.isFinite(now) ? now : Date.now();
  let cached = null;
  try {
    cached = cachedCatalog(cachePath);
  } catch {
    // A malformed cache is never used. A verified remote response may replace
    // it, but an unavailable network must not turn malformed data into UI data.
    cached = null;
  }
  if (mode === 'automatic' && cached && timestamp - cached.updatedAt < REMOTE_CATALOG_AUTO_REFRESH_MS) {
    return cached.catalog;
  }
  try {
    const parsedURL = new URL(indexURL);
    if (indexURL === DEFAULT_INDEX_URL) {
      officialPreviewURL(indexURL.replace('/index.json', '/previews/catalog.webp'));
    }
    if (parsedURL.protocol !== 'https:' && process.env.LINGGLOW_ALLOW_LOCAL_SKIN_CATALOG !== '1') {
      throw new Error('远程目录必须使用 HTTPS');
    }
    const buffer = await fetchBuffer(indexURL, INDEX_MAX_BYTES);
    const catalog = validateRemoteThemeCatalog(JSON.parse(buffer.toString('utf8')));
    atomicWrite(cachePath, buffer);
    return catalog;
  } catch (error) {
    if (!cached) throw error;
    return cached.catalog;
  }
}

function readReceipt(id, dataDir) {
  const receiptPath = path.join(installRoot(dataDir), id, 'receipt.json');
  if (!fs.existsSync(receiptPath)) return null;
  const receipt = JSON.parse(boundedFile(receiptPath, 16 * 1024).toString('utf8'));
  exactKeys(receipt, [
    'schemaVersion', 'id', 'kind', 'version', 'packageSHA256', 'definitionPath', 'installedAt',
  ], 'receipt');
  if (receipt.schemaVersion !== 1 || receipt.id !== id || !ID.test(receipt.id) ||
      !['legacy-v1', 'theme-pack'].includes(receipt.kind) || !VERSION.test(receipt.version) ||
      !SHA256.test(receipt.packageSHA256)) {
    throw new Error('已安装皮肤收据无效');
  }
  const expectedPath = receipt.kind === 'theme-pack'
    ? `theme-packs/${id}.json`
    : `skins/${id}.json`;
  if (receipt.definitionPath !== expectedPath) throw new Error('已安装皮肤定义路径无效');
  return receipt;
}

export function getInstalledRemoteSkin(id, {clientId, dataDir} = {}) {
  if (!ID.test(id)) return null;
  try {
    const receipt = readReceipt(id, dataDir);
    if (!receipt) return null;
    const localRoot = path.join(installRoot(dataDir), id);
    const localCatalog = path.join(localRoot, 'catalog');
    const definitionPath = path.join(localCatalog, receipt.definitionPath);
    const definition = JSON.parse(boundedFile(definitionPath, DEFINITION_MAX_BYTES).toString('utf8'));
    const skin = receipt.kind === 'theme-pack'
      ? validateThemePack(definition)
      : validateCatalogSkin(definition);
    if (skin.id !== id || (clientId && !skin.clientIds.includes(clientId))) return null;
    return Object.freeze({receipt, skin, catalogDir: localCatalog});
  } catch {
    // An install interrupted mid-write is reported as absent rather than
    // taken as an error: only this entry disappears, the rest of the catalog
    // keeps working, and reinstalling repairs the directory in place.
    return null;
  }
}

function legacyCard(skin, clientId, catalogDir) {
  const previewProfile = skin.asset ? materializeCatalogProfile(skin, {clientId, catalogDir}) : null;
  return {
    schemaVersion: skin.schemaVersion,
    kind: 'legacy-v1',
    id: skin.id,
    name: skin.name,
    description: skin.description,
    tier: skin.tier,
    clientIds: skin.clientIds,
    preview: skin.preview,
    previewArtwork: previewProfile?.advanced.background.image ?? null,
    hasArtwork: Boolean(skin.asset),
    hasProjectHero: Boolean(skin.projectHeroAsset),
    hasComposerAvatar: Boolean(skin.composerAvatarAsset),
    hasBrand: Boolean(skin.profile.advanced.brand?.enabled),
    hasBanner: false,
    colors: {
      accent: skin.profile.official.accent,
      surface: skin.profile.official.surface,
      ink: skin.profile.official.ink,
    },
    runtimeStatus: 'available',
    applySupported: true,
    designPreview: false,
  };
}

const LABEL_CATEGORY_SET = new Set([
  'basketball', 'football', 'film-ip', 'anime-ip',
  'novel-ip', 'game-ip', 'celebrity', 'other',
]);

function labelCategoryFromTags(tags) {
  const value = tags
    .find((tag) => tag.startsWith('label:'))
    ?.slice('label:'.length);
  return LABEL_CATEGORY_SET.has(value) ? value : 'other';
}

function remoteOnlyCard(entry, clientId) {
  const map = getClientCapabilityMap(clientId);
  const blocked = entry.kind === 'theme-pack' && map.runtimeStatus !== 'available';
  return {
    schemaVersion: 1,
    kind: entry.kind,
    id: entry.id,
    name: entry.name,
    description: entry.description,
    tier: entry.tier,
    clientIds: entry.clientIds,
    category: entry.category,
    labelCategory: labelCategoryFromTags(entry.tags),
    series: entry.series,
    tags: entry.tags,
    publishedAt: entry.publishedAt ?? null,
    preview: {gradientPreset: entry.appearanceMode === 'light' ? 'ocean' : 'graphite'},
    previewArtwork: null,
    hasArtwork: entry.features.artwork,
    hasProjectHero: entry.features.projectHero,
    hasComposerAvatar: entry.features.composerAvatar === true,
    hasBrand: entry.features.brand,
    hasBanner: entry.features.banner,
    colors: entry.colors,
    runtimeStatus: blocked ? map.runtimeStatus : 'available',
    applySupported: !blocked,
    designPreview: blocked,
  };
}

export async function listRemoteThemeCatalogCards(clientId, {dataDir, refresh = 'automatic'} = {}) {
  const catalog = await loadRemoteThemeCatalog({dataDir, refresh});
  return catalog.skins
    .filter((entry) => entry.clientIds.includes(clientId))
    .map((entry) => {
      let installed = getInstalledRemoteSkin(entry.id, {clientId, dataDir});
      let base = null;
      try {
        if (installed) {
          base = installed.receipt.kind === 'theme-pack'
            ? themePackCatalogCard(installed.skin, clientId, {catalogDir: installed.catalogDir})
            : legacyCard(installed.skin, clientId, installed.catalogDir);
        }
      } catch {
        // Damaged local artwork only costs this card its installed view; the
        // remote-only card keeps the entry listed and reinstallable.
        installed = null;
      }
      return Object.freeze({
        ...(base ?? remoteOnlyCard(entry, clientId)),
        category: entry.category,
        labelCategory: labelCategoryFromTags(entry.tags),
        series: entry.series,
        tags: entry.tags,
        publishedAt: entry.publishedAt ?? null,
        previewArtworkURL: entry.preview.url,
        installed: Boolean(installed),
        updateAvailable: Boolean(installed && installed.receipt.packageSHA256 !== entry.package.sha256),
        packageVersion: entry.version,
        downloadBytes: entry.package.bytes,
        distribution: 'github',
      });
    });
}

function decodePayload(payload, label, maximum) {
  exactKeys(payload, ['path', 'sha256', 'dataBase64'], label);
  if (!SHA256.test(payload.sha256) || typeof payload.dataBase64 !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(payload.dataBase64)) {
    throw new Error(`${label} 编码不合法`);
  }
  const buffer = Buffer.from(payload.dataBase64, 'base64');
  if (buffer.length < 1 || buffer.length > maximum || sha256(buffer) !== payload.sha256) {
    throw new Error(`${label} 完整性校验失败`);
  }
  return buffer;
}

function expectedAssetPaths(kind, definition) {
  if (kind === 'theme-pack') return new Set(Object.values(definition.assets).map(({path: value}) => value));
  return new Set([
    definition.asset?.path,
    definition.projectHeroAsset?.path,
    definition.composerAvatarAsset?.path,
  ].filter(Boolean));
}

function commitStage(stage, target) {
  const backup = `${target}.previous-${crypto.randomUUID()}`;
  let movedPrevious = false;
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      movedPrevious = true;
    }
    fs.renameSync(stage, target);
    if (movedPrevious) fs.rmSync(backup, {recursive: true, force: true});
  } catch (error) {
    if (!fs.existsSync(target) && movedPrevious && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

export async function installRemoteThemeSkin(id, {dataDir} = {}) {
  if (!ID.test(id)) throw new Error('待安装皮肤 ID 不合法');
  // Download is user-initiated, so it deliberately checks the official index
  // now rather than waiting for the hourly automatic refresh window.
  const catalog = await loadRemoteThemeCatalog({dataDir, refresh: 'manual'});
  const entry = catalog.skins.find((candidate) => candidate.id === id);
  if (!entry) throw new Error('远程目录中找不到这套皮肤');
  const bundleBuffer = await fetchBuffer(entry.package.url, BUNDLE_MAX_BYTES);
  if (bundleBuffer.length !== entry.package.bytes || sha256(bundleBuffer) !== entry.package.sha256) {
    throw new Error('远程皮肤包 SHA-256 或大小不匹配');
  }
  const bundle = JSON.parse(bundleBuffer.toString('utf8'));
  exactKeys(bundle, ['schemaVersion', 'id', 'kind', 'version', 'definition', 'assets'], 'bundle');
  if (bundle.schemaVersion !== 1 || bundle.id !== entry.id || bundle.kind !== entry.kind ||
      bundle.version !== entry.version || !Array.isArray(bundle.assets) || bundle.assets.length > 32) {
    throw new Error('远程皮肤包与目录声明不一致');
  }
  const definitionPath = entry.kind === 'theme-pack'
    ? `theme-packs/${entry.id}.json`
    : `skins/${entry.id}.json`;
  if (bundle.definition.path !== definitionPath) throw new Error('远程皮肤定义路径不合法');
  const definitionBuffer = decodePayload(bundle.definition, 'definition', DEFINITION_MAX_BYTES);
  const definition = JSON.parse(definitionBuffer.toString('utf8'));
  const skin = entry.kind === 'theme-pack'
    ? validateThemePack(definition)
    : validateCatalogSkin(definition);
  if (skin.id !== entry.id) throw new Error('远程皮肤定义 ID 不匹配');

  const expected = expectedAssetPaths(entry.kind, skin);
  const seen = new Set();
  let totalBytes = 0;
  const decodedAssets = bundle.assets.map((asset, index) => {
    if (!ASSET_PATH.test(asset.path) || !expected.has(asset.path) || !seen.add(asset.path)) {
      throw new Error(`assets[${index}] 路径不合法或重复`);
    }
    const buffer = decodePayload(asset, `assets[${index}]`, ASSET_MAX_BYTES);
    totalBytes += buffer.length;
    if (totalBytes > TOTAL_ASSET_MAX_BYTES) throw new Error('皮肤图片总大小超过限制');
    return {path: asset.path, buffer};
  });
  if (seen.size !== expected.size || [...expected].some((assetPath) => !seen.has(assetPath))) {
    throw new Error('远程皮肤包缺少声明的图片资源');
  }

  const root = installRoot(dataDir);
  ensurePrivateDirectory(root);
  const stage = path.join(root, `.${id}.stage-${crypto.randomUUID()}`);
  const stageCatalog = path.join(stage, 'catalog');
  ensurePrivateDirectory(stageCatalog);
  try {
    const definitionDestination = path.join(stageCatalog, definitionPath);
    ensurePrivateDirectory(path.dirname(definitionDestination));
    fs.writeFileSync(definitionDestination, definitionBuffer, {flag: 'wx', mode: 0o600});
    for (const asset of decodedAssets) {
      const destination = path.join(stageCatalog, asset.path);
      ensurePrivateDirectory(path.dirname(destination));
      fs.writeFileSync(destination, asset.buffer, {flag: 'wx', mode: 0o600});
    }
    if (entry.kind === 'theme-pack') {
      themePackCatalogCard(skin, skin.clientIds[0], {catalogDir: stageCatalog});
    } else if (skin.asset) {
      materializeCatalogProfile(skin, {clientId: skin.clientIds[0], catalogDir: stageCatalog});
    }
    const receipt = {
      schemaVersion: 1,
      id,
      kind: entry.kind,
      version: entry.version,
      packageSHA256: entry.package.sha256,
      definitionPath,
      installedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(stage, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    commitStage(stage, path.join(root, id));
    return Object.freeze(receipt);
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, {recursive: true, force: true});
    throw error;
  }
}

export function resolveInstalledRemoteSkin(id, clientId, {dataDir} = {}) {
  const installed = getInstalledRemoteSkin(id, {clientId, dataDir});
  if (!installed) return null;
  const profile = installed.receipt.kind === 'theme-pack'
    ? materializeThemePack(installed.skin, clientId, {catalogDir: installed.catalogDir})
    : materializeCatalogProfile(installed.skin, {clientId, catalogDir: installed.catalogDir});
  return Object.freeze({profile, skin: installed.skin, custom: false});
}
