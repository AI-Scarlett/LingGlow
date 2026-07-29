import {validateImageDataUrl} from './profile.mjs';
import {TARGET_CLIENT_IDS} from './client-registry.mjs';

export const UNION_SCHEMA_VERSION = 1;
// Alias the canonical registry rather than maintaining a second client list.
export const UNION_CLIENT_IDS = TARGET_CLIENT_IDS;
export const SUPPORT_STATUSES = Object.freeze(['supported', 'pending', 'unsupported']);

const ALL_CLIENTS = UNION_CLIENT_IDS;
const STATIC_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
const FIELD_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/u;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 20_000;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function jsonClone(value, state = {depth: 0, counter: {nodes: 0}}) {
  state.counter.nodes += 1;
  if (state.counter.nodes > MAX_JSON_NODES || state.depth > MAX_JSON_DEPTH) {
    throw new Error('并集配置 JSON 过深或节点过多');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('并集配置不能包含非有限数字');
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonClone(item, {depth: state.depth + 1, counter: state.counter}));
  }
  if (!value || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('并集配置只能包含普通 JSON 值');
  }
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (RESERVED_KEYS.has(key)) throw new Error(`并集配置包含保留键：${key}`);
    result[key] = jsonClone(nested, {depth: state.depth + 1, counter: state.counter});
  }
  return result;
}

function field({
  id,
  type,
  defaultValue,
  assetSlot = null,
  clients = ALL_CLIENTS,
  status = 'stable',
  description,
  version = 1,
  group,
  constraints = {},
  legacyV1Path = null,
}) {
  return deepFreeze({
    id,
    type,
    defaultValue,
    assetSlot,
    clients: [...clients],
    status,
    description,
    version,
    group,
    constraints,
    legacyV1Path,
  });
}

const backgroundPositions = [
  'center', 'top', 'bottom', 'left', 'right',
  'top left', 'top right', 'bottom left', 'bottom right',
];

export const UNION_FIELDS = deepFreeze([
  field({id: 'advanced.enabled', type: 'boolean', defaultValue: false, group: '基础',
    description: '高级视觉层总开关。', legacyV1Path: 'advanced.enabled'}),
  field({id: 'appearance.variant', type: 'enum', defaultValue: 'dark', group: '色彩',
    description: '浅色或深色基础外观。', constraints: {options: ['light', 'dark']},
    legacyV1Path: 'official.variant'}),
  field({id: 'appearance.accent', type: 'color', defaultValue: '#7AA2F7', group: '色彩',
    description: '按钮、选中态与重点控件的强调色。', legacyV1Path: 'official.accent'}),
  field({id: 'appearance.surface', type: 'color', defaultValue: '#111827', group: '色彩',
    description: '窗口、面板与卡片的基础表面色。', legacyV1Path: 'official.surface'}),
  field({id: 'appearance.ink', type: 'color', defaultValue: '#E5E7EB', group: '色彩',
    description: '主要文本和图标颜色。', legacyV1Path: 'official.ink'}),
  field({id: 'appearance.contrast', type: 'integer', defaultValue: 45, group: '色彩',
    description: '官方主题对比度。', constraints: {min: 0, max: 100},
    legacyV1Path: 'official.contrast'}),
  field({id: 'typography.codeFont', type: 'string', defaultValue: null, group: '字体',
    description: '代码字体；null 表示使用客户端默认字体。', constraints: {nullable: true, maxLength: 80, format: 'font'},
    legacyV1Path: 'official.fonts.code'}),
  field({id: 'typography.uiFont', type: 'string', defaultValue: null, group: '字体',
    description: '界面字体；null 表示使用客户端默认字体。', constraints: {nullable: true, maxLength: 80, format: 'font'},
    legacyV1Path: 'official.fonts.ui'}),
  field({id: 'window.opaque', type: 'boolean', defaultValue: true, group: '窗口', clients: ['codex'],
    description: 'Codex 官方主题的不透明窗口选项。', legacyV1Path: 'official.opaqueWindows'}),
  field({id: 'semantic.diffAdded', type: 'color', defaultValue: '#22C55E', group: '语义色',
    description: '代码新增与成功状态颜色。', legacyV1Path: 'official.semanticColors.diffAdded'}),
  field({id: 'semantic.diffRemoved', type: 'color', defaultValue: '#EF4444', group: '语义色',
    description: '代码删除、危险和停止状态颜色。', legacyV1Path: 'official.semanticColors.diffRemoved'}),
  field({id: 'semantic.skill', type: 'color', defaultValue: '#A78BFA', group: '语义色',
    clients: ['workbuddy', 'codex'], description: 'Skill 或扩展能力的强调色。',
    legacyV1Path: 'official.semanticColors.skill'}),
  field({id: 'background.image', type: 'asset', defaultValue: null, assetSlot: 'background.main', group: '背景',
    description: '整窗本地静态背景图；建议 16:10、2560×1600 px，最大 4 MB。', constraints: {
      nullable: true, mimeTypes: STATIC_IMAGE_TYPES, maxBytes: 4 * 1024 * 1024,
      maxDimension: 4096, maxPixels: 16 * 1024 * 1024,
    }, legacyV1Path: 'advanced.background.image'}),
  field({id: 'background.opacity', type: 'number', defaultValue: 0.55, group: '背景',
    description: '背景图层整体不透明度。', constraints: {min: 0.05, max: 1},
    legacyV1Path: 'advanced.background.opacity'}),
  field({id: 'background.overlay', type: 'number', defaultValue: 0.58, group: '背景',
    description: '背景图上的表面色遮罩强度。', constraints: {min: 0, max: 0.95},
    legacyV1Path: 'advanced.background.overlay'}),
  field({id: 'background.blur', type: 'integer', defaultValue: 0, group: '背景',
    description: '背景模糊半径。', constraints: {min: 0, max: 24},
    legacyV1Path: 'advanced.background.blur'}),
  field({id: 'background.position', type: 'enum', defaultValue: 'center', group: '背景',
    description: '背景图焦点位置。', constraints: {options: backgroundPositions},
    legacyV1Path: 'advanced.background.position'}),
  field({id: 'glass.enabled', type: 'boolean', defaultValue: true, group: '玻璃',
    description: '启用半透明玻璃面板。', legacyV1Path: 'advanced.glass.enabled'}),
  field({id: 'glass.opacity', type: 'number', defaultValue: 0.74, group: '玻璃',
    description: '玻璃面板不透明度。', constraints: {min: 0.35, max: 0.98},
    legacyV1Path: 'advanced.glass.opacity'}),
  field({id: 'glass.blur', type: 'integer', defaultValue: 18, group: '玻璃',
    description: '玻璃面板背景模糊半径。', constraints: {min: 0, max: 32},
    legacyV1Path: 'advanced.glass.blur'}),
  field({id: 'brand.enabled', type: 'boolean', defaultValue: false, group: '品牌',
    description: '启用客户端品牌区视觉替换。', legacyV1Path: 'advanced.brand.enabled'}),
  field({id: 'brand.displayName', type: 'string', defaultValue: null, group: '品牌',
    description: '客户端显示名称；null 表示保留原名。', constraints: {nullable: true, maxLength: 24},
    legacyV1Path: 'advanced.brand.displayName'}),
  field({id: 'brand.shortMark', type: 'string', defaultValue: null, group: '品牌',
    description: '无图片时显示的 1 至 3 字符短标。', constraints: {nullable: true, maxLength: 3},
    legacyV1Path: 'advanced.brand.shortMark'}),
  field({id: 'brand.logoStyle', type: 'enum', defaultValue: 'original', group: '品牌',
    description: '短标的固定安全形状。', constraints: {options: ['original', 'tile', 'circle', 'diamond']},
    legacyV1Path: 'advanced.brand.logoStyle'}),
  field({id: 'brand.iconImage', type: 'asset', defaultValue: null, assetSlot: 'brand.icon', group: '品牌',
    description: '本地静态品牌图标；建议 1:1、512×512 px 以上，最大 2 MB。', constraints: {
      nullable: true, mimeTypes: STATIC_IMAGE_TYPES, maxBytes: 2 * 1024 * 1024,
      maxDimension: 2048, maxPixels: 4 * 1024 * 1024,
    }, legacyV1Path: 'advanced.brand.iconImage'}),
  field({id: 'shape.radius', type: 'integer', defaultValue: 16, group: '形状',
    description: '卡片、输入框和按钮的圆角。', constraints: {min: 8, max: 28},
    legacyV1Path: 'advanced.radius'}),
  field({id: 'motion.preset', type: 'enum', defaultValue: 'subtle', group: '动效',
    description: '固定白名单动效预设。', constraints: {options: ['none', 'subtle', 'float']},
    legacyV1Path: 'advanced.motion'}),
  field({id: 'layout.sidebarWidth', type: 'integer', defaultValue: 275, group: '布局',
    description: '侧栏宽度候选值。', constraints: {min: 240, max: 420},
    legacyV1Path: 'advanced.sidebarWidth'}),
  field({id: 'codex.codeThemeId', type: 'string', defaultValue: 'codex', group: 'Codex', clients: ['codex'],
    description: 'Codex 客户端已安装的代码高亮主题 ID。', constraints: {maxLength: 60, format: 'identifier'},
    legacyV1Path: 'official.codeThemeId'}),
  field({id: 'codex.banner.enabled', type: 'boolean', defaultValue: false, group: 'Codex', clients: ['codex'],
    description: 'Codex 横幅候选能力开关。', legacyV1Path: 'advanced.banner.enabled'}),
  field({id: 'codex.banner.image', type: 'asset', defaultValue: null, assetSlot: 'codex.banner', group: 'Codex', clients: ['codex'],
    description: 'Codex 新建任务主视觉；建议 3:1、2400×800 px，最大 4 MB。', constraints: {
      nullable: true, mimeTypes: STATIC_IMAGE_TYPES, maxBytes: 4 * 1024 * 1024,
      maxDimension: 4096, maxPixels: 16 * 1024 * 1024,
    }, legacyV1Path: 'advanced.banner.image'}),
  field({id: 'codex.banner.opacity', type: 'number', defaultValue: 0.45, group: 'Codex', clients: ['codex'],
    description: 'Codex 横幅不透明度。', constraints: {min: 0.1, max: 0.55},
    legacyV1Path: 'advanced.banner.opacity'}),
  field({id: 'codex.banner.height', type: 'integer', defaultValue: 112, group: 'Codex', clients: ['codex'],
    description: 'Codex 横幅高度。', constraints: {min: 48, max: 240}, legacyV1Path: 'advanced.banner.height'}),
  field({id: 'codex.banner.width', type: 'integer', defaultValue: 720, group: 'Codex', clients: ['codex'],
    description: 'Codex 横幅宽度。', constraints: {min: 240, max: 1200}, legacyV1Path: 'advanced.banner.width'}),
  field({id: 'codex.banner.position', type: 'enum', defaultValue: 'top-center', group: 'Codex', clients: ['codex'],
    description: 'Codex 横幅固定位置。', constraints: {options: ['top-center', 'top-right', 'bottom-right']},
    legacyV1Path: 'advanced.banner.position'}),
  field({id: 'workbuddy.projectHero.image', type: 'asset', defaultValue: null,
    assetSlot: 'workbuddy.project-hero', group: 'WorkBuddy', clients: ['workbuddy'],
    description: 'WorkBuddy 项目页右上 Hero；建议 16:9、1920×1080 px，最大 4 MB。', constraints: {
      nullable: true, mimeTypes: STATIC_IMAGE_TYPES, maxBytes: 4 * 1024 * 1024,
      maxDimension: 4096, maxPixels: 16 * 1024 * 1024,
    }, legacyV1Path: 'advanced.workbuddy.projectHero.image'}),
  field({id: 'workbuddy.projectHero.fit', type: 'enum', defaultValue: 'cover', group: 'WorkBuddy', clients: ['workbuddy'],
    description: 'WorkBuddy 项目 Hero 的填充方式。', constraints: {options: ['cover', 'contain']},
    legacyV1Path: 'advanced.workbuddy.projectHero.fit'}),
  field({id: 'workbuddy.projectHero.position', type: 'enum', defaultValue: 'center', group: 'WorkBuddy', clients: ['workbuddy'],
    description: 'WorkBuddy 项目 Hero 的焦点位置。', constraints: {options: backgroundPositions},
    legacyV1Path: 'advanced.workbuddy.projectHero.position'}),
  field({id: 'workbuddy.composerAvatar.image', type: 'asset', defaultValue: null,
    assetSlot: 'workbuddy.composer-avatar', group: '三端输入框', clients: ALL_CLIENTS,
    description: '三端新建任务与历史对话输入区右上角机器人；必须是透明画布上的完整独立主体，四周保留透明留白，不接受背景图或圆形裁切图。', constraints: {
      nullable: true, mimeTypes: STATIC_IMAGE_TYPES, maxBytes: 2 * 1024 * 1024,
      maxDimension: 2048, maxPixels: 4 * 1024 * 1024, requireIsolatedSubject: true,
    }, legacyV1Path: 'advanced.workbuddy.composerAvatar.image'}),
  field({id: 'workbuddy.composerAvatar.fit', type: 'enum', defaultValue: 'contain', group: '三端输入框', clients: ALL_CLIENTS,
    description: '三端输入区机器人的填充方式。', constraints: {options: ['cover', 'contain']},
    legacyV1Path: 'advanced.workbuddy.composerAvatar.fit'}),
  field({id: 'workbuddy.composerAvatar.shape', type: 'enum', defaultValue: 'square', group: '三端输入框', clients: ALL_CLIENTS,
    description: '三端输入区机器人的外形。', constraints: {options: ['circle', 'rounded', 'square']},
    legacyV1Path: 'advanced.workbuddy.composerAvatar.shape'}),
  field({id: 'workbuddy.composerAvatar.activityMotion', type: 'enum', defaultValue: 'float', group: '三端输入框', clients: ALL_CLIENTS,
    description: '当前皮肤静态挂件在任务生成时的动作；每张皮肤独立声明，任务结束后停下。',
    constraints: {options: ['still', 'float', 'walk', 'roll', 'crawl', 'hop']},
    legacyV1Path: 'advanced.workbuddy.composerAvatar.activityMotion'}),
  field({id: 'doubao.homeHero.image', type: 'asset', defaultValue: null, assetSlot: 'doubao.home-hero',
    group: 'Doubao', clients: ['doubao'], status: 'candidate', version: 1,
    description: '豆包首页 Hero；建议 16:9、1920×1080 px，最大 4 MB；选择器尚未审计。', constraints: {
      nullable: true, mimeTypes: STATIC_IMAGE_TYPES, maxBytes: 4 * 1024 * 1024,
      maxDimension: 4096, maxPixels: 16 * 1024 * 1024,
    }}),
  field({id: 'doubao.homeHero.fit', type: 'enum', defaultValue: 'cover', group: 'Doubao',
    clients: ['doubao'], status: 'candidate', description: '豆包首页 Hero 候选填充方式。',
    constraints: {options: ['cover', 'contain']}}),
  field({id: 'doubao.homeHero.position', type: 'enum', defaultValue: 'center', group: 'Doubao',
    clients: ['doubao'], status: 'candidate', description: '豆包首页 Hero 候选焦点位置。',
    constraints: {options: backgroundPositions}}),
  field({id: 'doubao.assistantAvatar.image', type: 'asset', defaultValue: null, assetSlot: 'doubao.assistant-avatar',
    group: 'Doubao', clients: ['doubao'], status: 'candidate',
    description: '豆包助手头像；建议 1:1、1024×1024 px 以内，最大 2 MB；DOM 与状态尚未审计。', constraints: {
      nullable: true, mimeTypes: STATIC_IMAGE_TYPES, maxBytes: 2 * 1024 * 1024,
      maxDimension: 2048, maxPixels: 4 * 1024 * 1024,
    }}),
  field({id: 'doubao.assistantAvatar.fit', type: 'enum', defaultValue: 'cover', group: 'Doubao',
    clients: ['doubao'], status: 'candidate', description: '豆包助手头像候选填充方式。',
    constraints: {options: ['cover', 'contain']}}),
  field({id: 'doubao.assistantAvatar.shape', type: 'enum', defaultValue: 'circle', group: 'Doubao',
    clients: ['doubao'], status: 'candidate', description: '豆包助手头像候选安全形状。',
    constraints: {options: ['circle', 'rounded', 'square']}}),
]);

const FIELD_BY_ID = new Map(UNION_FIELDS.map((entry) => [entry.id, entry]));

// A capability being "supported" must mean something concrete.  Keep the
// field-level delivery contract adjacent to the support policy so a newly
// marked supported field cannot silently become a storage-only value.
//
// - runtime-css: the fixed declarative compiler consumes the value when its
//   required capabilities are present.
// - runtime-css-gate: a value controls whether the entire visual layer is
//   emitted.  It intentionally produces no CSS when false.
// - manual-official-import: LingGlow only serializes a Codex-owned public
//   theme string.  The user imports it in Codex; it never becomes runtime CSS
//   or a target-process operation.
export const FIELD_CONSUMPTION_KINDS = Object.freeze([
  'runtime-css',
  'runtime-css-gate',
  'manual-official-import',
]);

function runtimeCss(consumer, requiredCapabilities) {
  return {
    kind: 'runtime-css',
    consumer,
    requiredCapabilities: [...requiredCapabilities],
    payloadPath: null,
  };
}

function runtimeCssGate(consumer) {
  return {
    kind: 'runtime-css-gate',
    consumer,
    requiredCapabilities: [],
    payloadPath: null,
  };
}

function manualOfficialImport(payloadPath) {
  return {
    kind: 'manual-official-import',
    consumer: 'codex-theme-v1',
    requiredCapabilities: [],
    payloadPath,
  };
}

const workbuddyFieldConsumption = {
  'advanced.enabled': [runtimeCssGate('compileSkin#visualLayerEnabled')],
  'appearance.accent': [runtimeCss('compileSkin#workbuddyPaletteRule', ['palette'])],
  'appearance.surface': [runtimeCss('compileSkin#workbuddyPaletteRule', ['palette'])],
  'appearance.ink': [runtimeCss('compileSkin#workbuddyPaletteRule', ['palette'])],
  'semantic.diffRemoved': [runtimeCss('compileSkin#workbuddyControlRules', ['controls'])],
  'background.image': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.opacity': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.overlay': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.blur': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.position': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'glass.enabled': [runtimeCss('compileSkin#workbuddyPaletteRule', ['palette', 'glass'])],
  'glass.opacity': [runtimeCss('compileSkin#workbuddyPaletteRule', ['palette', 'glass'])],
  'glass.blur': [runtimeCss('compileSkin#workbuddyPaletteRule', ['palette', 'glass'])],
  'brand.enabled': [runtimeCss('compileSkin#workbuddyBrandRules', ['brand'])],
  'brand.displayName': [runtimeCss('compileSkin#workbuddyBrandRules', ['brand'])],
  'brand.shortMark': [runtimeCss('compileSkin#workbuddyBrandRules', ['brand'])],
  'brand.logoStyle': [runtimeCss('compileSkin#workbuddyBrandRules', ['brand'])],
  'brand.iconImage': [runtimeCss('compileSkin#workbuddyBrandRules', ['brand'])],
  'shape.radius': [runtimeCss('compileSkin#workbuddyControlRules', ['controls'])],
  'workbuddy.projectHero.image': [runtimeCss('compileSkin#workbuddyProjectHeroRule', ['project-hero'])],
  'workbuddy.projectHero.fit': [runtimeCss('compileSkin#workbuddyProjectHeroRule', ['project-hero'])],
  'workbuddy.projectHero.position': [runtimeCss('compileSkin#workbuddyProjectHeroRule', ['project-hero'])],
  'workbuddy.composerAvatar.image': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'workbuddy.composerAvatar.fit': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'workbuddy.composerAvatar.shape': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'workbuddy.composerAvatar.activityMotion': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
};

const codexFieldConsumption = {
  'advanced.enabled': [runtimeCssGate('compileSkin#visualLayerEnabled')],
  'appearance.variant': [manualOfficialImport('variant')],
  'appearance.accent': [
    runtimeCss('compileSkin#codexPaletteRule', ['palette']),
    manualOfficialImport('theme.accent'),
  ],
  'appearance.surface': [
    runtimeCss('compileSkin#codexPaletteRule', ['palette']),
    manualOfficialImport('theme.surface'),
  ],
  'appearance.ink': [
    runtimeCss('compileSkin#codexPaletteRule', ['palette']),
    manualOfficialImport('theme.ink'),
  ],
  'appearance.contrast': [manualOfficialImport('theme.contrast')],
  'typography.codeFont': [manualOfficialImport('theme.fonts.code')],
  'typography.uiFont': [manualOfficialImport('theme.fonts.ui')],
  'window.opaque': [manualOfficialImport('theme.opaqueWindows')],
  'semantic.diffAdded': [manualOfficialImport('theme.semanticColors.diffAdded')],
  'semantic.diffRemoved': [manualOfficialImport('theme.semanticColors.diffRemoved')],
  'semantic.skill': [manualOfficialImport('theme.semanticColors.skill')],
  'background.image': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.opacity': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.overlay': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.blur': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.position': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'glass.enabled': [runtimeCss('compileSkin#codexPaletteRule', ['palette', 'glass'])],
  'glass.opacity': [runtimeCss('compileSkin#codexPaletteRule', ['palette', 'glass'])],
  'glass.blur': [runtimeCss('compileSkin#codexPaletteRule', ['palette', 'glass'])],
  // The historic field ID is retained for profile and Theme Pack backwards
  // compatibility, but its fixed CSS consumer is shared by all three Agents.
  'workbuddy.composerAvatar.image': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'workbuddy.composerAvatar.fit': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'workbuddy.composerAvatar.shape': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'workbuddy.composerAvatar.activityMotion': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'codex.codeThemeId': [manualOfficialImport('codeThemeId')],
};

const doubaoFieldConsumption = {
  'advanced.enabled': [runtimeCssGate('compileSkin#visualLayerEnabled')],
  'appearance.accent': [runtimeCss('compileSkin#doubaoPaletteRule', ['palette'])],
  'appearance.surface': [runtimeCss('compileSkin#doubaoPaletteRule', ['palette'])],
  'appearance.ink': [runtimeCss('compileSkin#doubaoPaletteRule', ['palette'])],
  'background.image': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.opacity': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.overlay': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.blur': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'background.position': [runtimeCss('compileSkin#backgroundRule', ['background'])],
  'glass.enabled': [runtimeCss('compileSkin#doubaoPaletteRule', ['palette', 'glass'])],
  'glass.opacity': [runtimeCss('compileSkin#doubaoPaletteRule', ['palette', 'glass'])],
  'glass.blur': [runtimeCss('compileSkin#doubaoPaletteRule', ['palette', 'glass'])],
  'workbuddy.composerAvatar.image': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'workbuddy.composerAvatar.fit': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'workbuddy.composerAvatar.shape': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
  'workbuddy.composerAvatar.activityMotion': [runtimeCss('compileSkin#composerMascotRule', ['composer-avatar'])],
};

export const CLIENT_FIELD_CONSUMPTION = deepFreeze({
  workbuddy: workbuddyFieldConsumption,
  doubao: doubaoFieldConsumption,
  codex: codexFieldConsumption,
});

// This is intentionally derived from the same contract used to label
// `supported` fields.  The API exporter must not maintain a second, drifting
// list of Codex official-theme fields.
export const CODEX_OFFICIAL_THEME_FIELD_IDS = Object.freeze(
  Object.entries(CLIENT_FIELD_CONSUMPTION.codex)
    .filter(([, consumers]) => consumers.some((consumer) => consumer.kind === 'manual-official-import'))
    .map(([fieldId]) => fieldId),
);

const workbuddySupported = new Set(Object.keys(CLIENT_FIELD_CONSUMPTION.workbuddy));

const workbuddyUnsupported = new Set([
  'appearance.variant', 'appearance.contrast',
  'typography.codeFont', 'typography.uiFont',
  'semantic.diffAdded', 'semantic.skill',
  'motion.preset', 'layout.sidebarWidth',
]);

const codexSupported = new Set(Object.keys(CLIENT_FIELD_CONSUMPTION.codex));
const doubaoSupported = new Set(Object.keys(CLIENT_FIELD_CONSUMPTION.doubao));

function consumptionFor(clientId, fieldId) {
  return CLIENT_FIELD_CONSUMPTION[clientId]?.[fieldId] ?? [];
}

function supportedDescription(clientId, fieldId) {
  const consumers = consumptionFor(clientId, fieldId);
  const hasRuntime = consumers.some((consumer) => consumer.kind === 'runtime-css' || consumer.kind === 'runtime-css-gate');
  const hasManualOfficialImport = consumers.some((consumer) => consumer.kind === 'manual-official-import');
  if (clientId === 'codex' && hasManualOfficialImport && !hasRuntime) {
    return '仅本地导出为 Codex 官方主题字符串；用户需在 Codex 中手动导入，不进入运行时 CSS。';
  }
  if (clientId === 'codex' && hasManualOfficialImport) {
    return '由当前 generic-safe 固定 CSS 消费，并可本地导出为 Codex 官方主题后手动导入。';
  }
  if (clientId === 'codex') {
    return '由 Codex generic-safe 固定 CSS 编译路径消费。';
  }
  if (clientId === 'doubao') {
    return '由豆包 exact 固定 CSS 编译路径消费（背景、色板与玻璃基础层）。';
  }
  return '已由 WorkBuddy 5.2.6 / 5.3.3 exact adapter 与固定 CSS 编译器验证。';
}

function capabilityName(fieldId) {
  if (fieldId === 'advanced.enabled') return 'core';
  if (fieldId.startsWith('appearance.') || fieldId.startsWith('semantic.')) return 'palette';
  if (fieldId.startsWith('typography.') || fieldId.startsWith('window.') || fieldId === 'codex.codeThemeId') {
    return 'official-theme';
  }
  if (fieldId.startsWith('background.')) return 'background';
  if (fieldId.startsWith('glass.')) return 'glass';
  if (fieldId.startsWith('brand.')) return 'brand';
  if (fieldId === 'shape.radius') return 'controls';
  if (fieldId === 'motion.preset') return 'motion';
  if (fieldId === 'layout.sidebarWidth') return 'sidebar-width';
  if (fieldId.startsWith('codex.banner.')) return 'banner';
  if (fieldId.startsWith('workbuddy.projectHero.')) return 'project-hero';
  if (fieldId.startsWith('workbuddy.composerAvatar.')) return 'composer-avatar';
  if (fieldId.startsWith('doubao.homeHero.')) return 'home-hero';
  if (fieldId.startsWith('doubao.assistantAvatar.')) return 'assistant-avatar';
  return 'unmapped';
}

function supportFor(clientId, fieldId) {
  if (clientId === 'workbuddy') {
    if (workbuddySupported.has(fieldId)) {
      return {status: 'supported', description: supportedDescription(clientId, fieldId)};
    }
    if (workbuddyUnsupported.has(fieldId)) {
      return {status: 'unsupported', description: 'WorkBuddy 当前编译器不消费此字段，但存储层会原样保留。'};
    }
    return {status: 'pending', description: 'WorkBuddy 候选字段尚未完成选择器与状态审计。'};
  }
  if (clientId === 'codex') {
    if (codexSupported.has(fieldId)) {
      return {status: 'supported', description: supportedDescription(clientId, fieldId)};
    }
    return {status: 'pending', description: 'Codex 精确界面字段尚未完成当前版本审计，不进入编译结果。'};
  }
  if (clientId === 'doubao') {
    if (doubaoSupported.has(fieldId)) {
      return {status: 'supported', description: supportedDescription(clientId, fieldId)};
    }
    return {
      status: 'pending',
      description: '豆包候选字段尚未完成实时 DOM 与注入回归，不进入编译结果。',
    };
  }
  // Never let a newly registered Agent inherit Doubao's blocked policy by
  // accident.  A new client must add its own evidence-backed support policy.
  throw new Error(`${clientId} 缺少 capability support policy`);
}

const CAPABILITY_MAP_METADATA = deepFreeze({
  workbuddy: {
    auditedTarget: 'WorkBuddy macOS 5.2.6 / 5.3.3 exact',
    runtimeStatus: 'available',
    transportVerified: true,
    capabilities: null,
  },
  doubao: {
    auditedTarget: 'Doubao macOS 2.19.9 exact + fixed composer mascot decoration',
    runtimeStatus: 'available',
    transportVerified: true,
    capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
  },
  codex: {
    auditedTarget: 'Codex macOS generic-safe + official theme',
    runtimeStatus: 'available',
    transportVerified: true,
    capabilities: null,
  },
});

function createCapabilityMap(clientId) {
  const metadata = CAPABILITY_MAP_METADATA[clientId];
  if (!metadata) throw new Error(`${clientId} 缺少 capability map metadata`);
  const fields = {};
  for (const descriptor of UNION_FIELDS.filter((entry) => entry.clients.includes(clientId))) {
    const support = supportFor(clientId, descriptor.id);
    fields[descriptor.id] = {
      fieldId: descriptor.id,
      capability: capabilityName(descriptor.id),
      version: 1,
      ...support,
      // Returning an empty immutable array for non-supported fields makes
      // "not consumed" explicit to API clients instead of implicit by
      // omission.  Supported fields are validated below to have at least one
      // concrete contract entry.
      consumption: consumptionFor(clientId, descriptor.id),
    };
  }
  return deepFreeze({
    schemaVersion: 1,
    clientId,
    version: 1,
    ...metadata,
    fields,
  });
}

export const CLIENT_CAPABILITY_MAPS = deepFreeze(Object.fromEntries(
  UNION_CLIENT_IDS.map((clientId) => [clientId, createCapabilityMap(clientId)]),
));
export const WORKBUDDY_CAPABILITY_MAP = CLIENT_CAPABILITY_MAPS.workbuddy;
export const DOUBAO_CAPABILITY_MAP = CLIENT_CAPABILITY_MAPS.doubao;
export const CODEX_CAPABILITY_MAP = CLIENT_CAPABILITY_MAPS.codex;

function assertClientId(clientId) {
  if (!UNION_CLIENT_IDS.includes(clientId)) throw new Error(`未知并集客户端：${clientId}`);
  return clientId;
}

function validateString(value, descriptor) {
  const {constraints} = descriptor;
  if (value === null && constraints.nullable) return null;
  if (typeof value !== 'string') throw new Error(`${descriptor.id} 必须是字符串${constraints.nullable ? '或 null' : ''}`);
  if (value.length > (constraints.maxLength ?? 4096) || /\p{Cc}/u.test(value)) {
    throw new Error(`${descriptor.id} 字符串不合法`);
  }
  if (constraints.format === 'font' && /[{};<>\n\r]/u.test(value)) throw new Error(`${descriptor.id} 字体名称不合法`);
  if (constraints.format === 'identifier' && !/^[a-z0-9][a-z0-9-]{0,59}$/u.test(value)) {
    throw new Error(`${descriptor.id} 标识符不合法`);
  }
  return value;
}

function validateKnownValue(descriptor, value) {
  const {constraints} = descriptor;
  if (descriptor.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${descriptor.id} 必须是布尔值`);
    return value;
  }
  if (descriptor.type === 'string') return validateString(value, descriptor);
  if (descriptor.type === 'color') {
    if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/u.test(value)) throw new Error(`${descriptor.id} 必须是六位颜色`);
    return value.toUpperCase();
  }
  if (descriptor.type === 'number' || descriptor.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) ||
        (descriptor.type === 'integer' && !Number.isInteger(value)) ||
        value < constraints.min || value > constraints.max) {
      throw new Error(`${descriptor.id} 数值不在允许范围内`);
    }
    return value;
  }
  if (descriptor.type === 'enum') {
    if (!constraints.options.includes(value)) throw new Error(`${descriptor.id} 不在枚举白名单`);
    return value;
  }
  if (descriptor.type === 'asset') {
    return validateImageDataUrl(value, {
      optional: constraints.nullable === true,
      maxBytes: constraints.maxBytes,
      maxDimension: constraints.maxDimension,
      maxPixels: constraints.maxPixels,
      label: descriptor.id,
      requireIsolatedSubject: constraints.requireIsolatedSubject === true,
    });
  }
  throw new Error(`未知字段类型：${descriptor.type}`);
}

function validateSchemaIntegrity() {
  const ids = new Set();
  for (const descriptor of UNION_FIELDS) {
    if (!FIELD_ID.test(descriptor.id) || ids.has(descriptor.id)) throw new Error(`并集字段 ID 无效或重复：${descriptor.id}`);
    ids.add(descriptor.id);
    if (!['boolean', 'string', 'color', 'number', 'integer', 'enum', 'asset'].includes(descriptor.type)) {
      throw new Error(`并集字段类型无效：${descriptor.id}`);
    }
    if (!Number.isInteger(descriptor.version) || descriptor.version < 1 ||
        !['stable', 'candidate'].includes(descriptor.status) || !descriptor.description) {
      throw new Error(`并集字段元数据不完整：${descriptor.id}`);
    }
    if (!Array.isArray(descriptor.clients) || descriptor.clients.length < 1 ||
        descriptor.clients.length > UNION_CLIENT_IDS.length ||
        new Set(descriptor.clients).size !== descriptor.clients.length ||
        !descriptor.clients.every((clientId) => UNION_CLIENT_IDS.includes(clientId))) {
      throw new Error(`并集字段 clients 无效：${descriptor.id}`);
    }
    if ((descriptor.type === 'asset') !== (typeof descriptor.assetSlot === 'string')) {
      throw new Error(`并集字段 assetSlot 与类型不匹配：${descriptor.id}`);
    }
    validateKnownValue(descriptor, descriptor.defaultValue);
  }
  for (const clientId of UNION_CLIENT_IDS) {
    const map = CLIENT_CAPABILITY_MAPS[clientId];
    const supportedFieldIds = new Set();
    for (const descriptor of UNION_FIELDS.filter((entry) => entry.clients.includes(clientId))) {
      const support = map.fields[descriptor.id];
      if (!support || !SUPPORT_STATUSES.includes(support.status) || !support.description ||
          !Number.isInteger(support.version) || !Array.isArray(support.consumption)) {
        throw new Error(`${clientId} capability map 缺少字段：${descriptor.id}`);
      }
      if (support.status === 'supported') {
        supportedFieldIds.add(descriptor.id);
        if (!support.consumption.length) {
          throw new Error(`${clientId} supported 字段缺少消费契约：${descriptor.id}`);
        }
      } else if (support.consumption.length) {
        throw new Error(`${clientId} 非 supported 字段不能声明消费契约：${descriptor.id}`);
      }
      for (const consumer of support.consumption) {
        if (!consumer || typeof consumer !== 'object' ||
            !FIELD_CONSUMPTION_KINDS.includes(consumer.kind) ||
            typeof consumer.consumer !== 'string' || !consumer.consumer ||
            !Array.isArray(consumer.requiredCapabilities) ||
            !consumer.requiredCapabilities.every((value) => typeof value === 'string' && value)) {
          throw new Error(`${clientId} 字段消费契约无效：${descriptor.id}`);
        }
        if (consumer.kind === 'manual-official-import') {
          if (clientId !== 'codex' || consumer.consumer !== 'codex-theme-v1' ||
              typeof consumer.payloadPath !== 'string' || !consumer.payloadPath) {
            throw new Error(`${clientId} 官方主题消费契约无效：${descriptor.id}`);
          }
        } else if (consumer.payloadPath !== null) {
          throw new Error(`${clientId} CSS 消费契约不能带官方主题路径：${descriptor.id}`);
        }
      }
    }
    const contractFieldIds = new Set(Object.keys(CLIENT_FIELD_CONSUMPTION[clientId]));
    if (supportedFieldIds.size !== contractFieldIds.size ||
        [...supportedFieldIds].some((fieldId) => !contractFieldIds.has(fieldId))) {
      throw new Error(`${clientId} supported 字段与消费契约不一致`);
    }
  }
}

validateSchemaIntegrity();

export function getUnionField(fieldId) {
  return FIELD_BY_ID.get(fieldId) ?? null;
}

export function getClientCapabilityMap(clientId) {
  return CLIENT_CAPABILITY_MAPS[assertClientId(clientId)];
}

/**
 * Return the immutable delivery channels for one applicable field.  This is
 * intentionally separate from `capability`: a field such as Codex's
 * typography is supported only through a user-owned official-theme import,
 * not through the renderer CSS path.
 */
export function getFieldConsumptionForClient(clientId, fieldId) {
  assertClientId(clientId);
  return consumptionFor(clientId, fieldId);
}

/**
 * Build a field-level audit from the same contract that powers capability
 * maps.  `compileSkin` uses this for transparent output metadata; it does not
 * change the set of CSS rules the compiler emits.
 */
export function compilerConsumptionAudit(clientId, {
  enabledCapabilities = [],
  visualLayerEnabled = false,
} = {}) {
  const capabilities = new Set(Array.isArray(enabledCapabilities) ? enabledCapabilities : []);
  const entries = CLIENT_FIELD_CONSUMPTION[clientId] ?? {};
  const runtimeFieldIds = [];
  const manualOfficialImportFieldIds = [];
  const visualLayerGateFieldIds = [];
  for (const [fieldId, consumers] of Object.entries(entries)) {
    for (const consumer of consumers) {
      if (consumer.kind === 'manual-official-import') {
        manualOfficialImportFieldIds.push(fieldId);
      } else if (consumer.kind === 'runtime-css-gate') {
        visualLayerGateFieldIds.push(fieldId);
      } else if (visualLayerEnabled &&
          consumer.requiredCapabilities.every((capability) => capabilities.has(capability))) {
        runtimeFieldIds.push(fieldId);
      }
    }
  }
  return {
    runtimeFieldIds: [...new Set(runtimeFieldIds)].sort(),
    manualOfficialImportFieldIds: [...new Set(manualOfficialImportFieldIds)].sort(),
    visualLayerGateFieldIds: [...new Set(visualLayerGateFieldIds)].sort(),
  };
}

export function normalizeUnionProfile(input = {}) {
  const value = jsonClone(input);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('并集 profile 必须是对象');
  const schemaVersion = value.schemaVersion ?? UNION_SCHEMA_VERSION;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new Error('并集 profile schemaVersion 无效');
  if (value.values !== undefined && (!value.values || typeof value.values !== 'object' || Array.isArray(value.values))) {
    throw new Error('并集 profile values 必须是对象');
  }
  const values = {};
  for (const [fieldId, fieldValue] of Object.entries(value.values ?? {})) {
    if (RESERVED_KEYS.has(fieldId)) throw new Error(`并集 profile 包含保留字段：${fieldId}`);
    const descriptor = FIELD_BY_ID.get(fieldId);
    if (!descriptor) {
      values[fieldId] = jsonClone(fieldValue);
      continue;
    }
    try {
      values[fieldId] = validateKnownValue(descriptor, fieldValue);
    } catch (error) {
      if (schemaVersion <= UNION_SCHEMA_VERSION) throw error;
      // A future schema may legitimately widen a known field. Preserve it, but
      // compileUnionProfileForClient will fall back to this runtime's safe default.
      values[fieldId] = jsonClone(fieldValue);
    }
  }
  return {...value, schemaVersion, values};
}

export function createUnionProfile(metadata = {}) {
  const safeMetadata = jsonClone(metadata);
  if (!safeMetadata || typeof safeMetadata !== 'object' || Array.isArray(safeMetadata) ||
      Object.hasOwn(safeMetadata, 'schemaVersion') || Object.hasOwn(safeMetadata, 'values')) {
    throw new Error('并集 profile metadata 不能覆盖 schemaVersion 或 values');
  }
  return normalizeUnionProfile({
    ...safeMetadata,
    schemaVersion: UNION_SCHEMA_VERSION,
    values: Object.fromEntries(UNION_FIELDS.map((descriptor) => [
      descriptor.id,
      jsonClone(descriptor.defaultValue),
    ])),
  });
}

function effectiveKnownValue(profile, descriptor) {
  if (!Object.hasOwn(profile.values, descriptor.id)) {
    return {value: jsonClone(descriptor.defaultValue), usesDefault: true, sourceValueValid: true};
  }
  try {
    return {value: validateKnownValue(descriptor, profile.values[descriptor.id]), usesDefault: false, sourceValueValid: true};
  } catch {
    return {value: jsonClone(descriptor.defaultValue), usesDefault: true, sourceValueValid: false};
  }
}

export function getEditorFieldsForClient(clientId, {
  profile = {},
  includeStatuses = SUPPORT_STATUSES,
} = {}) {
  const map = getClientCapabilityMap(clientId);
  if (!Array.isArray(includeStatuses) || !includeStatuses.every((status) => SUPPORT_STATUSES.includes(status))) {
    throw new Error('includeStatuses 包含未知支持状态');
  }
  const normalized = normalizeUnionProfile(profile);
  return UNION_FIELDS
    .filter((descriptor) => descriptor.clients.includes(clientId))
    .flatMap((descriptor) => {
      const support = map.fields[descriptor.id];
      if (!includeStatuses.includes(support.status)) return [];
      const effective = effectiveKnownValue(normalized, descriptor);
      return [{
        ...descriptor,
        value: effective.value,
        usesDefault: effective.usesDefault,
        sourceValueValid: effective.sourceValueValid,
        supportStatus: support.status,
        supportDescription: support.description,
        capability: support.capability,
        consumption: support.consumption,
        capabilityMapVersion: map.version,
        editable: support.status === 'supported',
      }];
    });
}

export function updateUnionProfileValues(profile, changes) {
  const normalized = normalizeUnionProfile(profile);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(changes))) {
    throw new Error('并集字段变更必须是普通对象');
  }
  const values = {...normalized.values};
  for (const [fieldId, fieldValue] of Object.entries(changes)) {
    if (RESERVED_KEYS.has(fieldId)) throw new Error(`并集字段变更包含保留字段：${fieldId}`);
    if (fieldValue === undefined) {
      delete values[fieldId];
      continue;
    }
    const descriptor = FIELD_BY_ID.get(fieldId);
    values[fieldId] = descriptor
      ? validateKnownValue(descriptor, fieldValue)
      : jsonClone(fieldValue);
  }
  return normalizeUnionProfile({...normalized, values});
}

export function compileUnionProfileForClient(profile, clientId) {
  const normalized = normalizeUnionProfile(profile);
  const map = getClientCapabilityMap(clientId);
  const values = {};
  for (const descriptor of UNION_FIELDS) {
    if (!descriptor.clients.includes(clientId) || map.fields[descriptor.id].status !== 'supported') continue;
    values[descriptor.id] = effectiveKnownValue(normalized, descriptor).value;
  }
  return {
    schemaVersion: UNION_SCHEMA_VERSION,
    sourceSchemaVersion: normalized.schemaVersion,
    clientId,
    capabilityMapVersion: map.version,
    values,
  };
}
