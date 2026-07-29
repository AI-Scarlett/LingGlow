((cssText, artDataUrl, homeArtDataUrl, themeConfig) => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
  const DISABLED_KEY = "__CODEX_DREAM_SKIN_DISABLED__";
  const STYLE_ID = "codex-dream-skin-style";
  const SHELL_ATTR = "data-dream-shell";
  const APPEARANCE_ATTR = "data-lingglow-appearance";
  const UI_FONT_ATTR = "data-lingglow-custom-ui-font";
  const CODE_FONT_ATTR = "data-lingglow-custom-code-font";
  const ART_ATTRS = [
    "data-dream-art-wide", "data-dream-art-safe", "data-dream-task-mode",
    "data-dream-art-safe-area", "data-dream-art-task-mode", "data-dream-art-aspect",
    "data-dream-art-ready", "data-dream-art-fit",
  ];
  const TURN_SURFACE_ATTR = 'data-lingglow-codex-turn-surface';
  const CONVERSATION_TURN_SELECTORS = [
    '[data-chatgpt-conversation-turn="true"]',
    '[data-turn-key]',
    '[data-testid="conversation-turn"]',
    '[data-message-author-role]',
    '[data-message-id]',
  ];
  const CONVERSATION_TURN_SELECTOR = CONVERSATION_TURN_SELECTORS.join(', ');
  const MASCOT_TRAVEL_VARIABLES = [
    '--lingglow-mascot-quarter-travel-x',
    '--lingglow-mascot-half-travel-x',
    '--lingglow-mascot-three-quarter-travel-x',
    '--lingglow-mascot-travel-x',
  ];
  const VERSION = __DREAM_SKIN_VERSION_JSON__;
  const STYLE_REVISION = __DREAM_SKIN_STYLE_REVISION_JSON__;
  const PAYLOAD_REVISION = __DREAM_SKIN_PAYLOAD_REVISION_JSON__;
  const THEME = themeConfig && typeof themeConfig === "object" ? themeConfig : {};
  const ART = THEME.art && typeof THEME.art === "object" ? THEME.art : {};
  const ART_METADATA = THEME.artMetadata && typeof THEME.artMetadata === "object"
    ? THEME.artMetadata : null;
  const ANALYSIS_CACHE_KEY = "__CODEX_DREAM_SKIN_ANALYSIS_CACHE__";
  const THEME_VARIABLES = [
    "--ds-bg", "--ds-panel", "--ds-panel-2", "--ds-green", "--ds-lime",
    "--ds-cyan", "--ds-purple", "--ds-danger", "--ds-danger-alt", "--ds-on-accent", "--ds-on-danger",
    "--ds-text", "--ds-muted", "--ds-line",
    "--ds-bg-rgb", "--ds-panel-rgb", "--ds-panel-2-rgb", "--ds-accent-rgb",
    "--ds-accent-alt-rgb", "--ds-secondary-rgb", "--ds-highlight-rgb", "--ds-danger-rgb", "--ds-danger-alt-rgb",
    "--ds-text-rgb", "--ds-muted-rgb", "--ds-line-rgb",
    "--dream-art-focus-x", "--dream-art-focus-y", "--dream-art-position",
    "--dream-skin-focus-x", "--dream-skin-focus-y", "--dream-skin-art-position",
    "--dream-skin-home-art", "--ds-focus-x", "--ds-focus-y", "--ds-art-position",
    "--ds-hero-strength", "--ds-hero-strong", "--ds-hero-mid", "--ds-hero-soft",
    "--dream-skin-name", "--dream-skin-tagline", "--dream-skin-project-prefix",
    "--dream-skin-project-label", "--ds-control-radius", "--ds-ui-font", "--ds-code-font",
  ];
  const installToken = {};
  const existingAnalysisCache = window[ANALYSIS_CACHE_KEY];
  const analysisCache = existingAnalysisCache && typeof existingAnalysisCache.get === "function" &&
    typeof existingAnalysisCache.set === "function" ? existingAnalysisCache : new Map();
  window[ANALYSIS_CACHE_KEY] = analysisCache;
  let artAnalysis = typeof THEME.artKey === "string" ? analysisCache.get(THEME.artKey) ?? null : null;
  let analysisTimer = null;
  let samplingNativeShell = false;
  let rootObserver = null;
  const now = () => typeof performance === "object" && typeof performance.now === "function"
    ? performance.now() : Date.now();
  const metrics = {
    ensureCalls: 0,
    rootPasses: 0,
    routePasses: 0,
    layoutReads: 0,
    attributeWrites: 0,
    styleWrites: 0,
    textWrites: 0,
    analysisRuns: 0,
    analysisCacheHits: artAnalysis ? 1 : 0,
    firstEnsureMs: null,
    analysisMs: null,
  };
  window[DISABLED_KEY] = false;

  const previous = window[STATE_KEY];
  const objectUrlForData = (dataUrl) => {
    const comma = dataUrl.indexOf(",");
    const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] || "image/png";
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  };
  const artUrl = objectUrlForData(artDataUrl);
  const hasSeparateHomeArt = typeof homeArtDataUrl === "string" && homeArtDataUrl &&
    homeArtDataUrl !== artDataUrl;
  const homeArtUrl = hasSeparateHomeArt ? objectUrlForData(homeArtDataUrl) : artUrl;

  if (previous?.observer) previous.observer.disconnect();
  if (previous?.rootObserver) previous.rootObserver.disconnect();
  if (previous?.resizeObserver) previous.resizeObserver.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.scheduler?.frame != null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(previous.scheduler.frame);
  }
  if (previous?.analysisTimer) clearTimeout(previous.analysisTimer);
  if (previous?.homeGraceTimer) clearTimeout(previous.homeGraceTimer);
  if (previous?.resizeHandler) window.removeEventListener("resize", previous.resizeHandler);
  if (previous?.mediaHandler && previous?.mediaQuery) {
    try { previous.mediaQuery.removeEventListener("change", previous.mediaHandler); } catch {}
  }

  const cssString = (value) => JSON.stringify(String(value ?? ""));

  const setStyleProperty = (root, name, value) => {
    if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value);
      metrics.styleWrites += 1;
    }
  };

  const setAttribute = (root, name, value) => {
    const normalized = String(value);
    if (root.getAttribute(name) !== normalized) {
      root.setAttribute(name, normalized);
      metrics.attributeWrites += 1;
    }
  };

  const clearComposerAnchorState = (node) => {
    node?.removeAttribute?.('data-lingglow-codex-composer-anchor');
    for (const name of MASCOT_TRAVEL_VARIABLES) node?.style?.removeProperty(name);
  };

  const parseRgb = (value) => {
    if (!value || value === "transparent") return null;
    const hex = String(value).trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const number = Number.parseInt(hex[1], 16);
      return { r: number >> 16, g: (number >> 8) & 255, b: number & 255 };
    }
    const m = String(value).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const rgbString = (value) => {
    const rgb = parseRgb(value);
    return rgb ? `${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)}` : null;
  };

  const rgbToHex = ({ r, g, b }) => `#${[r, g, b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;

  const rgbToHsl = ({ r, g, b }) => {
    const values = [r, g, b].map((value) => value / 255);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const lightness = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: lightness };
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === values[0]) hue = (values[1] - values[2]) / delta + (values[1] < values[2] ? 6 : 0);
    else if (max === values[1]) hue = (values[2] - values[0]) / delta + 2;
    else hue = (values[0] - values[1]) / delta + 4;
    return { h: hue * 60, s: saturation, l: lightness };
  };

  const hslToRgb = ({ h, s, l }) => {
    const hue = ((h % 360) + 360) % 360 / 360;
    if (s === 0) {
      const neutral = Math.round(l * 255);
      return { r: neutral, g: neutral, b: neutral };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (offset) => {
      let t = hue + offset;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return { r: channel(1 / 3) * 255, g: channel(0) * 255, b: channel(-1 / 3) * 255 };
  };

  const luminance = ({ r, g, b }) => {
    const lin = [r, g, b].map((c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };

  /** Detect Codex app light/dark shell for CSS branching. */
  const detectShellMode = () => {
    const root = document.documentElement;
    const body = document.body;
    const cls = `${root.className || ""} ${body?.className || ""}`.toLowerCase();

    if (/\b(dark|theme-dark|appearance-dark)\b/.test(cls)) return "dark";
    if (/\b(light|theme-light|appearance-light)\b/.test(cls)) return "light";

    const dataTheme = (
      root.getAttribute("data-theme") ||
      root.getAttribute("data-appearance") ||
      root.getAttribute("data-color-mode") ||
      body?.getAttribute("data-theme") ||
      body?.getAttribute("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    // Radios in profile menu (if present in DOM)
    const checked = document.querySelector('input[name="appearance-theme"]:checked');
    if (checked) {
      const label = (checked.getAttribute("aria-label") || checked.value || "").toLowerCase();
      if (label.includes("暗") || label.includes("dark")) return "dark";
      if (label.includes("浅") || label.includes("light")) return "light";
      if (label.includes("系统") || label.includes("system")) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
    }

    // The skin itself declares color-scheme on :root.  Once installed,
    // reading getComputedStyle(root) directly would therefore keep `auto`
    // themes locked to the previous shell mode. Temporarily remove only our
    // own root class/attribute, sample the native computed scheme, then restore
    // synchronously. Mutation records created by this probe are drained below
    // so the root observer does not schedule a redundant ensure pass.
    try {
      const hadSkin = root.classList.contains("codex-dream-skin");
      const savedShell = root.getAttribute(SHELL_ATTR);
      samplingNativeShell = true;
      if (hadSkin) root.classList.remove("codex-dream-skin");
      if (savedShell !== null) root.removeAttribute(SHELL_ATTR);
      let colorScheme = "";
      try {
        colorScheme = getComputedStyle(root).colorScheme || "";
      } finally {
        if (hadSkin) root.classList.add("codex-dream-skin");
        if (savedShell !== null) root.setAttribute(SHELL_ATTR, savedShell);
        rootObserver?.takeRecords?.();
        samplingNativeShell = false;
      }
      if (colorScheme.includes("dark") && !colorScheme.includes("light")) return "dark";
      if (colorScheme.includes("light") && !colorScheme.includes("dark")) return "light";
    } catch {
      samplingNativeShell = false;
    }

    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {}

    // Only use surface luminance before the skin owns those surfaces. Sampling
    // our own translucent layers would create route-dependent light/dark flips.
    if (!root.classList.contains("codex-dream-skin")) {
      const samples = [
        body,
        document.querySelector("main.main-surface"),
        document.querySelector("aside.app-shell-left-panel"),
      ].filter(Boolean);
      let votesLight = 0;
      let votesDark = 0;
      for (const el of samples) {
        try {
          const rgb = parseRgb(getComputedStyle(el).backgroundColor);
          if (!rgb) continue;
          const L = luminance(rgb);
          if (L >= 0.55) votesLight += 1;
          else if (L <= 0.25) votesDark += 1;
        } catch {}
      }
      if (votesLight > votesDark) return "light";
      if (votesDark > votesLight) return "dark";
    }
    return "light";
  };

  const makeAdaptivePalette = (sample, shell) => {
    const source = sample || { r: 108, g: 126, b: 136 };
    const hsl = rgbToHsl(source);
    const hue = hsl.s < 0.12 ? 214 : hsl.h;
    const saturation = clamp(hsl.s, 0.38, 0.72);
    const accent = hslToRgb({ h: hue, s: saturation, l: shell === "light" ? 0.42 : 0.66 });
    const accentAlt = hslToRgb({ h: hue + 12, s: saturation * 0.82, l: shell === "light" ? 0.52 : 0.73 });
    const secondary = hslToRgb({ h: hue - 24, s: saturation * 0.64, l: shell === "light" ? 0.56 : 0.62 });
    const highlight = hslToRgb({ h: hue + 24, s: saturation * 0.76, l: shell === "light" ? 0.36 : 0.58 });
    const neutral = (lightness, chroma = 0.08) => rgbToHex(hslToRgb({ h: hue, s: chroma, l: lightness }));
    return shell === "light" ? {
      background: neutral(0.965, 0.07),
      panel: neutral(0.987, 0.035),
      panelAlt: neutral(0.945, 0.09),
      accent: rgbToHex(accent),
      accentAlt: rgbToHex(accentAlt),
      secondary: rgbToHex(secondary),
      highlight: rgbToHex(highlight),
      danger: "#B42318",
      text: neutral(0.13, 0.10),
      muted: neutral(0.42, 0.08),
      line: `rgba(${Math.round(accent.r)}, ${Math.round(accent.g)}, ${Math.round(accent.b)}, .24)`,
    } : {
      background: neutral(0.055, 0.045),
      panel: neutral(0.085, 0.04),
      panelAlt: neutral(0.125, 0.05),
      accent: rgbToHex(accent),
      accentAlt: rgbToHex(accentAlt),
      secondary: rgbToHex(secondary),
      highlight: rgbToHex(highlight),
      danger: "#FF8A80",
      text: neutral(0.93, 0.025),
      muted: neutral(0.69, 0.03),
      line: `rgba(${Math.round(accent.r)}, ${Math.round(accent.g)}, ${Math.round(accent.b)}, .28)`,
    };
  };

  const resolvedShell = () => {
    if (THEME.appearance === "light" || THEME.appearance === "dark") return THEME.appearance;
    // Image luminance may tune accents and scrims, but auto appearance follows
    // Codex/ChatGPT (or the OS fallback) so a bright wallpaper cannot flip a
    // native dark session back to a light shell after analysis.
    return detectShellMode();
  };

  const applyTheme = (root, shell) => {
    const colors = THEME.colors || {};
    const explicit = new Set(Array.isArray(THEME.explicitColorKeys) ? THEME.explicitColorKeys : []);
    const adaptive = makeAdaptivePalette(artAnalysis?.accentRgb, shell);
    const legacyLight = !THEME.appearance && shell === "light";
    const structural = new Set(["background", "panel", "panelAlt", "text", "muted"]);
    const pick = (name) => {
      const allowExplicit = explicit.has(name) && !(legacyLight && structural.has(name));
      return allowExplicit && typeof colors[name] === "string" ? colors[name] : adaptive[name];
    };
    const accent = pick("accent");
    const accentAlt = explicit.has("accentAlt") ? pick("accentAlt") : (explicit.has("accent") ? accent : adaptive.accentAlt);
    const danger = pick("danger");
    const dangerAlt = explicit.has("dangerAlt") ? pick("dangerAlt") : danger;
    const variables = {
      "--ds-bg": pick("background"),
      "--ds-panel": pick("panel"),
      "--ds-panel-2": pick("panelAlt"),
      "--ds-green": accent,
      "--ds-lime": accentAlt,
      "--ds-cyan": pick("secondary"),
      "--ds-purple": pick("highlight"),
      "--ds-danger": danger,
      "--ds-danger-alt": dangerAlt,
      "--ds-on-accent": explicit.has("onAccent") ? pick("onAccent") : (shell === "light" ? "#FFFFFF" : "#071017"),
      "--ds-on-danger": explicit.has("onDanger") ? pick("onDanger") : (shell === "light" ? "#FFFFFF" : "#1B0B0A"),
      "--ds-text": pick("text"),
      "--ds-muted": pick("muted"),
      "--ds-line": explicit.has("line") && typeof colors.line === "string" ? colors.line : adaptive.line,
    };

    for (const [name, value] of Object.entries(variables)) {
      if (typeof value === "string" && value) setStyleProperty(root, name, value);
    }
    const rgbVariables = {
      "--ds-bg-rgb": variables["--ds-bg"],
      "--ds-panel-rgb": variables["--ds-panel"],
      "--ds-panel-2-rgb": variables["--ds-panel-2"],
      "--ds-accent-rgb": variables["--ds-green"],
      "--ds-accent-alt-rgb": variables["--ds-lime"],
      "--ds-secondary-rgb": variables["--ds-cyan"],
      "--ds-highlight-rgb": variables["--ds-purple"],
      "--ds-danger-rgb": variables["--ds-danger"],
      "--ds-danger-alt-rgb": variables["--ds-danger-alt"],
      "--ds-text-rgb": variables["--ds-text"],
      "--ds-muted-rgb": variables["--ds-muted"],
      "--ds-line-rgb": variables["--ds-line"],
    };
    for (const [name, value] of Object.entries(rgbVariables)) {
      const rgb = rgbString(value);
      if (rgb) setStyleProperty(root, name, rgb);
    }
    const radius = Number(THEME.controlRadius);
    setStyleProperty(root, "--ds-control-radius", `${Number.isFinite(radius) ? clamp(radius, 10, 18) : 14}px`);
    const fonts = THEME.fonts && typeof THEME.fonts === "object" ? THEME.fonts : {};
    if (typeof fonts.ui === "string" && fonts.ui) {
      setStyleProperty(root, "--ds-ui-font", fonts.ui);
      setAttribute(root, UI_FONT_ATTR, "true");
    } else {
      root.style.removeProperty("--ds-ui-font");
      root.removeAttribute(UI_FONT_ATTR);
    }
    if (typeof fonts.code === "string" && fonts.code) {
      setStyleProperty(root, "--ds-code-font", fonts.code);
      setAttribute(root, CODE_FONT_ATTR, "true");
    } else {
      root.style.removeProperty("--ds-code-font");
      root.removeAttribute(CODE_FONT_ATTR);
    }
    setStyleProperty(root, "--dream-skin-name", cssString(THEME.name || "Codex Dream Skin"));
    setStyleProperty(root, "--dream-skin-tagline", cssString(THEME.tagline || "Make something wonderful."));
    setStyleProperty(root, "--dream-skin-project-prefix", cssString(THEME.projectPrefix || "选择项目 · "));
    setStyleProperty(root, "--dream-skin-project-label", cssString(THEME.projectLabel || "◉  选择项目"));
  };

  const applyArtMetadata = (root) => {
    const profile = artAnalysis || ART_METADATA;
    const inferredSafe = profile?.safeArea || "center";
    const safeArea = ART.safeArea && ART.safeArea !== "auto" ? ART.safeArea : inferredSafe;
    const canonicalSafe = ["left", "right", "center", "none"].includes(safeArea)
      ? safeArea : "center";
    let focusX = typeof ART.focusX === "number" ? ART.focusX
      : profile?.focusX ?? (canonicalSafe === "left" ? 0.72 : canonicalSafe === "right" ? 0.28 : 0.5);
    let focusY = typeof ART.focusY === "number" ? ART.focusY : profile?.focusY ?? 0.5;
    if (canonicalSafe === "left") focusX = Math.max(0.64, focusX);
    if (canonicalSafe === "right") focusX = Math.min(0.36, focusX);
    focusX = clamp(focusX, 0.12, 0.88);
    focusY = clamp(focusY, 0.18, 0.82);
    const requestedTaskMode = ART.taskMode && ART.taskMode !== "auto"
      ? ART.taskMode : profile?.taskMode || "ambient";
    const taskMode = ["ambient", "banner", "off"].includes(requestedTaskMode)
      ? requestedTaskMode : "ambient";
    const fit = ["cover", "contain"].includes(ART.fit) ? ART.fit : "cover";
    const scrimStrength = clamp(Number(ART.scrimStrength ?? 0.76), 0, 0.85);
    const wide = profile?.wide || false;
    const aspect = profile?.aspect || "unknown";
    const focusXValue = `${(focusX * 100).toFixed(2)}%`;
    const focusYValue = `${(focusY * 100).toFixed(2)}%`;

    setAttribute(root, "data-dream-art-wide", wide ? "true" : "false");
    setAttribute(root, "data-dream-art-safe", canonicalSafe);
    setAttribute(root, "data-dream-task-mode", taskMode);
    setAttribute(root, "data-dream-art-safe-area", canonicalSafe);
    setAttribute(root, "data-dream-art-task-mode", taskMode);
    setAttribute(root, "data-dream-art-fit", fit);
    setAttribute(root, "data-dream-art-aspect", aspect);
    setAttribute(root, "data-dream-art-ready", artAnalysis ? "true" : "false");
    setStyleProperty(root, "--dream-art-focus-x", focusXValue);
    setStyleProperty(root, "--dream-art-focus-y", focusYValue);
    setStyleProperty(root, "--dream-art-position", `${focusXValue} ${focusYValue}`);
    setStyleProperty(root, "--dream-skin-focus-x", focusXValue);
    setStyleProperty(root, "--dream-skin-focus-y", focusYValue);
    setStyleProperty(root, "--dream-skin-art-position", `${focusXValue} ${focusYValue}`);
    setStyleProperty(root, "--ds-focus-x", focusXValue);
    setStyleProperty(root, "--ds-focus-y", focusYValue);
    setStyleProperty(root, "--ds-art-position", `${focusXValue} ${focusYValue}`);
    setStyleProperty(root, "--ds-hero-strength", scrimStrength.toFixed(3));
    setStyleProperty(root, "--ds-hero-strong", scrimStrength.toFixed(3));
    setStyleProperty(root, "--ds-hero-mid", (scrimStrength * 0.82).toFixed(3));
    setStyleProperty(root, "--ds-hero-soft", (scrimStrength * 0.24).toFixed(3));
  };

  const analyzeArt = () => new Promise((resolve) => {
    const startedAt = now();
    metrics.analysisRuns += 1;
    if (typeof window.Image !== "function" || !document?.createElement) {
      metrics.analysisMs = Number((now() - startedAt).toFixed(3));
      resolve(null);
      return;
    }
    const image = new window.Image();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (analysisTimer) clearTimeout(analysisTimer);
      analysisTimer = null;
      metrics.analysisMs = Number((now() - startedAt).toFixed(3));
      resolve(value);
    };
    analysisTimer = setTimeout(() => finish(null), 6000);
    image.onerror = () => finish(null);
    image.onload = () => {
      try {
        const ratio = image.naturalWidth / image.naturalHeight;
        if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("Invalid image dimensions");
        const maxDimension = 96;
        const width = Math.max(16, Math.round(ratio >= 1 ? maxDimension : maxDimension * ratio));
        const height = Math.max(16, Math.round(ratio >= 1 ? maxDimension / ratio : maxDimension));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext?.("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        const samples = new Array(width * height);
        const bins = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
        let lightTotal = 0;
        let count = 0;

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4;
            if (data[offset + 3] < 32) continue;
            const rgb = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
            const light = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
            const hsl = rgbToHsl(rgb);
            samples[y * width + x] = { light, saturation: hsl.s };
            lightTotal += light;
            count += 1;
            if (hsl.s >= 0.16 && hsl.l >= 0.16 && hsl.l <= 0.86) {
              const bin = bins[Math.min(23, Math.floor(hsl.h / 15))];
              const weight = hsl.s * (1 - Math.abs(hsl.l - 0.52) * 0.85);
              bin.weight += weight;
              bin.r += rgb.r * weight;
              bin.g += rgb.g * weight;
              bin.b += rgb.b * weight;
            }
          }
        }
        if (!count) throw new Error("Image has no visible pixels");
        const brightness = lightTotal / count;
        const information = (start, end) => {
          let total = 0;
          let totalSquared = 0;
          let edges = 0;
          let edgeCount = 0;
          let pixels = 0;
          for (let y = 0; y < height; y += 1) {
            for (let x = start; x < end; x += 1) {
              const sample = samples[y * width + x];
              if (!sample) continue;
              total += sample.light;
              totalSquared += sample.light * sample.light;
              pixels += 1;
              const previous = x > start ? samples[y * width + x - 1] : null;
              const above = y > 0 ? samples[(y - 1) * width + x] : null;
              if (previous) { edges += Math.abs(sample.light - previous.light); edgeCount += 1; }
              if (above) { edges += Math.abs(sample.light - above.light); edgeCount += 1; }
            }
          }
          const mean = pixels ? total / pixels : 0;
          const variance = pixels ? Math.max(0, totalSquared / pixels - mean * mean) : 1;
          return Math.sqrt(variance) * 0.58 + (edgeCount ? edges / edgeCount : 1) * 0.42;
        };
        const zoneWidth = Math.max(1, Math.floor(width * 0.38));
        const leftInformation = information(0, zoneWidth);
        const rightInformation = information(width - zoneWidth, width);
        let safeArea = "center";
        if (leftInformation < rightInformation * 0.86) safeArea = "left";
        else if (rightInformation < leftInformation * 0.86) safeArea = "right";

        let saliencyTotal = 0;
        let saliencyX = 0;
        let saliencyY = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const sample = samples[y * width + x];
            if (!sample) continue;
            const previous = x > 0 ? samples[y * width + x - 1] : null;
            const above = y > 0 ? samples[(y - 1) * width + x] : null;
            const edge = (previous ? Math.abs(sample.light - previous.light) : 0) +
              (above ? Math.abs(sample.light - above.light) : 0);
            const weight = 0.01 + Math.abs(sample.light - brightness) * 0.48 +
              sample.saturation * 0.34 + edge * 0.28;
            saliencyTotal += weight;
            saliencyX += (x + 0.5) / width * weight;
            saliencyY += (y + 0.5) / height * weight;
          }
        }
        let focusX = saliencyTotal ? saliencyX / saliencyTotal : 0.5;
        let focusY = saliencyTotal ? saliencyY / saliencyTotal : 0.5;
        if (safeArea === "left") focusX = Math.max(0.64, focusX);
        if (safeArea === "right") focusX = Math.min(0.36, focusX);
        focusX = clamp(focusX, 0.12, 0.88);
        focusY = clamp(focusY, 0.18, 0.82);

        const accentBin = bins.reduce((best, candidate) => candidate.weight > best.weight ? candidate : best, bins[0]);
        const accentRgb = accentBin.weight > 0 ? {
          r: accentBin.r / accentBin.weight,
          g: accentBin.g / accentBin.weight,
          b: accentBin.b / accentBin.weight,
        } : null;
        const aspect = ratio >= 2.25 ? "ultrawide" : ratio >= 1.45 ? "wide"
          : ratio >= 1.08 ? "landscape" : ratio >= 0.9 ? "square" : "portrait";
        finish({
          width: image.naturalWidth,
          height: image.naturalHeight,
          ratio,
          wide: ratio >= 1.75,
          aspect,
          brightness,
          shell: brightness >= 0.58 ? "light" : "dark",
          safeArea,
          focusX,
          focusY,
          taskMode: ratio >= 2.25 ? "banner" : "ambient",
          accentRgb,
        });
      } catch {
        finish(null);
      }
    };
    image.src = homeArtUrl;
  });

  // The New Task DOM is React-owned.  Do not add a parallel chrome layer or
  // force a card hierarchy: either can race a route refresh and make native
  // suggestion buttons disappear.  We retain one stable route marker only.
  let lastHome = null;
  let lastHomeSeenAt = 0;
  let lastHomeRouteKey = null;
  let homeGraceTimer = null;
  const classifyHomeSurface = __DREAM_SKIN_HOME_CLASSIFIER_SOURCE__;

  const currentRouteKey = () => {
    try {
      const target = window.location;
      return `${target?.pathname || ''}${target?.search || ''}${target?.hash || ''}`;
    } catch {
      return '';
    }
  };

  const clearHomeGraceTimer = () => {
    if (homeGraceTimer) clearTimeout(homeGraceTimer);
    homeGraceTimer = null;
    const state = window[STATE_KEY];
    if (state?.installToken === installToken) state.homeGraceTimer = null;
  };

  const armHomeGraceExpiry = (delay) => {
    if (homeGraceTimer) clearTimeout(homeGraceTimer);
    homeGraceTimer = setTimeout(() => {
      homeGraceTimer = null;
      const state = window[STATE_KEY];
      if (state?.installToken !== installToken || window[DISABLED_KEY]) return;
      state.homeGraceTimer = null;
      ensure({root: false, route: true, layout: false});
    }, Math.max(16, Math.round(delay)));
    const state = window[STATE_KEY];
    if (state?.installToken === installToken) state.homeGraceTimer = homeGraceTimer;
  };

  const ensureStyle = (root) => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = cssText;
      style.dataset.dreamSkinVersion = VERSION;
      (document.head || root).appendChild(style);
    } else if (style.dataset.dreamSkinStyleRevision !== STYLE_REVISION) {
      style.textContent = cssText;
    }
    style.dataset.dreamSkinVersion = VERSION;
    style.dataset.dreamSkinStyleRevision = STYLE_REVISION;
    return style;
  };

  const applyRootState = (root) => {
    metrics.rootPasses += 1;
    ensureStyle(root);
    const shell = resolvedShell();
    setAttribute(root, SHELL_ATTR, shell);
    setAttribute(root, APPEARANCE_ATTR, shell);
    setStyleProperty(root, "--dream-skin-art", `url("${artUrl}")`);
    setStyleProperty(root, "--dream-skin-home-art", `url("${homeArtUrl}")`);
    applyTheme(root, shell);
    applyArtMetadata(root);
    root.classList.add("codex-dream-skin");
    return shell;
  };

  const isRenderedElement = (node) => {
    if (!(node instanceof HTMLElement) || !node.isConnected || node.hidden) return false;
    if (node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const rects = [...node.getClientRects()];
    if (!rects.some((rect) => rect.width > 0 && rect.height > 0)) return false;
    try {
      // Opacity is not inherited, so checking only the leaf misses a stale
      // React subtree whose old composer root is faded out at an ancestor.
      for (let current = node; current instanceof HTMLElement; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
            Number.parseFloat(style.opacity || '1') <= 0) {
          return false;
        }
      }
    } catch {}
    return true;
  };

  const hasVisibleMatch = (root, selector) => {
    if (!(root instanceof HTMLElement)) return false;
    if (root.matches(selector) && isRenderedElement(root)) return true;
    return [...root.querySelectorAll(selector)].some(isRenderedElement);
  };

  const syncCanonicalTurnSurfaces = (routeState) => {
    const desired = new Set();
    if (routeState?.visibleTaskContent === true) {
      const scrollContainers = [...document.querySelectorAll('.thread-scroll-container')]
        .filter(isRenderedElement);
      for (const scrollContainer of scrollContainers) {
        const ranked = new Map();
        CONVERSATION_TURN_SELECTORS.forEach((selector, priority) => {
          for (const node of scrollContainer.querySelectorAll(selector)) {
            if (!isRenderedElement(node) || node === scrollContainer ||
                node.closest('.thread-scroll-container') !== scrollContainer) continue;
            const previousPriority = ranked.get(node);
            if (previousPriority === undefined || priority < previousPriority) ranked.set(node, priority);
          }
        });
        const candidates = [...ranked.entries()]
          .map(([node, priority]) => ({node, priority}))
          .sort((first, second) => {
            if (first.priority !== second.priority) return first.priority - second.priority;
            if (first.node.contains(second.node)) return -1;
            if (second.node.contains(first.node)) return 1;
            return 0;
          });
        const canonical = [];
        for (const candidate of candidates) {
          if (canonical.some((existing) => existing.node.contains(candidate.node) ||
              candidate.node.contains(existing.node))) continue;
          canonical.push(candidate);
        }
        for (const {node} of canonical) desired.add(node);
      }
    }
    // Streaming responses trigger frequent child-list mutations. Diff the
    // semantic marker set instead of clearing/re-adding every turn each pass;
    // unchanged cards keep their compositor layer and avoid needless repaint.
    for (const node of document.querySelectorAll(`[${TURN_SURFACE_ATTR}]`)) {
      if (!desired.has(node)) node.removeAttribute(TURN_SURFACE_ATTR);
    }
    for (const node of desired) {
      if (node.getAttribute(TURN_SURFACE_ATTR) !== 'true') {
        setAttribute(node, TURN_SURFACE_ATTR, 'true');
      }
    }
  };

  const boundedShellMain = () => [...new Set([
    document.querySelector('[data-app-shell-main-content-layout]'),
    document.querySelector('.app-shell-main-content-frame'),
    document.querySelector('main.main-surface'),
  ].filter(Boolean))].find(isRenderedElement) || null;

  const findHomeSurface = () => {
    const shellMain = boundedShellMain();
    if (!(shellMain instanceof HTMLElement) || !isRenderedElement(shellMain)) {
      return {home: null, shellMain: null, visibleTaskContent: false};
    }
    const visibleTaskContent = hasVisibleMatch(shellMain, CONVERSATION_TURN_SELECTOR);
    const candidates = [
      ...(shellMain.matches('[role="main"]') ? [shellMain] : []),
      ...shellMain.querySelectorAll('[role="main"]'),
    ];
    const home = candidates.find((candidate) => classifyHomeSurface({
      withinShell: candidate === shellMain || shellMain.contains(candidate),
      connected: shellMain.isConnected && candidate.isConnected,
      rendered: isRenderedElement(candidate),
      visibleGameSource: hasVisibleMatch(candidate, '[data-feature="game-source"]'),
      visibleSuggestions: hasVisibleMatch(candidate, '.group\\/home-suggestions'),
      visibleTaskContent,
    })) || null;
    return {home, shellMain, visibleTaskContent};
  };

  const syncRouteState = () => {
    metrics.routePasses += 1;
    const root = document.documentElement;
    if (!root) return {home: null, shellMain: null, visibleTaskContent: false, routeReady: false};
    const routeState = findHomeSurface();
    const detectedHome = routeState.home;
    const routeKey = currentRouteKey();
    // During a native React refresh its child controls may be briefly absent.
    // Preserve the known surface while it remains connected instead of toggling
    // the art class off and on every reconciliation frame.
    if (detectedHome) {
      lastHomeSeenAt = now();
      lastHomeRouteKey = routeKey;
    }
    const homeAge = now() - lastHomeSeenAt;
    const graceHome = !routeState.visibleTaskContent &&
      routeKey === lastHomeRouteKey &&
      routeState.shellMain?.contains(lastHome) &&
      isRenderedElement(lastHome) &&
      homeAge < 500
      ? lastHome
      : null;
    if (graceHome && !detectedHome) armHomeGraceExpiry(510 - homeAge);
    else clearHomeGraceTimer();
    const home = detectedHome || graceHome;
    lastHome = home;
    if (!home) lastHomeRouteKey = null;
    for (const candidate of document.querySelectorAll('[role="main"].dream-skin-home')) {
      if (candidate !== home) candidate.classList.remove("dream-skin-home");
    }
    if (home) home.classList.add("dream-skin-home");
    if (home) setAttribute(root, "data-dream-route-home", "true");
    else root.removeAttribute("data-dream-route-home");
    return {
      ...routeState,
      home,
      // Composer chrome and its mascot are safe only after this reconciliation
      // pass sees a concrete home signal, its same-route bounded grace, or a
      // real conversation turn. Navigation changes the route key immediately;
      // the timer also expires grace when reconciliation remains quiet.
      routeReady: Boolean(detectedHome || graceHome || routeState.visibleTaskContent),
    };
  };

  const syncSemanticControls = (routeState = null) => {
    document.querySelectorAll('[data-lingglow-codex-control]').forEach((node) => {
      node.removeAttribute('data-lingglow-codex-control');
      node.removeAttribute('data-lingglow-codex-submit-state');
    });
    document.querySelectorAll('[data-lingglow-codex-surface]').forEach((node) => {
      node.removeAttribute('data-lingglow-codex-surface');
    });
    syncCanonicalTurnSurfaces(routeState);
    document.querySelectorAll('[data-lingglow-codex-sidebar-state]').forEach((node) => {
      node.removeAttribute('data-lingglow-codex-sidebar-state');
    });
    const composerSelector = '.composer-surface-chrome, [data-codex-composer-root], [data-codex-composer]';
    const editorSelector = 'textarea, input, [contenteditable="true"], [role="textbox"], .ProseMirror';
    const visibleElement = isRenderedElement;
    const composerCandidates = [...document.querySelectorAll(composerSelector)]
      .filter(visibleElement);
    const rankedComposerCandidates = composerCandidates
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const hasVisibleEditor = (node.matches(editorSelector) && visibleElement(node)) ||
          [...node.querySelectorAll(editorSelector)].some(visibleElement);
        const hasComposerParent = Boolean(node.parentElement?.closest(composerSelector));
        const semanticWeight = node.matches('[data-codex-composer-root]') ? 3200
          : node.matches('.composer-surface-chrome') ? 2200 : 1200;
        return {
          node,
          hasVisibleEditor,
          score: (hasVisibleEditor ? 10000 : 0) + (hasComposerParent ? 0 : 1800) +
            semanticWeight + Math.min(1600, Math.round(rect.width)) + Math.min(600, Math.round(rect.height)),
        };
      })
      .sort((first, second) => second.score - first.score);
    const editorComposerCandidates = rankedComposerCandidates
      .filter((candidate) => candidate.hasVisibleEditor);
    // Prefer the semantic Codex composer root that really contains a rendered
    // editor. Ancestor shells also contain that editor, but anchoring one of
    // them produces the oversized/doubled frame seen during New Task loading.
    const canonicalComposer = editorComposerCandidates
      .find((candidate) => candidate.node.matches('[data-codex-composer-root]'))?.node || null;
    // Older builds may not expose data-codex-composer-root. Keep a bounded
    // fallback for those versions, choosing one outer shell only.
    const outermostComposerCandidates = editorComposerCandidates.filter((candidate) =>
      !editorComposerCandidates.some((other) =>
        other.node !== candidate.node && other.node.contains(candidate.node)));
    const fallbackComposer = outermostComposerCandidates[0]?.node ||
      editorComposerCandidates[0]?.node || null;
    const composerAnchor = routeState?.routeReady === true
      ? canonicalComposer || fallbackComposer
      : null;
    document.querySelectorAll('[data-lingglow-codex-composer-anchor]').forEach((node) => {
      if (node === composerAnchor) return;
      clearComposerAnchorState(node);
    });
    if (composerAnchor) {
      setAttribute(composerAnchor, 'data-lingglow-codex-composer-anchor', 'true');
      const width = composerAnchor.getBoundingClientRect().width;
      const travel = -Math.max(0, Math.round(width - 78 - 36));
      const mascotTravel = {
        '--lingglow-mascot-quarter-travel-x': `${Math.round(travel * 0.25)}px`,
        '--lingglow-mascot-half-travel-x': `${Math.round(travel * 0.5)}px`,
        '--lingglow-mascot-three-quarter-travel-x': `${Math.round(travel * 0.75)}px`,
        '--lingglow-mascot-travel-x': `${travel}px`,
      };
      for (const [name, value] of Object.entries(mascotTravel)) {
        if (composerAnchor.style.getPropertyValue(name) !== value) composerAnchor.style.setProperty(name, value);
      }
    }
    const sidebarRowSelector = [
      '[data-app-action-sidebar-row]',
      '[data-app-action-sidebar-project-row]',
      '[data-app-action-sidebar-thread-row]',
    ].join(', ');
    const selectedSidebarRowSelector = [
      '[aria-current="page"]',
      '[aria-current="true"]',
      '[data-state="active"]',
      '[data-state="selected"]',
      '[data-state="current"]',
      '[data-active="1"]',
      '[data-active="true"]',
      '[data-app-action-sidebar-thread-active="true"]',
      '.active',
      '.selected',
      '.is-active',
      '.is-current',
      '.is-selected',
    ].join(', ');
    const selectedSidebarChildSelector = [
      '[aria-current="page"]',
      '[aria-current="true"]',
      '[data-app-action-sidebar-thread-active="true"]',
    ].join(', ');
    for (const row of document.querySelectorAll(`[data-app-action-sidebar-scroll] :is(${sidebarRowSelector})`)) {
      if (!(row instanceof HTMLElement)) continue;
      // Generic child classes such as .active and aria-selected are also used
      // by clocks, status chips and disclosure controls inside idle task rows.
      // Only the row itself may use those broad state signals; a child must
      // expose the explicit current-thread contract.
      const selected = row.matches(selectedSidebarRowSelector) ||
        [...row.children].some((child) => child.matches?.(selectedSidebarChildSelector));
      setAttribute(row, 'data-lingglow-codex-sidebar-state', selected ? 'selected' : 'idle');
    }
    for (const portal of document.querySelectorAll('[data-above-composer-portal], [data-composer-overlay-floating-ui]')) {
      if (!(portal instanceof HTMLElement)) continue;
      if (portal.hasAttribute('data-composer-overlay-floating-ui')) {
        setAttribute(portal, 'data-lingglow-codex-surface', 'above-composer');
        continue;
      }
      for (const child of portal.children) {
        if (child instanceof HTMLElement && child.getClientRects().length > 0) {
          setAttribute(child, 'data-lingglow-codex-surface', 'above-composer');
        }
      }
    }
    for (const summary of document.querySelectorAll('[class~="group/turn-diff-header"]')) {
      if (summary instanceof HTMLElement) {
        setAttribute(summary, 'data-lingglow-codex-surface', 'diff-summary');
      }
    }
    document.querySelectorAll('[data-codex-intelligence-trigger]').forEach((node) => {
      setAttribute(node, 'data-lingglow-codex-control', 'model');
    });
    const classifySubmitState = __DREAM_SKIN_SUBMIT_CLASSIFIER_SOURCE__;
    const submitState = (button) => {
      const signature = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.getAttribute('data-testid') || ''} ${button.textContent || ''}`.trim();
      return classifySubmitState(signature);
    };
    const markSubmitControl = (button, state) => {
      if (!button || !state) return false;
      setAttribute(button, 'data-lingglow-codex-control', state === 'stop' ? 'stop' : 'send');
      setAttribute(button, 'data-lingglow-codex-submit-state', state);
      return true;
    };
    for (const composer of composerAnchor ? [composerAnchor] : []) {
      const buttons = [...composer.querySelectorAll('button')];
      for (const button of buttons) {
        const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''}`.trim();
        if (/(?:full access|workspace write|read only|完全访问|工作区写入|只读|权限|permission)/iu.test(label)) {
          setAttribute(button, 'data-lingglow-codex-control', 'permission');
        } else if (/(?:\b(?:model|gpt|glm|claude|gemini|sol|terra)\b|模型|大模型)/iu.test(label)) {
          setAttribute(button, 'data-lingglow-codex-control', 'model');
        } else if (/(?:voice|microphone|语音|麦克风)/iu.test(label)) {
          setAttribute(button, 'data-lingglow-codex-control', 'voice');
        }
      }
      const submitCandidates = buttons
        .filter((button) => visibleElement(button) &&
          !button.hasAttribute('data-lingglow-codex-control'))
        .map((button) => {
          const state = submitState(button);
          const explicitAction = button.matches([
            'button[type="submit"]',
            'button[data-testid*="send" i]',
            'button[data-testid*="submit" i]',
            'button[data-testid*="stop" i]',
            'button[data-testid*="interrupt" i]',
          ].join(', '));
          const nativePrimary = button.matches('button[class~="bg-token-foreground"]');
          return {
            button,
            state,
            hasPrimaryStructure: explicitAction || nativePrimary,
            score: (state ? 4000 : 0) + (explicitAction ? 2000 : 0) +
              (nativePrimary ? 1000 : 0),
          };
        })
        .filter((candidate) => candidate.state && candidate.hasPrimaryStructure)
        .sort((first, second) => second.score - first.score);
      const primary = submitCandidates[0] || null;
      if (primary) markSubmitControl(primary.button, primary.state);
    }
    document.querySelectorAll('[data-lingglow-plain-text-surface]').forEach((node) => {
      node.removeAttribute('data-lingglow-plain-text-surface');
    });
  };

  const ensure = ({ root: rootPass = true, route = true, layout = true } = {}) => {
    if (window[DISABLED_KEY]) return;
    const root = document.documentElement;
    if (!root) return;
    metrics.ensureCalls += 1;
    if (rootPass) applyRootState(root);
    if (route) {
      const routeState = syncRouteState();
      syncSemanticControls(routeState);
    }
  };

  const cleanup = () => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken) return false;
    window[DISABLED_KEY] = true;
    document.documentElement?.classList.remove("codex-dream-skin");
    document.documentElement?.removeAttribute(SHELL_ATTR);
    document.documentElement?.removeAttribute(APPEARANCE_ATTR);
    document.documentElement?.removeAttribute(UI_FONT_ATTR);
    document.documentElement?.removeAttribute(CODE_FONT_ATTR);
    document.documentElement?.removeAttribute("data-dream-route-home");
    for (const name of ART_ATTRS) document.documentElement?.removeAttribute(name);
    document.documentElement?.style.removeProperty("--dream-skin-art");
    for (const name of THEME_VARIABLES) document.documentElement?.style.removeProperty(name);
    document.querySelectorAll(".dream-skin-home").forEach((node) => node.classList.remove("dream-skin-home"));
    document.querySelectorAll('[data-lingglow-codex-control]').forEach((node) => {
      node.removeAttribute('data-lingglow-codex-control');
      node.removeAttribute('data-lingglow-codex-submit-state');
    });
    document.querySelectorAll('[data-lingglow-codex-surface]').forEach((node) => node.removeAttribute('data-lingglow-codex-surface'));
    document.querySelectorAll(`[${TURN_SURFACE_ATTR}]`).forEach((node) => node.removeAttribute(TURN_SURFACE_ATTR));
    document.querySelectorAll('[data-lingglow-codex-sidebar-state]').forEach((node) => node.removeAttribute('data-lingglow-codex-sidebar-state'));
    document.querySelectorAll('[data-lingglow-codex-composer-anchor]').forEach((node) => {
      clearComposerAnchorState(node);
    });
    document.querySelectorAll('[data-lingglow-plain-text-surface]').forEach((node) => node.removeAttribute('data-lingglow-plain-text-surface'));
    document.getElementById(STYLE_ID)?.remove();
    state?.observer?.disconnect();
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (analysisTimer) clearTimeout(analysisTimer);
    clearHomeGraceTimer();
    if (state?.homeArtUrl && state.homeArtUrl !== state.artUrl) URL.revokeObjectURL(state.homeArtUrl);
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null, route: false };
  const flushScheduledEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = null;
    const pending = { root: false, route: scheduler.route };
    scheduler.route = false;
    ensure(pending);
  };
  const scheduleEnsure = ({ route = true } = {}) => {
    scheduler.route ||= route;
    if (scheduler.timeout) return;
    scheduler.timeout = setTimeout(flushScheduledEnsure, 80);
  };
  const observer = new MutationObserver(() => scheduleEnsure({ route: true }));

  window[STATE_KEY] = {
    ensure,
    cleanup,
    observer,
    scheduler,
    artUrl,
    homeArtUrl,
    installToken,
    analysis: artAnalysis,
    artMetadata: ART_METADATA,
    metrics,
    homeGraceTimer,
    version: VERSION,
    themeId: THEME.id || "custom",
    revision: PAYLOAD_REVISION,
    detectShellMode,
  };
  const firstEnsureStartedAt = now();
  ensure();
  metrics.firstEnsureMs = Number((now() - firstEnsureStartedAt).toFixed(3));
  if (previous?.homeArtUrl && previous.homeArtUrl !== previous.artUrl && previous.homeArtUrl !== homeArtUrl) {
    URL.revokeObjectURL(previous.homeArtUrl);
  }
  if (previous?.artUrl && previous.artUrl !== artUrl) URL.revokeObjectURL(previous.artUrl);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  const analysisPromise = artAnalysis ? Promise.resolve(null) : analyzeArt();
  window[STATE_KEY].analysisTimer = analysisTimer;
  analysisPromise.then((analysis) => {
    const state = window[STATE_KEY];
    if (!analysis || state?.installToken !== installToken || window[DISABLED_KEY]) return;
    artAnalysis = analysis;
    state.analysis = analysis;
    if (typeof THEME.artKey === "string") {
      analysisCache.set(THEME.artKey, analysis);
      while (analysisCache.size > 8) analysisCache.delete(analysisCache.keys().next().value);
    }
    ensure({ root: true, route: false });
  }).catch(() => {});
  return {
    installed: true,
    version: VERSION,
    themeId: THEME.id || "custom",
    revision: PAYLOAD_REVISION,
    shell: resolvedShell(),
    analysis: artAnalysis,
  };
})(__DREAM_SKIN_CSS_JSON__, __DREAM_SKIN_ART_JSON__, __DREAM_SKIN_HOME_ART_JSON__, __DREAM_SKIN_THEME_JSON__)
