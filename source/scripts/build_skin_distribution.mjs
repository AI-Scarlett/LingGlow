#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SOURCE_CATALOG = path.join(ROOT, 'catalog');
const OUTPUT = path.join(ROOT, 'dist', 'skin-catalog-v1');
const RELEASE_TAG = 'skin-catalog-v1';

const CLASSIFICATION = Object.freeze({
  'dream-portal': {category: 'fantasy', series: 'dream-portal', tags: ['梦境', '传送门', '浅色']},
  'graphite-focus': {category: 'minimal', series: 'focus', tags: ['石墨', '专注', '深色']},
  'ocean-breeze': {category: 'nature', series: 'ocean', tags: ['海洋', '清爽', '浅色']},
  'jade-calm': {category: 'nature', series: 'jade', tags: ['青玉', '静谧', '深色']},
  'aurora-glass': {category: 'fantasy', series: 'aurora', tags: ['极光', '玻璃', '深色']},
  'sunset-atelier': {category: 'art', series: 'atelier', tags: ['落日', '工坊', '浅色']},
  'violet-nebula': {category: 'fantasy', series: 'nebula', tags: ['星云', '宇宙', '深色']},
  'aurora-free': {category: 'fantasy', series: 'aurora', tags: ['极光', '免费', '深色']},
  'amber-free': {category: 'minimal', series: 'amber', tags: ['暖沙', '免费', '深色']},
  'dream-gothic-void': {category: 'fantasy', series: 'gothic', tags: ['哥特', '远征', '深色']},
  'dream-portal-free': {category: 'fantasy', series: 'dream-portal', tags: ['梦境', '免费', '浅色']},
  'cr7-portugal': {category: 'sports', series: 'football-legends', tags: ['足球', '葡萄牙', '7号']},
  'messi-argentina': {category: 'sports', series: 'football-legends', tags: ['足球', '阿根廷', '10号']},
  'neymar-brazil': {category: 'sports', series: 'football-legends', tags: ['足球', '巴西', '10号']},
  'kungfu-womens-football': {category: 'sports', series: 'kungfu-football', tags: ['功夫', '女足', '电影感']},
  'spain-2026-champions': {category: 'sports', series: 'world-champions', tags: ['世界杯', '西班牙', '双星冠军', '足球', '深色']},
  'baxian-lu-dongbin': {category: 'fantasy', series: 'baxian-movie', tags: ['八仙', '吕洞宾', '纯阳剑', '电影', '免费', '浅色']},
  'baxian-he-xiangu': {category: 'fantasy', series: 'baxian-movie', tags: ['八仙', '何仙姑', '莲花', '电影', '免费', '浅色']},
  'baxian-zhongli-quan': {category: 'fantasy', series: 'baxian-movie', tags: ['八仙', '钟离权', '芭蕉扇', '电影', '免费', '深色']},
  'baxian-tieguai-li': {category: 'fantasy', series: 'baxian-movie', tags: ['八仙', '铁拐李', '葫芦', '电影', '免费', '深色']},
  'baxian-han-xiangzi': {category: 'fantasy', series: 'baxian-movie', tags: ['八仙', '韩湘子', '流云', '电影', '免费', '浅色']},
  'baxian-cao-guojiu': {category: 'fantasy', series: 'baxian-movie', tags: ['八仙', '曹国舅', '玉板', '电影', '免费', '浅色']},
  'baxian-lan-caihe': {category: 'fantasy', series: 'baxian-movie', tags: ['八仙', '蓝采和', '花篮', '电影', '免费', '浅色']},
  'baxian-zhang-guolao': {category: 'fantasy', series: 'baxian-movie', tags: ['八仙', '张果老', '仙驴', '电影', '免费', '深色']},
  'baxian-ensemble': {category: 'fantasy', series: 'baxian-movie', tags: ['八仙', '群像', '过海', '有求必应', '电影', '免费']},
  'agent-codex-terminal-orbit': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'Codex CLI', '智能核心舱', '算力核心', '无人物', 'VIP', '深色']},
  'agent-claude-code-clay': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'Claude Code', '光子推理舱', '算力核心', '无人物', 'VIP', '浅色']},
  'agent-grok-singularity': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'Grok', '深空推理阵列', '算力核心', '无人物', 'VIP', '深色']},
  'agent-openclaw-gateway': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'OpenClaw', '赤爪编排核心', '机器人控制', '无人物', 'VIP', '深色']},
  'agent-hermes-memory': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'Hermes', '信使记忆引擎', '长上下文', '无人物', 'VIP', '深色']},
  'agent-cursor-cube': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'Cursor', '光晶编译核心', '编译引擎', '无人物', 'VIP', '深色']},
  'agent-antigravity-orbit-lab': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'Antigravity CLI', '零重力算力舱', '轨道实验室', '无人物', 'VIP', '深色']},
  'agent-github-copilot-cockpit': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'GitHub Copilot CLI', '代码协同核心', '仓库拓扑', '无人物', 'VIP', '深色']},
  'agent-qwen-code-lab': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'Qwen Code', '紫曜推理核心', '语言模型', '无人物', 'VIP', '深色']},
  'agent-kimi-code-moonlab': {category: 'minimal', series: 'agent-cli', tags: ['Agent', 'Kimi Code', '月弧长上下文核心', '长上下文', '无人物', 'VIP', '深色']},
  'einstein-relativity': {category: 'art', series: 'great-minds', tags: ['爱因斯坦', '普林斯顿', '物理学家', 'VIP', '深色']},
  'honor-canyon-inspired': {category: 'fantasy', series: 'game-inspired', tags: ['王者荣耀', '王者峡谷', '东方英雄', '免费', '浅色']},
  'last-circle-inspired': {category: 'fantasy', series: 'game-inspired', tags: ['绝地求生', '艾伦格', '生存竞技', '免费', '深色']},
  'radiant-arena-inspired': {category: 'fantasy', series: 'game-inspired', tags: ['无畏契约', '打瓦', '亚海悬城', '免费', '深色']},
});

function labelCategoryFor(id) {
  if (id.startsWith('baxian-')) return 'anime-ip';
  if (['honor-canyon-inspired', 'last-circle-inspired', 'radiant-arena-inspired'].includes(id)) return 'game-ip';
  if (['cr7-portugal', 'messi-argentina', 'neymar-brazil'].includes(id)) return 'celebrity';
  if (id === 'spain-2026-champions') return 'football';
  if (id === 'kungfu-womens-football') return 'film-ip';
  return 'other';
}

const FEATURED_SKIN_IDS = new Set([
  'spain-2026-champions',
  'agent-codex-terminal-orbit',
  'agent-claude-code-clay',
  'agent-openclaw-gateway',
  'baxian-lu-dongbin',
  'baxian-he-xiangu',
  'baxian-zhongli-quan',
  'baxian-tieguai-li',
]);

function featuredTagsFor(id) {
  return FEATURED_SKIN_IDS.has(id) ? ['featured'] : [];
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function hexRGB(value) {
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function generatedPreview(surface, accent) {
  const width = 960;
  const height = 540;
  const [sr, sg, sb] = hexRGB(surface);
  const [ar, ag, ab] = hexRGB(accent);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const t = Math.min(1, (x / width) * 0.72 + (y / height) * 0.28);
      const insideSidebar = x < 210;
      const insideComposer = x > 265 && x < 890 && y > 365 && y < 485;
      const insideCard = x > 280 && x < 545 && y > 130 && y < 300;
      const shade = insideSidebar ? 0.62 : insideComposer || insideCard ? 0.76 : 1;
      const offset = 1 + x * 4;
      row[offset] = Math.round((sr * (1 - t) + ar * t) * shade);
      row[offset + 1] = Math.round((sg * (1 - t) + ag * t) * shade);
      row[offset + 2] = Math.round((sb * (1 - t) + ab * t) * shade);
      row[offset + 3] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows), {level: 9})),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function lightOrDark(surface) {
  const [r, g, b] = hexRGB(surface).map((value) => value / 255);
  const linear = [r, g, b].map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722) > 0.45 ? 'light' : 'dark';
}

function bundleAsset(assetPath) {
  const buffer = fs.readFileSync(path.join(SOURCE_CATALOG, assetPath));
  return {path: assetPath, sha256: sha256(buffer), dataBase64: buffer.toString('base64')};
}

function makeBundle(kind, id, definitionPath, assetPaths) {
  const definitionBuffer = fs.readFileSync(path.join(SOURCE_CATALOG, definitionPath));
  const bundle = {
    schemaVersion: 1,
    id,
    kind,
    version: '1.1.0',
    definition: {
      path: definitionPath,
      sha256: sha256(definitionBuffer),
      dataBase64: definitionBuffer.toString('base64'),
    },
    assets: [...new Set(assetPaths)].sort().map(bundleAsset),
  };
  return Buffer.from(`${JSON.stringify(bundle)}\n`);
}

function previewFor(id, sourcePath, colors) {
  const extension = sourcePath ? path.extname(sourcePath) : '.png';
  const outputName = `${id}${extension}`;
  const buffer = sourcePath
    ? fs.readFileSync(path.join(SOURCE_CATALOG, sourcePath))
    : generatedPreview(colors.surface, colors.accent);
  const outputPath = path.join(OUTPUT, 'catalog', 'v1', 'previews', outputName);
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  fs.writeFileSync(outputPath, buffer);
  return {name: outputName, buffer};
}

function publishEntry({
  kind,
  definitionPath,
  definition,
  assetPaths,
  previewPath,
  colors,
  features,
  publishedAt,
}) {
  const id = definition.id;
  const classification = CLASSIFICATION[id] || {category: 'other', series: 'uncategorized', tags: []};
  const labelCategory = labelCategoryFor(id);
  const bundle = makeBundle(kind, id, definitionPath, assetPaths);
  const bundleName = `${id}.lingglow-skin.json`;
  const bundlePath = path.join(OUTPUT, 'bundles', bundleName);
  fs.mkdirSync(path.dirname(bundlePath), {recursive: true});
  fs.writeFileSync(bundlePath, bundle);
  const preview = previewFor(id, previewPath, colors);
  return {
    id,
    kind,
    version: '1.1.0',
    publishedAt,
    name: definition.name,
    description: definition.description,
    tier: definition.tier,
    appearanceMode: definition.base?.['appearance.mode'] || lightOrDark(colors.surface),
    clientIds: definition.clientIds,
    category: classification.category,
    series: classification.series,
    tags: [...classification.tags, ...featuredTagsFor(id), `label:${labelCategory}`],
    preview: {
      url: `https://raw.githubusercontent.com/AI-Scarlett/LingGlow/main/catalog/v1/previews/${preview.name}`,
      sha256: sha256(preview.buffer),
    },
    colors,
    features,
    package: {
      url: `https://github.com/AI-Scarlett/LingGlow/releases/download/${RELEASE_TAG}/${bundleName}`,
      sha256: sha256(bundle),
      bytes: bundle.length,
    },
  };
}

function previousPublicationDates(indexPath = path.join(OUTPUT, 'catalog', 'v1', 'index.json')) {
  try {
    const previous = readJSON(indexPath);
    return new Map((previous.skins ?? [])
      .filter((entry) => typeof entry.id === 'string' &&
        typeof entry.publishedAt === 'string' &&
        !Number.isNaN(Date.parse(entry.publishedAt)))
      .map((entry) => [entry.id, entry.publishedAt]));
  } catch {
    return new Map();
  }
}

function preservePublishedPackages(entries, publishedIndexPath) {
  const published = readJSON(publishedIndexPath);
  if (published.schemaVersion !== 2 || !Array.isArray(published.skins)) {
    throw new Error('目录元数据更新需要现有的协议 v2 公开索引');
  }
  const byId = new Map(published.skins.map((entry) => [entry.id, entry]));
  if (byId.size !== entries.length) {
    throw new Error('目录元数据更新不能新增或删除皮肤包');
  }
  return entries.map((entry) => {
    const previous = byId.get(entry.id);
    if (!previous?.package || typeof previous.package.sha256 !== 'string' ||
        typeof previous.package.url !== 'string' || !Number.isInteger(previous.package.bytes)) {
      throw new Error(`公开目录缺少可复用的皮肤包记录：${entry.id}`);
    }
    const nextComparable = structuredClone(entry);
    const previousComparable = structuredClone(previous);
    delete nextComparable.tags;
    delete nextComparable.package;
    delete previousComparable.tags;
    delete previousComparable.package;
    if (JSON.stringify(nextComparable) !== JSON.stringify(previousComparable)) {
      throw new Error(`目录元数据更新检测到标签以外的皮肤变化：${entry.id}`);
    }
    return {...entry, package: structuredClone(previous.package)};
  });
}

function publicationDateFor(id, definitionPath, previous) {
  const preserved = previous.get(id);
  if (preserved) return preserved;
  // One-time migration for catalogs that predate `publishedAt`. Subsequent
  // builds preserve the generated value, so editing a skin does not make an
  // old release appear new.
  return fs.statSync(path.join(SOURCE_CATALOG, definitionPath)).mtime.toISOString();
}

function buildDistribution({publishedIndexPath = null} = {}) {
  const publications = previousPublicationDates(publishedIndexPath ?? undefined);
  const generatedAt = new Date().toISOString();
  fs.rmSync(OUTPUT, {recursive: true, force: true});
  const entries = [];
  const legacyIndex = readJSON(path.join(SOURCE_CATALOG, 'index.json'));
  for (const definitionPath of legacyIndex.skins) {
    const skin = readJSON(path.join(SOURCE_CATALOG, definitionPath));
    const assetPaths = [
      skin.asset?.path,
      skin.projectHeroAsset?.path,
      skin.composerAvatarAsset?.path,
    ].filter(Boolean);
    const colors = {
      accent: skin.profile.official.accent,
      surface: skin.profile.official.surface,
      ink: skin.profile.official.ink,
    };
    entries.push(publishEntry({
      kind: 'legacy-v1',
      definitionPath,
      definition: skin,
      assetPaths,
      previewPath: skin.asset?.path || null,
      colors,
      publishedAt: publicationDateFor(skin.id, definitionPath, publications),
      features: {
        artwork: Boolean(skin.asset),
        projectHero: Boolean(skin.projectHeroAsset),
        composerAvatar: Boolean(skin.composerAvatarAsset),
        brand: Boolean(skin.profile.advanced.brand?.enabled),
        banner: false,
      },
    }));
  }
  const themeIndex = readJSON(path.join(SOURCE_CATALOG, 'theme-packs', 'index.json'));
  for (const record of themeIndex.packs) {
    const pack = readJSON(path.join(SOURCE_CATALOG, record.path));
    const assetPaths = Object.values(pack.assets).map(({path: value}) => value);
    const previewPath = pack.preview.assetId ? pack.assets[pack.preview.assetId].path : null;
    const colors = {
      accent: pack.base['appearance.accent'],
      surface: pack.base['appearance.surface'],
      ink: pack.base['appearance.ink'],
    };
    entries.push(publishEntry({
      kind: 'theme-pack',
      definitionPath: record.path,
      definition: pack,
      assetPaths,
      previewPath,
      colors,
      publishedAt: publicationDateFor(pack.id, record.path, publications),
      features: {
        artwork: Boolean(previewPath || pack.base['background.image']),
        projectHero: Boolean(pack.base['workbuddy.projectHero.image']),
        composerAvatar: Boolean(pack.base['workbuddy.composerAvatar.image']),
        brand: pack.base['brand.enabled'] === true,
        banner: pack.base['codex.banner.enabled'] === true && Boolean(pack.base['codex.banner.image']),
      },
    }));
  }
  const publishedEntries = publishedIndexPath
    ? preservePublishedPackages(entries, publishedIndexPath)
    : entries;
  const index = {
    schemaVersion: 2,
    catalogVersion: generatedAt.slice(0, 10).replaceAll('-', '.') + '.1',
    generatedAt,
    minimumAppVersion: '2.2.1',
    skins: publishedEntries,
  };
  writeJSON(path.join(OUTPUT, 'catalog', 'v1', 'index.json'), index);
  const gallery = [
    '# 灵妆皮肤样式库',
    '',
    `当前共 ${entries.length} 套。预览图只用于展示风格；实际效果取决于 Agent 版本与安全适配级别。`,
    '',
    ...publishedEntries.flatMap((entry) => [
      `## ${entry.name}`,
      '',
      `- ID: \`${entry.id}\``,
      `- 类型: ${entry.tier === 'free' ? '免费' : 'VIP'} / ${entry.appearanceMode === 'light' ? '浅色' : '深色'}`,
      `- 分类: ${entry.category} / ${entry.series} / ${entry.tags.join('、')}`,
      `- 标签分类: ${entry.tags.find((tag) => tag.startsWith('label:'))?.slice(6) || 'other'}`,
      `- Agent: ${entry.clientIds.join('、')}`,
      '',
      `![${entry.name}](./previews/${path.basename(new URL(entry.preview.url).pathname)})`,
      '',
    ]),
  ].join('\n');
  fs.writeFileSync(path.join(OUTPUT, 'catalog', 'v1', 'GALLERY.md'), gallery);
  process.stdout.write(`已生成 ${publishedEntries.length} 套远程皮肤：${OUTPUT}\n`);
}

function pruneRuntime(catalogDir, keepIds) {
  const themeIndexPath = path.join(catalogDir, 'theme-packs', 'index.json');
  const themeIndex = readJSON(themeIndexPath);
  const selected = keepIds.map((id) => {
    const record = themeIndex.packs.find((candidate) => candidate.id === id);
    if (!record) throw new Error(`找不到离线皮肤：${id}`);
    const packPath = path.join(catalogDir, record.path);
    const packBuffer = fs.readFileSync(packPath);
    return {record, packPath, packBuffer, pack: JSON.parse(packBuffer.toString('utf8'))};
  });
  const keepPackPaths = new Set(selected.map(({packPath}) => packPath));
  const keepAssets = new Set(selected.flatMap(({pack}) =>
    Object.values(pack.assets).map(({path: value}) => value)));
  const legacyIndex = readJSON(path.join(catalogDir, 'index.json'));
  for (const definitionPath of legacyIndex.skins) {
    const skin = readJSON(path.join(catalogDir, definitionPath));
    if (skin.asset?.path) keepAssets.add(skin.asset.path);
    if (skin.projectHeroAsset?.path) keepAssets.add(skin.projectHeroAsset.path);
    if (skin.composerAvatarAsset?.path) keepAssets.add(skin.composerAvatarAsset.path);
  }
  for (const name of fs.readdirSync(path.join(catalogDir, 'assets'))) {
    const relative = `assets/${name}`;
    if (!keepAssets.has(relative)) fs.rmSync(path.join(catalogDir, relative));
  }
  for (const name of fs.readdirSync(path.join(catalogDir, 'theme-packs'))) {
    const current = path.join(catalogDir, 'theme-packs', name);
    if (name !== 'index.json' && !keepPackPaths.has(current) && fs.statSync(current).isFile()) fs.rmSync(current);
  }
  writeJSON(themeIndexPath, {
    ...themeIndex,
    packs: selected.map(({record, packBuffer}) => ({
      id: record.id,
      path: record.path,
      sha256: sha256(packBuffer),
    })),
  });
  process.stdout.write(`运行时目录保留离线皮肤：${keepIds.join('、')}\n`);
}

const args = process.argv.slice(2);
if (args[0] === '--prune-runtime') {
  const keepIds = [];
  for (let index = 2; index < args.length; index += 1) {
    if (['--keep', '--fallback'].includes(args[index]) && args[index + 1]) {
      keepIds.push(args[index + 1]);
      index += 1;
    }
  }
  if (!args[1] || keepIds.length < 1) {
    throw new Error('用法：--prune-runtime <catalogDir> --keep <skinId> [--keep <skinId>]');
  }
  pruneRuntime(path.resolve(args[1]), [...new Set(keepIds)]);
} else if (args[0] === '--catalog-metadata-from') {
  if (!args[1] || args.length !== 2) {
    throw new Error('用法：--catalog-metadata-from <published-index.json>');
  }
  buildDistribution({publishedIndexPath: path.resolve(args[1])});
} else {
  buildDistribution();
}
