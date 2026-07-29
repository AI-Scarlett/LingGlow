import { nativeThemeParametersFor } from './native-theme-params.mjs';
import { codexDreamSkinInjectionSource } from './codex-dream-skin-adapter.mjs';

function installComposerActivityMonitor(clientId, enabled) {
  if (!document?.documentElement || typeof MutationObserver !== "function") return;
  const stateKey = "__LINGGLOW_COMPOSER_ACTIVITY_STATE__";
  window[stateKey]?.cleanup?.();
  const root = document.documentElement;
  if (!enabled) {
    root.removeAttribute("data-lingglow-agent-active");
    delete window[stateKey];
    return;
  }
  const client = String(clientId || "");
  let scheduled = false;
  let scheduledHandle = null;
  let scheduledWithAnimationFrame = false;
  const visibleEnabled = (node) => {
    if (!(node instanceof HTMLElement) || !node.isConnected || node.hidden) return false;
    if (node.matches(':disabled, [aria-disabled="true"]')) return false;
    for (let current = node, depth = 0; current instanceof HTMLElement && depth < 10;
      current = current.parentElement, depth += 1) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
          Number(style.opacity) <= 0.01) return false;
    }
    return typeof node.getClientRects !== "function" || node.getClientRects().length > 0;
  };
  const codexActive = () => [...document.querySelectorAll(
    '[data-lingglow-codex-control="stop"]'
  )].some(visibleEnabled);
  const workbuddyActive = () => [...document.querySelectorAll(
    '[data-track-id="agent_task_interrupted"]'
  )].some(visibleEnabled);
  const doubaoActive = () => {
    // Doubao 2.19.9 renders the active break control as a component carrying
    // this test id; it is not guaranteed to be a native button or a child of
    // the editable input. Match that stable contract first.
    const explicitBreakControls = document.querySelectorAll([
      '#chat-route-main [data-testid="chat_input_local_break_button"]',
      '#chat-route-main [data-testid*="stop_generating" i]',
      '#chat-route-main [data-testid*="break_button" i]',
      '#chat-route-main [data-testid*="interrupt" i]',
    ].join(', '));
    if ([...explicitBreakControls].some(visibleEnabled)) return true;

    let inspected = 0;
    for (const composer of document.querySelectorAll('[data-testid="chat_input"]')) {
      const scope = composer.parentElement?.parentElement || composer.parentElement || composer;
      for (const button of scope.querySelectorAll('button, [role="button"], [data-testid]')) {
        if (++inspected > 48) return false;
        const signature = [
          button.getAttribute('data-testid'),
          button.getAttribute('aria-label'),
          button.getAttribute('title'),
        ].filter(Boolean).join(' ');
        if (/(?:^|[_\s-])(?:stop|cancel|interrupt|break|abort)(?:$|[_\s-])|停止|中断|取消生成/iu.test(signature) &&
            visibleEnabled(button)) return true;
      }
    }
    return false;
  };
  const sync = () => {
    scheduled = false;
    scheduledHandle = null;
    const pageVisible = document.hidden !== true && document.visibilityState !== 'hidden';
    const active = pageVisible && (client === "codex" ? codexActive()
      : client === "workbuddy" ? workbuddyActive()
        : client === "doubao" ? doubaoActive()
          : false);
    if (active) root.setAttribute("data-lingglow-agent-active", "true");
    else root.removeAttribute("data-lingglow-agent-active");
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    scheduledWithAnimationFrame = typeof requestAnimationFrame === "function";
    scheduledHandle = scheduledWithAnimationFrame
      ? requestAnimationFrame(sync)
      : setTimeout(sync, 0);
  };
  const pauseWhenHidden = () => {
    if (document.hidden === true || document.visibilityState === 'hidden') {
      root.removeAttribute("data-lingglow-agent-active");
      return;
    }
    schedule();
  };
  const stopOnPageHide = () => root.removeAttribute("data-lingglow-agent-active");
  const observer = new MutationObserver(schedule);
  const activityAttributes = [
    'aria-label', 'aria-disabled', 'title', 'data-testid', 'disabled', 'hidden',
    ...(client === 'doubao' ? ['class', 'style'] : []),
  ];
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: activityAttributes,
  });
  document.addEventListener?.('visibilitychange', pauseWhenHidden);
  window.addEventListener?.('pagehide', stopOnPageHide);
  const timers = [setTimeout(schedule, 250), setTimeout(schedule, 1000)];
  const cleanup = () => {
    observer.disconnect();
    timers.forEach(clearTimeout);
    if (scheduledHandle !== null) {
      if (scheduledWithAnimationFrame && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(scheduledHandle);
      } else {
        clearTimeout(scheduledHandle);
      }
    }
    document.removeEventListener?.('visibilitychange', pauseWhenHidden);
    window.removeEventListener?.('pagehide', stopOnPageHide);
    root.removeAttribute("data-lingglow-agent-active");
    if (window[stateKey]?.cleanup === cleanup) delete window[stateKey];
  };
  window[stateKey] = {client, observer, sync: schedule, cleanup};
  schedule();
}

function installRuntimeHotfix(clientId, palette, nativeTheme, visual) {
  // Injection can happen while a renderer is still constructing its document.
  // Keep the static skin active and skip only this optional enhancement until a
  // complete DOM exists; never throw in a constrained renderer/test context.
  if (!document?.documentElement ||
      typeof document.documentElement.getAttribute !== "function" ||
      typeof document.querySelectorAll !== "function") return;
  const styleId = "__lingglow_runtime_hotfix_v3__";
  const client = String(clientId || "");
  const accent = palette?.accent || "#ff4d57";
  const surface = palette?.surface || "#071411";
  const requestedInk = palette?.ink || "#fff7ef";
  const nativeMode = nativeTheme?.mode === "light" ? "light" : "dark";
  const toRgb = (value, fallback) => {
    const match = String(value || "").trim().match(/^#([0-9a-f]{6})$/i);
    if (!match) return fallback;
    return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16)).join(", ");
  };
  const accentRgb = toRgb(accent, "255, 77, 87");
  const surfaceRgb = toRgb(surface, "7, 20, 17");
  const requestedInkRgb = toRgb(requestedInk, "255, 247, 239");
  const relativeLuminance = (rgbText) => rgbText.split(",").map((channel) => {
    const normalized = Number(channel.trim()) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (first, second) => {
    const bright = Math.max(first, second);
    const dark = Math.min(first, second);
    return (bright + 0.05) / (dark + 0.05);
  };
  const rgbChannels = (rgbText) => rgbText.split(",").map((channel) => Number(channel.trim()));
  const luminanceForChannels = (channels) => relativeLuminance(channels.join(", "));
  const compositeChannels = (foreground, background, alpha) => foreground.map(
    (channel, index) => channel * alpha + background[index] * (1 - alpha),
  );
  const readablePhotoOverlayAlpha = (surfaceChannels, foregroundLuminance, minimumContrast = 4.5) => {
    // A photograph can contain both black and white pixels. Pick the lowest
    // surface-colour overlay that keeps the selected ink readable over both
    // extremes, then add a small guard for compression and display variance.
    for (let step = 24; step <= 94; step += 1) {
      const alpha = step / 100;
      const overBlack = luminanceForChannels(compositeChannels(surfaceChannels, [0, 0, 0], alpha));
      const overWhite = luminanceForChannels(compositeChannels(surfaceChannels, [255, 255, 255], alpha));
      if (Math.min(contrast(foregroundLuminance, overBlack), contrast(foregroundLuminance, overWhite)) >= minimumContrast) {
        return Math.min(0.94, alpha + 0.02);
      }
    }
    return 0.94;
  };
  const surfaceLuminance = relativeLuminance(surfaceRgb);
  const requestedInkLuminance = relativeLuminance(requestedInkRgb);
  const darkInkLuminance = relativeLuminance("23, 23, 23");
  const lightInkLuminance = relativeLuminance("247, 247, 245");
  const accentLuminance = relativeLuminance(accentRgb);
  const accentInk = contrast(darkInkLuminance, accentLuminance) >=
    contrast(lightInkLuminance, accentLuminance) ? "#171717" : "#F7F7F5";
  const fallbackInk = contrast(darkInkLuminance, surfaceLuminance) >=
    contrast(lightInkLuminance, surfaceLuminance) ? "#171717" : "#F7F7F5";
  // The client can report a dark native mode while the selected skin surface
  // is light (WorkBuddy does this today).  Resolve text against the actual
  // painted surface, not the host mode, otherwise a light glass panel inherits
  // white text and becomes unreadable.
  const ink = contrast(requestedInkLuminance, surfaceLuminance) >= 4.5
    ? requestedInk
    : fallbackInk;
  const inkRgb = toRgb(ink, "255, 247, 239");
  const inkChannels = rgbChannels(inkRgb);
  const inkLuminance = (0.2126 * inkChannels[0] + 0.7152 * inkChannels[1] + 0.0722 * inkChannels[2]) / 255;
  const inkRelativeLuminance = relativeLuminance(inkRgb);
  const doubaoReadingAlpha = readablePhotoOverlayAlpha(
    rgbChannels(surfaceRgb),
    inkRelativeLuminance,
  );
  const doubaoTextShadow = inkLuminance < 0.56
    ? "0 1px 2px rgba(255, 255, 255, 0.56)"
    : "0 1px 3px rgba(0, 0, 0, 0.62)";
  const workbuddyNativeTheme = nativeMode;
  const workbuddyContrastSurface = inkLuminance >= 0.56
    ? `rgba(${surfaceRgb}, 0.92)`
    : "rgba(255, 255, 255, 0.94)";
  const workbuddyContrastGradient = inkLuminance >= 0.56
    ? `linear-gradient(180deg, rgba(${surfaceRgb}, 0.08) 0%, rgba(${surfaceRgb}, 0.94) 100%)`
    : "linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.94) 100%)";
  const backgroundImage = typeof visual?.backgroundImage === "string" && visual.backgroundImage.startsWith("data:image/")
    ? visual.backgroundImage
    : "";
  const composerAvatarImage = typeof visual?.composerAvatarImage === "string" && visual.composerAvatarImage.startsWith("data:image/")
    ? visual.composerAvatarImage
    : "";
  const composerAvatarEnabled = visual?.composerAvatarEnabled === true && Boolean(composerAvatarImage);
  const homeDisplayName = typeof visual?.homeDisplayName === "string" ? visual.homeDisplayName.trim() : "";
  const homeTagline = typeof visual?.homeTagline === "string" ? visual.homeTagline.trim() : "";
  const homeTitle = typeof visual?.homeTitle === "string" ? visual.homeTitle.trim() : "";
  const chatStageBackground = backgroundImage
    ? `linear-gradient(rgba(${surfaceRgb}, ${doubaoReadingAlpha.toFixed(2)}), rgba(${surfaceRgb}, ${doubaoReadingAlpha.toFixed(2)})), url("${backgroundImage}")`
    : `linear-gradient(135deg, rgba(${surfaceRgb}, 0.72), rgba(${surfaceRgb}, 0.84))`;
  const nativeRoleValues = nativeMode === "light" ? {
    canvas: "#F7F8FA", surface: "rgba(255, 255, 255, 0.94)", surfaceElevated: "#FFFFFF",
    surfaceOverlay: "#FFFFFF", surfaceHover: "rgba(0, 0, 0, 0.055)", surfaceActive: "rgba(0, 0, 0, 0.09)",
    mainSurface: "#F7F8FA", sidebar: "rgba(255, 255, 255, 0.94)", editor: "#F7F8FA",
    input: "rgba(255, 255, 255, 0.96)", dropdown: "#FFFFFF", menu: "#FFFFFF",
    card: "rgba(255, 255, 255, 0.94)", cardHover: "#FFFFFF",
    cardBorder: "rgba(23, 23, 23, 0.14)", cardBorderHover: `rgba(${accentRgb}, 0.58)`,
    cardShadow: "0 12px 30px rgba(17, 24, 39, 0.12)", textPrimary: ink, textStrong: ink,
    textSecondary: `rgba(${inkRgb}, 0.76)`, textTertiary: `rgba(${inkRgb}, 0.60)`, textMuted: `rgba(${inkRgb}, 0.56)`,
    textDescription: `rgba(${inkRgb}, 0.72)`, textPlaceholder: `rgba(${inkRgb}, 0.50)`, foreground: ink,
    description: `rgba(${inkRgb}, 0.72)`, placeholder: `rgba(${inkRgb}, 0.50)`, filterText: `rgba(${inkRgb}, 0.76)`,
    filterTextHover: ink, filterTextActive: ink, filterBorder: "rgba(23, 23, 23, 0.14)",
    border: "rgba(23, 23, 23, 0.14)", borderDefault: "rgba(23, 23, 23, 0.14)", borderLight: "rgba(23, 23, 23, 0.09)",
    buttonBackground: "rgba(255, 255, 255, 0.96)", buttonBackgroundHover: `rgba(${accentRgb}, 0.13)`, buttonText: ink,
    searchBackground: "rgba(255, 255, 255, 0.96)", searchText: ink, selectedBackground: `rgba(${accentRgb}, 0.20)`,
    hoverBackground: `rgba(${accentRgb}, 0.10)`, accentLabel: accent, codeBlock: "#F1F3F5", diffSurface: "#F7F8FA",
    featuredBackground: "rgba(255, 255, 255, 0.94)", featuredOverlay: "linear-gradient(180deg, transparent, rgba(255,255,255,0.92))",
    featuredTagBackground: "rgba(255, 255, 255, 0.92)", featuredTagText: ink,
    fill: "rgba(23, 23, 23, 0.06)", fillHover: "rgba(23, 23, 23, 0.09)", fillActive: `rgba(${accentRgb}, 0.18)`,
    primary: accent, primaryHover: accent, primaryActive: accent, focusBorder: accent,
  } : {
    canvas: surface, surface: `rgba(${surfaceRgb}, 0.88)`, surfaceElevated: `rgba(${surfaceRgb}, 0.96)`,
    surfaceOverlay: `rgba(${surfaceRgb}, 0.98)`, surfaceHover: `rgba(${inkRgb}, 0.08)`, surfaceActive: `rgba(${accentRgb}, 0.18)`,
    mainSurface: surface, sidebar: `rgba(${surfaceRgb}, 0.90)`, editor: surface,
    input: `rgba(${surfaceRgb}, 0.92)`, dropdown: `rgba(${surfaceRgb}, 0.98)`, menu: `rgba(${surfaceRgb}, 0.98)`,
    card: `rgba(${surfaceRgb}, 0.88)`, cardHover: `rgba(${surfaceRgb}, 0.96)`,
    cardBorder: `rgba(${inkRgb}, 0.14)`, cardBorderHover: `rgba(${accentRgb}, 0.62)`,
    cardShadow: "0 14px 36px rgba(0, 0, 0, 0.28)", textPrimary: ink, textStrong: ink,
    textSecondary: `rgba(${inkRgb}, 0.78)`, textTertiary: `rgba(${inkRgb}, 0.62)`, textMuted: `rgba(${inkRgb}, 0.58)`,
    textDescription: `rgba(${inkRgb}, 0.74)`, textPlaceholder: `rgba(${inkRgb}, 0.54)`, foreground: ink,
    description: `rgba(${inkRgb}, 0.74)`, placeholder: `rgba(${inkRgb}, 0.54)`, filterText: `rgba(${inkRgb}, 0.78)`,
    filterTextHover: ink, filterTextActive: ink, filterBorder: `rgba(${inkRgb}, 0.15)`,
    border: `rgba(${inkRgb}, 0.15)`, borderDefault: `rgba(${inkRgb}, 0.15)`, borderLight: `rgba(${inkRgb}, 0.10)`,
    buttonBackground: `rgba(${surfaceRgb}, 0.92)`, buttonBackgroundHover: `rgba(${accentRgb}, 0.20)`, buttonText: ink,
    searchBackground: `rgba(${surfaceRgb}, 0.92)`, searchText: ink, selectedBackground: `rgba(${accentRgb}, 0.26)`,
    hoverBackground: `rgba(${accentRgb}, 0.14)`, accentLabel: accent, codeBlock: `rgba(${surfaceRgb}, 0.98)`, diffSurface: surface,
    featuredBackground: `rgba(${surfaceRgb}, 0.88)`, featuredOverlay: `linear-gradient(180deg, transparent, rgba(${surfaceRgb}, 0.94))`,
    featuredTagBackground: `rgba(${surfaceRgb}, 0.92)`, featuredTagText: ink,
    fill: `rgba(${inkRgb}, 0.08)`, fillHover: `rgba(${inkRgb}, 0.12)`, fillActive: `rgba(${accentRgb}, 0.22)`,
    primary: accent, primaryHover: accent, primaryActive: accent, focusBorder: accent,
  };
  const nativeTokenDeclarations = Object.entries(nativeTheme?.tokens || {})
    .map(([role, property]) => nativeRoleValues[role] ? `${property}: ${nativeRoleValues[role]} !important;` : "")
    .filter(Boolean)
    .join("\n");
  const nativeTokenCss = nativeTokenDeclarations ? `
    html[data-codex-skin-studio], html[data-codex-skin-studio] body {
      ${nativeTokenDeclarations}
    }
  ` : "";
  window.__lingglowRuntimeHotfixCleanup?.();

  const oldStyle = document.getElementById(styleId);
  oldStyle?.remove();

  const style = document.createElement("style");
  style.id = styleId;

  const codexCss = `
    html[data-codex-skin-studio],
    html[data-codex-skin-studio] body {
      background-color: ${surface} !important;
      background-image: none !important;
      color: ${ink} !important;
    }
    html[data-codex-skin-studio] body::before,
    html[data-codex-skin-studio] body::after {
      content: none !important;
      background: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] body > :first-child,
    html[data-codex-skin-studio] body > #root,
    html[data-codex-skin-studio] body > #app,
    html[data-codex-skin-studio] body > [data-reactroot] {
      background: transparent !important;
    }
    html[data-codex-skin-studio] body > :is(#root, #app, [data-reactroot]) {
      position: relative !important;
      z-index: 1 !important;
    }
    html[data-codex-skin-studio] :is(
      [data-slot="sidebar-wrapper"],
      [data-slot="sidebar-inset"],
      [class~="bg-background"],
      [class*="app-shell" i],
      [class*="main-surface" i]
    ) {
      background-color: transparent !important;
      background-image: none !important;
    }
    html[data-codex-skin-studio] body > :first-child > :first-child,
    html[data-codex-skin-studio] body > :first-child > :first-child > :first-child,
    html[data-codex-skin-studio] :is(main, [role="main"], [class*="main-content" i], [class*="mainContent" i], [class*="app-shell" i]) {
      background-color: transparent !important;
      background-image: none !important;
    }
    html[data-codex-skin-studio] :is(
      aside,
      nav,
      [class*="sidebar" i],
      [class*="left-panel" i],
      [class*="leftPanel" i],
      aside.app-shell-left-panel
    ) {
      background-color: rgba(${surfaceRgb}, 0.78) !important;
      background-image: none !important;
      color: ${ink} !important;
      border-color: rgba(${accentRgb}, 0.24) !important;
      backdrop-filter: blur(22px) saturate(1.12) !important;
      -webkit-backdrop-filter: blur(22px) saturate(1.12) !important;
    }
    html[data-codex-skin-studio] :is(
      aside,
      nav,
      [class*="sidebar" i],
      [class*="left-panel" i],
      [class*="leftPanel" i],
      aside.app-shell-left-panel
    ) :where(button, a, span, p, h1, h2, h3, label) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      text-shadow: 0 1px 2px rgba(${surfaceRgb}, 0.56) !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] :is(textarea, input, [contenteditable="true"]) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      caret-color: ${accent} !important;
    }
    html[data-codex-skin-studio] :is(textarea, input)::placeholder {
      color: rgba(${inkRgb}, 0.70) !important;
      -webkit-text-fill-color: rgba(${inkRgb}, 0.70) !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] :is(
      [role="menu"],
      [role="listbox"],
      [role="dialog"],
      [data-radix-popper-content-wrapper] > *
    ) {
      background: rgba(${surfaceRgb}, 0.98) !important;
      color: ${ink} !important;
      border-color: rgba(${inkRgb}, 0.16) !important;
    }
    html[data-codex-skin-studio] :is(
      [role="menu"],
      [role="listbox"],
      [role="dialog"],
      [data-radix-popper-content-wrapper] > *
    ) :where(button, a, span, p, label, div) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
    }
    html[data-codex-skin-studio] aside.app-shell-left-panel {
      background: linear-gradient(180deg, rgba(${surfaceRgb}, 0.90), rgba(${surfaceRgb}, 0.72)) !important;
      border-right: 1px solid rgba(${accentRgb}, 0.22) !important;
      box-shadow: 18px 0 48px rgba(0, 0, 0, 0.20) !important;
      backdrop-filter: blur(22px) saturate(1.18) !important;
    }
    html[data-codex-skin-studio] main.main-surface,
    html[data-codex-skin-studio] [class*="main-surface"] {
      background: transparent !important;
    }
    html[data-codex-skin-studio] .composer-surface-chrome,
    html[data-codex-skin-studio] [class*="composer-surface"] {
      background: rgba(${surfaceRgb}, 0.84) !important;
      border: 1px solid rgba(${accentRgb}, 0.32) !important;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28) !important;
      backdrop-filter: blur(24px) saturate(1.2) !important;
    }
    html[data-codex-skin-studio] aside.app-shell-left-panel :is([aria-current="page"], [aria-selected="true"], [data-state="active"], [data-selected="true"]) {
      color: ${ink} !important;
      background: linear-gradient(90deg, rgba(${accentRgb}, 0.28), rgba(${accentRgb}, 0.10)) !important;
      box-shadow: inset 3px 0 ${accent} !important;
    }
    html[data-codex-skin-studio] :is([data-testid*="browser"], [class*="browser-panel"], [class*="BrowserPanel"], webview) {
      position: relative !important;
      z-index: 8 !important;
      pointer-events: auto !important;
    }
  `;

  const workbuddyCss = `
    html[data-codex-skin-studio] [data-lingglow-light-surface="true"] {
      --cb-text-primary: #17211e !important;
      --cb-text-secondary: rgba(23, 33, 30, 0.76) !important;
      --cb-text-tertiary: rgba(23, 33, 30, 0.58) !important;
      --color-text-primary: #17211e !important;
      --color-text-secondary: rgba(23, 33, 30, 0.76) !important;
      --text-primary: #17211e !important;
      --text-secondary: rgba(23, 33, 30, 0.76) !important;
      color: #17211e !important;
      text-shadow: none !important;
    }
    html[data-codex-skin-studio] [data-lingglow-light-surface="true"] :where(*) {
      color: #17211e !important;
      -webkit-text-fill-color: #17211e !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] [data-lingglow-light-surface="true"] :where(small, [class*="secondary"], [class*="tertiary"], [class*="description"]) {
      color: rgba(23, 33, 30, 0.70) !important;
      -webkit-text-fill-color: rgba(23, 33, 30, 0.70) !important;
    }
    html[data-codex-skin-studio] [data-lingglow-light-surface="true"] input::placeholder,
    html[data-codex-skin-studio] [data-lingglow-light-surface="true"] textarea::placeholder {
      color: rgba(23, 33, 30, 0.52) !important;
      -webkit-text-fill-color: rgba(23, 33, 30, 0.52) !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] [role="listbox"] {
      --cb-text-primary: ${ink} !important;
      --cb-text-secondary: rgba(${inkRgb}, 0.76) !important;
      --cb-text-tertiary: rgba(${inkRgb}, 0.62) !important;
      --cb-content-background: rgba(${surfaceRgb}, 0.98) !important;
      --cb-dropdown-item-hover-bg-color: rgba(${accentRgb}, 0.16) !important;
      color: ${ink} !important;
      background: rgba(${surfaceRgb}, 0.98) !important;
      border: 1px solid rgba(${accentRgb}, 0.42) !important;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.38) !important;
      backdrop-filter: blur(22px) saturate(1.12) !important;
      -webkit-backdrop-filter: blur(22px) saturate(1.12) !important;
    }
    html[data-codex-skin-studio] [role="listbox"] :where(span, p, label, small) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] [role="listbox"] :is([role="option"], button):hover {
      background: rgba(${accentRgb}, 0.16) !important;
    }
    html[data-codex-skin-studio] [class*="_container_"][class*="_popover_qeqjw_"],
    html[data-codex-skin-studio] [class*="_popover_qeqjw_"] [class*="_autoModeSection_qeqjw_"] {
      background: ${nativeRoleValues.dropdown} !important;
      color: ${nativeRoleValues.textPrimary} !important;
      border-color: ${nativeRoleValues.borderDefault} !important;
    }
    html[data-codex-skin-studio] [class*="_container_"][class*="_popover_qeqjw_"] {
      border: 1px solid ${nativeRoleValues.borderDefault} !important;
      box-shadow: ${nativeRoleValues.cardShadow} !important;
    }
    html[data-codex-skin-studio] [class*="_popover_qeqjw_"] :is([class*="_autoModeLabel_qeqjw_"], [class*="_modelName_"], [class*="_footerActionLabel_"]) {
      color: ${nativeRoleValues.textPrimary} !important;
      -webkit-text-fill-color: ${nativeRoleValues.textPrimary} !important;
      opacity: 1 !important;
      text-shadow: none !important;
    }
    html[data-codex-skin-studio] [class*="_popover_qeqjw_"] [class*="_modelCredits_"] {
      color: ${nativeRoleValues.textSecondary} !important;
      -webkit-text-fill-color: ${nativeRoleValues.textSecondary} !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] [class*="_popover_qeqjw_"] :is([class*="_modelItem_"], [class*="_autoModeItem_qeqjw_"], [class*="_footerAction_"]) {
      color: ${nativeRoleValues.textPrimary} !important;
    }
    html[data-codex-skin-studio] [class*="_popover_qeqjw_"] :is([class*="_modelItem_"], [class*="_footerAction_"]):hover {
      background: ${nativeRoleValues.hoverBackground} !important;
    }
    html[data-codex-skin-studio] [class*="_popover_qeqjw_"] :is([class*="_autoModeSection_qeqjw_"], [class*="_modelListContainer_qeqjw_"], [class*="_footerAction_"]) {
      border-color: ${nativeRoleValues.borderDefault} !important;
    }
    html[data-codex-skin-studio] [data-lingglow-contrast-text="dark"] {
      color: #17211e !important;
      -webkit-text-fill-color: #17211e !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-expert-card,
    html[data-codex-skin-studio] .expert-center-light .ec-expert-card :where(*),
    html[data-codex-skin-studio] .expert-center-light .ec-featured-scene-content,
    html[data-codex-skin-studio] .expert-center-light .ec-featured-scene-content :where(*) {
      color: #1a1a1a !important;
      -webkit-text-fill-color: #1a1a1a !important;
      text-shadow: 0 1px 2px rgba(255, 255, 255, 0.78) !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-search-wrapper .wb-input-wrapper,
    html[data-codex-skin-studio] .expert-center-light .ec-search-wrapper input {
      color: #1a1a1a !important;
      -webkit-text-fill-color: #1a1a1a !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-search-wrapper input::placeholder {
      color: rgba(26, 26, 26, 0.52) !important;
      -webkit-text-fill-color: rgba(26, 26, 26, 0.52) !important;
      opacity: 1 !important;
    }
  `;

  const workbuddyCardCss = `
    html[data-codex-skin-studio] .expert-center-light .ec-expert-card {
      background: rgba(255, 255, 255, 0.96) !important;
      border: 1px solid rgba(${accentRgb}, 0.36) !important;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18) !important;
      backdrop-filter: blur(12px) saturate(1.08) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-expert-card:hover {
      border-color: rgba(${accentRgb}, 0.72) !important;
      box-shadow: 0 16px 38px rgba(0, 0, 0, 0.24), 0 0 0 1px rgba(${accentRgb}, 0.12) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-card-title-row,
    html[data-codex-skin-studio] .expert-center-light .ec-card-role-wrap {
      background: ${workbuddyContrastSurface} !important;
      border: 1px solid rgba(${accentRgb}, 0.24) !important;
      border-radius: 8px !important;
      padding: 2px 7px !important;
      width: fit-content !important;
      max-width: 100% !important;
      box-shadow: inset 3px 0 ${accent} !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-featured-scene-card {
      border: 1px solid rgba(${accentRgb}, 0.38) !important;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.22) !important;
      overflow: hidden !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-featured-scene-overlay {
      background: ${workbuddyContrastGradient} !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-search-wrapper .wb-input-wrapper {
      background: ${workbuddyContrastSurface} !important;
      border: 1px solid rgba(${accentRgb}, 0.42) !important;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.20) !important;
      backdrop-filter: blur(14px) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-search-wrapper input {
      background: transparent !important;
    }
    html[data-codex-skin-studio] .expert-center-light :is(.ec-card-title-row, .ec-card-role-wrap, .wb-input-wrapper)[data-lingglow-card-surface="light"] {
      background: rgba(255, 255, 255, 0.94) !important;
    }
    html[data-codex-skin-studio] .expert-center-light :is(.ec-card-title-row, .ec-card-role-wrap, .wb-input-wrapper)[data-lingglow-card-surface="dark"] {
      background: rgba(${surfaceRgb}, 0.92) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-featured-scene-overlay[data-lingglow-card-surface="light"] {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.94) 100%) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-featured-scene-overlay[data-lingglow-card-surface="dark"] {
      background: linear-gradient(180deg, rgba(${surfaceRgb}, 0.08) 0%, rgba(${surfaceRgb}, 0.94) 100%) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-expert-card,
    html[data-codex-skin-studio] .expert-center-light .ec-expert-card :where(*) {
      color: #171717 !important;
      -webkit-text-fill-color: #171717 !important;
      text-shadow: none !important;
    }
    html[data-codex-skin-studio] .expert-center-light :is(.ec-card-title-row, .ec-card-role-wrap) {
      background: rgba(17, 24, 39, 0.94) !important;
    }
    html[data-codex-skin-studio] .expert-center-light :is(.ec-card-title-row, .ec-card-role-wrap),
    html[data-codex-skin-studio] .expert-center-light :is(.ec-card-title-row, .ec-card-role-wrap) :where(*) {
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
      text-shadow: none !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-featured-scene-overlay {
      background: linear-gradient(180deg, rgba(17, 24, 39, 0.08) 0%, rgba(17, 24, 39, 0.94) 100%) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-featured-scene-content,
    html[data-codex-skin-studio] .expert-center-light .ec-featured-scene-content :where(*) {
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.72) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-search-wrapper .wb-input-wrapper {
      background: rgba(17, 24, 39, 0.94) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-search-wrapper input,
    html[data-codex-skin-studio] .expert-center-light .ec-search-wrapper input::placeholder {
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
  `;

  const doubaoCss = `
    html[data-codex-skin-studio] body::before {
      opacity: 1 !important;
      filter: brightness(1.72) contrast(1.08) saturate(1.10) !important;
      background-blend-mode: normal !important;
    }
    html[data-codex-skin-studio] #flow_chat_sidebar {
      background: linear-gradient(180deg, rgba(${surfaceRgb}, 0.90), rgba(${surfaceRgb}, 0.84)) !important;
      border-right: 1px solid rgba(${accentRgb}, 0.24) !important;
      box-shadow: 18px 0 54px rgba(0, 0, 0, 0.22) !important;
      backdrop-filter: blur(22px) saturate(1.16) !important;
    }
    html[data-codex-skin-studio] #flow_chat_sidebar :where(
      a, button, p, span, strong, small, label, h1, h2, h3, h4, h5, h6,
      [data-testid="chat_list_item_title"], [data-testid="chat_list_thread_item"]
    ) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] #chat-route-main {
      position: relative !important;
      background-image: ${chatStageBackground} !important;
      background-position: right center !important;
      background-size: cover !important;
      background-repeat: no-repeat !important;
      backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] #chat-route-main :is(main, [role="main"])[class*="center-bg-"] {
      background: transparent !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] #chat-route-main > :is(div, main, section),
    html[data-codex-skin-studio] #chat-route-main > :is(div, main, section) > :is(div, main, section) {
      background-color: transparent !important;
    }
    html[data-codex-skin-studio] #chat-route-main [data-lingglow-doubao-stage="true"] {
      background: transparent !important;
      background-color: transparent !important;
      background-image: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] #flow_chat_sidebar [class*="nav-link-"] {
      border: 1px solid transparent !important;
      transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease !important;
    }
    html[data-codex-skin-studio] #flow_chat_sidebar [class*="nav-link-"]:hover {
      color: ${ink} !important;
      background: rgba(${accentRgb}, 0.14) !important;
      border-color: rgba(${accentRgb}, 0.26) !important;
      transform: translateX(2px) !important;
    }
    html[data-codex-skin-studio] #flow_chat_sidebar [class*="nav-link-"]:active {
      background: rgba(${accentRgb}, 0.24) !important;
      transform: translateX(2px) scale(0.985) !important;
    }
    html[data-codex-skin-studio] #flow_chat_sidebar :is([class*="nav-link-"][data-lingglow-selected="true"], [class*="nav-link-"][aria-current="page"]) {
      color: ${ink} !important;
      background: linear-gradient(90deg, rgba(${accentRgb}, 0.34), rgba(${accentRgb}, 0.12)) !important;
      border-color: rgba(${accentRgb}, 0.38) !important;
      box-shadow: inset 3px 0 ${accent}, 0 8px 24px rgba(${accentRgb}, 0.10) !important;
    }
    html[data-codex-skin-studio] #flow_chat_sidebar :is([data-testid="chat_list_thread_item"][data-lingglow-selected="true"], [data-testid="chat_list_thread_item"][aria-current="page"], [data-testid="chat_list_thread_item"][class*="active-link-"]) {
      color: ${ink} !important;
      background: linear-gradient(90deg, rgba(${accentRgb}, 0.24), rgba(${accentRgb}, 0.08)) !important;
      box-shadow: inset 3px 0 rgba(${accentRgb}, 0.92) !important;
    }
    html[data-codex-skin-studio] :is([data-testid="chat_input"], #chat_input, [class*="chat-input"], [class*="chat_input"]) {
      background: rgba(${surfaceRgb}, 0.92) !important;
      border-color: rgba(${accentRgb}, 0.34) !important;
      box-shadow: 0 20px 52px rgba(0, 0, 0, 0.26), inset 0 1px rgba(255, 255, 255, 0.04) !important;
      backdrop-filter: blur(24px) saturate(1.2) !important;
    }
    html[data-codex-skin-studio] :is([data-testid="chat_input"], #chat_input, [class*="chat-input"], [class*="chat_input"])
      :is(textarea, input, [contenteditable="true"], .ProseMirror, [class*="editable"]) {
      background: transparent !important;
      background-image: none !important;
      border-color: transparent !important;
      box-shadow: none !important;
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      caret-color: ${accent} !important;
    }
    html[data-codex-skin-studio] :is([data-testid="chat_input"], #chat_input, [class*="chat-input"], [class*="chat_input"])
      :is(textarea, input)::placeholder {
      color: rgba(${inkRgb}, 0.62) !important;
      -webkit-text-fill-color: rgba(${inkRgb}, 0.62) !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] :is([data-testid="chat_input"], #chat_input, [class*="chat-input"], [class*="chat_input"])
      :is([contenteditable="true"], .ProseMirror, [class*="editable"])[data-placeholder]::before {
      color: rgba(${inkRgb}, 0.62) !important;
      -webkit-text-fill-color: rgba(${inkRgb}, 0.62) !important;
    }
    html[data-codex-skin-studio] #chat-route-main :is(
      [data-testid="message_content"],
      [data-testid="receive_message"],
      [data-testid="message_text_content"]
    ),
    html[data-codex-skin-studio] #chat-route-main :is(
      [data-testid="message_content"],
      [data-testid="receive_message"],
      [data-testid="message_text_content"]
    ) :where(*) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      text-shadow: ${doubaoTextShadow} !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] #chat-route-main :is(
      [class*="bg-g-send-msg-bubble-bg"],
      [class*="bubble-"]
    ) {
      background-color: rgba(${surfaceRgb}, 0.86) !important;
      border: 1px solid rgba(${accentRgb}, 0.28) !important;
      border-radius: 12px !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18) !important;
    }
    html[data-codex-skin-studio] #chat-route-main :is(
      [class~="bg-g-send-msg-bubble-bg"],
      [class~="text-g-send-msg-bubble-text"]
    ),
    html[data-codex-skin-studio] #chat-route-main :is(
      [class~="bg-g-send-msg-bubble-bg"],
      [class~="text-g-send-msg-bubble-text"]
    ) :where(*) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      text-shadow: ${doubaoTextShadow} !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] #chat-route-main [data-testid="message_text_content"] :is(a, a *) {
      color: ${accent} !important;
      -webkit-text-fill-color: ${accent} !important;
    }
  `;

  const workbuddyControlCss = `
    html[data-codex-skin-studio] .expert-center-light :is(.ec-list-tab, .ec-category-tab, .ec-sort-btn) {
      color: rgba(255, 255, 255, 0.9) !important;
      -webkit-text-fill-color: rgba(255, 255, 255, 0.9) !important;
      opacity: 1 !important;
      text-shadow: none !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-list-tab {
      background: rgba(17, 24, 39, 0.78) !important;
      border: 1px solid rgba(255, 255, 255, 0.14) !important;
      border-radius: 10px !important;
      padding: 6px 14px !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-list-tab:hover,
    html[data-codex-skin-studio] .expert-center-light .ec-list-tab.is-active,
    html[data-codex-skin-studio] .expert-center-light .ec-list-tab[aria-selected="true"] {
      background: rgba(255, 255, 255, 0.96) !important;
      border-color: rgba(255, 255, 255, 0.96) !important;
      color: #171717 !important;
      -webkit-text-fill-color: #171717 !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-category-tabs {
      gap: 8px !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-category-tab {
      background: rgba(17, 24, 39, 0.76) !important;
      border: 1px solid rgba(255, 255, 255, 0.14) !important;
      border-radius: 9px !important;
      color: rgba(255, 255, 255, 0.9) !important;
      -webkit-text-fill-color: rgba(255, 255, 255, 0.9) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-category-tab:hover {
      background: rgba(17, 24, 39, 0.96) !important;
      border-color: rgba(${accentRgb}, 0.9) !important;
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-category-tab.is-active,
    html[data-codex-skin-studio] .expert-center-light .ec-category-tab[aria-selected="true"] {
      background: rgba(255, 255, 255, 0.96) !important;
      border-color: rgba(255, 255, 255, 0.96) !important;
      color: #171717 !important;
      -webkit-text-fill-color: #171717 !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-sort-group {
      background: rgba(17, 24, 39, 0.92) !important;
      border: 1px solid rgba(255, 255, 255, 0.16) !important;
      border-radius: 10px !important;
      padding: 3px !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-sort-btn {
      background: transparent !important;
      color: rgba(255, 255, 255, 0.9) !important;
      -webkit-text-fill-color: rgba(255, 255, 255, 0.9) !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-sort-btn:hover {
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-sort-btn.is-active,
    html[data-codex-skin-studio] .expert-center-light .ec-sort-btn[aria-selected="true"] {
      background: rgba(255, 255, 255, 0.98) !important;
      color: #171717 !important;
      -webkit-text-fill-color: #171717 !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18) !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-category-tabs-next {
      background: rgba(255, 255, 255, 0.98) !important;
      border: 1px solid rgba(17, 24, 39, 0.14) !important;
      color: #171717 !important;
      -webkit-text-fill-color: #171717 !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22) !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] .expert-center-light .ec-category-tabs-next :is(svg, path, .ec-category-tabs-next-icon) {
      color: #171717 !important;
      stroke: currentColor !important;
      opacity: 1 !important;
    }
  `;

  const workbuddyNativeThemeCss = `
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-expert-card {
      background: var(--ec-expert-card-bg, var(--ec-card-bg)) !important;
      color: var(--ec-text-primary) !important;
      border: 1px solid rgba(${accentRgb}, 0.42) !important;
      box-shadow: var(--ec-expert-card-shadow, var(--ec-card-shadow)) !important;
      backdrop-filter: blur(12px) saturate(1.08) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-expert-card:hover {
      background: var(--ec-expert-card-hover-bg, var(--ec-expert-card-bg, var(--ec-card-bg))) !important;
      border-color: var(--ec-expert-card-hover-border, rgba(${accentRgb}, 0.78)) !important;
      box-shadow: var(--ec-card-shadow-hover, var(--ec-expert-card-shadow)) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-expert-card :is(.ec-card-title-row, .ec-card-role-wrap) {
      background: transparent !important;
      color: var(--ec-text-strong) !important;
      -webkit-text-fill-color: var(--ec-text-strong) !important;
      border: 0 !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-expert-card :is(.ec-card-title, .ec-card-name, h2, h3, h4) {
      color: var(--ec-text-strong) !important;
      -webkit-text-fill-color: var(--ec-text-strong) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-expert-card :is(.ec-card-desc, .ec-card-description, p) {
      color: var(--ec-expert-card-desc-color, var(--ec-text-desc)) !important;
      -webkit-text-fill-color: var(--ec-expert-card-desc-color, var(--ec-text-desc)) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-expert-card :is(.ec-card-tag, [class*="tag"]) {
      background: var(--ec-card-tag-bg) !important;
      border-color: var(--ec-card-tag-border) !important;
      color: var(--ec-card-tag-color) !important;
      -webkit-text-fill-color: var(--ec-card-tag-color) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-search-wrapper .wb-input-wrapper {
      background: var(--ec-search-bg) !important;
      border-color: var(--ec-filter-border, var(--ec-border)) !important;
      color: var(--ec-search-text) !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-search-wrapper input {
      color: var(--ec-search-text) !important;
      -webkit-text-fill-color: var(--ec-search-text) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-search-wrapper input::placeholder {
      color: var(--ec-text-placeholder) !important;
      -webkit-text-fill-color: var(--ec-text-placeholder) !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) :is(.ec-list-tab, .ec-category-tab, .ec-sort-btn) {
      color: var(--ec-filter-text, var(--ec-text-strong)) !important;
      -webkit-text-fill-color: var(--ec-filter-text, var(--ec-text-strong)) !important;
      opacity: 1 !important;
      text-shadow: none !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) :is(.ec-list-tab, .ec-category-tab):hover {
      background: var(--ec-bg-hover) !important;
      border-color: var(--ec-border-hover, rgba(${accentRgb}, 0.72)) !important;
      color: var(--ec-filter-text-hover, var(--ec-text-strong)) !important;
      -webkit-text-fill-color: var(--ec-filter-text-hover, var(--ec-text-strong)) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) :is(.ec-list-tab, .ec-category-tab).is-active,
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) :is(.ec-list-tab, .ec-category-tab)[aria-selected="true"] {
      background: var(--ec-bg-active, var(--ec-bg-tertiary)) !important;
      color: var(--ec-filter-text-active, var(--ec-text-strong)) !important;
      -webkit-text-fill-color: var(--ec-filter-text-active, var(--ec-text-strong)) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-sort-group {
      background: var(--ec-bg-secondary) !important;
      border: 1px solid var(--ec-border, var(--ec-border-subtle)) !important;
      box-shadow: var(--ec-card-shadow) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-sort-btn.is-active,
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-sort-btn[aria-selected="true"] {
      background: var(--ec-bg-active, var(--ec-bg-tertiary)) !important;
      color: var(--ec-filter-text-active, var(--ec-text-strong)) !important;
      -webkit-text-fill-color: var(--ec-filter-text-active, var(--ec-text-strong)) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-category-tabs-next {
      background: var(--ec-btn-bg, var(--ec-bg-tertiary)) !important;
      border-color: var(--ec-border, var(--ec-border-subtle)) !important;
      color: var(--ec-btn-text, var(--ec-text-primary)) !important;
      -webkit-text-fill-color: var(--ec-btn-text, var(--ec-text-primary)) !important;
      box-shadow: var(--ec-card-shadow) !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-category-tabs-next :is(svg, path, .ec-category-tabs-next-icon) {
      color: var(--ec-btn-text, var(--ec-text-primary)) !important;
      stroke: currentColor !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-featured-scene-card {
      background: var(--ec-featured-scene-bg) !important;
      border-color: var(--ec-featured-scene-border) !important;
    }
  `;

  const workbuddySurfaceOnlyCss = `
    html[data-codex-skin-studio] body {
      background: transparent !important;
    }
    html[data-codex-skin-studio] body > :is(#root, #app, [data-reactroot]) {
      position: relative !important;
      z-index: 1 !important;
    }
    html[data-codex-skin-studio] :is(#root, #app, [data-reactroot]) {
      background: transparent !important;
    }
    html[data-codex-skin-studio] [data-lingglow-chat-stage="true"] {
      background: transparent !important;
      border-color: transparent !important;
      box-shadow: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] [data-lingglow-chat-layer="true"] {
      background-color: transparent !important;
      background-image: none !important;
      border-color: transparent !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] [data-lingglow-chat-stage="true"]::before,
    html[data-codex-skin-studio] [data-lingglow-chat-stage="true"]::after,
    html[data-codex-skin-studio] [data-lingglow-chat-layer="true"]::before,
    html[data-codex-skin-studio] [data-lingglow-chat-layer="true"]::after {
      background: transparent !important;
      background-image: none !important;
      border-color: transparent !important;
      box-shadow: none !important;
      pointer-events: none !important;
    }
    html[data-codex-skin-studio] :is(
      .main-content,
      .automation-panel,
      .code-buddy-automation,
      .automation-main-page
    ) {
      background-color: transparent !important;
      background-image: none !important;
    }
    html[data-codex-skin-studio] .main-content.main-content--chat {
      background: transparent !important;
      filter: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] .main-content.main-content--chat [data-lingglow-chat-stage="true"],
    html[data-codex-skin-studio] .main-content.main-content--chat > *,
    html[data-codex-skin-studio] .main-content.main-content--chat .chat-container,
    html[data-codex-skin-studio] .main-content.main-content--chat .wb-cb-chat,
    html[data-codex-skin-studio] .main-content.main-content--chat [class*="_chatMessageBox_"],
    html[data-codex-skin-studio] .main-content.main-content--chat section[class*="_container_"] {
      background: transparent !important;
      box-shadow: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    /* WorkBuddy 5.3.5 moved each timeline row through these two CSS-module
       wrappers. They are layout layers, not cards: leaving either native
       background in place produces a solid shared sheet over the wallpaper. */
    html[data-codex-skin-studio] .wb-cb-chat :is(
      [class^="_chatMessageContainer_"],
      [class*=" _chatMessageContainer_"],
      [class^="_chatMessage_"],
      [class*=" _chatMessage_"]
    ) {
      background-color: transparent !important;
      background-image: none !important;
      border-color: transparent !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat :is(
      [class^="_chatMessageContainer_"],
      [class*=" _chatMessageContainer_"],
      [class^="_chatMessage_"],
      [class*=" _chatMessage_"]
    )::before,
    html[data-codex-skin-studio] .wb-cb-chat :is(
      [class^="_chatMessageContainer_"],
      [class*=" _chatMessageContainer_"],
      [class^="_chatMessage_"],
      [class*=" _chatMessage_"]
    )::after {
      background: transparent !important;
      background-image: none !important;
      border-color: transparent !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] .main-content.main-content--chat :is(
      textarea,
      input,
      [contenteditable="true"],
      .team-member-bar-scroll,
      [class*="_inputArea_"],
      [class*="_textarea_"],
      [class*="_editor_"]
    ) {
      background: transparent !important;
      background-image: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] .main-content.main-content--chat::before,
    html[data-codex-skin-studio] .main-content.main-content--chat::after,
    html[data-codex-skin-studio] .main-content.main-content--chat [data-lingglow-workbuddy-composer="true"]::before,
    html[data-codex-skin-studio] .main-content.main-content--chat [data-lingglow-workbuddy-composer="true"] [class*="_mainArea_"]::before,
    html[data-codex-skin-studio] .main-content.main-content--chat [data-lingglow-workbuddy-composer="true"] [class*="_mainArea_"]::after {
      background: transparent !important;
      background-image: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] .main-content.main-content--chat :is(.chat-container, .wb-cb-chat) {
      background: transparent !important;
      border-color: transparent !important;
      border-radius: 0 !important;
      color: ${ink} !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      overflow: visible !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat :is(
      [class*="_assistantMessageContent_"],
      [class*="_assistantTextContent_"],
      [class*="_userMessageText_"],
      [class*="_metaFold_"],
      .cb-markdown
    ),
    html[data-codex-skin-studio] .wb-cb-chat :is(
      [class*="_assistantMessageContent_"],
      [class*="_assistantTextContent_"],
      [class*="_userMessageText_"],
      [class*="_metaFold_"],
      .cb-markdown
    ) :where(p, span, li, td, th, label, h1, h2, h3, h4, blockquote) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat table {
      border-collapse: separate !important;
      border-spacing: 0 !important;
      border: 1px solid rgba(${inkRgb}, 0.14) !important;
      border-radius: 14px !important;
      background: rgba(${surfaceRgb}, 0.66) !important;
      color: ${ink} !important;
      overflow: hidden !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat :is(th, td) {
      border-color: rgba(${inkRgb}, 0.12) !important;
      background: transparent !important;
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat th {
      background: rgba(${accentRgb}, 0.10) !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat :is(code, pre) {
      border-radius: 8px !important;
      background: rgba(${surfaceRgb}, 0.46) !important;
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
    }
    /* The semantic input-area marker is the only history-composer glass
       frame. A CSS-module name such as _mainArea_ also appears in unrelated
       WorkBuddy views, so it must never create a frame by itself. */
    html[data-codex-skin-studio] .main-content.main-content--chat [data-lingglow-workbuddy-composer="true"] {
      background: rgba(${surfaceRgb}, 0.58) !important;
      border: 1px solid rgba(${accentRgb}, 0.26) !important;
      border-radius: 20px !important;
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.12) !important;
      backdrop-filter: blur(14px) saturate(1.12) !important;
      -webkit-backdrop-filter: blur(14px) saturate(1.12) !important;
    }
    html[data-codex-skin-studio] .main-content.main-content--chat [data-lingglow-workbuddy-composer="true"] :is(
      [class*="_mainArea_"],
      [class*="_inputArea_"],
      [class*="_textarea_"],
      [class*="_editor_"]
    ) {
      background-color: transparent !important;
      background-image: none !important;
      border: 0 !important;
      border-radius: 0 !important;
      outline: 0 !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat [class*="_userMessageText_"] {
      background: rgba(${surfaceRgb}, 0.58) !important;
      border: 1px solid rgba(${accentRgb}, 0.30) !important;
      border-radius: 12px !important;
      padding: 8px 12px !important;
      box-shadow: 0 7px 20px rgba(0, 0, 0, 0.12) !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat [class*="_userMessageText_"] :is(.phrase-content-wrapper, [class*="_tag_"]) {
      background: rgba(${inkRgb}, 0.10) !important;
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      border-radius: 6px !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat .team-member-bar-scroll > button {
      background: rgba(${surfaceRgb}, 0.64) !important;
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      border: 1px solid rgba(${accentRgb}, 0.34) !important;
      box-shadow: 0 5px 16px rgba(0, 0, 0, 0.10) !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat .team-member-bar-scroll > button :where(*) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat .team-member-bar-slot {
      background: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] .team-member-bar-slot::before,
    html[data-codex-skin-studio] .vscode-dark .team-member-bar-slot::before,
    html[data-codex-skin-studio] .vscode-high-contrast .team-member-bar-slot::before {
      background: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat .team-member-bar-slot::after,
    html[data-codex-skin-studio].vscode-dark .wb-cb-chat .team-member-bar-slot::after,
    html[data-codex-skin-studio].vscode-high-contrast .wb-cb-chat .team-member-bar-slot::after {
      background: linear-gradient(to right, transparent, rgba(${surfaceRgb}, 0.34)) !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat .team-member-bar-slot__fade-left,
    html[data-codex-skin-studio].vscode-dark .wb-cb-chat .team-member-bar-slot__fade-left,
    html[data-codex-skin-studio].vscode-high-contrast .wb-cb-chat .team-member-bar-slot__fade-left {
      background: linear-gradient(to left, transparent, rgba(${surfaceRgb}, 0.34)) !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat [class*="_modelSelectorTrigger_"] {
      background: rgba(${surfaceRgb}, 0.34) !important;
      background-image: none !important;
      border: 1px solid transparent !important;
      border-radius: 999px !important;
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat [class*="_modelSelectorTrigger_"]:is(:hover, :focus-visible, [aria-expanded="true"]) {
      background: rgba(${surfaceRgb}, 0.56) !important;
      background-image: none !important;
      border-color: rgba(${accentRgb}, 0.34) !important;
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      box-shadow: 0 5px 16px rgba(0, 0, 0, 0.10) !important;
    }
    html[data-codex-skin-studio] .wb-cb-chat [class*="_modelSelectorTrigger_"] :where(*) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] :is([role="listbox"], [role="menu"]) {
      --cb-text-primary: ${nativeRoleValues.textPrimary} !important;
      --cb-text-secondary: ${nativeRoleValues.textSecondary} !important;
      --color-text-primary: ${nativeRoleValues.textPrimary} !important;
      --color-text-secondary: ${nativeRoleValues.textSecondary} !important;
      background: ${nativeRoleValues.dropdown} !important;
      background-image: none !important;
      border-color: ${nativeRoleValues.borderDefault} !important;
      color: ${nativeRoleValues.textPrimary} !important;
      -webkit-text-fill-color: ${nativeRoleValues.textPrimary} !important;
      box-shadow: ${nativeRoleValues.cardShadow} !important;
    }
    html[data-codex-skin-studio] :is([role="listbox"], [role="menu"]) {
      border-radius: 14px !important;
      overflow: hidden !important;
    }
    html[data-codex-skin-studio] :is([role="listbox"], [role="menu"]) :where(p, span, label, div, button) {
      color: ${nativeRoleValues.textPrimary} !important;
      -webkit-text-fill-color: ${nativeRoleValues.textPrimary} !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] [class*="_topRightSlotStandalone_"] {
      background: transparent !important;
      background-image: none !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      overflow: visible !important;
    }
    html[data-codex-skin-studio] [class*="_topRightSlotStandalone_"] img[alt=""] {
      display: ${composerAvatarEnabled ? "none" : "block"} !important;
      visibility: ${composerAvatarEnabled ? "hidden" : "visible"} !important;
      opacity: ${composerAvatarEnabled ? "0" : "1"} !important;
      z-index: 3 !important;
      mix-blend-mode: normal !important;
    }
    html[data-codex-skin-studio] [class*="_topRightSlotStandalone_"] img[alt=""]:not([data-lingglow-custom-avatar="true"]) {
      filter: brightness(1.18) contrast(1.08) drop-shadow(0 8px 16px rgba(0, 0, 0, 0.32)) !important;
    }
    html[data-codex-skin-studio] [class*="_topRightSlotStandalone_"] img[data-lingglow-custom-avatar="true"] {
      object-fit: contain !important;
      object-position: center !important;
      border-radius: 0 !important;
      border: 0 !important;
      box-shadow: none !important;
      background: transparent !important;
      background-image: none !important;
      pointer-events: none !important;
    }
    html[data-codex-skin-studio] [class*="_topRightSlotStandalone_"]:has(img[data-lingglow-custom-avatar="true"]) :is(video, canvas) {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    html[data-codex-skin-studio] [class*="_topRightSlotStandalone_"]:has(img[data-lingglow-custom-avatar="true"]) img[data-lingglow-custom-avatar="true"] {
      position: relative !important;
      z-index: 5 !important;
    }
    html[data-codex-skin-studio] [data-lingglow-activity-notice="true"] {
      background: linear-gradient(145deg, rgba(${surfaceRgb}, 0.98), rgba(${surfaceRgb}, 0.90)) !important;
      border: 1px solid rgba(${accentRgb}, 0.46) !important;
      border-radius: 18px !important;
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.34) !important;
      backdrop-filter: blur(20px) saturate(1.16) !important;
      -webkit-backdrop-filter: blur(20px) saturate(1.16) !important;
    }
    html[data-codex-skin-studio] [data-lingglow-activity-notice="true"],
    html[data-codex-skin-studio] [data-lingglow-activity-notice="true"] :where(*) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] [data-lingglow-activity-notice="true"] button:not([aria-label="关闭活动通知"]) {
      background: rgba(${surfaceRgb}, 0.96) !important;
      border: 1px solid rgba(${accentRgb}, 0.70) !important;
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.20) !important;
    }
    html[data-codex-skin-studio] [data-lingglow-activity-notice-wrap="true"]::before,
    html[data-codex-skin-studio] [data-lingglow-activity-notice-wrap="true"]::after {
      color: rgba(${surfaceRgb}, 0.96) !important;
      border-top-color: rgba(${surfaceRgb}, 0.96) !important;
      border-bottom-color: rgba(${surfaceRgb}, 0.96) !important;
    }
    html[data-codex-skin-studio] :is(.automation-panel, .code-buddy-automation, .automation-main-page) {
      --atm-surface: rgba(${surfaceRgb}, 0.50) !important;
      --atm-surface-muted: rgba(${surfaceRgb}, 0.38) !important;
      --atm-surface-subtle: rgba(${surfaceRgb}, 0.30) !important;
      --atm-surface-soft: rgba(${surfaceRgb}, 0.44) !important;
      --atm-surface-hover: rgba(${accentRgb}, 0.10) !important;
      --atm-surface-active: rgba(${accentRgb}, 0.16) !important;
      --atm-template-card-bg: rgba(${surfaceRgb}, 0.50) !important;
      --atm-template-card-bg-hover: rgba(${surfaceRgb}, 0.64) !important;
      --atm-text-primary: ${ink} !important;
      --atm-text-secondary: rgba(${inkRgb}, 0.74) !important;
      --atm-text-tertiary: rgba(${inkRgb}, 0.62) !important;
      --atm-text-muted: rgba(${inkRgb}, 0.56) !important;
      --atm-text-subtle: rgba(${inkRgb}, 0.68) !important;
      --atm-text-strong: ${ink} !important;
      --atm-text-placeholder: rgba(${inkRgb}, 0.48) !important;
      --atm-border: rgba(${inkRgb}, 0.14) !important;
      --atm-border-secondary: rgba(${inkRgb}, 0.12) !important;
      --cb-content-background: transparent !important;
      --cb-main-area-background: transparent !important;
      --cb-bg-color-container: rgba(${surfaceRgb}, 0.50) !important;
      --cb-text-primary: ${ink} !important;
      --cb-text-secondary: rgba(${inkRgb}, 0.72) !important;
      background: transparent !important;
      color: ${ink} !important;
      border-color: transparent !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] :is(.automation-panel, .code-buddy-automation, .automation-main-page) :where(h1, h2, h3, h4, p, span, label, button) {
      color: ${ink} !important;
      -webkit-text-fill-color: ${ink} !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] :is(.atm-empty-state, .atm-empty-state-hero, .atm-empty-state-templates) {
      background: transparent !important;
      background-image: none !important;
      border-color: transparent !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-codex-skin-studio] :is(.atm-template-card, .atm-row, .atm-detail-page, .atm-modal) {
      border-color: rgba(${inkRgb}, 0.14) !important;
      border-radius: 14px !important;
      background: rgba(${surfaceRgb}, 0.50) !important;
      color: ${ink} !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08) !important;
      backdrop-filter: blur(10px) saturate(1.08) !important;
      -webkit-backdrop-filter: blur(10px) saturate(1.08) !important;
    }
    html[data-codex-skin-studio] :is(
      [data-lingglow-semantic-popup="true"],
      .user-menu-popover,
      .user-menu-submenu,
      .user-menu-panel,
      .user-menu-dropdown,
      .profile-menu-popover,
      .profile-menu-dropdown
    ) {
      background: ${nativeRoleValues.dropdown} !important;
      color: ${nativeRoleValues.textPrimary} !important;
      border: 1px solid ${nativeRoleValues.borderDefault} !important;
      box-shadow: ${nativeRoleValues.cardShadow} !important;
      backdrop-filter: blur(20px) saturate(1.16) !important;
      -webkit-backdrop-filter: blur(20px) saturate(1.16) !important;
    }
    html[data-codex-skin-studio] :is(
      [data-lingglow-semantic-popup="true"],
      .user-menu-popover,
      .user-menu-submenu,
      .user-menu-panel,
      .user-menu-dropdown,
      .profile-menu-popover,
      .profile-menu-dropdown
    ) :where(button, a, p, span, label, h1, h2, h3, small) {
      color: ${nativeRoleValues.textPrimary} !important;
      -webkit-text-fill-color: ${nativeRoleValues.textPrimary} !important;
      opacity: 1 !important;
      text-shadow: none !important;
    }
    html[data-codex-skin-studio] .user-menu-popover :is(
      .daily-checkin-info,
      .daily-checkin-actions,
      .account-panel__credits-section,
      .account-panel__plan-card
    ) {
      background: ${nativeRoleValues.surfaceElevated} !important;
      border-color: ${nativeRoleValues.borderDefault} !important;
      color: ${nativeRoleValues.textPrimary} !important;
    }
    html[data-codex-skin-studio] .user-menu-popover :is(
      .daily-checkin-info,
      .daily-checkin-actions,
      .account-panel__credits-section,
      .account-panel__plan-card
    ) :where(p, span, label, strong, small, div) {
      color: ${nativeRoleValues.textPrimary} !important;
      -webkit-text-fill-color: ${nativeRoleValues.textPrimary} !important;
      opacity: 1 !important;
      text-shadow: none !important;
    }
    html[data-codex-skin-studio] .user-menu-popover :is(.daily-checkin-divider, .account-panel__plan-divider) {
      border-color: ${nativeRoleValues.borderDefault} !important;
      background-color: ${nativeRoleValues.borderDefault} !important;
    }
    html[data-codex-skin-studio] .user-menu-popover .daily-checkin-btn-primary:not(.is-claimed) {
      background: ${accent} !important;
      border-color: ${accent} !important;
      color: ${accentInk} !important;
      -webkit-text-fill-color: ${accentInk} !important;
    }
    html[data-codex-skin-studio] .user-menu-popover :is(.daily-checkin-btn-primary.is-claimed, .daily-checkin-btn-secondary) {
      background: ${nativeRoleValues.buttonBackground} !important;
      border-color: ${nativeRoleValues.borderDefault} !important;
      color: ${nativeRoleValues.textPrimary} !important;
      -webkit-text-fill-color: ${nativeRoleValues.textPrimary} !important;
      opacity: 1 !important;
    }
    html[data-codex-skin-studio] :is(.user-menu-popover, .user-menu-submenu, .user-menu-panel, .user-menu-dropdown) :where(
      .user-menu-header-name,
      .user-menu-item-label,
      .user-menu-item-value,
      .user-menu-section-title,
      .user-menu-plan-name,
      .user-menu-plan-description
    ) {
      background: transparent !important;
      background-image: none !important;
      border: 0 !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-expert-card {
      background: var(--ec-expert-card-bg, var(--ec-card-bg)) !important;
      border: 1px solid rgba(${accentRgb}, 0.42) !important;
      box-shadow: var(--ec-expert-card-shadow, var(--ec-card-shadow)) !important;
      backdrop-filter: blur(12px) saturate(1.08) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-expert-card:hover {
      background: var(--ec-expert-card-hover-bg, var(--ec-expert-card-bg, var(--ec-card-bg))) !important;
      border-color: var(--ec-expert-card-hover-border, rgba(${accentRgb}, 0.78)) !important;
      box-shadow: var(--ec-card-shadow-hover, var(--ec-expert-card-shadow)) !important;
    }
    html[data-codex-skin-studio] :is(.expert-center-light, .expert-center-dark) .ec-featured-scene-card {
      border-color: var(--ec-featured-scene-border, rgba(${accentRgb}, 0.34)) !important;
      box-shadow: var(--ec-card-shadow) !important;
    }
  `;

  const textSurfaceResetCss = `
    html[data-codex-skin-studio] :where(h1, h2, h3, h4, h5, h6, p, label, legend, figcaption),
    html[data-codex-skin-studio] [data-lingglow-plain-text-surface="true"] {
      background-color: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
    }
    html[data-codex-skin-studio] :where(input, textarea, [contenteditable="true"], [role="textbox"]) {
      background-color: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
    }
  `;
  const clientCss = client === "workbuddy" ? workbuddySurfaceOnlyCss : client === "doubao" ? doubaoCss : client === "codex" ? codexCss : "";
  style.textContent = nativeTokenCss + clientCss + textSurfaceResetCss;
  (document.head || document.documentElement).appendChild(style);

  window.__lingglowBackgroundCanvasCleanup?.();
  if ((client === "codex" || client === "workbuddy") && backgroundImage && document.body) {
    const canvas = document.createElement("canvas");
    canvas.id = "__lingglow_background_canvas__";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "0",
      pointerEvents: "none",
    });
    document.body.prepend(canvas);

    let bitmap = null;
    let disposed = false;
    const paint = () => {
      if (!bitmap || disposed) return;
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d", {alpha: false});
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = surface;
      context.fillRect(0, 0, width, height);
      const scale = Math.max(width / bitmap.width, height / bitmap.height);
      const drawWidth = bitmap.width * scale;
      const drawHeight = bitmap.height * scale;
      context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    };
    const onResize = () => paint();
    window.addEventListener("resize", onResize, {passive: true});
    window.__lingglowBackgroundCanvasCleanup = () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      bitmap?.close?.();
      canvas.remove();
      delete window.__lingglowBackgroundCanvasCleanup;
    };

    try {
      const separator = backgroundImage.indexOf(",");
      const header = backgroundImage.slice(0, separator);
      const mime = header.match(/^data:([^;,]+)/)?.[1] || "image/webp";
      const payload = backgroundImage.slice(separator + 1);
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      createImageBitmap(new Blob([bytes], {type: mime})).then((decoded) => {
        if (disposed) {
          decoded.close?.();
          return;
        }
        bitmap = decoded;
        paint();
      }).catch(() => {});
    } catch {}
  }

  let observer = null;
  let doubaoObserver = null;
  let doubaoResizeObserver = null;
  let navHandler = null;
  let backdropRule = null;
  let originalBackdrop = "";
  let originalThemeMode = null;
  let originalDataTheme = null;
  let runtimeResizeHandler = null;
  let runtimeVisibilityHandler = null;
  let runtimeScheduleTimer = null;
  let runtimeScheduleFrame = null;
  let runtimeScheduleUsesAnimationFrame = false;
  let doubaoStageScheduled = false;
  let doubaoStageScheduleHandle = null;
  const runtimeTimers = [];
  const setComposerMascotTravel = (anchor, mascotSize) => {
    if (!(anchor instanceof HTMLElement)) return;
    const width = anchor.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width < mascotSize + 36) return;
    const travel = -Math.max(0, Math.round(width - mascotSize - 36));
    const values = {
      "--lingglow-mascot-quarter-travel-x": `${Math.round(travel * 0.25)}px`,
      "--lingglow-mascot-half-travel-x": `${Math.round(travel * 0.5)}px`,
      "--lingglow-mascot-three-quarter-travel-x": `${Math.round(travel * 0.75)}px`,
      "--lingglow-mascot-travel-x": `${travel}px`,
    };
    for (const [name, value] of Object.entries(values)) {
      if (anchor.style.getPropertyValue(name) !== value) anchor.style.setProperty(name, value);
    }
  };
  const clearComposerMascotTravel = (anchor) => {
    if (!(anchor instanceof HTMLElement)) return;
    for (const name of [
      "--lingglow-mascot-quarter-travel-x",
      "--lingglow-mascot-half-travel-x",
      "--lingglow-mascot-three-quarter-travel-x",
      "--lingglow-mascot-travel-x",
    ]) anchor.style.removeProperty(name);
  };
  const themeRoot = document.documentElement;
  const themeRootConfig = nativeTheme?.root || {};
  const themeBody = document.body;
  const themeBodyConfig = nativeTheme?.body || {};
  const themeAttributes = themeRootConfig.attributes || {};
  const themeClasses = themeRootConfig.classes || {add: [], remove: []};
  const originalThemeAttributes = new Map(Object.keys(themeAttributes).map((name) => [name, themeRoot.getAttribute(name)]));
  const originalThemeClasses = new Map([...themeClasses.add, ...themeClasses.remove].map((name) => [name, themeRoot.classList.contains(name)]));
  const originalColorScheme = themeRoot.style.colorScheme;
  const bodyAttributes = themeBodyConfig.attributes || {};
  const bodyClasses = themeBodyConfig.classes || {add: [], remove: []};
  const originalBodyAttributes = new Map(Object.keys(bodyAttributes).map((name) => [name, themeBody?.getAttribute(name) ?? null]));
  const originalBodyClasses = new Map([...bodyClasses.add, ...bodyClasses.remove].map((name) => [name, themeBody?.classList.contains(name) ?? false]));
  const originalBodyColorScheme = themeBody?.style.colorScheme || "";
  const applyRootThemeLock = () => {
    for (const [name, value] of Object.entries(themeAttributes)) {
      if (themeRoot.getAttribute(name) !== value) themeRoot.setAttribute(name, value);
    }
    for (const name of themeClasses.add || []) {
      if (!themeRoot.classList.contains(name)) themeRoot.classList.add(name);
    }
    for (const name of themeClasses.remove || []) {
      if (themeRoot.classList.contains(name)) themeRoot.classList.remove(name);
    }
    if (themeRootConfig.colorScheme && themeRoot.style.colorScheme !== themeRootConfig.colorScheme) {
      themeRoot.style.colorScheme = themeRootConfig.colorScheme;
    }
    if (themeBody) {
      for (const [name, value] of Object.entries(bodyAttributes)) {
        if (themeBody.getAttribute(name) !== value) themeBody.setAttribute(name, value);
      }
      for (const name of bodyClasses.add || []) themeBody.classList.add(name);
      for (const name of bodyClasses.remove || []) themeBody.classList.remove(name);
      if (themeBodyConfig.colorScheme) themeBody.style.colorScheme = themeBodyConfig.colorScheme;
    }
  };
  const restoreRootTheme = () => {
    for (const [name, value] of originalThemeAttributes) {
      if (value === null) themeRoot.removeAttribute(name);
      else themeRoot.setAttribute(name, value);
    }
    for (const [name, enabled] of originalThemeClasses) themeRoot.classList.toggle(name, enabled);
    themeRoot.style.colorScheme = originalColorScheme;
    if (themeBody) {
      for (const [name, value] of originalBodyAttributes) {
        if (value === null) themeBody.removeAttribute(name);
        else themeBody.setAttribute(name, value);
      }
      for (const [name, enabled] of originalBodyClasses) themeBody.classList.toggle(name, enabled);
      themeBody.style.colorScheme = originalBodyColorScheme;
    }
  };
  applyRootThemeLock();

  const syncPlainTextSurfaces = () => {
    document.querySelectorAll("[data-lingglow-plain-text-surface]").forEach((node) => {
      delete node.dataset.lingglowPlainTextSurface;
    });
    const reservedSurface = /(?:badge|chip|pill|tag|status|button|btn|tab|option|menu|selected|active|alert|warning|error|bubble|message|card|input|field|control|switch|hero|banner|cover|image|media|toolbar|sidebar|navigation)/iu;
    let inspected = 0;
    for (const node of document.querySelectorAll("header, section, div, span, strong, small")) {
      if (!(node instanceof HTMLElement) || ++inspected > 6000) break;
      const text = (node.innerText || node.textContent || "").trim();
      const rect = node.getBoundingClientRect();
      const className = typeof node.className === "string" ? node.className : "";
      if (!text || text.length > 240 || rect.width < 4 || rect.height < 4 || rect.height > 112 || reservedSurface.test(className)) continue;
      if (node.closest('button, a, [role="button"], [role="tab"], [role="option"], [role="menuitem"]')) continue;
      if (node.querySelector('input, textarea, button, a, img, picture, video, canvas, svg, table, pre, code, [contenteditable="true"], [role="button"]')) continue;
      if (node.querySelectorAll("*").length > 6) continue;
      const computed = getComputedStyle(node);
      const color = computed.backgroundColor.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:[, /]+\s*([\d.]+))?\s*\)/iu);
      const alpha = color ? (color[4] === undefined ? 1 : Number(color[4])) : 0;
      if (alpha > 0.06 || computed.backgroundImage !== "none" || computed.boxShadow !== "none") {
        node.dataset.lingglowPlainTextSurface = "true";
      }
    }
  };

  if (client === "workbuddy") {
    originalThemeMode = document.documentElement.getAttribute("theme-mode");
    originalDataTheme = document.documentElement.getAttribute("data-theme");
    let scheduled = false;
    // Conversation bodies live under the same chat root as the landing page, so
    // the headline scan has to stay out of rendered messages: their prose uses
    // the very words the landing copy is matched on.
    const homeCopyMessageScope = '[class*="_chatMessageBox_"], [class*="_assistantMessageContent_"], [class*="_assistantTextContent_"], [class*="_userMessageText_"], .cb-markdown';
    const syncWorkbuddyHomeCopy = () => {
      const replacements = [
        {kind: "title", original: "WorkBuddy", value: homeDisplayName},
        {kind: "subtitle", original: "你的职场超能力", value: homeTagline},
      ];
      for (const replacement of replacements) {
        if (!replacement.value) continue;
        for (const node of document.querySelectorAll('h1, h2, h3, p, [class*="_title_"], [class*="_subtitle_"], span, div')) {
          if (node.children.length > 0) continue;
          const currentKind = node.dataset.lingglowHomeCopy;
          const currentText = (node.textContent || "").trim();
          // Only a short decorated headline counts as the same original; the
          // subtitle has to match exactly.
          const compatibleOriginal = replacement.kind === "title" &&
            currentText.length <= 24 && /WorkBuddy$/iu.test(currentText);
          if (currentKind !== replacement.kind && currentText !== replacement.original && !compatibleOriginal) continue;
          if (node.closest(homeCopyMessageScope)) continue;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || rect.left < Math.min(240, window.innerWidth * 0.20) ||
              rect.top < 72 || rect.top > window.innerHeight * 0.72) continue;
          if (!node.hasAttribute("data-lingglow-original-home-copy")) {
            node.dataset.lingglowOriginalHomeCopy = node.textContent || replacement.original;
          }
          node.dataset.lingglowHomeCopy = replacement.kind;
          if (node.textContent !== replacement.value) node.textContent = replacement.value;
          break;
        }
      }
    };
    const syncWorkbuddyComposerAvatar = () => {
      // WorkBuddy 5.3.5 uses the same toolbar contract on both its landing
      // composer and history conversations. Keep a stationary skin mascot on
      // the landing composer, while only history conversations receive the
      // travelling mascot. The two route states intentionally use different
      // semantic anchors so a future selector drift cannot merge them again.
      const historyComposers = new Set();
      const landingComposers = new Set();
      const composerEditorSelector = [
        'textarea',
        'input:not([type="hidden"])',
        '[contenteditable="true"]',
        '[role="textbox"]',
      ].join(', ');
      const isRenderedComposerNode = (node) => {
        if (!(node instanceof HTMLElement) || !node.isConnected || node.hidden ||
            node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          style.visibility !== 'collapse' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const isComposerRegion = (node) => {
        if (!isRenderedComposerNode(node)) return false;
        const rect = node.getBoundingClientRect();
        if (rect.width < 180 || rect.height < 36 ||
            rect.height > Math.max(360, window.innerHeight * 0.42)) return false;
        return [...node.querySelectorAll(composerEditorSelector)].some(isRenderedComposerNode);
      };
      document.querySelectorAll('.wb-home-composer .wb-home-composer__input-slot').forEach((composer) => {
        if (isComposerRegion(composer)) {
          landingComposers.add(composer);
        }
      });
      document.querySelectorAll('.wb-cb-chat [data-cb-chat-input-toolbar-right="true"]').forEach((toolbar) => {
        // 5.3.5 exposes the stable input-area wrapper outside the hashed ChatInput
        // section. Prefer that exact region so a shared section/mainArea can never
        // become the rounded composer panel; retain the section only as a guarded
        // fallback for the older exact adapters.
        if (!isRenderedComposerNode(toolbar)) return;
        const exactInputArea = toolbar.closest('[class*="_input-area-container_"]');
        const legacySection = toolbar.closest('section[class*="_container_"]');
        const composer = isComposerRegion(exactInputArea) ? exactInputArea
          : isComposerRegion(legacySection) ? legacySection : null;
        const landingComposer = composer?.closest('.wb-home-composer, .wb-home-page');
        if (composer?.closest('.wb-cb-chat') && !landingComposer) {
          historyComposers.add(composer);
        }
      });
      document.querySelectorAll('[data-lingglow-workbuddy-composer="true"]').forEach((node) => {
        if (historyComposers.has(node)) return;
        delete node.dataset.lingglowWorkbuddyComposer;
        clearComposerMascotTravel(node);
      });
      document.querySelectorAll('[data-lingglow-workbuddy-landing-composer="true"]').forEach((node) => {
        if (landingComposers.has(node)) return;
        delete node.dataset.lingglowWorkbuddyLandingComposer;
      });
      historyComposers.forEach((composer) => {
        if (composer.dataset.lingglowWorkbuddyComposer !== "true") {
          composer.dataset.lingglowWorkbuddyComposer = "true";
        }
        setComposerMascotTravel(composer, 74);
      });
      landingComposers.forEach((composer) => {
        if (composer.dataset.lingglowWorkbuddyLandingComposer !== "true") {
          composer.dataset.lingglowWorkbuddyLandingComposer = "true";
        }
      });
      // The moving composer mascot is rendered once by compileSkin as a
      // pseudo-element. Older releases also replaced WorkBuddy's native DOM
      // image, which left a second mascot in the same slot. Restore any such
      // legacy mutation and keep the native asset hidden through CSS only.
      document.querySelectorAll('[data-lingglow-original-avatar-src]').forEach((image) => {
        image.setAttribute("src", image.dataset.lingglowOriginalAvatarSrc || "");
        if (image.dataset.lingglowOriginalAvatarSrcsetPresent === "true") {
          image.setAttribute("srcset", image.dataset.lingglowOriginalAvatarSrcset || "");
        } else {
          image.removeAttribute("srcset");
        }
        delete image.dataset.lingglowOriginalAvatarSrc;
        delete image.dataset.lingglowOriginalAvatarSrcset;
        delete image.dataset.lingglowOriginalAvatarSrcsetPresent;
        delete image.dataset.lingglowCustomAvatar;
      });
    };
    const rememberModelPopoverStyle = (node) => {
      if (!(node instanceof HTMLElement) || node.hasAttribute("data-lingglow-model-original-style")) return;
      node.dataset.lingglowModelHadStyle = node.hasAttribute("style") ? "true" : "false";
      node.dataset.lingglowModelOriginalStyle = node.getAttribute("style") || "";
    };
    const setModelPopoverStyle = (node, property, value) => {
      if (!(node instanceof HTMLElement) || !value) return;
      rememberModelPopoverStyle(node);
      node.style.setProperty(property, value, "important");
    };
    const popupColorChannels = (value) => {
      const match = String(value || "").match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/iu);
      if (!match) return null;
      return {r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4])};
    };
    const popupLuminance = (color) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const popupContrast = (foreground, background) => {
      if (!foreground || !background) return 21;
      const foregroundLuminance = popupLuminance(foreground);
      const backgroundLuminance = popupLuminance(background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    };
    const popupSurfaceSelector = [
      '[role="dialog"]',
      '[role="listbox"]',
      '[role="menu"]',
      '[role="tooltip"]',
      '[class*="_popover_"]',
      '[class*="_popup_"]',
      '[class*="_dropdown_"]',
      '[class*="_modal_"]',
      '[class*="_tooltip_"]',
      '[class*="_hovercard_"]',
      '[class*="_hoverCard_"]',
      '.user-menu-popover',
      '.user-menu-submenu',
      '.user-menu-panel',
      '.user-menu-dropdown',
      '.profile-menu-popover',
      '.profile-menu-dropdown',
      '[class*="subMenu" i]',
      '[class*="contextMenu" i]',
      '[class*="flyout" i]',
    ].join(", ");
    const syncWorkbuddySemanticPopovers = () => {
      const candidates = [...document.querySelectorAll(popupSurfaceSelector)];
      for (const popover of candidates) {
        if (!(popover instanceof HTMLElement) || popover.parentElement?.closest(popupSurfaceSelector)) continue;
        const rect = popover.getBoundingClientRect();
        if (rect.width < 72 || rect.height < 32 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) continue;
        const computed = getComputedStyle(popover);
        const role = popover.getAttribute("role");
        let positionedAncestor = popover.parentElement;
        while (positionedAncestor && !["absolute", "fixed"].includes(getComputedStyle(positionedAncestor).position)) {
          positionedAncestor = positionedAncestor.parentElement;
        }
        if (!role && computed.position !== "absolute" && computed.position !== "fixed" && !positionedAncestor) continue;

        popover.dataset.lingglowSemanticPopup = "true";
        setModelPopoverStyle(popover, "background", nativeRoleValues.dropdown);
        setModelPopoverStyle(popover, "color", nativeRoleValues.textPrimary);
        setModelPopoverStyle(popover, "border-color", nativeRoleValues.borderDefault);
        setModelPopoverStyle(popover, "box-shadow", nativeRoleValues.cardShadow);
        setModelPopoverStyle(popover, "--cb-text-primary", nativeRoleValues.textPrimary);
        setModelPopoverStyle(popover, "--cb-text-secondary", nativeRoleValues.textSecondary);
        setModelPopoverStyle(popover, "--color-text-primary", nativeRoleValues.textPrimary);
        setModelPopoverStyle(popover, "--color-text-secondary", nativeRoleValues.textSecondary);

        const popupBackground = popupColorChannels(getComputedStyle(popover).backgroundColor);
        let surfaced = 0;
        for (const surface of popover.querySelectorAll('div, article, form, header, footer, section, ul, ol')) {
          if (!(surface instanceof HTMLElement) || ++surfaced > 300) break;
          const surfaceRect = surface.getBoundingClientRect();
          if (surfaceRect.width < Math.max(120, rect.width * 0.48) || surfaceRect.height < 24) continue;
          const surfaceStyle = getComputedStyle(surface);
          const surfaceBackground = popupColorChannels(surfaceStyle.backgroundColor);
          if (!surfaceBackground || surfaceBackground.a <= 0.1 || surfaceStyle.backgroundImage !== "none") continue;
          const surfaceMismatch = workbuddyNativeTheme === "dark"
            ? popupLuminance(surfaceBackground) >= 0.70
            : popupLuminance(surfaceBackground) <= 0.24;
          if (!surfaceMismatch) continue;
          setModelPopoverStyle(surface, "background", nativeRoleValues.surfaceElevated);
          setModelPopoverStyle(surface, "color", nativeRoleValues.textPrimary);
          setModelPopoverStyle(surface, "border-color", nativeRoleValues.borderDefault);
          surface.dataset.lingglowPopupSurface = "true";
        }
        for (const separator of popover.querySelectorAll('hr, [role="separator"], [class*="divider"], [class*="Divider"], [class*="separator"], [class*="Separator"]')) {
          if (!(separator instanceof HTMLElement)) continue;
          setModelPopoverStyle(separator, "border-color", nativeRoleValues.borderDefault);
          setModelPopoverStyle(separator, "background-color", nativeRoleValues.borderDefault);
          separator.dataset.lingglowPopupSeparator = "true";
        }
        const effectivePopupBackground = (node) => {
          let current = node;
          for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
            const background = popupColorChannels(getComputedStyle(current).backgroundColor);
            if (background && background.a > 0.1) return background;
            if (current === popover) break;
          }
          return popupBackground;
        };
        const popupDarkInk = popupColorChannels("rgb(23, 23, 23)");
        const popupLightInk = popupColorChannels("rgb(247, 247, 245)");
        let inspected = 0;
        for (const node of popover.querySelectorAll("button, a, input, textarea, label, p, span, div")) {
          if (!(node instanceof HTMLElement) || ++inspected > 500) break;
          const text = (node.innerText || node.textContent || "").trim();
          if (!text || (node.children.length > 0 && !node.matches("button, a, label"))) continue;
          const nodeStyle = getComputedStyle(node);
          const foreground = popupColorChannels(nodeStyle.color);
          const contrastBackground = effectivePopupBackground(node);
          if (popupContrast(foreground, contrastBackground) >= 4.2) continue;
          const corrected = popupContrast(popupDarkInk, contrastBackground) >= popupContrast(popupLightInk, contrastBackground)
            ? "#171717"
            : "#F7F7F5";
          setModelPopoverStyle(node, "color", corrected);
          setModelPopoverStyle(node, "-webkit-text-fill-color", corrected);
          setModelPopoverStyle(node, "opacity", "1");
          node.dataset.lingglowPopupText = "true";
        }
      }
    };
    const syncWorkbuddyActivityNotice = () => {
      document.querySelectorAll("[data-lingglow-activity-notice], [data-lingglow-activity-notice-wrap]").forEach((node) => {
        delete node.dataset.lingglowActivityNotice;
        delete node.dataset.lingglowActivityNoticeWrap;
      });
      document.querySelectorAll('button[aria-label="关闭活动通知"]').forEach((closeButton) => {
        let card = closeButton.parentElement;
        for (let depth = 0; card && depth < 6; depth += 1, card = card.parentElement) {
          const style = getComputedStyle(card);
          const rect = card.getBoundingClientRect();
          if (style.backgroundImage !== "none" && rect.width >= 150 && rect.height >= 80) break;
        }
        if (!card) return;
        card.dataset.lingglowActivityNotice = "true";
        if (card.parentElement) card.parentElement.dataset.lingglowActivityNoticeWrap = "true";
      });
    };
    const syncNativeTheme = () => {
      scheduled = false;
      applyRootThemeLock();
      document.querySelectorAll(".expert-center-page, .expert-center-light, .expert-center-dark").forEach((root) => {
        if (!root.dataset.lingglowOriginalExpertTheme) {
          root.dataset.lingglowOriginalExpertTheme = root.classList.contains("expert-center-dark") ? "dark" : "light";
        }
        root.classList.toggle("expert-center-dark", workbuddyNativeTheme === "dark");
        root.classList.toggle("expert-center-light", workbuddyNativeTheme === "light");
      });
      const candidates = [...document.querySelectorAll("main, section, [role='main'], div")]
        .map((node) => ({node, rect: node.getBoundingClientRect()}))
        .filter(({rect}) => rect.left >= window.innerWidth * 0.14
          && rect.width >= window.innerWidth * 0.58
          && rect.height >= window.innerHeight * 0.68);
      candidates.sort((left, right) => (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height));
      const chatStage = candidates[0]?.node || null;
      document.querySelectorAll("[data-lingglow-chat-stage]").forEach((node) => {
        if (node !== chatStage) delete node.dataset.lingglowChatStage;
      });
      document.querySelectorAll("[data-lingglow-chat-layer]").forEach((node) => delete node.dataset.lingglowChatLayer);
      if (chatStage) {
        chatStage.dataset.lingglowChatStage = "true";
        const stageRect = chatStage.getBoundingClientRect();
        const minimumArea = stageRect.width * stageRect.height * 0.42;
        for (const node of chatStage.querySelectorAll("*")) {
          const rect = node.getBoundingClientRect();
          if (rect.width * rect.height >= minimumArea
              && rect.width >= stageRect.width * 0.62
              && rect.height >= stageRect.height * 0.62) {
            node.dataset.lingglowChatLayer = "true";
          }
        }
      }
      syncWorkbuddyComposerAvatar();
      syncWorkbuddyHomeCopy();
      syncWorkbuddyActivityNotice();
      syncWorkbuddySemanticPopovers();
      markLightSurfaces();
      syncPlainTextSurfaces();
    };
    const markLightSurfaces = () => {
      scheduled = false;
      const nodes = document.querySelectorAll("main, [role='main'], section, article, div, a, button, input, textarea");
      let seen = 0;
      for (const node of nodes) {
        if (++seen > 5000) break;
        const rect = node.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 18) {
          delete node.dataset.lingglowLightSurface;
          continue;
        }
        const match = getComputedStyle(node).backgroundColor.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:[, /]+\s*([\d.]+))?\s*\)/i);
        if (!match) continue;
        const red = Number(match[1]);
        const green = Number(match[2]);
        const blue = Number(match[3]);
        const alpha = match[4] === undefined ? 1 : Number(match[4]);
        const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        if (alpha >= 0.68 && luminance >= 0.78) node.dataset.lingglowLightSurface = "true";
        else delete node.dataset.lingglowLightSurface;
      }

      const parseColor = (value) => {
        const match = String(value || "").match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:[, /]+\s*([\d.]+))?\s*\)/i);
        if (!match) return null;
        const red = Number(match[1]);
        const green = Number(match[2]);
        const blue = Number(match[3]);
        return {
          alpha: match[4] === undefined ? 1 : Number(match[4]),
          luminance: (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255,
        };
      };
      const hasLightBackdrop = (start) => {
        let current = start;
        for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
          if (current.dataset?.lingglowLightSurface === "true") return true;
          for (const pseudo of [null, "::before", "::after"]) {
            const color = parseColor(getComputedStyle(current, pseudo).backgroundColor);
            if (color && color.alpha >= 0.55) return color.luminance >= 0.76;
          }
        }
        return false;
      };
      const textNodes = document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, span, a, button, label, strong, small, div");
      let textSeen = 0;
      for (const node of textNodes) {
        if (++textSeen > 6000) break;
        const hasOwnText = Array.from(node.childNodes).some((child) =>
          child.nodeType === Node.TEXT_NODE && child.textContent.trim());
        if (!hasOwnText) {
          delete node.dataset.lingglowContrastText;
          continue;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) {
          delete node.dataset.lingglowContrastText;
          continue;
        }
        const foreground = parseColor(getComputedStyle(node).color);
        if (foreground && foreground.alpha > 0.2 && foreground.luminance >= 0.72 && hasLightBackdrop(node)) {
          node.dataset.lingglowContrastText = "dark";
        } else {
          delete node.dataset.lingglowContrastText;
        }
      }
      const setCardSurface = (container, textElement) => {
        if (!container || !textElement) return;
        const foreground = parseColor(getComputedStyle(textElement).color);
        container.dataset.lingglowCardSurface = foreground && foreground.luminance < 0.56 ? "light" : "dark";
      };
      document.querySelectorAll(".expert-center-light .ec-card-title-row, .expert-center-light .ec-card-role-wrap").forEach((container) => {
        setCardSurface(container, container.querySelector(".ec-card-role, .ec-card-name, [class*='title']") || container);
      });
      document.querySelectorAll(".expert-center-light .ec-search-wrapper .wb-input-wrapper").forEach((container) => {
        setCardSurface(container, container.querySelector("input") || container);
      });
      document.querySelectorAll(".expert-center-light .ec-featured-scene-card").forEach((card) => {
        setCardSurface(card.querySelector(".ec-featured-scene-overlay"), card.querySelector(".ec-featured-scene-name"));
      });
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      runtimeScheduleTimer = setTimeout(() => {
        runtimeScheduleTimer = null;
        const run = () => {
          runtimeScheduleFrame = null;
          if (document.hidden === true || document.visibilityState === "hidden") {
            scheduled = false;
            return;
          }
          syncNativeTheme();
        };
        runtimeScheduleUsesAnimationFrame = typeof requestAnimationFrame === "function";
        runtimeScheduleFrame = runtimeScheduleUsesAnimationFrame
          ? requestAnimationFrame(run)
          : setTimeout(run, 0);
      }, 120);
    };
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "theme-mode", "data-theme", "src", "srcset"] });
    runtimeResizeHandler = schedule;
    window.addEventListener?.("resize", runtimeResizeHandler);
    schedule();
    runtimeTimers.push(setTimeout(schedule, 500), setTimeout(schedule, 1500));
  }

  if (client === "codex" || client === "doubao") {
    let scheduled = false;
    const syncDoubaoComposerAvatar = () => {
      if (client !== "doubao") return;
      // Keep the chosen wrapper stable while Doubao streams a response. The
      // previous implementation removed and re-added this attribute on every
      // mutation, which recreated the ::after animation at frame zero so the
      // mascot looked fixed even though valid traversal keyframes existed.
      const desiredWrappers = new Set();
      const currentWrappers = [...document.querySelectorAll('[data-lingglow-doubao-composer="true"]')];
      document.querySelectorAll('#chat-route-main [data-testid="chat_input"]').forEach((input) => {
        if (!(input instanceof HTMLElement) || input.getClientRects().length === 0) return;
        // The input element owns Doubao's native ::after border. Attach the
        // mascot to its full-width parent instead, keeping the two effects
        // independent while preserving the same horizontal travel distance.
        const wrapper = currentWrappers.find((candidate) => candidate.contains(input)) || input.parentElement;
        if (!(wrapper instanceof HTMLElement) || !wrapper.closest('#chat-route-main')) return;
        const inputRect = input.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        if (wrapperRect.width + 2 < inputRect.width || wrapperRect.width < 240) return;
        desiredWrappers.add(wrapper);
      });
      document.querySelectorAll('[data-lingglow-doubao-composer="true"]').forEach((node) => {
        if (desiredWrappers.has(node)) return;
        delete node.dataset.lingglowDoubaoComposer;
        clearComposerMascotTravel(node);
      });
      desiredWrappers.forEach((wrapper) => {
        if (wrapper.dataset.lingglowDoubaoComposer !== "true") {
          wrapper.dataset.lingglowDoubaoComposer = "true";
        }
        setComposerMascotTravel(wrapper, 78);
      });
    };
    const syncDoubaoHomeCopy = () => {
      if (client !== "doubao" || !homeTitle) return;
      const main = document.querySelector("main, [role='main']");
      if (!main) return;
      const candidates = main.querySelectorAll('h1, h2, h3, [class*="title"], [class*="greeting"], [class*="welcome"]');
      for (const node of candidates) {
        if (node.children.length > 0) continue;
        const text = (node.textContent || "").trim();
        const alreadyManaged = node.dataset.lingglowHomeCopy === "doubao-title";
        if (!alreadyManaged && !/^(?:你好|嗨|有什么|今天|想聊|需要我|我能帮)/u.test(text)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.left < Math.min(260, window.innerWidth * 0.22) ||
            rect.top < 72 || rect.top > window.innerHeight * 0.72) continue;
        if (!node.hasAttribute("data-lingglow-original-home-copy")) {
          node.dataset.lingglowOriginalHomeCopy = node.textContent || "";
        }
        node.dataset.lingglowHomeCopy = "doubao-title";
        if (node.textContent !== homeTitle) node.textContent = homeTitle;
        break;
      }
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      runtimeScheduleTimer = setTimeout(() => {
        runtimeScheduleTimer = null;
        const run = () => {
          runtimeScheduleFrame = null;
          scheduled = false;
          if (document.hidden === true || document.visibilityState === "hidden") return;
          applyRootThemeLock();
          syncDoubaoComposerAvatar();
          syncDoubaoHomeCopy();
          // Doubao conversation text is painted on a calculated continuous
          // reading scrim. Do not repeatedly inspect thousands of streaming
          // message nodes for small local backgrounds.
          if (client !== "doubao") syncPlainTextSurfaces();
        };
        runtimeScheduleUsesAnimationFrame = typeof requestAnimationFrame === "function";
        runtimeScheduleFrame = runtimeScheduleUsesAnimationFrame
          ? requestAnimationFrame(run)
          : setTimeout(run, 0);
      }, client === "doubao" ? 96 : 0);
    };
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "theme-mode", "data-theme"]});
    runtimeResizeHandler = schedule;
    runtimeVisibilityHandler = () => {
      if (document.hidden !== true && document.visibilityState !== "hidden") schedule();
    };
    window.addEventListener?.("resize", runtimeResizeHandler);
    document.addEventListener?.("visibilitychange", runtimeVisibilityHandler);
    schedule();
  }

  if (client === "doubao") {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (!rule.selectorText?.includes("body::before") || !rule.style?.background) continue;
          backdropRule = rule;
          originalBackdrop = rule.style.background;
          rule.style.background = originalBackdrop.replace(
            /rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*([\\d.]+)\\s*\\)/g,
            (value, red, green, blue, alpha) => `rgba(${red}, ${green}, ${blue}, ${Math.min(Number(alpha), 0.10)})`,
          );
          break;
        }
      } catch {}
      if (backdropRule) break;
    }

    const markLargeStages = () => {
      doubaoStageScheduled = false;
      doubaoStageScheduleHandle = null;
      if (document.hidden === true || document.visibilityState === "hidden") return;
      const main = document.querySelector("#chat-route-main");
      if (!main) return;
      const mainRect = main.getBoundingClientRect();
      const minimumArea = mainRect.width * mainRect.height * 0.42;
      const candidates = new Set([
        ...main.children,
        ...main.querySelectorAll([
          ':scope > :is(div, main, section) > :is(div, main, section)',
          ':scope :is(main, [role="main"])[class*="center-bg-"]',
        ].join(', ')),
      ]);
      const desiredStages = new Set();
      let inspected = 0;
      for (const node of candidates) {
        if (!(node instanceof HTMLElement) || ++inspected > 96) break;
        const rect = node.getBoundingClientRect();
        const coversMain = rect.width * rect.height >= minimumArea
          && rect.width >= mainRect.width * 0.62
          && rect.height >= mainRect.height * 0.62;
        if (coversMain) desiredStages.add(node);
      }
      main.querySelectorAll('[data-lingglow-doubao-stage="true"]').forEach((node) => {
        if (!desiredStages.has(node)) delete node.dataset.lingglowDoubaoStage;
      });
      desiredStages.forEach((node) => {
        if (node.dataset.lingglowDoubaoStage !== "true") node.dataset.lingglowDoubaoStage = "true";
      });
    };
    const scheduleLargeStages = () => {
      if (doubaoStageScheduled) return;
      doubaoStageScheduled = true;
      doubaoStageScheduleHandle = setTimeout(markLargeStages, 120);
    };
    markLargeStages();
    const initialMain = document.querySelector("#chat-route-main");
    if (initialMain) {
      doubaoObserver = new MutationObserver(scheduleLargeStages);
      doubaoObserver.observe(document.documentElement, {subtree: true, childList: true});
      doubaoResizeObserver = new ResizeObserver(scheduleLargeStages);
      doubaoResizeObserver.observe(initialMain);
      scheduleLargeStages();
      runtimeTimers.push(setTimeout(scheduleLargeStages, 500), setTimeout(scheduleLargeStages, 1500));
    }

    const sidebar = document.querySelector("#flow_chat_sidebar");
    const setSelected = (item) => {
      if (!item) return;
      const selector = item.matches('[data-testid="chat_list_thread_item"]') ? '[data-testid="chat_list_thread_item"]' : '[class*="nav-link-"]';
      sidebar?.querySelectorAll(`${selector}[data-lingglow-selected="true"]`).forEach((node) => delete node.dataset.lingglowSelected);
      item.dataset.lingglowSelected = "true";
    };
    sidebar?.querySelectorAll('[class*="nav-link-"][aria-current="page"], [data-testid="chat_list_thread_item"][aria-current="page"], [data-testid="chat_list_thread_item"][class*="active-link-"]').forEach(setSelected);
    navHandler = (event) => setSelected(event.target.closest('#flow_chat_sidebar [class*="nav-link-"], #flow_chat_sidebar [data-testid="chat_list_thread_item"]'));
    sidebar?.addEventListener("click", navHandler, true);
  }

  window.__lingglowRuntimeHotfixCleanup = () => {
    observer?.disconnect();
    doubaoObserver?.disconnect();
    doubaoResizeObserver?.disconnect();
    runtimeTimers.forEach(clearTimeout);
    if (runtimeScheduleTimer !== null) clearTimeout(runtimeScheduleTimer);
    if (runtimeScheduleFrame !== null) {
      if (runtimeScheduleUsesAnimationFrame && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(runtimeScheduleFrame);
      } else {
        clearTimeout(runtimeScheduleFrame);
      }
    }
    if (doubaoStageScheduleHandle !== null) clearTimeout(doubaoStageScheduleHandle);
    if (runtimeResizeHandler) window.removeEventListener?.("resize", runtimeResizeHandler);
    if (runtimeVisibilityHandler) document.removeEventListener?.("visibilitychange", runtimeVisibilityHandler);
    if (client === "workbuddy") {
      if (originalThemeMode === null) document.documentElement.removeAttribute("theme-mode");
      else document.documentElement.setAttribute("theme-mode", originalThemeMode);
      if (originalDataTheme === null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", originalDataTheme);
      document.querySelectorAll("[data-lingglow-original-expert-theme]").forEach((root) => {
        const original = root.dataset.lingglowOriginalExpertTheme;
        root.classList.toggle("expert-center-dark", original === "dark");
        root.classList.toggle("expert-center-light", original !== "dark");
        delete root.dataset.lingglowOriginalExpertTheme;
      });
      document.querySelectorAll("[data-lingglow-original-avatar-src]").forEach((image) => {
        image.setAttribute("src", image.dataset.lingglowOriginalAvatarSrc || "");
        if (image.dataset.lingglowOriginalAvatarSrcsetPresent === "true") {
          image.setAttribute("srcset", image.dataset.lingglowOriginalAvatarSrcset || "");
        } else {
          image.removeAttribute("srcset");
        }
        delete image.dataset.lingglowOriginalAvatarSrc;
        delete image.dataset.lingglowOriginalAvatarSrcset;
        delete image.dataset.lingglowOriginalAvatarSrcsetPresent;
        delete image.dataset.lingglowCustomAvatar;
      });
      document.querySelectorAll("[data-lingglow-model-original-style]").forEach((node) => {
        const originalStyle = node.dataset.lingglowModelOriginalStyle || "";
        if (node.dataset.lingglowModelHadStyle === "true") node.setAttribute("style", originalStyle);
        else node.removeAttribute("style");
        delete node.dataset.lingglowModelOriginalStyle;
        delete node.dataset.lingglowModelHadStyle;
        delete node.dataset.lingglowModelPopover;
        delete node.dataset.lingglowSemanticPopup;
        delete node.dataset.lingglowPopupText;
        delete node.dataset.lingglowPopupSurface;
        delete node.dataset.lingglowPopupSeparator;
      });
    }
    document.querySelectorAll("[data-lingglow-original-home-copy]").forEach((node) => {
      node.textContent = node.dataset.lingglowOriginalHomeCopy || "";
      delete node.dataset.lingglowOriginalHomeCopy;
      delete node.dataset.lingglowHomeCopy;
    });
    const sidebar = document.querySelector("#flow_chat_sidebar");
    if (navHandler) sidebar?.removeEventListener("click", navHandler, true);
    if (backdropRule && originalBackdrop) backdropRule.style.background = originalBackdrop;
    restoreRootTheme();
    document.querySelectorAll("[data-lingglow-light-surface], [data-lingglow-contrast-text], [data-lingglow-card-surface], [data-lingglow-selected], [data-lingglow-original-expert-theme], [data-lingglow-doubao-stage], [data-lingglow-doubao-composer], [data-lingglow-chat-stage], [data-lingglow-chat-layer], [data-lingglow-custom-avatar], [data-lingglow-workbuddy-composer], [data-lingglow-workbuddy-landing-composer], [data-lingglow-codex-composer-anchor], [data-lingglow-home-copy], [data-lingglow-activity-notice], [data-lingglow-activity-notice-wrap], [data-lingglow-model-popover], [data-lingglow-semantic-popup], [data-lingglow-popup-text], [data-lingglow-popup-surface], [data-lingglow-popup-separator], [data-lingglow-plain-text-surface]").forEach((node) => {
      clearComposerMascotTravel(node);
      delete node.dataset.lingglowLightSurface;
      delete node.dataset.lingglowContrastText;
      delete node.dataset.lingglowCardSurface;
      delete node.dataset.lingglowSelected;
      delete node.dataset.lingglowOriginalExpertTheme;
      delete node.dataset.lingglowDoubaoStage;
      delete node.dataset.lingglowDoubaoComposer;
      delete node.dataset.lingglowChatStage;
      delete node.dataset.lingglowChatLayer;
      delete node.dataset.lingglowCustomAvatar;
      delete node.dataset.lingglowWorkbuddyComposer;
      delete node.dataset.lingglowWorkbuddyLandingComposer;
      delete node.dataset.lingglowCodexComposerAnchor;
      delete node.dataset.lingglowHomeCopy;
      delete node.dataset.lingglowActivityNotice;
      delete node.dataset.lingglowActivityNoticeWrap;
      delete node.dataset.lingglowModelPopover;
      delete node.dataset.lingglowSemanticPopup;
      delete node.dataset.lingglowPopupText;
      delete node.dataset.lingglowPopupSurface;
      delete node.dataset.lingglowPopupSeparator;
      delete node.dataset.lingglowPlainTextSurface;
    });
    document.getElementById(styleId)?.remove();
    delete window.__lingglowRuntimeHotfixCleanup;
  };
}

function cleanupRuntimeHotfix() {
  window.__LINGGLOW_COMPOSER_ACTIVITY_STATE__?.cleanup?.();
  window.__CODEX_DREAM_SKIN_STATE__?.cleanup?.();
  window.__lingglowRuntimeHotfixCleanup?.();
  window.__lingglowBackgroundCanvasCleanup?.();
  document.getElementById("__lingglow_runtime_hotfix_v3__")?.remove();
  document.querySelectorAll("[data-lingglow-light-surface], [data-lingglow-contrast-text], [data-lingglow-card-surface], [data-lingglow-selected], [data-lingglow-original-expert-theme], [data-lingglow-doubao-stage], [data-lingglow-doubao-composer], [data-lingglow-chat-stage], [data-lingglow-chat-layer], [data-lingglow-workbuddy-composer], [data-lingglow-workbuddy-landing-composer], [data-lingglow-codex-composer-anchor], [data-lingglow-plain-text-surface]").forEach((node) => {
    if (node instanceof HTMLElement) {
      for (const name of [
        "--lingglow-mascot-quarter-travel-x",
        "--lingglow-mascot-half-travel-x",
        "--lingglow-mascot-three-quarter-travel-x",
        "--lingglow-mascot-travel-x",
      ]) node.style.removeProperty(name);
    }
    delete node.dataset.lingglowLightSurface;
    delete node.dataset.lingglowContrastText;
    delete node.dataset.lingglowCardSurface;
    delete node.dataset.lingglowSelected;
    delete node.dataset.lingglowOriginalExpertTheme;
    delete node.dataset.lingglowDoubaoStage;
    delete node.dataset.lingglowDoubaoComposer;
    delete node.dataset.lingglowChatStage;
    delete node.dataset.lingglowChatLayer;
    delete node.dataset.lingglowWorkbuddyComposer;
    delete node.dataset.lingglowWorkbuddyLandingComposer;
    delete node.dataset.lingglowCodexComposerAnchor;
    delete node.dataset.lingglowPlainTextSurface;
  });
}

export function runtimeHotfixInjectionSource(compiledSkin) {
  const avatar = compiledSkin?.profile?.advanced?.workbuddy?.composerAvatar;
  const activityEnabled = compiledSkin?.audit?.composerAvatarEnabled === true &&
    avatar?.activityMotion !== "still";
  const activitySource = `;(${installComposerActivityMonitor.toString()})(${JSON.stringify(compiledSkin?.clientId)}, ${JSON.stringify(activityEnabled)});`;
  if (compiledSkin?.clientId === "codex") {
    const dreamSkinSource = codexDreamSkinInjectionSource(compiledSkin);
    // Codex has its own deliberately small, route-aware adapter.  Falling
    // through to the legacy generic observer would reintroduce broad DOM
    // scans and unsafe layout mutations on a renderer that has no local art.
    return `${dreamSkinSource || ''}\n${activitySource}`;
  }
  const profile = compiledSkin?.profile || {};
  const official = profile.official || {};
  const appearance = profile.appearance || {};
  const colors = profile.colors || {};
  const advanced = profile.advanced || {};
  const background = advanced.background || {};
  const palette = {
    accent: official.accent || profile["appearance.accent"] || appearance.accent || profile["colors.accent"] || colors.accent || "#ff4d57",
    surface: official.surface || profile["appearance.surface"] || appearance.surface || profile["colors.surface"] || colors.surface || "#071411",
    ink: official.ink || profile["appearance.ink"] || appearance.ink || profile["colors.ink"] || colors.ink || "#fff7ef",
  };
  const visual = {
    backgroundImage: background.image || null,
    composerAvatarImage: advanced.workbuddy?.composerAvatar?.image || null,
    composerAvatarEnabled: compiledSkin?.audit?.composerAvatarEnabled === true,
    homeDisplayName: advanced.workbuddy?.homeCopy?.title || null,
    homeTagline: advanced.workbuddy?.homeCopy?.subtitle || null,
    homeTitle: advanced.homeCopy?.title || null,
  };
  const nativeTheme = nativeThemeParametersFor(compiledSkin?.clientId, official.variant);
  return `(${installRuntimeHotfix.toString()})(${JSON.stringify(compiledSkin?.clientId)}, ${JSON.stringify(palette)}, ${JSON.stringify(nativeTheme)}, ${JSON.stringify(visual)});\n${activitySource}`;
}

export function runtimeHotfixCleanupSource() {
  return `;(${cleanupRuntimeHotfix.toString()})();`;
}
