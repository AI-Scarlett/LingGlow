import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {capabilitiesForCompatibility, compatibilityFor} from '../src/adapter.mjs';
import {listRegisteredThemePacks, materializeThemePack} from '../src/catalog/theme-pack.mjs';
import {cleanupSource, compileSkin, injectionSource} from '../src/skin.mjs';

const profile = {
  id: 'nebula',
  name: 'Nebula',
  official: {accent: '#7AA2F7', surface: '#111827', ink: '#E5E7EB'},
  advanced: {
    enabled: true,
    banner: {enabled: false},
    glass: {enabled: true, blur: 18},
    motion: 'subtle',
  },
};
const onePixelWebp = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89';

test('compiled exact skin uses semantic selectors and no remote imports', () => {
  const compiled = compileSkin(profile, {capabilityLevel: 'exact'});
  assert.match(compiled.css, /data-codex-composer/u);
  assert.match(compiled.css, /\[data-codex-composer\][\s\S]*?background: rgba\([^;]+\) !important/u);
  assert.match(compiled.css, /\[data-codex-composer-root\] input,[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/u);
  assert.match(compiled.css, /data-app-action-sidebar/u);
  assert.doesNotMatch(compiled.css, /@import|https?:\/\//u);
  assert.equal(compiled.audit.arbitraryJavaScript, false);
  assert.equal(compiled.audit.remoteUrls, false);
});

test('generic safe mode omits build-sensitive layout rules', () => {
  const compiled = compileSkin(profile, {capabilityLevel: 'generic-safe'});
  assert.doesNotMatch(compiled.css, /spacing-token-sidebar|--radius-token-composer-single-line/u);
  assert.match(compiled.css, /data-codex-composer-root/u);
  assert.match(compiled.css, /aside\.app-shell-left-panel \{[\s\S]*?background: linear-gradient\([\s\S]*?calc\(100% - 24px\)/u);
  assert.match(compiled.css, /aside\.app-shell-left-panel \{[\s\S]*?border-right: 0 !important;[\s\S]*?box-shadow: none !important/u);
  assert.match(compiled.css, /aside\.app-shell-left-panel::after \{[\s\S]*?background: linear-gradient\([\s\S]*?transparent 100%/u);
  assert.match(compiled.css, /\[data-app-action-sidebar-scroll\] \{\s*background: transparent !important/u);
  assert.match(compiled.css, /\[data-app-shell-main-content-layout\],[\s\S]*?main\.main-surface \{[\s\S]*?background-color: transparent !important;[\s\S]*?background-image: none !important/u);
  assert.equal(compiled.audit.layoutFeaturesEnabled, false);
});

test('all three Agents keep one rounded composer frame and borderless inner regions', () => {
  for (const clientId of ['workbuddy', 'codex', 'doubao']) {
    const compiled = compileSkin(profile, {
      clientId,
      capabilityLevel: clientId === 'workbuddy' ? 'exact' : 'generic-safe',
      capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
    });
    assert.match(compiled.css, /Three-Agent composer structure: exactly one rounded frame/u, clientId);
    assert.match(compiled.css, /border-radius: 18px !important/u, clientId);
    assert.match(compiled.css, /border: 0 !important;\s+border-radius: 0 !important;\s+outline: 0 !important;\s+box-shadow: none !important/u,
      clientId);
    assert.match(compiled.css, /background-color: transparent !important;\s+background-image: none !important/u,
      clientId);
  }
  const codex = compileSkin(profile, {
    clientId: 'codex',
    capabilityLevel: 'generic-safe',
    capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
  });
  assert.match(codex.css,
    /data-lingglow-codex-composer-anchor="true"[\s\S]*?data-composer-utility-bar-scroll-area/u);
  assert.match(codex.css,
    /\[data-lingglow-codex-composer-anchor="true"\] \{/u);
  assert.match(codex.css,
    /data-lingglow-codex-composer-anchor="true"\] :is\(\s+\.composer-surface-chrome,[\s\S]*?border: 0 !important/u);
  assert.doesNotMatch(codex.css,
    /data-lingglow-codex-composer-anchor="true"\][^{]*\{[^}]*box-shadow:\s*(?:[\s\S]*?)0 0 0 2px/u);
  assert.match(codex.css,
    /data-lingglow-codex-surface="above-composer"[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important/u);
  assert.match(codex.css,
    /data-lingglow-codex-surface="diff-summary"[\s\S]*?border-radius: 18px !important/u);
  const mascotPack = listRegisteredThemePacks({clientId: 'workbuddy'})
    .find((entry) => entry.clientIds.length === 3);
  const workbuddy = compileSkin(materializeThemePack(mascotPack, 'workbuddy'), {
    clientId: 'workbuddy', capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
  });
  assert.match(workbuddy.css, /data-cb-chat-input-toolbar-right/u);
  const doubao = compileSkin(profile, {
    clientId: 'doubao', capabilityLevel: 'generic-safe',
    capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
  });
  assert.match(doubao.css, /\[data-testid="chat_input"\] :is\([\s\S]*?data-testid="chat_input_input"/u);
  assert.match(doubao.css, /\[data-testid="chat_input"\] :is\([\s\S]*?data-testid="guidance-skill-bar"/u);
});

test('all three Agents frame only the selected sidebar item', () => {
  for (const clientId of ['workbuddy', 'codex', 'doubao']) {
    const compiled = compileSkin(profile, {
      clientId,
      capabilityLevel: clientId === 'workbuddy' ? 'exact' : 'generic-safe',
      capabilities: ['background', 'palette', 'glass'],
    });
    assert.match(compiled.css, /Three-Agent sidebar structure: ordinary rows are unframed/u, clientId);
    assert.match(compiled.css,
      /border: 0 !important;\s+border-radius: 14px !important/u, clientId);
    assert.match(compiled.css,
      /border: 1px solid rgba\([^;]+\) !important;\s+border-radius: 14px !important;\s+background: linear-gradient/u,
      clientId);
  }
  const codex = compileSkin(profile, {
    clientId: 'codex', capabilityLevel: 'generic-safe',
    capabilities: ['background', 'palette', 'glass'],
  });
  assert.match(codex.css, /\[data-app-action-sidebar-section\] \{\s+border: 0 !important/u);
  assert.match(codex.css, /data-lingglow-codex-sidebar-state="selected"/u);
  assert.match(codex.css,
    /data-app-action-sidebar-thread-row[\s\S]*?\) \{\s+background: transparent !important/u);
  assert.doesNotMatch(codex.css,
    /data-app-action-sidebar-thread-row\]\[aria-selected="true"\][\s\S]*?background:/u);
  const workbuddy = compileSkin(profile, {
    clientId: 'workbuddy', capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass'],
  });
  assert.match(workbuddy.css, /\.conversation-list-tab-row\.active/u);
  const doubao = compileSkin(profile, {
    clientId: 'doubao', capabilityLevel: 'generic-safe',
    capabilities: ['background', 'palette', 'glass'],
  });
  assert.match(doubao.css, /\[data-testid="chat_list_thread_item"\]/u);
});

test('all three Agents receive complete send and stop interaction states', () => {
  for (const clientId of ['workbuddy', 'codex', 'doubao']) {
    const compiled = compileSkin(profile, {
      clientId,
      capabilityLevel: clientId === 'workbuddy' ? 'exact' : 'generic-safe',
      capabilities: ['background', 'palette', 'glass', 'controls'],
    });
    const actionCss = compiled.css.split('/* Three-Agent composer actions:')[1]?.split('@media')[0] || '';
    assert.match(compiled.css, /Three-Agent composer actions/u, clientId);
    assert.match(actionCss, /width: 40px !important;[\s\S]*?border-radius: 999px !important/u, clientId);
    assert.doesNotMatch(actionCss, /::after \{[\s\S]*?content: none !important/u, clientId);
    assert.match(actionCss, /background: linear-gradient\(145deg,/u, clientId);
    assert.match(actionCss,
      /background: linear-gradient\(145deg,[\s\S]*?rgba\([^)]*, 0\.940\)[\s\S]*?rgba\([^)]*, 0\.160\)/u,
      clientId);
    assert.match(actionCss, /svg \[fill\]:not\(\[fill="none"\]\)/u, clientId);
    assert.doesNotMatch(actionCss, /lingglow-composer-stop-breathe/u, clientId);
    assert.match(actionCss, /animation: none !important/u, clientId);
    assert.match(actionCss,
      /:is\(:disabled, \[aria-disabled="true"\]\),[\s\S]*?:is\(:disabled, \[aria-disabled="true"\]\) \{/u,
      clientId);
    assert.doesNotMatch(compiled.css, /Typography follows the selected profile/u, clientId);
    assert.doesNotMatch(compiled.css, /font-family:/u, clientId);
  }
});

test('all three Agents keep the main workspace unframed and WorkBuddy renders one mascot', () => {
  for (const clientId of ['workbuddy', 'codex', 'doubao']) {
    const compiled = compileSkin(profile, {
      clientId,
      capabilityLevel: clientId === 'workbuddy' ? 'exact' : 'generic-safe',
      capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
    });
    assert.match(compiled.css, /The Agent workspace is the wallpaper canvas, not another card/u, clientId);
    assert.match(compiled.css,
      /border: 0 !important;\s+outline: 0 !important;\s+border-radius: 0 !important;\s+box-shadow: none !important/u,
      clientId);
  }
  const mascotPack = listRegisteredThemePacks({clientId: 'workbuddy'})
    .find((entry) => entry.clientIds.length === 3);
  const workbuddy = compileSkin(materializeThemePack(mascotPack, 'workbuddy'), {
    clientId: 'workbuddy', capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass', 'composer-avatar'],
  });
  assert.match(workbuddy.css,
    /hide the native copy[\s\S]*?display: none !important;\s+visibility: hidden !important;\s+opacity: 0 !important/u);
  assert.doesNotMatch(workbuddy.css,
    /\.wb-home-composer img\[src\*="mascot" i\][\s\S]{0,900}?opacity: 1 !important/u);
});

test('disabled advanced visual layer compiles to stock-safe CSS but preserves manual Codex theme export', () => {
  const compiled = compileSkin({
    ...profile,
    advanced: {
      ...profile.advanced,
      enabled: false,
      background: {image: onePixelWebp},
      banner: {enabled: true, image: onePixelWebp},
    },
  }, {
    clientId: 'codex',
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass', 'composer', 'banner', 'motion', 'sidebar-width'],
  });
  assert.equal(compiled.css, '');
  assert.equal(compiled.audit.visualLayerEnabled, false);
  assert.equal(compiled.audit.localImagesEmbedded, false);
  assert.deepEqual(compiled.audit.consumedCapabilities, []);
  assert.deepEqual(compiled.audit.runtimeConsumedFieldIds, []);
  assert.deepEqual(compiled.audit.visualLayerGateFieldIds, ['advanced.enabled']);
  assert.ok(compiled.audit.manualOfficialImportFieldIds.includes('typography.codeFont'));
  assert.equal(compiled.audit.bannerEnabled, false);
  assert.equal(compiled.audit.layoutFeaturesEnabled, false);
  assert.ok(compiled.officialThemeString.startsWith('codex-theme-v1:'));
});

test('WorkBuddy renderer uses a visible background layer and safe VS Code variables', () => {
  const compiled = compileSkin(profile, {
    clientId: 'workbuddy',
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass'],
  });
  assert.match(compiled.css, /--vscode-editor-background/u);
  assert.match(compiled.css, /--vscode-editorGroup-emptyBackground/u);
  assert.match(compiled.css, /--vscode-editorGroupHeader-tabsBackground/u);
  assert.match(compiled.css, /--vscode-tab-activeBackground/u);
  assert.match(compiled.css, /--vscode-sideBarSectionHeader-background/u);
  assert.match(compiled.css, /--vscode-activityBarTop-background/u);
  assert.match(compiled.css, /--vscode-terminal-background/u);
  assert.match(compiled.css, /--vscode-focusBorder/u);
  assert.match(compiled.css, /body::before\s*\{[\s\S]*?z-index: 0;/u);
  assert.match(compiled.css, /#root\s*\{[\s\S]*?position: relative;\s*z-index: 1;/u);
  assert.match(compiled.css, /\.teams-container/u);
  assert.match(compiled.css, /\[class\^="_gridViewItem_"\]/u);
  assert.match(compiled.css, /\.main-content/u);
  assert.match(compiled.css, /\.claw-workspace/u);
  assert.match(compiled.css, /\.workbuddy-collab/u);
  assert.match(compiled.css, /\.landing/u);
  assert.match(compiled.css, /\.conversation-list/u);
  assert.match(compiled.css, /data-lingglow-plain-text-surface/u);
  assert.match(compiled.css, /\[role="textbox"\]\) \{\s*background-color: transparent !important/u);
  assert.match(compiled.css, /\.conversation-list \{\s*\/\* Keep the single viewport wallpaper visibly continuous beneath the sidebar\. \*\/\s*background: rgba\([^)]*, 0\.(?:1\d\d|2[0-4]\d)\) !important;/u);
  assert.match(compiled.css, /\.wb-home-composer__input-slot/u);
  assert.match(compiled.css, /data-lingglow-plain-text-surface/u);
  assert.match(compiled.css, /:where\(input, textarea, \[contenteditable="true"\], \[role="textbox"\]\)/u);
  assert.match(compiled.css, /\.my-files-panel/u);
  assert.match(compiled.css, /\.tencent-docs-panel/u);
  assert.match(compiled.css, /\.ima-panel/u);
  assert.match(compiled.css, /\.tencent-lexiang-panel/u);
  assert.match(compiled.css, /\.discover-panel-page/u);
  assert.doesNotMatch(compiled.css, /data-codex-composer|data-app-action-sidebar|spacing-token-sidebar/u);
  assert.doesNotMatch(compiled.css, /nth-(?:child|of-type)|\[class\*?=/u);
  assert.equal(compiled.audit.clientId, 'workbuddy');
  assert.equal(compiled.audit.layoutFeaturesEnabled, false);
  assert.ok(compiled.audit.runtimeConsumedFieldIds.includes('appearance.accent'));
  assert.ok(compiled.audit.runtimeConsumedFieldIds.includes('background.image'));
  assert.ok(compiled.audit.runtimeConsumedFieldIds.includes('glass.blur'));
  assert.deepEqual(compiled.audit.manualOfficialImportFieldIds, []);
});

test('all client palettes choose dark ink when a light surface is paired with white text', () => {
  const lowContrastLightProfile = {
    ...profile,
    official: {...profile.official, surface: '#F6F1EE', ink: '#FFFFFF'},
  };
  const workbuddy = compileSkin(lowContrastLightProfile, {
    clientId: 'workbuddy',
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass', 'navigation', 'controls'],
  });
  const doubao = compileSkin(lowContrastLightProfile, {
    clientId: 'doubao',
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass'],
  });
  const codex = compileSkin(lowContrastLightProfile, {
    clientId: 'codex',
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass', 'composer', 'sidebar-width'],
  });
  assert.match(workbuddy.css, /--vscode-foreground: #171717/u);
  assert.match(workbuddy.css, /--cb-text-primary: #171717/u);
  assert.match(doubao.css, /--dbx-text-primary: #171717/u);
  assert.match(doubao.css, /--s-color-text-primary: #171717/u);
  assert.match(codex.css, /--color-token-foreground: #171717/u);
});

test('WorkBuddy audited shell selectors stay behind exact compatibility', () => {
  const compiled = compileSkin(profile, {
    clientId: 'workbuddy',
    capabilityLevel: 'generic-safe',
    capabilities: ['background', 'palette', 'glass'],
  });
  assert.doesNotMatch(compiled.css, /\.teams-container|_gridViewItem_|\.main-content|\.conversation-list \{\s*\/\* Keep/u);
  assert.match(compiled.css, /Per-skin border signature/u);
});

test('WorkBuddy exact component skin covers navigation, controls, send, stop, and visual brand', () => {
  const compiled = compileSkin({
    ...profile,
    advanced: {
      ...profile.advanced,
      brand: {enabled: true, displayName: 'Dream Portal', shortMark: 'DP', logoStyle: 'diamond'},
    },
  }, {
    clientId: 'workbuddy',
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass', 'brand', 'navigation', 'controls'],
  });
  assert.match(compiled.css, /\.conversation-list-tabs button\.conversation-list-tab-button-box:is\(\.active, \[aria-selected="true"\]\)/u);
  assert.match(compiled.css, /\.conversation-list-tab-row:not\(\.active\).*:hover/u);
  assert.match(compiled.css, /\.conversation-list-nav-item:not\(\.conversation-list-nav-item-active\):hover/u);
  assert.match(compiled.css, /\.conversation-list-tabs button svg/u);
  assert.match(compiled.css, /color: currentColor !important/u);
  assert.match(compiled.css, /\.conversation-list-more-dropdown \.wb-dropdown__item/u);
  assert.match(compiled.css, /\.user-menu-popover :is\([\s\S]*?\.daily-checkin-info,[\s\S]*?\.daily-checkin-actions,[\s\S]*?\.account-panel__credits-section,[\s\S]*?\.account-panel__plan-card/u);
  assert.match(compiled.css, /\.daily-checkin-btn-primary:not\(\.is-claimed\)/u);
  assert.match(compiled.css, /\.daily-checkin-btn-secondary/u);
  assert.match(compiled.css, /\.um-header__tabs\[role="tablist"\]/u);
  assert.match(compiled.css, /\.wb-scene-tabs__pill--active/u);
  assert.match(compiled.css, /\.wb-segmented__item--active/u);
  assert.match(compiled.css, /\.quick-actions__item/u);
  assert.match(compiled.css, /data-track-id="agent_session_input_status"/u);
  assert.match(compiled.css, /data-track-id="agent_session_input_status"\]:disabled/u);
  assert.match(compiled.css, /data-track-id="agent_task_interrupted"/u);
  assert.match(compiled.css, /\.logo-workbuddy-title::after/u);
  assert.match(compiled.css, /a\.conversation-list-logo::before/u);
  assert.match(compiled.css, /\.workbuddy-topbar-logo::before/u);
  assert.match(compiled.css, /\.top-bar-workbuddy-logo::before/u);
  assert.match(compiled.css, /img\.logo-workbuddy-icon\[alt="WorkBuddy"\]/u);
  assert.match(compiled.css, /img\.collapsed-logo\[alt="WorkBuddy"\]/u);
  assert.match(compiled.css, /--wb-todo-menu-bg-hover:/u);
  assert.match(compiled.css, /--wb-todo-menu-bg-active:/u);
  assert.match(compiled.css, /--wb-button-primary-bg:/u);
  assert.match(compiled.css, /--wb-button-primary-bg-hover:/u);
  assert.match(compiled.css, /--wb-button-primary-bg-active:/u);
  assert.match(compiled.css, /--wb-button-primary-fg:/u);
  assert.doesNotMatch(compiled.css, /--wb-button-primary-background:/u);
  assert.match(compiled.css, /\.project-grid__card/u);
  assert.match(compiled.css, /\.atm-template-card/u);
  assert.match(compiled.css, /:is\(\.atm-empty-state, \.atm-empty-state-hero, \.atm-empty-state-templates\) \{[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/u);
  assert.doesNotMatch(compiled.css, /\.atm-row,\s*\nhtml\[[^\]]+\][^\n]*\.atm-empty-state,/u);
  assert.match(compiled.css, /\.connector-card/u);
  assert.match(compiled.css, /\.inspiration-card/u);
  assert.match(compiled.css, /content: "Dream Portal"/u);
  assert.match(compiled.css, /content: "DP"/u);
  assert.equal(compiled.audit.brandEnabled, true);
  assert.equal(compiled.audit.navigationEnabled, true);
  assert.equal(compiled.audit.controlsEnabled, true);
  assert.doesNotMatch(compiled.css, /@import|https?:\/\//u);
});

test('WorkBuddy exact project Hero uses only the audited image selector and embedded artwork', () => {
  const withHero = {
    ...profile,
    advanced: {
      ...profile.advanced,
      workbuddy: {
        projectHero: {image: onePixelWebp, fit: 'contain', position: 'right'},
      },
    },
  };
  const compiled = compileSkin(withHero, {
    clientId: 'workbuddy',
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass', 'project-hero'],
  });
  assert.match(compiled.css, /\.workbuddy-collab \.landing > header\.landing-header > img\.landing-hero/u);
  assert.match(compiled.css, /content: url\("data:image\/webp;base64,/u);
  assert.match(compiled.css, /object-fit: contain !important/u);
  assert.match(compiled.css, /object-position: right !important/u);
  assert.match(compiled.css, /mask-image: radial-gradient/u);
  assert.match(compiled.css, /overflow: hidden !important/u);
  assert.match(compiled.css, /border-radius: 22px !important/u);
  assert.match(compiled.css, /opacity: \.60 !important/u);
  assert.match(compiled.css, /mix-blend-mode: normal !important/u);
  assert.equal(compiled.audit.projectHeroEnabled, true);

  const generic = compileSkin(withHero, {
    clientId: 'workbuddy',
    capabilityLevel: 'generic-safe',
    capabilities: ['background', 'palette', 'glass'],
  });
  assert.doesNotMatch(generic.css, /landing-hero|project-list Hero artwork/u);
  assert.equal(generic.audit.projectHeroEnabled, false);
});

test('WorkBuddy embedded brand icon takes priority over the generated short mark', () => {
  const compiled = compileSkin({
    ...profile,
    advanced: {
      ...profile.advanced,
      brand: {
        enabled: true,
        displayName: 'Free Brand',
        shortMark: 'FB',
        logoStyle: 'diamond',
        iconImage: onePixelWebp,
      },
    },
  }, {
    clientId: 'workbuddy',
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass', 'brand'],
  });
  assert.match(compiled.css, /a\.conversation-list-logo::before/u);
  assert.match(compiled.css, /background: url\("data:image\/webp;base64,/u);
  assert.match(compiled.css, /content: "";/u);
  assert.doesNotMatch(compiled.css, /content: "FB";/u);
});

test('WorkBuddy exact More pages expose the wallpaper and theme their real controls', () => {
  const compiled = compileSkin(profile, {
    clientId: 'workbuddy',
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass', 'navigation', 'controls'],
  });
  for (const selector of [
    '.my-files-panel',
    '.tencent-docs-panel',
    '.ima-panel',
    '.tencent-lexiang-panel',
    '.discover-panel-page',
  ]) {
    assert.match(compiled.css, new RegExp(`html\\[data-codex-skin-studio\\] \\${selector}`));
  }
  assert.match(compiled.css, /\.my-files-tab\.active/u);
  assert.match(compiled.css, /\.my-files-flat-row/u);
  assert.match(compiled.css, /\.tencent-docs-search-bar/u);
  assert.match(compiled.css, /\.tdoc-file-list-item/u);
  assert.match(compiled.css, /\.tencent-docs-auth-guide__permissions/u);
  assert.match(compiled.css, /\.ima-auth-guide__permissions/u);
  assert.match(compiled.css, /\.lexiang-auth-guide__permissions/u);
  assert.match(compiled.css, /\.tencent-lexiang-list__row/u);
  assert.match(compiled.css, /\.dc-playbook-card/u);
  assert.match(compiled.css, /\.dc-search-input/u);
  assert.match(compiled.css, /--dc-bg-primary: transparent/u);
  assert.doesNotMatch(compiled.css, /nth-(?:child|of-type)|\[class\*?=/u);
});

test('WorkBuddy generic-safe mode never changes component identity or controls', () => {
  const compiled = compileSkin({
    ...profile,
    advanced: {
      ...profile.advanced,
      brand: {enabled: true, displayName: 'Dream Portal', shortMark: 'DP', logoStyle: 'diamond'},
    },
  }, {clientId: 'workbuddy', capabilityLevel: 'generic-safe'});
  assert.doesNotMatch(compiled.css, /Dream Portal|agent_task_interrupted|conversation-list-tab-button|logo-workbuddy-title|my-files-panel|discover-panel-page/u);
  assert.equal(compiled.audit.brandEnabled, false);
  assert.equal(compiled.audit.navigationEnabled, false);
  assert.equal(compiled.audit.controlsEnabled, false);
});

test('fixed injection source only manages one style element', () => {
  const compiled = compileSkin(profile);
  const source = injectionSource(compiled, 'app://-/index.html');
  assert.match(source, /createElement\('style'\)/u);
  assert.doesNotMatch(source, /innerText|textContent\s*\)|localStorage|cookie|fetch\(/u);
  assert.match(cleanupSource(), /removeAttribute/u);
});

test('fixed injection source refuses subframes and non-adapter URLs before DOM writes', () => {
  const compiled = compileSkin(profile);
  const source = injectionSource(compiled, 'app://-/index.html');
  const run = ({href, topFrame}) => {
    let writes = 0;
    const window = {};
    window.top = topFrame ? window : {};
    const context = {
      window,
      location: {href},
      document: {
        documentElement: {setAttribute: () => { writes += 1; }},
        head: {appendChild: () => { writes += 1; }},
        getElementById: () => null,
        createElement: () => { writes += 1; return {textContent: ''}; },
        addEventListener: () => { writes += 1; },
      },
    };
    const result = vm.runInNewContext(source, context);
    return {result: JSON.parse(JSON.stringify(result)), writes};
  };

  assert.deepEqual(run({href: 'https://example.invalid/', topFrame: true}), {
    result: {ok: false, styleId: '__codex_skin_studio_style_v1__', skipped: 'unauthorized-document'},
    writes: 0,
  });
  assert.deepEqual(run({href: 'app://-/index.html', topFrame: false}), {
    result: {ok: false, styleId: '__codex_skin_studio_style_v1__', skipped: 'unauthorized-document'},
    writes: 0,
  });
});

test('compatibility fails closed, verified WorkBuddy matches exactly, and unknown builds downgrade', () => {
  const trusted = {
    clientId: 'workbuddy',
    safeToLaunch: true,
    bundleId: 'com.workbuddy.workbuddy',
    teamId: 'FN2V63AD2J',
    version: '1',
    build: '2',
    asarSha256: 'a'.repeat(64),
    asarPath: '/Applications/WorkBuddy.app/Contents/Resources/app.asar',
    signals: {appUrlEntry: true, semanticSelectors: true, designTokens: true, productMarker: true},
  };
  const adapter = {
    schemaVersion: 1, adapterId: 'test', clientId: 'workbuddy', bundleId: trusted.bundleId, teamId: trusted.teamId,
    versions: ['1'], builds: ['2'], asarSha256: ['a'.repeat(64)],
    targetPath: 'renderer/index.html',
    capabilities: ['background', 'palette', 'glass'],
    requiredSignals: Object.keys(trusted.signals),
  };
  assert.equal(compatibilityFor(trusted, [adapter]).level, 'exact');
  assert.equal(compatibilityFor({...trusted, build: '3'}, [adapter]).level, 'generic-safe');
  assert.equal(compatibilityFor({...trusted, safeToLaunch: false}, [adapter]).level, 'blocked');
  const invalidInstallation = compatibilityFor({
    ...trusted,
    displayName: 'WorkBuddy',
    safeToLaunch: false,
    signatureValid: false,
    trustedPublisher: true,
  }, [adapter]);
  assert.match(invalidInstallation.reason, /安装完整性校验失败/u);
  assert.match(invalidInstallation.reason, /不是皮肤错误/u);
  assert.equal(compatibilityFor(null, [adapter]).level, 'blocked');
});

test('signed rolling Codex updates stay usable in generic-safe mode when renderer tokens drift', () => {
  const rollingUpdate = {
    clientId: 'codex',
    displayName: 'Codex',
    safeToLaunch: true,
    signatureValid: true,
    trustedPublisher: true,
    bundleId: 'com.openai.codex',
    teamId: '2DC432GLL2',
    version: '26.721.30844',
    build: '5813',
    asarSha256: 'f'.repeat(64),
    signals: {
      appUrlEntry: true,
      semanticSelectors: true,
      designTokens: false,
      transportVerified: true,
    },
    transportVerification: {
      verified: true,
      strategyId: 'direct-pipe',
      transport: 'pipe',
    },
  };

  const compatibility = compatibilityFor(rollingUpdate, []);
  assert.equal(compatibility.level, 'generic-safe');
  assert.equal(compatibility.advancedAllowed, true);
  assert.match(compatibility.reason, /可能存在适配问题/u);
  assert.match(compatibility.reason, /designTokens/u);
  assert.deepEqual(capabilitiesForCompatibility(compatibility), [
    'background', 'palette', 'glass', 'composer-avatar',
  ]);
  assert.equal(compatibility.disabledFeatures.includes('banner'), true);
  assert.equal(compatibility.disabledFeatures.includes('composer'), true);
  assert.equal(compatibility.disabledFeatures.includes('sidebar-width'), true);

  assert.equal(compatibilityFor({
    ...rollingUpdate,
    signals: {...rollingUpdate.signals, appUrlEntry: false},
  }, []).level, 'blocked');
  assert.equal(compatibilityFor({...rollingUpdate, safeToLaunch: false}, []).level, 'blocked');
});

test('partial adapters cannot enable undeclared layout capabilities', () => {
  const compiled = compileSkin(profile, {
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass'],
  });
  assert.doesNotMatch(compiled.css, /spacing-token-sidebar|--radius-token-composer-single-line|body::after/u);
  assert.match(compiled.css, /Per-skin border signature/u);
  assert.deepEqual(compiled.audit.enabledCapabilities, ['background', 'glass', 'palette']);
  assert.equal(compiled.audit.layoutFeaturesEnabled, false);
});

test('main blocks receive a distinct border signature derived from each skin', () => {
  const first = compileSkin(profile, {
    clientId: 'codex',
    capabilityLevel: 'generic-safe',
    capabilities: ['background', 'palette', 'glass'],
  });
  const second = compileSkin({
    ...profile,
    id: 'jade-border',
    official: {
      ...profile.official,
      accent: '#18A875',
      surface: '#F1FFF8',
      ink: '#113C2C',
      contrast: 76,
      semanticColors: {
        diffAdded: '#0B8F62',
        diffRemoved: '#C94A5A',
        skill: '#E4A72C',
      },
    },
  }, {
    clientId: 'codex',
    capabilityLevel: 'generic-safe',
    capabilities: ['background', 'palette', 'glass'],
  });
  const signature = (css) => css.match(/--lingglow-border-primary: ([^;]+);/u)?.[1];
  assert.ok(signature(first.css));
  assert.ok(signature(second.css));
  assert.notEqual(signature(first.css), signature(second.css));
  assert.match(first.css, /--lingglow-border-secondary:/u);
  assert.match(first.css, /--lingglow-border-highlight:/u);
  assert.match(first.css, /data-lingglow-codex-composer-anchor/u);
  assert.doesNotMatch(first.css, /\[data-thread-find-composer\][\s\S]*?border-style: solid/u);
  assert.match(first.css, /\[role="dialog"\].*\[role="alertdialog"\]/u);
  assert.match(second.css, /--lingglow-border-width: 2px/u);
});

test('invalid adapter schema never receives exact trust', () => {
  const app = {
    safeToLaunch: true,
    bundleId: 'com.openai.codex', teamId: '2DC432GLL2', version: '1', build: '2',
    asarSha256: 'abc',
    signals: {appUrlEntry: true, semanticSelectors: true, designTokens: true},
  };
  assert.notEqual(compatibilityFor(app, [{adapterId: 'invalid'}]).level, 'exact');
});

test('Doubao compile path uses audited design tokens instead of Codex variables', () => {
  const compiled = compileSkin({
    ...profile,
    advanced: {
      ...profile.advanced,
      background: {
        image: onePixelWebp,
        opacity: 0.55,
        overlay: 0.4,
        blur: 0,
        position: 'center',
      },
    },
  }, {
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass'],
    clientId: 'doubao',
  });
  assert.match(compiled.css, /--s-color-bg-primary/u);
  assert.match(compiled.css, /--dbx-text-primary/u);
  assert.match(compiled.css, /--chat-bg-color/u);
  assert.match(compiled.css, /#chat-route-main > main/u);
  assert.match(compiled.css, /#flow_chat_sidebar/u);
  assert.match(compiled.css, /data-testid="create_conversation_button"/u);
  assert.match(compiled.css, /data-testid="onboarding_sug_item"/u);
  assert.match(compiled.css, /data-testid="chat_input_input"/u);
  assert.match(compiled.css, /#chat-input input,[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/u);
  assert.match(compiled.css, /\[data-testid="chat_input_input"\],[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/u);
  assert.match(compiled.css, /greeting-text/u);
  assert.doesNotMatch(compiled.css, /灵妆 · 已换肤/u);
  assert.doesNotMatch(compiled.css, /--codex-base-accent|--color-token-main-surface-primary/u);
  assert.equal(compiled.clientId, 'doubao');
  assert.ok(compiled.audit.runtimeConsumedFieldIds.includes('appearance.accent'));
  assert.ok(compiled.audit.runtimeConsumedFieldIds.includes('background.image'));
});

test('injection source authorizes Doubao allowlisted documents', () => {
  const compiled = compileSkin(profile, {
    capabilityLevel: 'exact',
    capabilities: ['background', 'palette', 'glass'],
    clientId: 'doubao',
  });
  const allowlist = [
    'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html',
    'https://www.doubao.com/chat/*',
  ];
  const source = injectionSource(compiled, {
    targetUrl: 'app://-/index.html',
    targetAllowlist: allowlist,
  });
  const run = ({href, topFrame = true}) => {
    let writes = 0;
    const window = {};
    window.top = topFrame ? window : {};
    const context = {
      window,
      location: {href},
      document: {
        documentElement: {setAttribute: () => { writes += 1; }},
        head: {appendChild: () => { writes += 1; }},
        getElementById: () => null,
        createElement: () => { writes += 1; return {textContent: ''}; },
        addEventListener: () => { writes += 1; },
      },
    };
    const result = vm.runInNewContext(source, context);
    return {result: JSON.parse(JSON.stringify(result)), writes};
  };

  assert.equal(run({
    href: 'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html',
  }).result.ok, true);
  assert.equal(run({href: 'https://www.doubao.com/chat/abc123'}).result.ok, true);
  assert.deepEqual(run({href: 'https://www.doubao.com/chat/'}), {
    result: {ok: false, styleId: '__codex_skin_studio_style_v1__', skipped: 'unauthorized-document'},
    writes: 0,
  });
  assert.deepEqual(run({href: 'https://evil.example/chat/x'}), {
    result: {ok: false, styleId: '__codex_skin_studio_style_v1__', skipped: 'unauthorized-document'},
    writes: 0,
  });
  assert.deepEqual(run({href: 'app://-/index.html'}), {
    result: {ok: false, styleId: '__codex_skin_studio_style_v1__', skipped: 'unauthorized-document'},
    writes: 0,
  });
});
