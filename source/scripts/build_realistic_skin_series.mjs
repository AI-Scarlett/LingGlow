#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER_DIR = path.join(ROOT, 'work', 'skin-masters');
const MASCOT_DIR = path.join(ROOT, 'work', 'skin-mascots-rendered');
const ASSET_DIR = path.join(ROOT, 'catalog', 'assets');
const PACK_DIR = path.join(ROOT, 'catalog', 'theme-packs');

const SERIES = [
  {
    id: 'agent-codex-terminal-orbit', master: 'agent-codex-logo-master-v3.png',
    name: 'Codex CLI·智能核心舱', description: '无人物设计；以 Codex 结形标识计算核心、终端矩阵与光路机舱为主视觉的三端 VIP 主题；非官方粉丝创作，与 OpenAI 无商业关联。',
    tier: 'vip', variant: 'dark', accent: '#52C991', surface: '#07110D', ink: '#EFFAF5', skill: '#8BE0B7',
    brand: 'Codex CLI', mark: 'CX', style: 'circle', crop: [950, 130, 500],
  },
  {
    id: 'agent-claude-code-clay', master: 'agent-claude-logo-master-v3.png',
    name: 'Claude Code·光子推理舱', description: '无人物设计；以 Claude 星芒推理核心、琥珀光子总线与机械仪器阵列为主视觉的三端 VIP 主题；非官方粉丝创作，与 Anthropic 无商业关联。',
    tier: 'vip', variant: 'light', accent: '#A84F34', surface: '#F3E8DB', ink: '#2B211C', skill: '#9B5A3E',
    brand: 'Claude Code', mark: 'CC', style: 'tile', crop: [800, 110, 500],
  },
  {
    id: 'agent-grok-singularity', master: 'agent-grok-logo-master-v3.png',
    name: 'Grok·深空推理阵列', description: '无人物设计；以 Grok X 推理引擎、轨道遥测与航天算力阵列为主视觉的三端 VIP 主题；非官方粉丝创作，与 xAI 无商业关联。',
    tier: 'vip', variant: 'dark', accent: '#C7CDD6', surface: '#07090C', ink: '#F7F9FB', skill: '#AEB8C8',
    brand: 'Grok', mark: 'G', style: 'tile', crop: [780, 90, 500],
  },
  {
    id: 'agent-openclaw-gateway', master: 'agent-openclaw-logo-master-v3.png',
    name: 'OpenClaw·赤爪编排核心', description: '无人物设计；以赤色多爪编排核心、机器人控制总线与安全运维机柜为主视觉的三端 VIP 主题；非官方粉丝创作，与 OpenClaw 项目无商业关联。',
    tier: 'vip', variant: 'dark', accent: '#F05B61', surface: '#071018', ink: '#F4F8FB', skill: '#FF8A8E',
    brand: 'OpenClaw', mark: 'OC', style: 'diamond', crop: [800, 90, 500],
  },
  {
    id: 'agent-hermes-memory', master: 'agent-hermes-logo-master-v3.png',
    name: 'Hermes·信使记忆引擎', description: '无人物设计；以金色信使记忆引擎、蓝金数据路由与长期上下文矩阵为主视觉的三端 VIP 主题；非官方粉丝创作，与 Nous Research 无商业关联。',
    tier: 'vip', variant: 'dark', accent: '#CBA45B', surface: '#090D1D', ink: '#F5ECD9', skill: '#E1C27C',
    brand: 'Hermes', mark: 'H', style: 'circle', crop: [950, 100, 500],
  },
  {
    id: 'agent-cursor-cube', master: 'agent-cursor-logo-master-v3.png',
    name: 'Cursor·光晶编译核心', description: '无人物设计；以 Cursor 光晶编译核心、紫色代码光路与多层工程数据面为主视觉的三端 VIP 主题；非官方粉丝创作，与 Cursor 无商业关联。',
    tier: 'vip', variant: 'dark', accent: '#A793FF', surface: '#0B0A13', ink: '#F7F5FF', skill: '#C0B5FF',
    brand: 'Cursor', mark: 'CU', style: 'tile', crop: [750, 100, 650],
  },
  {
    id: 'agent-antigravity-orbit-lab', master: 'agent-antigravity-logo-master-v3.png',
    name: 'Antigravity CLI·零重力算力舱', description: '无人物设计；以四色反重力算力核心、轨道机械臂与失重数据环为主视觉的三端 VIP 主题；非官方粉丝创作，与 Google 无商业关联。',
    tier: 'vip', variant: 'dark', accent: '#4A8BE8', surface: '#071426', ink: '#F1F7FF', skill: '#74A8F0',
    brand: 'Antigravity CLI', mark: 'AG', style: 'circle', crop: [780, 150, 500],
  },
  {
    id: 'agent-github-copilot-cockpit', master: 'agent-github-copilot-logo-master-v3.png',
    name: 'GitHub Copilot CLI·代码协同核心', description: '无人物设计；以 Copilot 机器人形协同核心、仓库拓扑与多屏代码数据面为主视觉的三端 VIP 主题；非官方粉丝创作，与 GitHub 无商业关联。',
    tier: 'vip', variant: 'dark', accent: '#9B7CFF', surface: '#0D0D14', ink: '#F7F5FF', skill: '#B59DFF',
    brand: 'GitHub Copilot', mark: 'GC', style: 'circle', crop: [850, 80, 600],
  },
  {
    id: 'agent-qwen-code-lab', master: 'agent-qwen-code-logo-master-v3.png',
    name: 'Qwen Code·紫曜推理核心', description: '无人物设计；以紫蓝多环语言推理核心、参数光路与编码终端矩阵为主视觉的三端 VIP 主题；非官方粉丝创作，与通义千问无商业关联。',
    tier: 'vip', variant: 'dark', accent: '#8B6CFF', surface: '#0B0D27', ink: '#F5F3FF', skill: '#AA91FF',
    brand: 'Qwen Code', mark: 'QW', style: 'circle', crop: [730, 110, 500],
  },
  {
    id: 'agent-kimi-code-moonlab', master: 'agent-kimi-code-logo-master-v3.png',
    name: 'Kimi Code·月弧长上下文核心', description: '无人物设计；以银色月弧长上下文核心、深蓝推理光路与月面数据中心为主视觉的三端 VIP 主题；非官方粉丝创作，与 Moonshot AI 无商业关联。',
    tier: 'vip', variant: 'dark', accent: '#D5E8FF', surface: '#071426', ink: '#F5F9FF', skill: '#AFCFEB',
    brand: 'Kimi Code', mark: 'KM', style: 'circle', crop: [900, 160, 500],
  },
  {
    id: 'einstein-relativity', master: 'einstein-realistic-master.png',
    name: '爱因斯坦·普林斯顿书房', description: '以写实爱因斯坦肖像、历史物理书房与手稿实验器材为核心的三端 VIP 主题；为非官方艺术创作。',
    tier: 'vip', variant: 'dark', accent: '#D2A45B', surface: '#0A1B2E', ink: '#F4EBDD', skill: '#E3BF78',
    brand: 'Einstein', mark: 'AE', style: 'circle', crop: [1010, 90, 470],
  },
  {
    id: 'honor-canyon-inspired', master: 'honor-kings-realistic-master.png',
    name: '王者荣耀·云巅峡谷', description: '以写实王者峡谷、东方英雄群像与蓝红阵营建筑为核心的三端免费主题；非官方粉丝创作，与腾讯游戏无商业关联。',
    tier: 'free', variant: 'light', accent: '#2E70B8', surface: '#EDF5F8', ink: '#18283A', skill: '#356DA5',
    brand: '王者荣耀', mark: '王', style: 'diamond', crop: [880, 90, 560],
  },
  {
    id: 'last-circle-inspired', master: 'pubg-realistic-master.png',
    name: '绝地求生·艾伦格终局', description: '以写实艾伦格战场、三级头幸存者与蓝圈空投为核心的三端免费主题；非官方粉丝创作，与 PUBG Studios 无商业关联。',
    tier: 'free', variant: 'dark', accent: '#D6A04E', surface: '#191711', ink: '#F3EFE3', skill: '#E7BC70',
    brand: 'PUBG', mark: 'P', style: 'diamond', crop: [940, 30, 500],
  },
  {
    id: 'radiant-arena-inspired', master: 'valorant-realistic-master.png',
    name: '无畏契约·亚海悬城', description: '以写实亚海悬城战术场景、风火特工与辐能爆破装置为核心的三端免费主题；非官方粉丝创作，与 Riot Games 无商业关联。',
    tier: 'free', variant: 'dark', accent: '#FF5B68', surface: '#0A1E23', ink: '#F5F4EC', skill: '#FF858D',
    brand: 'VALORANT', mark: 'V', style: 'diamond', crop: [900, 80, 560],
  },
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {stdio: 'inherit'});
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

function assetEntry(id, suffix, slot, fileName) {
  const filePath = path.join(ASSET_DIR, fileName);
  return [
    `${id}-${suffix}`,
    {slot, path: `assets/${fileName}`, sha256: sha256(filePath)},
  ];
}

function buildAssets(theme) {
  const master = path.join(MASTER_DIR, theme.master);
  if (!fs.existsSync(master)) throw new Error(`Missing master: ${master}`);
  const background = `${theme.id}-background.webp`;
  const hero = `${theme.id}-hero.webp`;
  const banner = `${theme.id}-banner.webp`;
  const avatar = `${theme.id}-avatar.webp`;
  const mascotSource = path.join(MASCOT_DIR, `${theme.id}.png`);
  const mascot = fs.existsSync(mascotSource) ? `${theme.id}-mascot.webp` : null;
  const [x, y, size] = theme.crop;
  const isAgentCore = theme.id.startsWith('agent-');

  const backgroundFilter = isAgentCore
    ? 'crop=1536:960:0:32,scale=2560:1600:flags=lanczos'
    : 'scale=2560:1600:flags=lanczos';
  const heroFilter = isAgentCore
    ? 'crop=1536:864:0:80,scale=1920:1080:flags=lanczos'
    : 'scale=1920:-2:flags=lanczos,crop=1920:1080:(iw-ow)/2:(ih-oh)/2';
  const bannerFilter = isAgentCore
    ? 'crop=1536:512:0:144,scale=2400:800:flags=lanczos'
    : 'scale=2400:-2:flags=lanczos,crop=2400:800:0:(ih-oh)/2';

  runFfmpeg(['-i', master, '-vf', backgroundFilter, '-c:v', 'libwebp', '-q:v', '86', '-frames:v', '1', path.join(ASSET_DIR, background)]);
  runFfmpeg(['-i', master, '-vf', heroFilter, '-c:v', 'libwebp', '-q:v', '84', '-frames:v', '1', path.join(ASSET_DIR, hero)]);
  runFfmpeg(['-i', master, '-vf', bannerFilter, '-c:v', 'libwebp', '-q:v', '85', '-frames:v', '1', path.join(ASSET_DIR, banner)]);
  runFfmpeg([
    '-i', master,
    '-vf', `crop=${size}:${size}:${x}:${y},scale=512:512:flags=lanczos,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),W/2),255,0)'`,
    '-c:v', 'libwebp', '-q:v', '88', '-frames:v', '1', path.join(ASSET_DIR, avatar),
  ]);
  if (mascot) {
    runFfmpeg([
      '-i', mascotSource,
      '-vf', 'scale=1024:1024:flags=lanczos,format=rgba',
      '-c:v', 'libwebp', '-lossless', '1', '-frames:v', '1', path.join(ASSET_DIR, mascot),
    ]);
  }
  return {background, hero, banner, avatar, mascot};
}

function makePack(theme, files) {
  const isLight = theme.variant === 'light';
  const baseOverlay = isLight ? 0.10 : 0.20;
  const baseGlass = isLight ? 0.86 : 0.78;
  const entries = [
    assetEntry(theme.id, 'background', 'background.main', files.background),
    assetEntry(theme.id, 'preview', 'workbuddy.project-hero', files.hero),
    assetEntry(theme.id, 'codex-banner', 'codex.banner', files.banner),
    assetEntry(theme.id, 'doubao-hero', 'doubao.home-hero', files.hero),
    assetEntry(theme.id, 'brand-icon', 'brand.icon', files.avatar),
  ];
  if (files.mascot) {
    entries.push(assetEntry(theme.id, 'composer-mascot', 'workbuddy.composer-avatar', files.mascot));
  }
  return {
    schemaVersion: 1,
    kind: 'lingglow.theme-pack',
    id: theme.id,
    name: theme.name,
    description: theme.description,
    tier: theme.tier,
    clientIds: ['workbuddy', 'doubao', 'codex'],
    preview: {gradientPreset: 'sunset', assetId: `${theme.id}-preview`},
    assets: Object.fromEntries(entries),
    base: {
      'advanced.enabled': true,
      'appearance.variant': theme.variant,
      'appearance.accent': theme.accent,
      'appearance.surface': theme.surface,
      'appearance.ink': theme.ink,
      'appearance.contrast': 86,
      'typography.codeFont': null,
      'typography.uiFont': null,
      'window.opaque': true,
      'semantic.diffAdded': '#45C17A',
      'semantic.diffRemoved': '#E35D68',
      'semantic.skill': theme.skill,
      'background.image': {assetId: `${theme.id}-background`},
      'background.opacity': 1,
      'background.overlay': baseOverlay,
      'background.blur': 0,
      'background.position': 'right',
      'glass.enabled': true,
      'glass.opacity': baseGlass,
      'glass.blur': 18,
      'brand.enabled': true,
      'brand.displayName': theme.brand,
      'brand.shortMark': theme.mark,
      'brand.logoStyle': theme.style,
      'brand.iconImage': {assetId: `${theme.id}-brand-icon`},
      'shape.radius': isLight ? 22 : 20,
      'motion.preset': 'subtle',
      'layout.sidebarWidth': 280,
      'codex.codeThemeId': 'codex',
      'workbuddy.projectHero.image': {assetId: `${theme.id}-preview`},
      'workbuddy.projectHero.fit': 'cover',
      'workbuddy.projectHero.position': 'right',
      // Only a separately rendered, transparent, padded subject can replace
      // WorkBuddy's native robot. Themes without one deliberately fall back.
      'workbuddy.composerAvatar.image': files.mascot
        ? {assetId: `${theme.id}-composer-mascot`}
        : null,
      'workbuddy.composerAvatar.fit': 'contain',
      'workbuddy.composerAvatar.shape': 'square',
      'codex.banner.enabled': true,
      'codex.banner.image': {assetId: `${theme.id}-codex-banner`},
      'codex.banner.opacity': isLight ? 0.52 : 0.55,
      'codex.banner.height': 220,
      'codex.banner.width': 1160,
      'codex.banner.position': 'top-right',
      'doubao.homeHero.image': {assetId: `${theme.id}-doubao-hero`},
      'doubao.homeHero.fit': 'cover',
      'doubao.homeHero.position': 'right',
      'doubao.assistantAvatar.image': null,
      'doubao.assistantAvatar.fit': 'cover',
      'doubao.assistantAvatar.shape': 'circle',
    },
    overrides: {
      workbuddy: {
        'appearance.accent': theme.accent,
        'appearance.surface': theme.surface,
        'appearance.ink': theme.ink,
        'background.overlay': isLight ? 0.12 : 0.22,
        'glass.opacity': isLight ? 0.88 : 0.80,
      },
      doubao: {
        'appearance.accent': theme.accent,
        'appearance.surface': theme.surface,
        'appearance.ink': theme.ink,
        'background.overlay': isLight ? 0.14 : 0.24,
        'glass.enabled': true,
        'glass.opacity': isLight ? 0.89 : 0.82,
        'glass.blur': 18,
      },
      codex: {
        'appearance.accent': theme.accent,
        'appearance.surface': theme.surface,
        'appearance.ink': theme.ink,
        'background.overlay': isLight ? 0.11 : 0.20,
        'glass.opacity': isLight ? 0.87 : 0.79,
      },
    },
  };
}

fs.mkdirSync(ASSET_DIR, {recursive: true});
fs.mkdirSync(PACK_DIR, {recursive: true});
for (const theme of SERIES) {
  const files = buildAssets(theme);
  const pack = makePack(theme, files);
  fs.writeFileSync(path.join(PACK_DIR, `${theme.id}.json`), `${JSON.stringify(pack, null, 2)}\n`);
  console.log(`built ${theme.id}`);
}

const indexPath = path.join(PACK_DIR, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const ids = new Set(SERIES.map((theme) => theme.id));
index.packs = [
  ...index.packs.filter((entry) => !ids.has(entry.id)),
  ...SERIES.map((theme) => {
    const definition = path.join(PACK_DIR, `${theme.id}.json`);
    return {
      id: theme.id,
      path: `theme-packs/${theme.id}.json`,
      sha256: sha256(definition),
    };
  }),
];
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`updated ${path.relative(ROOT, indexPath)}`);
