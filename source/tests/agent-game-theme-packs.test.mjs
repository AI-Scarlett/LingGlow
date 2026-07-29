import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_THEME_PACK_CATALOG_DIR,
  loadThemePackRegistry,
  materializeThemePackPreview,
  materializeThemePackUnionProfile,
  projectThemePackValues,
} from '../src/catalog/theme-pack.mjs';

const THEMES = [
  ['agent-codex-terminal-orbit', 'vip', 'dark'],
  ['agent-claude-code-clay', 'vip', 'light'],
  ['agent-grok-singularity', 'vip', 'dark'],
  ['agent-openclaw-gateway', 'vip', 'dark'],
  ['agent-hermes-memory', 'vip', 'dark'],
  ['agent-cursor-cube', 'vip', 'dark'],
  ['agent-antigravity-orbit-lab', 'vip', 'dark'],
  ['agent-github-copilot-cockpit', 'vip', 'dark'],
  ['agent-qwen-code-lab', 'vip', 'dark'],
  ['agent-kimi-code-moonlab', 'vip', 'dark'],
  ['einstein-relativity', 'vip', 'dark'],
  ['honor-canyon-inspired', 'free', 'light'],
  ['last-circle-inspired', 'free', 'dark'],
  ['radiant-arena-inspired', 'free', 'dark'],
];
const THEMES_WITH_ISOLATED_MASCOTS = new Set(THEMES.map(([id]) => id));

function linearChannel(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const [r, g, b] = channels.map(linearChannel);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(left, right) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('Agent、科学家与游戏灵感系列完整注册并锁定明暗模式', () => {
  const registry = loadThemePackRegistry();
  const byId = new Map(registry.packs.map((pack) => [pack.id, pack]));
  for (const [id, tier, variant] of THEMES) {
    const pack = byId.get(id);
    assert.ok(pack, `缺少主题 ${id}`);
    assert.equal(pack.tier, tier);
    assert.equal(pack.base['appearance.variant'], variant);
    assert.deepEqual(pack.clientIds, ['workbuddy', 'doubao', 'codex']);
    assert.equal(pack.base['brand.enabled'], true);
    assert.equal(pack.base['background.position'], 'right');
    assert.equal(pack.base['codex.banner.enabled'], true);
    assert.equal(pack.base['workbuddy.projectHero.position'], 'right');
    assert.equal(pack.base['doubao.homeHero.position'], 'right');
    assert.ok(contrast(pack.base['appearance.surface'], pack.base['appearance.ink']) >= 7,
      `${id} 主文字对比度不足`);
    assert.ok(contrast(pack.base['appearance.surface'], pack.base['appearance.accent']) >= 3,
      `${id} 强调控件对比度不足`);
    assert.ok(Object.keys(pack.base).every((key) => !/(?:text|label|input).*background/iu.test(key)),
      `${id} 不应通过逐文字底框修复可读性`);
  }
});

test('每套主题均携带独立三端素材并通过物化', () => {
  const registry = loadThemePackRegistry();
  const byId = new Map(registry.packs.map((pack) => [pack.id, pack]));
  for (const [id] of THEMES) {
    const pack = byId.get(id);
    const assets = Object.values(pack.assets);
    assert.equal(assets.length, 6);
    const hashesBySlot = new Map(assets.map((asset) => [asset.slot, asset.sha256]));
    assert.notEqual(hashesBySlot.get('background.main'), hashesBySlot.get('codex.banner'));
    assert.notEqual(hashesBySlot.get('workbuddy.project-hero'), hashesBySlot.get('codex.banner'));
    for (const asset of assets) {
      const stat = fs.statSync(`${DEFAULT_THEME_PACK_CATALOG_DIR}/${asset.path}`);
      assert.ok(stat.size > 0 && stat.size <= 4 * 1024 * 1024, `${id} 素材大小越界`);
    }

    const preview = materializeThemePackPreview(pack);
    assert.match(preview, /^data:image\/webp;base64,/u);

    const workbuddy = materializeThemePackUnionProfile(pack, 'workbuddy');
    assert.match(workbuddy.values['background.image'], /^data:image\/webp;base64,/u);
    assert.match(workbuddy.values['workbuddy.projectHero.image'], /^data:image\/webp;base64,/u);
    assert.equal(THEMES_WITH_ISOLATED_MASCOTS.has(id), true);
    assert.match(workbuddy.values['workbuddy.composerAvatar.image'], /^data:image\/webp;base64,/u);
    assert.match(workbuddy.values['brand.iconImage'], /^data:image\/webp;base64,/u);

    const codex = materializeThemePackUnionProfile(pack, 'codex');
    assert.match(codex.values['background.image'], /^data:image\/webp;base64,/u);
    assert.match(codex.values['codex.banner.image'], /^data:image\/webp;base64,/u);
    assert.equal(codex.values['appearance.variant'], pack.base['appearance.variant']);

    const doubao = projectThemePackValues(pack, 'doubao');
    assert.equal(doubao.values['appearance.variant'], pack.base['appearance.variant']);
    assert.deepEqual(doubao.values['doubao.homeHero.image'], {assetId: `${id}-doubao-hero`});
    assert.equal(doubao.values['glass.enabled'], true);
  }
});
