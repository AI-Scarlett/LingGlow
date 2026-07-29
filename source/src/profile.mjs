import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HEX = /^#[0-9a-fA-F]{6}$/u;
const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
const MAX_PROFILE_COUNT = 24;
const MAX_PROFILE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PROFILE_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_BRAND_ICON_BYTES = 2 * 1024 * 1024;
const MAX_BRAND_ICON_DIMENSION = 2048;
const MAX_BRAND_ICON_PIXELS = 4 * 1024 * 1024;
const MAX_FREE_BRAND_FILE_BYTES = 3 * 1024 * 1024;
const FREE_BRAND_FILE = 'free-brand.json';
const BRAND_DISPLAY_NAME = /^[\p{L}\p{M}\p{N} .·&_\-]+$/u;
const BRAND_SHORT_MARK = /^[\p{L}\p{N}]{1,3}$/u;
const BRAND_FORBIDDEN = /[\p{Cc}\p{Cf}"'`\\]/u;
const BRAND_FORBIDDEN_URI = /(?:https?|file|data|javascript|vbscript):/iu;
const BRAND_LOGO_STYLES = Object.freeze(['original', 'tile', 'circle', 'diamond']);
const IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_POSITIONS = Object.freeze([
  'center', 'top', 'bottom', 'left', 'right',
  'top left', 'top right', 'bottom left', 'bottom right',
]);
const decodedImageCache = new Map();
// normalizeProfile 自己产出的对象；用来避免对同一份已规范化配置重复做全套校验
// （尤其是图片的 base64 解码与哈希）。只记录本模块生成的对象，外部数据永远不会命中。
const NORMALIZED_PROFILES = new WeakSet();

function ensurePrivateDirectory(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`数据目录不安全：${directory}`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`数据目录不属于当前用户：${directory}`);
  }
  fs.chmodSync(directory, 0o700);
}

export function defaultDataDir() {
  return process.env.CODEX_SKIN_STUDIO_DATA ||
    path.join(os.homedir(), 'Library/Application Support/Codex Skin Studio');
}

export function ensureDataDir(dataDir = defaultDataDir()) {
  ensurePrivateDirectory(dataDir);
  ensurePrivateDirectory(path.join(dataDir, 'profiles'));
  return dataDir;
}

function clampNumber(value, min, max, fallback, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(max, Math.max(min, parsed));
  return integer ? Math.round(clamped) : clamped;
}

function color(value, fallback) {
  return HEX.test(String(value ?? '')) ? String(value).toUpperCase() : fallback;
}

function nullableFont(value) {
  if (value == null || String(value).trim() === '') return null;
  const font = String(value).trim();
  if (font.length > 80 || /[{};<>\n\r]/u.test(font)) throw new Error('字体名称不合法');
  return font;
}

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function strictBoolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} 必须是布尔值`);
  return value;
}

function optionalPlainObject(value, label) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} 必须是普通对象`);
  }
  return value;
}

function exactOptionalKeys(value, allowed, label) {
  const input = optionalPlainObject(value, label);
  const expected = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !expected.has(key));
  if (unknown.length) throw new Error(`${label} 包含未允许字段：${unknown.join(', ')}`);
  return input;
}

function brandObject(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('advanced.brand 必须是普通对象');
  }
  const allowed = new Set(['enabled', 'displayName', 'shortMark', 'logoStyle', 'iconImage']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`advanced.brand 包含未允许字段：${unknown.join(', ')}`);
  return value;
}

function nullableBrandDisplayName(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('advanced.brand.displayName 必须是字符串或 null');
  const text = value.normalize('NFKC').trim().replace(/ +/gu, ' ');
  if (!text) return null;
  if ([...text].length > 24 || BRAND_FORBIDDEN.test(text) || BRAND_FORBIDDEN_URI.test(text) ||
      !BRAND_DISPLAY_NAME.test(text)) {
    throw new Error('advanced.brand.displayName 不合法');
  }
  return text;
}

function nullableHomeTagline(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('WorkBuddy 首页副标题必须是字符串或 null');
  const text = value.normalize('NFKC').trim().replace(/ +/gu, ' ');
  if (!text) return null;
  if ([...text].length > 48 || BRAND_FORBIDDEN.test(text) || BRAND_FORBIDDEN_URI.test(text)) {
    throw new Error('WorkBuddy 首页副标题不合法');
  }
  return text;
}

function nullableBrandShortMark(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('advanced.brand.shortMark 必须是字符串或 null');
  const text = value.normalize('NFKC').trim();
  if (!text) return null;
  if (!BRAND_SHORT_MARK.test(text)) throw new Error('advanced.brand.shortMark 必须是 1 到 3 个 Unicode 字母或数字');
  return text;
}

export function normalizeBrand(value) {
  const input = brandObject(value);
  const enabled = strictBoolean(input.enabled, false, 'advanced.brand.enabled');
  const displayName = nullableBrandDisplayName(input.displayName);
  const shortMark = nullableBrandShortMark(input.shortMark);
  const iconImage = validateImageDataUrl(input.iconImage, {
    maxBytes: MAX_BRAND_ICON_BYTES,
    maxDimension: MAX_BRAND_ICON_DIMENSION,
    maxPixels: MAX_BRAND_ICON_PIXELS,
    label: '品牌图标',
  });
  const logoStyle = input.logoStyle === undefined ? 'original' : input.logoStyle;
  if (!BRAND_LOGO_STYLES.includes(logoStyle)) throw new Error('advanced.brand.logoStyle 不在允许范围内');
  if (logoStyle === 'original' && shortMark !== null) {
    throw new Error('advanced.brand.shortMark 需要非 original 的 logoStyle');
  }
  if (logoStyle !== 'original' && shortMark === null) {
    throw new Error('自定义 logoStyle 必须提供 advanced.brand.shortMark');
  }
  if (enabled && displayName === null && logoStyle === 'original' && iconImage === null) {
    throw new Error('启用品牌区时必须提供显示名称或自定义短标');
  }
  return {enabled, displayName, shortMark, logoStyle, iconImage};
}

function isoDate(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} 不是有效时间`);
  }
  return value;
}

function webpDimensions(buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) {
    throw new Error('WebP 容器不完整');
  }
  let dimensions = null;
  let imageChunk = false;
  for (let offset = 12, chunks = 0; offset + 8 <= buffer.length; chunks += 1) {
    if (chunks > 4096) throw new Error('WebP 分块过多');
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (!Number.isSafeInteger(end) || end > buffer.length) throw new Error('WebP 分块越界');
    if (type === 'ANIM' || type === 'ANMF') throw new Error('不允许动态 WebP');
    if (type === 'VP8X') {
      if (size < 10) throw new Error('VP8X 头无效');
      if (buffer[start] & 0x02) throw new Error('不允许动态 WebP');
      dimensions = {
        width: 1 + buffer.readUIntLE(start + 4, 3),
        height: 1 + buffer.readUIntLE(start + 7, 3),
      };
    } else if (type === 'VP8 ') {
      if (size < 10 || buffer[start + 3] !== 0x9d || buffer[start + 4] !== 0x01 || buffer[start + 5] !== 0x2a) {
        throw new Error('VP8 图像头无效');
      }
      dimensions = {
        width: buffer.readUInt16LE(start + 6) & 0x3fff,
        height: buffer.readUInt16LE(start + 8) & 0x3fff,
      };
      imageChunk = true;
    } else if (type === 'VP8L') {
      if (size < 5 || buffer[start] !== 0x2f) throw new Error('VP8L 图像头无效');
      dimensions = {
        width: 1 + buffer[start + 1] + ((buffer[start + 2] & 0x3f) << 8),
        height: 1 + (buffer[start + 2] >> 6) + (buffer[start + 3] << 2) + ((buffer[start + 4] & 0x0f) << 10),
      };
      imageChunk = true;
    }
    offset = end + (size % 2);
    if (offset === buffer.length) break;
    if (offset > buffer.length) throw new Error('WebP 对齐无效');
  }
  if (!imageChunk || !dimensions?.width || !dimensions?.height) throw new Error('WebP 缺少有效图像帧');
  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION ||
      dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new Error('WebP 尺寸超过 4096 px 或 16 MP 安全上限');
  }
  return dimensions;
}

function validImageDimensions(dimensions, label) {
  if (!dimensions?.width || !dimensions?.height ||
      dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION ||
      dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new Error(`${label} 尺寸超过 4096 px 或 16 MP 安全上限`);
  }
  return dimensions;
}

function pngDimensions(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature) ||
      buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('PNG 容器头无效');
  }
  const dimensions = validImageDimensions({
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }, 'PNG');
  let sawIend = false;
  for (let offset = 8, chunks = 0; offset + 12 <= buffer.length; chunks += 1) {
    if (chunks > 65536) throw new Error('PNG 分块过多');
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + size;
    if (!Number.isSafeInteger(end) || end > buffer.length) throw new Error('PNG 分块越界');
    if (type === 'acTL') throw new Error('不允许动态 PNG');
    if (type === 'IEND') {
      if (size !== 0 || end !== buffer.length) throw new Error('PNG 结束块无效');
      sawIend = true;
      break;
    }
    offset = end;
  }
  if (!sawIend) throw new Error('PNG 缺少结束块');
  return dimensions;
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) {
    throw new Error('JPEG 容器头无效');
  }
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  for (let offset = 2, markers = 0; offset + 1 < buffer.length; markers += 1) {
    if (markers > 65536) throw new Error('JPEG 标记过多');
    if (buffer[offset] !== 0xff) throw new Error('JPEG 标记无效');
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) throw new Error('JPEG 分段头越界');
    const size = buffer.readUInt16BE(offset);
    if (size < 2 || offset + size > buffer.length) throw new Error('JPEG 分段越界');
    if (startOfFrame.has(marker)) {
      if (size < 8) throw new Error('JPEG 图像头无效');
      return validImageDimensions({
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      }, 'JPEG');
    }
    offset += size;
  }
  throw new Error('JPEG 缺少有效图像帧');
}

function inspectIsolatedSubjectBitmap(filePath, directory) {
  const bitmapPath = path.join(directory, 'subject-preview.bmp');
  execFileSync('/usr/bin/sips', ['-Z', '64', '-s', 'format', 'bmp', filePath, '--out', bitmapPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 5000,
    maxBuffer: 64 * 1024,
  });
  const bitmap = fs.readFileSync(bitmapPath);
  if (bitmap.length < 138 || bitmap.toString('ascii', 0, 2) !== 'BM') {
    throw new Error('机器人素材预览不是有效 BMP');
  }
  const pixelOffset = bitmap.readUInt32LE(10);
  const dibSize = bitmap.readUInt32LE(14);
  const width = bitmap.readInt32LE(18);
  const signedHeight = bitmap.readInt32LE(22);
  const height = Math.abs(signedHeight);
  const planes = bitmap.readUInt16LE(26);
  const bitsPerPixel = bitmap.readUInt16LE(28);
  const compression = bitmap.readUInt32LE(30);
  if (dibSize < 108 || width < 1 || height < 1 || width > 64 || height > 64 ||
      planes !== 1 || bitsPerPixel !== 32 || compression !== 3 ||
      bitmap.readUInt32LE(54) !== 0x00ff0000 ||
      bitmap.readUInt32LE(58) !== 0x0000ff00 ||
      bitmap.readUInt32LE(62) !== 0x000000ff ||
      bitmap.readUInt32LE(66) !== 0xff000000) {
    throw new Error('机器人素材预览像素格式不受支持');
  }
  const rowBytes = width * 4;
  if (pixelOffset < 14 + dibSize || pixelOffset + rowBytes * height !== bitmap.length) {
    throw new Error('机器人素材预览像素数据不完整');
  }

  const total = width * height;
  const paddingX = Math.max(2, Math.floor(width * 0.03));
  const paddingY = Math.max(2, Math.floor(height * 0.03));
  let transparent = 0;
  let occupied = 0;
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = bitmap[pixelOffset + y * rowBytes + x * 4 + 3];
      if (alpha <= 8) transparent += 1;
      if (alpha >= 32) {
        occupied += 1;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
    }
  }
  return occupied >= Math.max(16, Math.floor(total * 0.03)) &&
    transparent >= Math.floor(total * 0.15) &&
    minimumX >= paddingX &&
    minimumY >= paddingY &&
    maximumX < width - paddingX &&
    maximumY < height - paddingY;
}

function verifyDecodableImage(buffer, expected, mimeType, {inspectIsolatedSubject = false} = {}) {
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  const cached = decodedImageCache.get(digest);
  if (cached && (!inspectIsolatedSubject || cached.isolatedSubject !== undefined)) return cached;
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-image-'));
  const filePath = path.join(directory, `image.${extension}`);
  try {
    fs.writeFileSync(filePath, buffer, {mode: 0o600, flag: 'wx'});
    const output = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', filePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    const width = Number(output.match(/pixelWidth:\s*(\d+)/u)?.[1]);
    const height = Number(output.match(/pixelHeight:\s*(\d+)/u)?.[1]);
    const hasAlpha = /hasAlpha:\s*(?:yes|true|1)/iu.test(output);
    if (width !== expected.width || height !== expected.height) throw new Error('图片解码尺寸与容器不一致');
    const ratio = width / height;
    const isolatedSubject = inspectIsolatedSubject
      ? hasAlpha && ratio >= 0.8 && ratio <= 1.25 && inspectIsolatedSubjectBitmap(filePath, directory)
      : cached?.isolatedSubject;
    const verified = {width, height, hasAlpha, ...(isolatedSubject === undefined ? {} : {isolatedSubject})};
    decodedImageCache.set(digest, verified);
    if (decodedImageCache.size > 128) decodedImageCache.delete(decodedImageCache.keys().next().value);
    return verified;
  } catch (error) {
    throw new Error(`图片无法安全解码：${error.message}`);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

export function validateImageDataUrl(value, {
  optional = true,
  maxBytes = MAX_IMAGE_BYTES,
  maxDimension = MAX_IMAGE_DIMENSION,
  maxPixels = MAX_IMAGE_PIXELS,
  label = '图片',
  requireTransparency = false,
  requireIsolatedSubject = false,
} = {}) {
  if (!value) {
    if (optional) return null;
    throw new Error('缺少图片');
  }
  if (typeof value !== 'string') throw new Error('图片必须是本地嵌入的 data URL');
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u);
  if (!match || !IMAGE_MIME_TYPES.includes(match[1])) {
    throw new Error('只接受本地嵌入的 PNG、JPEG 或 WebP data URL');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.toString('base64') !== match[2]) throw new Error('图片 Base64 编码不规范');
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new Error(`${label}必须小于 ${Math.floor(maxBytes / (1024 * 1024))} MB`);
  }
  const dimensions = match[1] === 'image/png'
    ? pngDimensions(buffer)
    : match[1] === 'image/jpeg'
      ? jpegDimensions(buffer)
      : webpDimensions(buffer);
  if (dimensions.width > maxDimension || dimensions.height > maxDimension ||
      dimensions.width * dimensions.height > maxPixels) {
    throw new Error(`${label}尺寸超过 ${maxDimension} px 或 ${maxPixels} 像素安全上限`);
  }
  const decoded = verifyDecodableImage(buffer, dimensions, match[1], {
    inspectIsolatedSubject: requireIsolatedSubject,
  });
  if ((requireTransparency || requireIsolatedSubject) && decoded.hasAlpha !== true) {
    throw new Error(`${label}必须包含真实透明通道；请使用透明底 PNG 或 WebP，不能使用 JPEG 或带棋盘格背景的图片`);
  }
  if (requireIsolatedSubject && decoded.isolatedSubject !== true) {
    throw new Error(`${label}必须是透明画布上的完整独立主体，并在四周保留透明留白；不能使用背景图、主视觉或圆形裁切图`);
  }
  return `data:${match[1]};base64,${match[2]}`;
}

export function normalizeProfile(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('皮肤配置必须是对象');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('不支持的皮肤 schemaVersion');
  const rawName = String(input.name ?? '未命名皮肤').trim().slice(0, 60) || '未命名皮肤';
  if (/\p{Cc}/u.test(rawName)) throw new Error('方案名称包含控制字符');
  const generatedId = rawName.toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 40) || `skin-${crypto.randomBytes(4).toString('hex')}`;
  const id = PROFILE_ID.test(String(input.id ?? '')) ? String(input.id) : generatedId;
  const officialInput = input.official ?? {};
  const advancedInput = input.advanced ?? {};
  const background = advancedInput.background ?? {};
  const banner = advancedInput.banner ?? {};
  const glass = advancedInput.glass ?? {};
  const appHomeCopy = exactOptionalKeys(
    advancedInput.homeCopy,
    ['title'],
    'advanced.homeCopy',
  );
  const brand = normalizeBrand(advancedInput.brand);
  const workbuddy = exactOptionalKeys(
    advancedInput.workbuddy,
    ['projectHero', 'composerAvatar', 'homeCopy'],
    'advanced.workbuddy',
  );
  const projectHero = exactOptionalKeys(
    workbuddy.projectHero,
    ['image', 'fit', 'position'],
    'advanced.workbuddy.projectHero',
  );
  const composerAvatar = exactOptionalKeys(
    workbuddy.composerAvatar,
    ['image', 'fit', 'shape', 'activityMotion'],
    'advanced.workbuddy.composerAvatar',
  );
  const homeCopy = exactOptionalKeys(
    workbuddy.homeCopy,
    ['title', 'subtitle'],
    'advanced.workbuddy.homeCopy',
  );
  const now = new Date().toISOString();

  const profile = {
    schemaVersion: 1,
    id,
    name: rawName,
    createdAt: isoDate(input.createdAt, now, 'createdAt'),
    updatedAt: isoDate(input.updatedAt, now, 'updatedAt'),
    official: {
      variant: enumValue(officialInput.variant, ['light', 'dark'], 'dark'),
      codeThemeId: /^[a-z0-9][a-z0-9-]{0,59}$/u.test(String(officialInput.codeThemeId || ''))
        ? String(officialInput.codeThemeId)
        : 'codex',
      accent: color(officialInput.accent, '#7AA2F7'),
      surface: color(officialInput.surface, '#111827'),
      ink: color(officialInput.ink, '#E5E7EB'),
      contrast: clampNumber(officialInput.contrast, 0, 100, 45, true),
      fonts: {
        code: nullableFont(officialInput.fonts?.code),
        ui: nullableFont(officialInput.fonts?.ui),
      },
      opaqueWindows: strictBoolean(officialInput.opaqueWindows, true, 'opaqueWindows'),
      semanticColors: {
        diffAdded: color(officialInput.semanticColors?.diffAdded, '#22C55E'),
        diffRemoved: color(officialInput.semanticColors?.diffRemoved, '#EF4444'),
        skill: color(officialInput.semanticColors?.skill, '#A78BFA'),
      },
    },
    advanced: {
      enabled: strictBoolean(advancedInput.enabled, false, 'advanced.enabled'),
      background: {
        image: validateImageDataUrl(background.image),
        opacity: clampNumber(background.opacity, 0.05, 1, 0.55),
        overlay: clampNumber(background.overlay, 0, 0.95, 0.58),
        blur: clampNumber(background.blur, 0, 24, 0, true),
        position: enumValue(background.position, IMAGE_POSITIONS, 'center'),
      },
      banner: {
        enabled: strictBoolean(banner.enabled, false, 'advanced.banner.enabled'),
        image: validateImageDataUrl(banner.image),
        opacity: clampNumber(banner.opacity, 0.1, 0.55, 0.45),
        height: clampNumber(banner.height, 48, 240, 112, true),
        width: clampNumber(banner.width, 240, 1200, 720, true),
        position: enumValue(banner.position, ['top-center', 'top-right', 'bottom-right'], 'top-center'),
      },
      glass: {
        enabled: strictBoolean(glass.enabled, true, 'advanced.glass.enabled'),
        opacity: clampNumber(glass.opacity, 0.35, 0.98, 0.74),
        blur: clampNumber(glass.blur, 0, 32, 18, true),
      },
      brand,
      homeCopy: {
        title: nullableHomeTagline(appHomeCopy.title),
      },
      workbuddy: {
        homeCopy: {
          title: nullableBrandDisplayName(homeCopy.title),
          subtitle: nullableHomeTagline(homeCopy.subtitle),
        },
        projectHero: {
          image: validateImageDataUrl(projectHero.image),
          fit: enumValue(projectHero.fit, ['cover', 'contain'], 'cover'),
          position: enumValue(projectHero.position, IMAGE_POSITIONS, 'center'),
        },
        composerAvatar: {
          image: validateImageDataUrl(composerAvatar.image, {
            maxBytes: 2 * 1024 * 1024,
            maxDimension: 2048,
            maxPixels: 4 * 1024 * 1024,
            label: 'WorkBuddy 输入区头像',
            requireIsolatedSubject: true,
          }),
          fit: enumValue(composerAvatar.fit, ['cover', 'contain'], 'contain'),
          shape: enumValue(composerAvatar.shape, ['circle', 'rounded', 'square'], 'square'),
          activityMotion: enumValue(
            composerAvatar.activityMotion,
            ['still', 'float', 'walk', 'roll', 'crawl', 'hop'],
            'float',
          ),
        },
      },
      radius: clampNumber(advancedInput.radius, 8, 28, 16, true),
      motion: enumValue(advancedInput.motion, ['none', 'subtle', 'float'], 'subtle'),
      sidebarWidth: clampNumber(advancedInput.sidebarWidth, 240, 420, 275, true),
    },
  };
  if (profile.advanced.banner.enabled && !profile.advanced.banner.image) {
    profile.advanced.banner.enabled = false;
  }
  NORMALIZED_PROFILES.add(profile);
  return profile;
}

export function officialThemeObject(profile) {
  // 只有本函数自己产出的对象才被认作已规范化，外部数据一律重新走全套校验。
  // compileSkin 传进来的正是刚 normalizeProfile 过的那个对象，跳过第二遍可以省下
  // 最大 4MB 图片的 base64 解码/再编码与 SHA-256。
  const p = NORMALIZED_PROFILES.has(profile) ? profile : normalizeProfile(profile);
  return {
    codeThemeId: p.official.codeThemeId,
    theme: {
      accent: p.official.accent,
      contrast: p.official.contrast,
      // 复用已规范化的 profile 后 p 可能是调用方仍持有的对象；这两个嵌套对象
      // 必须复制，才能保持“返回值不会成为调用方配置的别名”这一既有性质。
      fonts: {...p.official.fonts},
      ink: p.official.ink,
      opaqueWindows: p.official.opaqueWindows,
      semanticColors: {...p.official.semanticColors},
      surface: p.official.surface,
    },
    variant: p.official.variant,
  };
}

export function officialThemeString(profile) {
  return `codex-theme-v1:${JSON.stringify(officialThemeObject(profile))}`;
}

function atomicWrite(filePath, contents) {
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, contents, {encoding: 'utf8'});
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (fs.existsSync(filePath)) {
      const existing = fs.lstatSync(filePath);
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('拒绝覆盖非普通方案文件');
      const backup = `${filePath}.bak`;
      if (fs.existsSync(backup)) {
        const backupStat = fs.lstatSync(backup);
        if (!backupStat.isFile() || backupStat.isSymbolicLink()) throw new Error('方案备份路径不安全');
      }
      fs.copyFileSync(filePath, backup);
      fs.chmodSync(backup, 0o600);
    }
    fs.renameSync(temp, filePath);
    let directoryFd;
    try {
      directoryFd = fs.openSync(path.dirname(filePath), 'r');
      fs.fsyncSync(directoryFd);
    } catch {
      // The rename stays atomic even where a directory fsync is rejected.
    } finally {
      if (directoryFd !== undefined) fs.closeSync(directoryFd);
    }
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function atomicReplacePrivate(filePath, contents) {
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    if (fs.existsSync(filePath)) {
      const existing = fs.lstatSync(filePath);
      if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 ||
          (typeof process.getuid === 'function' && existing.uid !== process.getuid())) {
        throw new Error('拒绝覆盖不安全的免费品牌配置');
      }
    }
    fs.writeFileSync(temp, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    fs.renameSync(temp, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function safeProfileFiles(dataDir) {
  const profilesDir = path.join(ensureDataDir(dataDir), 'profiles');
  return fs.readdirSync(profilesDir)
    .filter((name) => PROFILE_ID.test(name.replace(/\.json$/u, '')) && name.endsWith('.json'))
    .flatMap((name) => {
      const filePath = path.join(profilesDir, name);
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) return [];
      if (stat.size <= 0 || stat.size > MAX_PROFILE_FILE_BYTES) return [];
      return [{name, filePath, size: stat.size}];
    });
}

export function saveProfile(input, dataDir = defaultDataDir()) {
  ensureDataDir(dataDir);
  const profile = normalizeProfile(input);
  profile.updatedAt = new Date().toISOString();
  const filePath = path.join(dataDir, 'profiles', `${profile.id}.json`);
  const contents = `${JSON.stringify(profile, null, 2)}\n`;
  if (Buffer.byteLength(contents) > MAX_PROFILE_FILE_BYTES) throw new Error('方案文件超过 12 MB');
  const files = safeProfileFiles(dataDir);
  if (!fs.existsSync(filePath) && files.length >= MAX_PROFILE_COUNT) throw new Error('最多保存 24 个方案');
  const previousSize = files.find((item) => item.filePath === filePath)?.size ?? 0;
  const aggregate = files.reduce((sum, item) => sum + item.size, 0) - previousSize + Buffer.byteLength(contents);
  if (aggregate > MAX_PROFILE_TOTAL_BYTES) throw new Error('方案总容量超过 64 MB');
  atomicWrite(filePath, contents);
  return profile;
}

export function listProfiles(dataDir = defaultDataDir()) {
  ensureDataDir(dataDir);
  return safeProfileFiles(dataDir)
    .flatMap(({filePath}) => {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return [normalizeProfile(raw)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProfile(id, dataDir = defaultDataDir()) {
  if (!PROFILE_ID.test(String(id ?? ''))) return null;
  const filePath = path.join(dataDir, 'profiles', `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_PROFILE_FILE_BYTES) return null;
  return normalizeProfile(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function normalizeFreeBrand(input = {}) {
  const value = exactOptionalKeys(
    input,
    [
      'schemaVersion', 'displayName', 'tagline', 'iconImage', 'composerAvatarImage',
      'composerAvatarMotion',
      'codexHomeTitle', 'doubaoHomeTitle', 'workbuddyHomeTitle', 'updatedAt',
    ],
    '免费品牌配置',
  );
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    throw new Error('不支持的免费品牌配置 schemaVersion');
  }
  const updatedAt = value.updatedAt === undefined || value.updatedAt === null
    ? null
    : isoDate(value.updatedAt, null, '免费品牌配置 updatedAt');
  return {
    schemaVersion: 1,
    displayName: nullableBrandDisplayName(value.displayName),
    tagline: nullableHomeTagline(value.tagline),
    iconImage: validateImageDataUrl(value.iconImage, {
      maxBytes: MAX_BRAND_ICON_BYTES,
      maxDimension: MAX_BRAND_ICON_DIMENSION,
      maxPixels: MAX_BRAND_ICON_PIXELS,
      label: '品牌图标',
    }),
    composerAvatarImage: validateImageDataUrl(value.composerAvatarImage, {
      maxBytes: 2 * 1024 * 1024,
      maxDimension: 2048,
      maxPixels: 4 * 1024 * 1024,
      label: '三端输入区机器人',
      requireIsolatedSubject: true,
    }),
    composerAvatarMotion: value.composerAvatarMotion == null ? null : enumValue(
      value.composerAvatarMotion,
      ['still', 'float', 'walk', 'roll', 'crawl', 'hop'],
      null,
    ),
    codexHomeTitle: nullableHomeTagline(value.codexHomeTitle),
    doubaoHomeTitle: nullableHomeTagline(value.doubaoHomeTitle),
    workbuddyHomeTitle: nullableHomeTagline(value.workbuddyHomeTitle),
    updatedAt,
  };
}

function freeBrandFile(dataDir) {
  return path.join(ensureDataDir(dataDir), FREE_BRAND_FILE);
}

function safeFreeBrandFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0 ||
      stat.size > MAX_FREE_BRAND_FILE_BYTES || (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new Error('免费品牌配置文件不安全');
  }
  return stat;
}

export function loadFreeBrand(dataDir = defaultDataDir()) {
  const filePath = freeBrandFile(dataDir);
  if (!fs.existsSync(filePath)) return normalizeFreeBrand();
  safeFreeBrandFile(filePath);
  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  try {
    return normalizeFreeBrand(stored);
  } catch (error) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !stored.composerAvatarImage) throw error;
    return normalizeFreeBrand({...stored, composerAvatarImage: null});
  }
}

export function saveFreeBrand(input, dataDir = defaultDataDir()) {
  const value = normalizeFreeBrand(input);
  const filePath = freeBrandFile(dataDir);
  if (value.displayName === null && value.tagline === null && value.iconImage === null &&
      value.composerAvatarImage === null && value.composerAvatarMotion === null &&
      value.codexHomeTitle === null &&
      value.doubaoHomeTitle === null && value.workbuddyHomeTitle === null) {
    if (fs.existsSync(filePath)) {
      safeFreeBrandFile(filePath);
      fs.unlinkSync(filePath);
    }
    return normalizeFreeBrand();
  }
  value.updatedAt = new Date().toISOString();
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(contents) > MAX_FREE_BRAND_FILE_BYTES) {
    throw new Error('免费品牌配置文件超过 3 MB');
  }
  atomicReplacePrivate(filePath, contents);
  return value;
}

export function mergeFreeBrandOverride(profileInput, freeBrandInput, {clientId = 'workbuddy'} = {}) {
  const profile = normalizeProfile(profileInput);
  const override = normalizeFreeBrand(freeBrandInput);
  const clientHomeTitle = clientId === 'codex' ? override.codexHomeTitle
    : clientId === 'doubao' ? override.doubaoHomeTitle
      : override.workbuddyHomeTitle;
  if (clientHomeTitle !== null) {
    profile.advanced.homeCopy = {
      ...profile.advanced.homeCopy,
      title: clientHomeTitle,
    };
  }
  if (clientId === 'workbuddy' && (override.displayName !== null || override.iconImage !== null)) {
    profile.advanced.brand = {
      ...profile.advanced.brand,
      enabled: true,
      displayName: override.displayName ?? profile.advanced.brand.displayName,
      iconImage: override.iconImage ?? profile.advanced.brand.iconImage,
    };
  }
  if (clientId === 'workbuddy' &&
      (override.workbuddyHomeTitle !== null || override.displayName !== null || override.tagline !== null)) {
    profile.advanced.workbuddy.homeCopy = {
      ...profile.advanced.workbuddy.homeCopy,
      title: override.workbuddyHomeTitle ?? override.displayName ?? profile.advanced.workbuddy.homeCopy.title,
      subtitle: override.tagline ?? profile.advanced.workbuddy.homeCopy.subtitle,
    };
  }
  if (override.composerAvatarImage !== null) {
    profile.advanced.workbuddy.composerAvatar = {
      ...profile.advanced.workbuddy.composerAvatar,
      image: override.composerAvatarImage,
      fit: 'contain',
      shape: 'square',
    };
  }
  // Motion belongs to the selected profile/Theme Pack. Keep accepting the
  // legacy freeBrand key for storage compatibility, but never let one global
  // preference overwrite every skin's own motion.
  return profile;
}

export function contrastRatio(colorA, colorB) {
  const luminance = (hex) => {
    const values = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const a = luminance(color(colorA, '#000000'));
  const b = luminance(color(colorB, '#FFFFFF'));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
