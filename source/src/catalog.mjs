import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {LEGACY_CATALOG_CLIENT_IDS} from './client-registry.mjs';
import {normalizeProfile} from './profile.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CATALOG_DIR = path.resolve(MODULE_DIR, '..', 'catalog');
// Catalog v1 only contains the legacy adapters.  The full target list lives
// in client-registry.mjs; a future Agent can opt into this older catalog
// format deliberately rather than creating another scattered string list.
export const CLIENT_IDS = LEGACY_CATALOG_CLIENT_IDS;
export const CATALOG_TIERS = Object.freeze(['free', 'vip']);
export const GRADIENT_PRESETS = Object.freeze([
  'aurora',
  'graphite',
  'jade',
  'ocean',
  'sunset',
  'violet',
]);

const CLIENT_ID_SET = new Set(CLIENT_IDS);
const TIER_SET = new Set(CATALOG_TIERS);
const GRADIENT_PRESET_SET = new Set(GRADIENT_PRESETS);
const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const CODE_THEME_ID = /^[a-z0-9][a-z0-9-]{0,59}$/u;
const HEX = /^#[0-9A-F]{6}$/u;
const SAFE_FILE = /^skins\/[a-z0-9][a-z0-9-]{0,47}\.json$/u;
const SAFE_ASSET_FILE = /^assets\/[a-z0-9][a-z0-9-]{0,47}\.webp$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_CATALOG_FILE_BYTES = 64 * 1024;
const MAX_CATALOG_ASSET_BYTES = 4 * 1024 * 1024;
const FORBIDDEN_URI = /(?:https?|file|data|javascript|vbscript):/iu;
const BRAND_DISPLAY_NAME = /^[\p{L}\p{M}\p{N} .·&_\-]+$/u;
const BRAND_SHORT_MARK = /^[\p{L}\p{N}]{1,3}$/u;
const BRAND_FORBIDDEN = /[\p{Cc}\p{Cf}"'`\\]/u;
const BRAND_LOGO_STYLES = Object.freeze(['original', 'tile', 'circle', 'diamond']);
const IMAGE_POSITIONS = Object.freeze([
  'center', 'top', 'bottom', 'left', 'right',
  'top left', 'top right', 'bottom left', 'bottom right',
]);

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} 必须是普通对象`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  plainObject(value, label);
  const expected = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length) throw new Error(`${label} 包含未允许字段：${unknown.join(', ')}`);
  if (missing.length) throw new Error(`${label} 缺少字段：${missing.join(', ')}`);
}

function safeText(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`);
  const text = value.trim();
  if (!text || text.length > maxLength || /\p{Cc}/u.test(text) || FORBIDDEN_URI.test(text) || /[<>]/u.test(text)) {
    throw new Error(`${label} 不合法`);
  }
  return text;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} 必须是布尔值`);
  return value;
}

function numberInRange(value, min, max, label, {integer = false} = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} 必须在 ${min} 到 ${max} 之间${integer ? '且为整数' : ''}`);
  }
  return value;
}

function hex(value, label) {
  if (typeof value !== 'string' || !HEX.test(value)) throw new Error(`${label} 必须是大写六位十六进制颜色`);
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} 不在允许范围内`);
  return value;
}

function nullableFont(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[{};<>\n\r]/u.test(value) || FORBIDDEN_URI.test(value)) {
    throw new Error(`${label} 不合法`);
  }
  return value;
}

function validateOfficial(value) {
  exactKeys(value, [
    'variant', 'codeThemeId', 'accent', 'surface', 'ink', 'contrast',
    'fonts', 'opaqueWindows', 'semanticColors',
  ], 'profile.official');
  enumValue(value.variant, ['light', 'dark'], 'profile.official.variant');
  if (typeof value.codeThemeId !== 'string' || !CODE_THEME_ID.test(value.codeThemeId)) {
    throw new Error('profile.official.codeThemeId 不合法');
  }
  hex(value.accent, 'profile.official.accent');
  hex(value.surface, 'profile.official.surface');
  hex(value.ink, 'profile.official.ink');
  numberInRange(value.contrast, 0, 100, 'profile.official.contrast', {integer: true});
  exactKeys(value.fonts, ['code', 'ui'], 'profile.official.fonts');
  nullableFont(value.fonts.code, 'profile.official.fonts.code');
  nullableFont(value.fonts.ui, 'profile.official.fonts.ui');
  boolean(value.opaqueWindows, 'profile.official.opaqueWindows');
  exactKeys(value.semanticColors, ['diffAdded', 'diffRemoved', 'skill'], 'profile.official.semanticColors');
  hex(value.semanticColors.diffAdded, 'profile.official.semanticColors.diffAdded');
  hex(value.semanticColors.diffRemoved, 'profile.official.semanticColors.diffRemoved');
  hex(value.semanticColors.skill, 'profile.official.semanticColors.skill');
}

function nullableBrandDisplayName(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || value !== value.normalize('NFKC') || value !== value.trim() ||
      !value || [...value].length > 24 || BRAND_FORBIDDEN.test(value) || FORBIDDEN_URI.test(value) ||
      !BRAND_DISPLAY_NAME.test(value)) {
    throw new Error(`${label} 不合法`);
  }
  return value;
}

function nullableBrandShortMark(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || value !== value.normalize('NFKC') || value !== value.trim() ||
      !BRAND_SHORT_MARK.test(value)) {
    throw new Error(`${label} 必须是 1 到 3 个 Unicode 字母或数字`);
  }
  return value;
}

function validateBrand(value) {
  const keys = ['enabled', 'displayName', 'shortMark', 'logoStyle'];
  exactKeys(value, Object.hasOwn(value, 'iconImage') ? [...keys, 'iconImage'] : keys, 'profile.advanced.brand');
  boolean(value.enabled, 'profile.advanced.brand.enabled');
  const displayName = nullableBrandDisplayName(value.displayName, 'profile.advanced.brand.displayName');
  const shortMark = nullableBrandShortMark(value.shortMark, 'profile.advanced.brand.shortMark');
  enumValue(value.logoStyle, BRAND_LOGO_STYLES, 'profile.advanced.brand.logoStyle');
  if (value.iconImage !== undefined && value.iconImage !== null) {
    throw new Error('内置皮肤 brand.iconImage 不能内嵌图片');
  }
  if (value.logoStyle === 'original' && shortMark !== null) {
    throw new Error('profile.advanced.brand.shortMark 需要非 original 的 logoStyle');
  }
  if (value.logoStyle !== 'original' && shortMark === null) {
    throw new Error('自定义 logoStyle 必须提供 profile.advanced.brand.shortMark');
  }
  if (value.enabled && displayName === null && value.logoStyle === 'original') {
    throw new Error('启用品牌区时必须提供显示名称或自定义短标');
  }
}

function validateWorkBuddy(value) {
  exactKeys(value, ['projectHero'], 'profile.advanced.workbuddy');
  exactKeys(value.projectHero, ['image', 'fit', 'position'], 'profile.advanced.workbuddy.projectHero');
  if (value.projectHero.image !== null) {
    throw new Error('内置皮肤 projectHero.image 必须由 projectHeroAsset 提供');
  }
  enumValue(value.projectHero.fit, ['cover', 'contain'], 'profile.advanced.workbuddy.projectHero.fit');
  enumValue(value.projectHero.position, IMAGE_POSITIONS, 'profile.advanced.workbuddy.projectHero.position');
}

function validateAdvanced(value) {
  const requiredKeys = [
    'enabled', 'background', 'banner', 'glass', 'radius', 'motion', 'sidebarWidth',
  ];
  const optionalKeys = ['brand', 'workbuddy'].filter((key) => Object.hasOwn(value, key));
  exactKeys(value, [...requiredKeys, ...optionalKeys], 'profile.advanced');
  boolean(value.enabled, 'profile.advanced.enabled');
  exactKeys(value.background, ['image', 'opacity', 'overlay', 'blur', 'position'], 'profile.advanced.background');
  if (value.background.image !== null) throw new Error('内置皮肤不允许携带图片或 URL');
  numberInRange(value.background.opacity, 0.05, 1, 'profile.advanced.background.opacity');
  numberInRange(value.background.overlay, 0, 0.95, 'profile.advanced.background.overlay');
  numberInRange(value.background.blur, 0, 24, 'profile.advanced.background.blur', {integer: true});
  enumValue(value.background.position, [
    'center', 'top', 'bottom', 'left', 'right', 'top left', 'top right',
  ], 'profile.advanced.background.position');
  exactKeys(value.banner, ['enabled', 'image', 'opacity', 'height', 'width', 'position'], 'profile.advanced.banner');
  if (value.banner.enabled !== false || value.banner.image !== null) {
    throw new Error('内置皮肤 Banner 必须关闭且不能携带图片');
  }
  numberInRange(value.banner.opacity, 0.1, 0.55, 'profile.advanced.banner.opacity');
  numberInRange(value.banner.height, 48, 240, 'profile.advanced.banner.height', {integer: true});
  numberInRange(value.banner.width, 240, 1200, 'profile.advanced.banner.width', {integer: true});
  enumValue(value.banner.position, ['top-center', 'top-right', 'bottom-right'], 'profile.advanced.banner.position');
  exactKeys(value.glass, ['enabled', 'opacity', 'blur'], 'profile.advanced.glass');
  boolean(value.glass.enabled, 'profile.advanced.glass.enabled');
  numberInRange(value.glass.opacity, 0.35, 0.98, 'profile.advanced.glass.opacity');
  numberInRange(value.glass.blur, 0, 32, 'profile.advanced.glass.blur', {integer: true});
  if (value.brand !== undefined) validateBrand(value.brand);
  if (value.workbuddy !== undefined) validateWorkBuddy(value.workbuddy);
  numberInRange(value.radius, 8, 28, 'profile.advanced.radius', {integer: true});
  enumValue(value.motion, ['none', 'subtle', 'float'], 'profile.advanced.motion');
  numberInRange(value.sidebarWidth, 240, 420, 'profile.advanced.sidebarWidth', {integer: true});
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export function validateCatalogSkin(input) {
  const value = clone(plainObject(input, '皮肤目录项'));
  const requiredKeys = [
    'schemaVersion', 'id', 'name', 'description', 'tier', 'clientIds', 'preview', 'profile',
  ];
  const optionalKeys = ['asset', 'projectHeroAsset', 'composerAvatarAsset']
    .filter((key) => Object.hasOwn(value, key));
  exactKeys(value, [...requiredKeys, ...optionalKeys], '皮肤目录项');
  if (value.schemaVersion !== 1) throw new Error('不支持的皮肤目录 schemaVersion');
  if (typeof value.id !== 'string' || !SKIN_ID.test(value.id)) throw new Error('皮肤 ID 不合法');
  value.name = safeText(value.name, '皮肤名称', 60);
  value.description = safeText(value.description, '皮肤说明', 180);
  if (!TIER_SET.has(value.tier)) throw new Error('皮肤等级不合法');
  if (!Array.isArray(value.clientIds) || value.clientIds.length === 0 ||
      new Set(value.clientIds).size !== value.clientIds.length ||
      !value.clientIds.every((id) => CLIENT_ID_SET.has(id))) {
    throw new Error('clientIds 必须是已注册 legacy catalog Agent 的非重复列表');
  }
  exactKeys(value.preview, ['gradientPreset'], 'preview');
  if (!GRADIENT_PRESET_SET.has(value.preview.gradientPreset)) throw new Error('gradientPreset 不在白名单');
  if (value.asset !== undefined) {
    exactKeys(value.asset, ['kind', 'path', 'sha256'], 'asset');
    if (value.asset.kind !== 'background-webp') throw new Error('asset.kind 不在允许范围内');
    if (typeof value.asset.path !== 'string' || !SAFE_ASSET_FILE.test(value.asset.path)) {
      throw new Error('asset.path 必须是 assets 目录下的安全 WebP 文件');
    }
    if (typeof value.asset.sha256 !== 'string' || !SHA256.test(value.asset.sha256)) {
      throw new Error('asset.sha256 必须是小写 SHA-256');
    }
  }
  if (value.projectHeroAsset !== undefined) {
    exactKeys(value.projectHeroAsset, ['kind', 'path', 'sha256'], 'projectHeroAsset');
    if (value.projectHeroAsset.kind !== 'project-hero-webp') {
      throw new Error('projectHeroAsset.kind 不在允许范围内');
    }
    if (typeof value.projectHeroAsset.path !== 'string' || !SAFE_ASSET_FILE.test(value.projectHeroAsset.path)) {
      throw new Error('projectHeroAsset.path 必须是 assets 目录下的安全 WebP 文件');
    }
    if (typeof value.projectHeroAsset.sha256 !== 'string' || !SHA256.test(value.projectHeroAsset.sha256)) {
      throw new Error('projectHeroAsset.sha256 必须是小写 SHA-256');
    }
  }
  if (value.composerAvatarAsset !== undefined) {
    exactKeys(value.composerAvatarAsset, ['kind', 'path', 'sha256'], 'composerAvatarAsset');
    if (value.composerAvatarAsset.kind !== 'composer-avatar-webp') {
      throw new Error('composerAvatarAsset.kind 不在允许范围内');
    }
    if (typeof value.composerAvatarAsset.path !== 'string' || !SAFE_ASSET_FILE.test(value.composerAvatarAsset.path)) {
      throw new Error('composerAvatarAsset.path 必须是 assets 目录下的安全 WebP 文件');
    }
    if (typeof value.composerAvatarAsset.sha256 !== 'string' || !SHA256.test(value.composerAvatarAsset.sha256)) {
      throw new Error('composerAvatarAsset.sha256 必须是小写 SHA-256');
    }
  }
  exactKeys(value.profile, ['official', 'advanced'], 'profile');
  validateOfficial(value.profile.official);
  validateAdvanced(value.profile.advanced);
  return deepFreeze(value);
}

function safeJsonFile(filePath, baseDirectory) {
  const resolved = path.resolve(filePath);
  const base = `${path.resolve(baseDirectory)}${path.sep}`;
  if (!resolved.startsWith(base)) throw new Error('目录文件越界');
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_CATALOG_FILE_BYTES) {
    throw new Error(`目录文件不安全：${path.basename(resolved)}`);
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function safeAssetFile(asset, catalogDir) {
  const catalogRoot = path.resolve(catalogDir);
  const catalogStat = fs.lstatSync(catalogRoot);
  if (!catalogStat.isDirectory() || catalogStat.isSymbolicLink()) throw new Error('内置皮肤目录不安全');

  const assetsDirectory = path.join(catalogRoot, 'assets');
  const assetsStat = fs.lstatSync(assetsDirectory);
  if (!assetsStat.isDirectory() || assetsStat.isSymbolicLink()) throw new Error('内置皮肤资源目录不安全');

  const resolved = path.resolve(catalogRoot, asset.path);
  if (path.dirname(resolved) !== assetsDirectory || !SAFE_ASSET_FILE.test(asset.path)) {
    throw new Error('内置皮肤资源路径越界');
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_CATALOG_ASSET_BYTES) {
    throw new Error(`内置皮肤资源不安全：${path.basename(resolved)}`);
  }

  const buffer = fs.readFileSync(resolved);
  if (buffer.length !== stat.size || buffer.length > MAX_CATALOG_ASSET_BYTES) {
    throw new Error(`内置皮肤资源大小已变化：${path.basename(resolved)}`);
  }
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest !== asset.sha256) throw new Error(`内置皮肤资源 SHA-256 校验失败：${path.basename(resolved)}`);
  return buffer;
}

export function loadBuiltInCatalog({catalogDir = DEFAULT_CATALOG_DIR} = {}) {
  const directoryStat = fs.lstatSync(catalogDir);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('内置皮肤目录不安全');
  const index = safeJsonFile(path.join(catalogDir, 'index.json'), catalogDir);
  exactKeys(index, ['schemaVersion', 'skins'], 'catalog/index.json');
  if (index.schemaVersion !== 1 || !Array.isArray(index.skins) || index.skins.length === 0) {
    throw new Error('内置皮肤索引格式无效');
  }
  if (new Set(index.skins).size !== index.skins.length || !index.skins.every((entry) => SAFE_FILE.test(entry))) {
    throw new Error('内置皮肤索引包含重复或不安全路径');
  }
  const skins = index.skins.map((entry) => validateCatalogSkin(safeJsonFile(path.join(catalogDir, entry), catalogDir)));
  if (new Set(skins.map((skin) => skin.id)).size !== skins.length) throw new Error('内置皮肤 ID 重复');
  for (const tier of CATALOG_TIERS) {
    if (skins.filter((skin) => skin.tier === tier).length < 3) throw new Error(`内置 ${tier} 皮肤少于 3 套`);
  }
  return deepFreeze({schemaVersion: 1, skins});
}

export function listBuiltInSkins({clientId, tier, catalogDir = DEFAULT_CATALOG_DIR} = {}) {
  if (clientId !== undefined && !CLIENT_ID_SET.has(clientId)) throw new Error('未知客户端');
  if (tier !== undefined && !TIER_SET.has(tier)) throw new Error('未知皮肤等级');
  return loadBuiltInCatalog({catalogDir}).skins.filter((skin) =>
    (clientId === undefined || skin.clientIds.includes(clientId)) &&
    (tier === undefined || skin.tier === tier));
}

export function getBuiltInSkin(id, {clientId, catalogDir = DEFAULT_CATALOG_DIR} = {}) {
  if (typeof id !== 'string' || !SKIN_ID.test(id)) return null;
  const skin = loadBuiltInCatalog({catalogDir}).skins.find((entry) => entry.id === id) ?? null;
  if (!skin || (clientId !== undefined && !skin.clientIds.includes(clientId))) return null;
  return skin;
}

export function materializeCatalogProfile(skinInput, {clientId, catalogDir = DEFAULT_CATALOG_DIR} = {}) {
  const skin = validateCatalogSkin(skinInput);
  if (clientId !== undefined && (!CLIENT_ID_SET.has(clientId) || !skin.clientIds.includes(clientId))) {
    throw new Error('该皮肤不支持所选客户端');
  }
  const advanced = clone(skin.profile.advanced);
  if (skin.asset !== undefined) {
    const buffer = safeAssetFile(skin.asset, catalogDir);
    advanced.background.image = `data:image/webp;base64,${buffer.toString('base64')}`;
  }
  if (skin.projectHeroAsset !== undefined) {
    const buffer = safeAssetFile(skin.projectHeroAsset, catalogDir);
    advanced.workbuddy ??= {};
    advanced.workbuddy.projectHero = {
      image: `data:image/webp;base64,${buffer.toString('base64')}`,
      fit: advanced.workbuddy.projectHero?.fit ?? 'cover',
      position: advanced.workbuddy.projectHero?.position ?? 'center',
    };
  }
  if (skin.composerAvatarAsset !== undefined) {
    const buffer = safeAssetFile(skin.composerAvatarAsset, catalogDir);
    advanced.workbuddy ??= {};
    advanced.workbuddy.composerAvatar = {
      image: `data:image/webp;base64,${buffer.toString('base64')}`,
      fit: 'contain',
      shape: 'square',
      activityMotion: 'float',
    };
  }
  return normalizeProfile({
    schemaVersion: 1,
    id: skin.id,
    name: skin.name,
    official: clone(skin.profile.official),
    advanced,
  });
}
