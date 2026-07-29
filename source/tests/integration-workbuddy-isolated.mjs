#!/usr/bin/env node
import assert from 'node:assert/strict';
import {ALL_CAPABILITIES, compatibilityFor, resolveAdapterTargetUrl} from '../src/adapter.mjs';
import {listRegisteredThemePacks, materializeThemePack} from '../src/catalog/theme-pack.mjs';
import {SkinSessionManager} from '../src/cdp.mjs';
import {findClientApp, launchStock, runningMainProcesses} from '../src/client-app.mjs';
import {skinRuntimeIds} from '../src/skin.mjs';
import {refuseManagedLiveSession} from './helpers/live-session-guard.mjs';

await refuseManagedLiveSession('workbuddy');

const app = findClientApp('workbuddy', {fresh: true});
if (!app?.safeToLaunch) throw new Error('没有找到经过腾讯签名验证的 WorkBuddy');
const productionCompatibility = compatibilityFor(app);
const candidateQaEnabled = process.env.LINGGLOW_WORKBUDDY_STATIC_CANDIDATE_QA === '1';
const candidate = productionCompatibility.candidateAdapter;
// A static candidate must never unlock production injection. This explicit
// test-only bridge exists so a newly installed WorkBuddy build can complete
// its real-device matrix before it is promoted to the built-in exact list.
const compatibility = productionCompatibility.level === 'exact'
  ? productionCompatibility
  : candidateQaEnabled && productionCompatibility.level === 'generic-safe' &&
      candidate?.clientId === 'workbuddy' && candidate.validation?.status === 'static-candidate'
    ? {
        ...productionCompatibility,
        level: 'exact',
        advancedAllowed: true,
        reason: '测试专用：正在验收摘要锁定的 WorkBuddy 静态候选 Adapter。',
        adapter: candidate,
        candidateAdapter: null,
        targetUrl: resolveAdapterTargetUrl(candidate, app),
        capabilities: [...candidate.capabilities],
        disabledFeatures: ALL_CAPABILITIES.filter((name) => !candidate.capabilities.includes(name)),
      }
    : productionCompatibility;
if (compatibility.level !== 'exact') throw new Error(`WorkBuddy 不是精确适配状态：${compatibility.reason}`);
assert.deepEqual(compatibility.adapter.capabilities, [
  'background', 'palette', 'glass', 'brand', 'navigation', 'controls', 'project-hero',
  'composer-avatar',
]);

const asarBefore = app.asarSha256;
const profile = materializeThemePack(
  listRegisteredThemePacks({clientId: 'workbuddy'})
    .find((entry) => entry.id === 'agent-codex-terminal-orbit'),
  'workbuddy',
);
const events = [];
const manager = new SkinSessionManager({
  log: (level, message) => events.push({level, message}),
});
const normalizedObjectPosition = (value) => ({
  center: '50% 50%', top: '50% 0%', bottom: '50% 100%',
  left: '0% 50%', right: '100% 50%',
  'top left': '0% 0%', 'top right': '100% 0%',
  'bottom left': '0% 100%', 'bottom right': '100% 100%',
}[value] ?? value);
let restored = false;

try {
  const status = await manager.launch({
    app,
    profile,
    compatibility,
    confirmRestart: true,
  });
  assert.equal(status.state, 'active');
  assert.equal(status.clientId, 'workbuddy');
  assert.equal(status.profileId, profile.id);
  assert.ok(status.injectedTargets >= 1);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const tracked = manager.targets.values().next().value;
  assert.ok(tracked?.sessionId);
  const proof = await manager.evaluateValue(`(() => {
    const root = document.documentElement;
    const style = document.getElementById(${JSON.stringify(skinRuntimeIds.styleId)});
    const computed = getComputedStyle(root);
    const brand = document.querySelector('.logo-workbuddy-title');
    const brandMark = document.querySelector('a.conversation-list-logo');
    const brandImage = document.querySelector('a.conversation-list-logo > img.logo-workbuddy-icon[alt="WorkBuddy"]');
    const activeTab = document.querySelector('.conversation-list-tabs [role="tab"][aria-selected="true"]');
    const inactiveTab = document.querySelector('.conversation-list-tabs [role="tab"][aria-selected="false"]');
    const activeVisual = activeTab?.closest('.conversation-list-tab-row') ?? activeTab;
    const inactiveIcon = inactiveTab?.querySelector('svg');
    const sidebar = document.querySelector('.conversation-list');
    const send = document.querySelector('[data-track-id="agent_session_input_status"]');
    const sendCount = document.querySelectorAll('[data-track-id="agent_session_input_status"]').length;
    const stopCount = document.querySelectorAll('[data-track-id="agent_task_interrupted"]').length;
    const toolbar = document.querySelector('.wb-cb-chat [data-cb-chat-input-toolbar-right="true"]');
    const toolbarAction = toolbar?.lastElementChild ?? null;
    const legacyCustomAvatars = [...document.querySelectorAll('img[data-lingglow-custom-avatar="true"]')];
    const nativeMascots = [...document.querySelectorAll([
      '.wb-home-composer img[src*="mascot" i]',
      '.wb-home-composer img[src*="robot" i]',
      '.wb-home-composer img[alt*="robot" i]',
      '.wb-home-composer img[alt*="机器人"]',
      '.wb-home-composer [class*="topRightSlotStandalone"] img[alt=""]',
      '.wb-home-composer__input-slot img[alt=""][style*="width: 140px"][style*="height: 140px"]',
    ].join(','))];
    const visibleNativeMascotCount = nativeMascots.filter((node) => {
      const value = getComputedStyle(node);
      return value.display !== 'none' && value.visibility !== 'hidden' && Number(value.opacity) > 0;
    }).length;
    const historyComposer = document.querySelector('[data-lingglow-workbuddy-composer="true"]');
    const historyMascotStyle = historyComposer ? getComputedStyle(historyComposer, '::after') : null;
    const landingComposer = document.querySelector('.wb-home-composer');
    const landingMascot = document.querySelector('[data-lingglow-workbuddy-landing-composer="true"]');
    const landingMascotStyle = landingMascot ? getComputedStyle(landingMascot, '::after') : null;
    const mainContent = document.querySelector('.main-content, .wb-cb-chat');
    const mainContentStyle = mainContent ? getComputedStyle(mainContent) : null;
    const backgroundAlpha = (value) => {
      if (!value || value === 'transparent') return 0;
      if (value.startsWith('rgba(') && value.endsWith(')')) {
        const alpha = Number(value.slice(5, -1).split(',').at(-1)?.trim());
        return Number.isFinite(alpha) ? alpha : 1;
      }
      return 1;
    };
    return {
      url: location.href.split(/[?#]/u, 1)[0],
      profileId: root.getAttribute(${JSON.stringify(skinRuntimeIds.rootAttribute)}),
      stylePresent: Boolean(style),
      focusBorder: computed.getPropertyValue('--vscode-focusBorder').trim(),
      editorBackground: computed.getPropertyValue('--vscode-editor-background').trim(),
      applicationName: document.body?.getAttribute('data-application-name') || '',
      brandContent: brand ? getComputedStyle(brand, '::after').content : null,
      brandMarkContent: brandMark ? getComputedStyle(brandMark, '::before').content : null,
      brandMarkBackgroundImage: brandMark ? getComputedStyle(brandMark, '::before').backgroundImage : null,
      brandImageDisplay: brandImage ? getComputedStyle(brandImage).display : null,
      activeTabBackground: activeVisual ? getComputedStyle(activeVisual).background : null,
      inactiveTabBackground: inactiveTab ? getComputedStyle(inactiveTab).background : null,
      inactiveTabColor: inactiveTab ? getComputedStyle(inactiveTab).color : null,
      inactiveIconColor: inactiveIcon ? getComputedStyle(inactiveIcon).color : null,
      sidebarBackground: sidebar ? getComputedStyle(sidebar).backgroundColor : null,
      fullWindowUsesLocalDataImage: getComputedStyle(document.body, '::before')
        .backgroundImage.includes('data:image/webp'),
      mainContentPresent: Boolean(mainContent),
      mainContentDescriptor: mainContent ? {
        tag: mainContent.tagName.toLowerCase(),
        classes: typeof mainContent.className === 'string'
          ? mainContent.className.split(/\s+/u).filter(Boolean).slice(0, 12)
          : [],
        inlineBackground: mainContent.style?.background ?? '',
      } : null,
      mainContentBackgroundColor: mainContentStyle?.backgroundColor ?? null,
      mainContentBackgroundAlpha: backgroundAlpha(mainContentStyle?.backgroundColor),
      mainContentAncestors: mainContent ? [...function* ancestors(node) {
        let current = node;
        for (let index = 0; current && index < 6; index += 1, current = current.parentElement) {
          const value = getComputedStyle(current);
          yield {
            tag: current.tagName.toLowerCase(),
            classes: typeof current.className === 'string'
              ? current.className.split(/\s+/u).filter(Boolean).slice(0, 10)
              : [],
            backgroundColor: value.backgroundColor,
            backgroundImage: value.backgroundImage === 'none' ? 'none' : 'present',
          };
        }
      }(mainContent)] : [],
      sendBackground: send ? getComputedStyle(send).backgroundColor : null,
      sendCount,
      stopCount,
      sendIsToolbarLastChild: Boolean(send && toolbarAction === send),
      sendRole: send?.getAttribute('role') ?? null,
      legacyCustomAvatarCount: legacyCustomAvatars.length,
      nativeMascotCount: nativeMascots.length,
      visibleNativeMascotCount,
      historyComposerPresent: Boolean(historyComposer),
      landingComposerPresent: Boolean(landingComposer),
      historyMascotUsesLocalWebP: historyMascotStyle?.backgroundImage?.includes('data:image/webp;base64,') ?? false,
      historyMascotAnimation: historyMascotStyle?.animationName ?? null,
      landingMascotPresent: Boolean(landingMascot),
      landingMascotUsesLocalWebP: landingMascotStyle?.backgroundImage?.includes('data:image/webp;base64,') ?? false,
      landingMascotAnimation: landingMascotStyle?.animationName ?? null,
      fullComponentSelectors: Boolean(style?.textContent.includes('agent_task_interrupted') &&
        style?.textContent.includes('conversation-list-more-dropdown') &&
        style?.textContent.includes('header.landing-header > img.landing-hero') &&
        style?.textContent.includes('--wb-button-primary-bg') &&
        style?.textContent.includes('logo-workbuddy-title'))
    };
  })()`, tracked.sessionId);
  assert.equal(proof.url, compatibility.targetUrl);
  assert.equal(proof.profileId, profile.id);
  assert.equal(proof.stylePresent, true);
  assert.equal(proof.focusBorder.toUpperCase(), profile.official.accent);
  assert.match(proof.editorBackground, /^rgba?\(/u);
  assert.equal(proof.applicationName, 'workbuddy');
  assert.equal(proof.brandContent, JSON.stringify(profile.advanced.brand.displayName));
  if (profile.advanced.brand.iconImage) {
    assert.equal(proof.brandMarkContent, '""');
    assert.match(proof.brandMarkBackgroundImage ?? '', /data:image\/webp;base64,/u);
  } else {
    assert.equal(proof.brandMarkContent, JSON.stringify(profile.advanced.brand.shortMark));
  }
  if (proof.brandImageDisplay !== null) assert.equal(proof.brandImageDisplay, 'none');
  assert.notEqual(proof.activeTabBackground, proof.inactiveTabBackground);
  assert.equal(proof.inactiveIconColor, proof.inactiveTabColor);
  assert.match(proof.sidebarBackground, /^rgba?\(/u);
  assert.equal(proof.fullWindowUsesLocalDataImage, true);
  assert.equal(proof.mainContentPresent, true);
  if (proof.mainContentBackgroundAlpha > 0.12) {
    console.error(JSON.stringify({
      mainContentDescriptor: proof.mainContentDescriptor,
      mainContentBackgroundColor: proof.mainContentBackgroundColor,
      mainContentAncestors: proof.mainContentAncestors,
    }));
  }
  assert.ok(proof.mainContentBackgroundAlpha <= 0.12,
    `WorkBuddy 主工作区仍遮住背景，alpha=${proof.mainContentBackgroundAlpha}`);
  assert.match(proof.sendBackground, /^rgb/u);
  assert.equal(proof.sendCount, 1);
  assert.equal(proof.stopCount, 0);
  assert.equal(proof.sendIsToolbarLastChild, true);
  assert.equal(proof.sendRole, 'button');
  assert.equal(proof.legacyCustomAvatarCount, 0, '旧 DOM 挂件不应与巡游挂件重复存在');
  assert.equal(proof.visibleNativeMascotCount, 0,
    `WorkBuddy 原生挂件仍有 ${proof.visibleNativeMascotCount} 个可见副本`);
  if (proof.landingComposerPresent) {
    assert.equal(proof.historyComposerPresent, false,
      'WorkBuddy 新建任务页不应挂载历史对话巡游挂件');
    assert.equal(proof.historyMascotUsesLocalWebP, false);
    assert.equal(proof.historyMascotAnimation, null);
    assert.equal(proof.landingMascotPresent, true,
      'WorkBuddy 新建任务页应保留当前皮肤的驻留挂件');
    assert.equal(proof.landingMascotUsesLocalWebP, true);
    assert.equal(proof.landingMascotAnimation, 'none',
      'WorkBuddy 新建任务页挂件不应执行横向巡游');
  } else {
    assert.equal(proof.historyComposerPresent, true);
    assert.equal(proof.historyMascotUsesLocalWebP, true);
    assert.match(proof.historyMascotAnimation, /^lingglow-composer-/u);
  }
  assert.equal(proof.fullComponentSelectors, true);

  const initialTabIndexBeforeHistory = await manager.evaluateValue(`(() => {
    const tabs = [...document.querySelectorAll('.conversation-list-tabs button.conversation-list-tab-button[role="tab"]:not(.conversation-list-tab-button-more)')]
      .filter((tab) => !tab.disabled && tab.getClientRects().length > 0);
    return tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true' ||
      tab.classList.contains('active') || tab.closest('.conversation-list-tab-row')?.classList.contains('active'));
  })()`, tracked.sessionId);
  assert.ok(initialTabIndexBeforeHistory >= 0, '无法确认新建任务页左侧 Tab 选中态');

  let historyRouteProof = {
    reachedFromLanding: false,
    composerPresent: proof.historyComposerPresent,
    landingComposerPresent: proof.landingComposerPresent,
  };
  if (proof.landingComposerPresent) {
    const clickedHistory = await manager.evaluateValue(`(() => {
      const candidates = [...document.querySelectorAll(
        '.conversation-agent-card--group-child[role="button"], .conversation-agent-card[role="button"]'
      )].filter((node) => node.getClientRects().length > 0 &&
        !node.classList.contains('conversation-agent-card--standalone'));
      candidates[0]?.click();
      return candidates.length > 0;
    })()`, tracked.sessionId);
    assert.equal(clickedHistory, true, '新建任务页没有可用于历史对话验收的任务入口');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      historyRouteProof = await manager.evaluateValue(`(() => {
        const composer = document.querySelector('[data-lingglow-workbuddy-composer="true"]');
        const style = composer ? getComputedStyle(composer, '::after') : null;
        return {
          reachedFromLanding: true,
          composerPresent: Boolean(composer),
          landingComposerPresent: Boolean(document.querySelector('.wb-home-composer')),
          usesLocalWebP: style?.backgroundImage?.includes('data:image/webp;base64,') ?? false,
          animationName: style?.animationName ?? null,
        };
      })()`, tracked.sessionId);
      if (historyRouteProof.composerPresent && !historyRouteProof.landingComposerPresent) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(historyRouteProof.landingComposerPresent, false,
      '点击历史任务后仍停留在 WorkBuddy 新建任务页');
    assert.equal(historyRouteProof.composerPresent, true,
      'WorkBuddy 历史对话没有挂载巡游挂件');
    assert.equal(historyRouteProof.usesLocalWebP, true);
    assert.match(historyRouteProof.animationName, /^lingglow-composer-/u);
  }

  // Sample the real pseudo-element animation at deterministic timeline
  // positions. This catches a high-priority base declaration pinning the
  // mascot in place even when the generated keyframes look correct.
  const mascotMotionProof = await manager.evaluateValue(`(() => {
    const composer = document.querySelector('[data-lingglow-workbuddy-composer="true"]');
    if (!composer) return null;
    const animations = composer.getAnimations({subtree: true});
    const animation = animations.find((candidate) =>
      candidate.animationName?.startsWith('lingglow-composer-'));
    if (!animation) return null;
    const duration = Number(animation.effect?.getComputedTiming?.().duration);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const idlePlayState = animation.playState;
    const rootAgentActive = document.documentElement.getAttribute('data-lingglow-agent-active');
    animation.pause();
    const sample = (progress) => {
      animation.currentTime = duration * progress;
      void composer.offsetWidth;
      const style = getComputedStyle(composer, '::after');
      const matrix = style.transform === 'none' ? null : new DOMMatrixReadOnly(style.transform);
      return {
        right: Number.parseFloat(style.right),
        x: matrix?.e ?? 0,
        facing: matrix ? Math.sign((matrix.a * matrix.d) - (matrix.b * matrix.c)) : 0,
        angle: matrix ? Math.atan2(matrix.b, matrix.a) * 180 / Math.PI : 0,
      };
    };
    const result = {
      animationName: animation.animationName,
      duration,
      idlePlayState,
      rootAgentActive,
      mascotTravel: getComputedStyle(composer).getPropertyValue('--lingglow-mascot-travel-x').trim(),
      composerWidth: composer.getBoundingClientRect().width,
      start: sample(0),
      outboundBefore: sample(0.10),
      outboundAfter: sample(0.11),
      farOutbound: sample(0.499),
      farReturn: sample(0.501),
      returnBefore: sample(0.90),
      returnAfter: sample(0.91),
      end: sample(1),
    };
    animation.currentTime = 0;
    animation.pause();
    return result;
  })()`, tracked.sessionId);
  assert.ok(mascotMotionProof, '无法读取真实输入框挂件动画');
  assert.match(mascotMotionProof.animationName, /^lingglow-composer-/u);
  assert.equal(mascotMotionProof.idlePlayState, 'paused', 'WorkBuddy 空闲时挂件必须暂停');
  assert.equal(mascotMotionProof.rootAgentActive, null, 'WorkBuddy 空闲时不能伪造生成中状态');
  assert.match(mascotMotionProof.mascotTravel, /^-\d+px$/u, '挂件没有按实际输入框宽度计算路程');
  assert.ok(mascotMotionProof.composerWidth > 200, '输入框宽度不足以验证横向巡游');
  assert.ok(
    mascotMotionProof.start.x - mascotMotionProof.farOutbound.x >
      mascotMotionProof.composerWidth * 0.45,
    '挂件没有用 transform 横穿输入框上沿',
  );
  assert.ok(Math.abs(mascotMotionProof.farOutbound.x - mascotMotionProof.farReturn.x) < 3,
    '挂件掉头前后没有停留在同一端');
  if (profile.advanced.workbuddy.composerAvatar.activityMotion === 'roll') {
    assert.equal(mascotMotionProof.farOutbound.facing, 1, '滚动挂件不应镜像旋转坐标系');
    assert.equal(mascotMotionProof.farReturn.facing, 1, '滚动挂件返程不应镜像旋转坐标系');
    assert.ok(mascotMotionProof.outboundAfter.angle < mascotMotionProof.outboundBefore.angle,
      '滚动挂件去程旋转方向不正确');
    assert.ok(mascotMotionProof.returnAfter.angle > mascotMotionProof.returnBefore.angle,
      '滚动挂件返程没有反向旋转');
  } else {
    assert.equal(mascotMotionProof.farOutbound.facing, -1, '挂件到边前方向不正确');
    assert.equal(mascotMotionProof.farReturn.facing, 1, '挂件到边后没有掉头');
  }
  assert.ok(Math.abs(mascotMotionProof.end.x - mascotMotionProof.start.x) < 3,
    '挂件没有返回起点');

  // Exercise every visible top-level left navigation tab.  The probe only
  // records indices, selected state and computed visual values; it deliberately
  // never reads task, conversation or project text.
  const tabCount = await manager.evaluateValue(`(() =>
    [...document.querySelectorAll('.conversation-list-tabs button.conversation-list-tab-button[role="tab"]:not(.conversation-list-tab-button-more)')]
      .filter((tab) => !tab.disabled && tab.getClientRects().length > 0).length
  )()`, tracked.sessionId);
  assert.ok(Number.isInteger(tabCount) && tabCount >= 2, '需要至少两个可见左侧 Tab 才能验证逐 Tab 换肤');
  const selectedTabIndexAfterHistory = await manager.evaluateValue(`(() => {
    const tabs = [...document.querySelectorAll('.conversation-list-tabs button.conversation-list-tab-button[role="tab"]:not(.conversation-list-tab-button-more)')]
      .filter((tab) => !tab.disabled && tab.getClientRects().length > 0);
    return tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true' ||
      tab.classList.contains('active') || tab.closest('.conversation-list-tab-row')?.classList.contains('active'));
  })()`, tracked.sessionId);
  const initialTabIndex = selectedTabIndexAfterHistory >= 0
    ? selectedTabIndexAfterHistory
    : initialTabIndexBeforeHistory;

  async function readTabVisual(index, {activate = false} = {}) {
    return manager.evaluateValue(`(() => {
      const tabs = [...document.querySelectorAll('.conversation-list-tabs button.conversation-list-tab-button[role="tab"]:not(.conversation-list-tab-button-more)')]
        .filter((tab) => !tab.disabled && tab.getClientRects().length > 0);
      const tab = tabs[${index}];
      if (!tab) return null;
      if (${activate ? 'true' : 'false'}) tab.click();
      const isSelected = (node) => Boolean(node) && (
        node.getAttribute('aria-selected') === 'true' ||
        node.classList.contains('active') ||
        node.closest('.conversation-list-tab-row')?.classList.contains('active')
      );
      const visual = tab.closest('.conversation-list-tab-row') ?? tab;
      const style = getComputedStyle(visual);
      const root = document.documentElement;
      const projectRoot = document.querySelector('.main-content--projects');
      // This descriptor is intentionally structural only: it excludes text,
      // URLs, alt strings, task IDs and project IDs.  It lets us identify the
      // actual visual node used by a particular WorkBuddy build without ever
      // collecting the user's project data.
      const projectVisualNodes = projectRoot
        ? [...projectRoot.querySelectorAll('img, [class*="hero"], [class*="banner"], [class*="landing"], [class*="empty"], [class*="project"]')]
          .filter((node, position, all) => all.indexOf(node) === position && node.getClientRects().length > 0)
          .slice(0, 24)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const nodeStyle = getComputedStyle(node);
            return {
              tag: node.tagName.toLowerCase(),
              classes: typeof node.className === 'string'
                ? node.className.split(/\\s+/u).filter(Boolean).slice(0, 8)
                : [],
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              backgroundImage: nodeStyle.backgroundImage !== 'none',
              objectFit: nodeStyle.objectFit,
            };
          })
        : [];
      return {
        tabCount: tabs.length,
        selectedIndex: tabs.findIndex(isSelected),
        requestedIndex: ${index},
        rootProfile: root.getAttribute(${JSON.stringify(skinRuntimeIds.rootAttribute)}),
        active: isSelected(tab),
        tabBackground: style.background,
        tabColor: style.color,
        sidebarBackground: getComputedStyle(document.querySelector('.conversation-list')).backgroundColor,
        fullWindowUsesLocalDataImage: getComputedStyle(document.body, '::before')
          .backgroundImage.includes('data:image/webp'),
        // Surface counts deliberately disclose no user/project/task text.  They
        // let the regression report say whether the project landing hero was
        // actually present on a visited route rather than treating its CSS
        // selector as runtime proof.
        surfaces: {
          mainProjects: document.querySelectorAll('.main-content--projects').length,
          mainChat: document.querySelectorAll('.main-content--chat').length,
          mainAutomation: document.querySelectorAll('.main-content--automation').length,
          expertCenter: document.querySelectorAll('.expert-center-page').length,
          skillsPanel: document.querySelectorAll('.skills-panel').length,
          connectorPanel: document.querySelectorAll('.connector-panel').length,
          inspirationPanel: document.querySelectorAll('.inspiration-panel').length,
          collaboration: document.querySelectorAll('.workbuddy-collab').length,
          landing: document.querySelectorAll('.workbuddy-collab .landing').length,
          projectHero: document.querySelectorAll('.workbuddy-collab .landing > header.landing-header > img.landing-hero').length,
          projectGrid: document.querySelectorAll('.project-grid__body').length,
          projectCards: document.querySelectorAll('.project-grid__card').length,
          projectDetail: document.querySelectorAll('.project-detail-view__body').length,
        },
        projectVisualNodes,
      };
    })()`, tracked.sessionId);
  }

  const tabAudits = [];
  let projectRouteProbe = null;
  for (let index = 0; index < tabCount; index += 1) {
    await readTabVisual(index, {activate: true});
    const deadline = Date.now() + 8000;
    let visual = null;
    while (Date.now() < deadline) {
      visual = await readTabVisual(index);
      if (visual?.active && visual.selectedIndex === index) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.ok(visual?.active, `左侧 Tab ${index} 未进入选中态`);
    assert.equal(visual.selectedIndex, index, `左侧 Tab ${index} 切换后选中态错误`);
    assert.equal(visual.rootProfile, profile.id, `左侧 Tab ${index} 切换后皮肤被 React 覆盖`);
    assert.match(visual.tabBackground, /(?:linear-gradient|rgb)/u, `左侧 Tab ${index} 未得到皮肤色块`);
    assert.match(visual.tabColor, /^rgb/u, `左侧 Tab ${index} 未得到皮肤前景色`);
    assert.match(visual.sidebarBackground, /^rgba?\(/u, `左侧 Tab ${index} 侧栏背景未保留`);
    assert.equal(visual.fullWindowUsesLocalDataImage, true, `左侧 Tab ${index} 全局背景丢失`);
    tabAudits.push({
      index,
      selectedIndex: visual.selectedIndex,
      surfaces: visual.surfaces,
      projectVisualNodes: visual.projectVisualNodes,
    });

    if (visual.surfaces.mainProjects > 0) {
      // WorkBuddy lazy-loads the Teams project route.  Do not treat the first
      // paint of its fallback shell as an absent Hero.  The probe retains only
      // route names, element counts and layout state—never project text, IDs,
      // image URLs or account data.
      const deadline = Date.now() + 10_000;
      let routeState = null;
      while (Date.now() < deadline) {
        routeState = await manager.evaluateValue(`(() => {
          const shell = document.querySelector('.main-content--projects');
          const fallback = shell?.querySelector('.main-content__lazy-fallback');
          const collab = shell?.querySelector('.workbuddy-collab');
          const landing = shell?.querySelector('.workbuddy-collab .landing');
          const hero = shell?.querySelector('.workbuddy-collab .landing > header.landing-header > img.landing-hero');
          const heroStyle = hero ? getComputedStyle(hero) : null;
          return {
            pathname: location.pathname,
            searchKeys: [...new URLSearchParams(location.search).keys()].sort(),
            shellPresent: Boolean(shell),
            shellChildren: shell?.children.length ?? 0,
            fallbackPresent: Boolean(fallback),
            collaborationPresent: Boolean(collab),
            landingPresent: Boolean(landing),
            heroPresent: Boolean(hero),
            // Do not return the CSS content value: it may contain the complete
            // local data URL for the artwork.  The probe needs only a bounded
            // proof that the compiled WebP replacement is present.
            heroUsesLocalDataImage: Boolean(heroStyle?.content?.includes('data:image/webp')),
            heroObjectFit: heroStyle?.objectFit ?? null,
            heroObjectPosition: heroStyle?.objectPosition ?? null,
            rootProfile: document.documentElement.getAttribute(${JSON.stringify(skinRuntimeIds.rootAttribute)}),
            // The background image is a local data URL.  Report only whether
            // it is still applied, never the artwork bytes themselves.
            fullWindowUsesLocalDataImage: getComputedStyle(document.body, '::before')
              .backgroundImage.includes('data:image/webp'),
          };
        })()`, tracked.sessionId);
        if (!routeState?.fallbackPresent) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.equal(routeState?.rootProfile, profile.id, '项目路由加载期间皮肤被覆盖');
      assert.equal(routeState?.fullWindowUsesLocalDataImage, true, '项目路由加载期间全局背景丢失');
      if (routeState?.heroPresent) {
        assert.equal(routeState.heroUsesLocalDataImage, true, '项目 Hero 未替换为受控本地图片');
        assert.equal(routeState.heroObjectFit, profile.advanced.workbuddy.projectHero.fit);
        const expectedPosition = profile.advanced.workbuddy.projectHero.position;
        assert.ok(
          routeState.heroObjectPosition === expectedPosition ||
          routeState.heroObjectPosition === normalizedObjectPosition(expectedPosition),
          `项目 Hero 位置不正确：${routeState.heroObjectPosition}`,
        );
      }
      projectRouteProbe = routeState;
    }
  }

  async function clickMoreControl() {
    const point = await manager.evaluateValue(`(() => {
    const button = [...document.querySelectorAll('button.conversation-list-tab-button-more')]
      .find((item) => !item.disabled && item.getClientRects().length > 0);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    })()`, tracked.sessionId);
    if (!point) return false;
    // React's menu trigger requires a trusted pointer sequence; this performs a
    // bounded click on that one inspected control and never reads menu content.
    await manager.transport.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: point.x, y: point.y, button: 'none',
    }, tracked.sessionId);
    await manager.transport.call('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
    }, tracked.sessionId);
    await manager.transport.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
    }, tracked.sessionId);
    return true;
  }

  const morePresent = await clickMoreControl();
  if (morePresent) {
    const deadline = Date.now() + 5000;
    let dropdown = null;
    while (Date.now() < deadline) {
      dropdown = await manager.evaluateValue(`(() => {
        const menu = document.querySelector('.conversation-list-more-dropdown');
        if (!menu || !menu.getClientRects().length) return null;
        const item = menu.querySelector('[role="menuitem"]');
        return {
          profile: document.documentElement.getAttribute(${JSON.stringify(skinRuntimeIds.rootAttribute)}),
          background: getComputedStyle(menu).backgroundColor,
          borderRadius: getComputedStyle(menu).borderRadius,
          itemColor: item ? getComputedStyle(item).color : null,
          fullWindowUsesLocalDataImage: getComputedStyle(document.body, '::before')
            .backgroundImage.includes('data:image/webp'),
        };
      })()`, tracked.sessionId);
      if (dropdown) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.ok(dropdown, '左侧 More 菜单没有打开');
    assert.equal(dropdown.profile, profile.id, '打开 More 菜单后皮肤被覆盖');
    assert.match(dropdown.background, /^rgba?\(/u, 'More 菜单未得到皮肤背景');
    assert.match(dropdown.borderRadius, /px$/u, 'More 菜单未得到圆角');
    if (dropdown.itemColor !== null) assert.match(dropdown.itemColor, /^rgb/u, 'More 菜单项未得到皮肤前景色');
    assert.equal(dropdown.fullWindowUsesLocalDataImage, true, '打开 More 菜单后全局背景丢失');
    await clickMoreControl();
  }

  async function navigateToProjectsRoute() {
    const point = await manager.evaluateValue(`(() => {
      // Only accept an already visible, first-party router link whose route is
      // exactly /projects.  The audit never guesses a menu entry or invokes a
      // destructive/project-management control.
      const link = [...document.querySelectorAll('a[href]')].find((item) => {
        if (item.getClientRects().length === 0) return false;
        try {
          const destination = new URL(item.href, location.href);
          return destination.pathname === '/projects' &&
            !destination.searchParams.has('projectId');
        } catch {
          return false;
        }
      });
      if (!link) return null;
      const rect = link.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    })()`, tracked.sessionId);
    if (!point) return false;
    await manager.transport.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: point.x, y: point.y, button: 'none',
    }, tracked.sessionId);
    await manager.transport.call('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
    }, tracked.sessionId);
    await manager.transport.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
    }, tracked.sessionId);
    return true;
  }

  // The hero belongs to WorkBuddy's /projects route, not a generic top-level
  // task tab.  Use a visible, exact route link if the current product build
  // exposes it; the test reports it as unavailable rather than fabricating a
  // route or reading user/project information.
  const projectRouteAttempted = await navigateToProjectsRoute();
  let projectRouteLoaded = false;
  if (projectRouteAttempted) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const state = await manager.evaluateValue(`(() => ({
        collaboration: document.querySelectorAll('.workbuddy-collab').length,
        landing: document.querySelectorAll('.workbuddy-collab .landing').length,
        profile: document.documentElement.getAttribute(${JSON.stringify(skinRuntimeIds.rootAttribute)}),
        usesLocalDataImage: getComputedStyle(document.body, '::before')
          .backgroundImage.includes('data:image/webp'),
      }))()`, tracked.sessionId);
      if (state?.landing > 0) {
        assert.equal(state.profile, profile.id, '进入项目页后皮肤被 React 覆盖');
        assert.equal(state.usesLocalDataImage, true, '进入项目页后全局背景丢失');
        projectRouteLoaded = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  const readHeroProof = () => manager.evaluateValue(`(() => {
    const hero = document.querySelector('.workbuddy-collab .landing > header.landing-header > img.landing-hero');
    if (!hero) return {present: false};
    const style = getComputedStyle(hero);
    return {
      present: true,
      // Keep the test report privacy-safe and compact: no artwork data URL.
      usesLocalDataImage: style.content.includes('data:image/webp'),
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
    };
  })()`, tracked.sessionId);
  // Verify before leaving /projects.  Returning to the initial task tab below
  // is solely for stock restoration hygiene.
  let heroProof = projectRouteProbe?.heroPresent ? {
    present: true,
    usesLocalDataImage: projectRouteProbe.heroUsesLocalDataImage,
    objectFit: projectRouteProbe.heroObjectFit,
    objectPosition: projectRouteProbe.heroObjectPosition,
  } : projectRouteLoaded ? await readHeroProof() : null;
  if (projectRouteLoaded) {
    assert.ok(heroProof?.present, '项目列表已载入，但 WorkBuddy 未渲染 Hero 元素');
  }

  // Return to the starting tab after the optional project route probe.  This
  // keeps the audit independent of the order in which WorkBuddy renders tabs.
  await readTabVisual(initialTabIndex, {activate: true});
  const returnDeadline = Date.now() + 8000;
  let returnedTab = null;
  while (Date.now() < returnDeadline) {
    returnedTab = await readTabVisual(initialTabIndex);
    if (returnedTab?.active && returnedTab.selectedIndex === initialTabIndex) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal(returnedTab?.selectedIndex, initialTabIndex, '未能返回项目 Hero 所在的初始 Tab');

  if (!heroProof) heroProof = await readHeroProof();
  if (heroProof.present) {
    assert.equal(heroProof.usesLocalDataImage, true, '项目 Hero 未替换为受控本地图片');
    assert.equal(heroProof.objectFit, profile.advanced.workbuddy.projectHero.fit);
    const expectedPosition = profile.advanced.workbuddy.projectHero.position;
    assert.ok(
      heroProof.objectPosition === expectedPosition ||
      heroProof.objectPosition === normalizedObjectPosition(expectedPosition),
      `项目 Hero 位置不正确：${heroProof.objectPosition}`,
    );
  }

  await manager.restoreStock(app, {confirmRestart: true});
  restored = true;
  const stock = runningMainProcesses(findClientApp('workbuddy', {fresh: true}));
  assert.ok(stock.length >= 1);
  assert.ok(stock.every((process) => process.debugTransport === 'stock'));
  const after = findClientApp('workbuddy', {fresh: true});
  assert.equal(after.asarSha256, asarBefore);
  console.log(JSON.stringify({
    ok: true,
    clientId: 'workbuddy',
    version: app.version,
    adapterId: compatibility.adapter.adapterId,
    injectedTargets: status.injectedTargets,
    verifiedVariables: ['--vscode-focusBorder', '--vscode-editor-background'],
    verifiedComponents: [
      'brand', 'navigation-all-tabs', 'more-dropdown', 'send-idle', 'stop-source-and-css',
      'project-hero-live', 'composer-avatar',
      'main-background-transparent', 'single-mascot-no-native-duplicate',
      'composer-avatar-full-width-turnaround',
    ],
    verifiedNavigationTabs: tabAudits,
    projectRouteProbe,
    historyRouteProof,
    projectHeroRoute: {
      attempted: projectRouteAttempted,
      loaded: projectRouteLoaded,
      observedViaTopLevelTab: projectRouteProbe?.landingPresent === true,
    },
    verifiedHero: heroProof.present,
    mascotMotionProof,
    restoredStock: true,
  }));
} finally {
  if (!restored) {
    try {
      const current = findClientApp('workbuddy', {fresh: true});
      if (manager.status().mode && current?.safeToLaunch) {
        await manager.restoreStock(current, {confirmRestart: true});
      } else {
        await manager.stop({terminateApp: Boolean(manager.status().mode)});
        if (current?.safeToLaunch && !runningMainProcesses(current).length) await launchStock(current);
      }
    } catch (error) {
      console.error(`WorkBuddy 恢复失败：${error.message}`);
    }
  }
  const finalApp = findClientApp('workbuddy', {fresh: true});
  assert.equal(finalApp?.asarSha256, asarBefore);
}
