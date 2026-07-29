import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isActiveHomeSurface} from './codex-home-detection.mjs';
import {contrastRatio} from './profile.mjs';

const VERSION = '1.12.0-lingglow';
const rendererTemplate = readFileSync(new URL('./vendor/codex-dream-skin/renderer-inject.js', import.meta.url), 'utf8');
// Codex owns the New Task page's geometry and it changes between desktop
// releases.  This sheet deliberately styles only semantic surfaces, leaving
// the live composer and suggestion-card layout entirely to the client.
const cssText = `
:root.codex-dream-skin {
  color-scheme: light !important;
  --ds-bg: #f4f6f8;
  --ds-bg-rgb: 244 246 248;
  --ds-panel: rgba(255, 255, 255, .92);
  --ds-panel-rgb: 255 255 255;
  --ds-panel-2: #edf1f4;
  --ds-panel-2-rgb: 237 241 244;
  --ds-text: #17212b;
  --ds-text-rgb: 23 33 43;
  --ds-muted: #5f6c76;
  --ds-muted-rgb: 95 108 118;
  --ds-green: #176b91;
  --ds-accent-rgb: 23 107 145;
  --ds-accent-alt-rgb: 49 139 178;
  --ds-danger: #b42318;
  --ds-danger-alt: #971d14;
  --ds-danger-rgb: 180 35 24;
  --ds-on-danger: #ffffff;
  --ds-on-accent: #ffffff;
  --ds-line: rgb(var(--ds-accent-rgb) / .18);
  --ds-control-radius: 14px;
  --ds-focus-x: 50%;
  --ds-focus-y: 50%;
  --ds-art-position: var(--ds-focus-x) var(--ds-focus-y);
  --ds-hero-strength: .76;
  --ds-hero-strong: .76;
  --ds-hero-mid: .62;
  --ds-hero-soft: .18;
  --ds-hero-scrim: linear-gradient(90deg,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-strong)) 0%,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-mid)) 50%,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-soft)) 84%,
    transparent 100%);
}

html.codex-dream-skin[data-dream-shell="dark"] {
  color-scheme: dark !important;
  --ds-bg: #11161d;
  --ds-bg-rgb: 17 22 29;
  --ds-panel: rgba(21, 29, 38, .92);
  --ds-panel-rgb: 21 29 38;
  --ds-panel-2: #202b36;
  --ds-panel-2-rgb: 32 43 54;
  --ds-text: #f2f7fb;
  --ds-text-rgb: 242 247 251;
  --ds-muted: #b5c1ca;
  --ds-muted-rgb: 181 193 202;
  --ds-green: #73c6f2;
  --ds-accent-rgb: 115 198 242;
  --ds-accent-alt-rgb: 149 216 249;
  --ds-danger: #ff8a80;
  --ds-danger-alt: #ff9a92;
  --ds-danger-rgb: 255 138 128;
  --ds-on-danger: #1b0b0a;
  --ds-on-accent: #071017;
  --ds-hero-scrim: linear-gradient(90deg,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-strong)) 0%,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-mid)) 50%,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-soft)) 84%,
    transparent 100%);
}

html.codex-dream-skin:is([data-dream-art-safe="right"], [data-dream-art-safe-area="right"]) {
  --ds-hero-scrim: linear-gradient(270deg,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-strong)) 0%,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-mid)) 50%,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-soft)) 84%,
    transparent 100%);
}

html.codex-dream-skin[data-dream-shell="dark"]:is(
  [data-dream-art-safe="right"],
  [data-dream-art-safe-area="right"]
) {
  --ds-hero-scrim: linear-gradient(270deg,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-strong)) 0%,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-mid)) 50%,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-soft)) 84%,
    transparent 100%);
}

html.codex-dream-skin:is([data-dream-art-safe="center"], [data-dream-art-safe-area="center"]) {
  --ds-hero-scrim: linear-gradient(90deg,
    transparent 0%,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-mid)) 26%,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-strong)) 50%,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-mid)) 74%,
    transparent 100%);
}

html.codex-dream-skin[data-dream-shell="dark"]:is(
  [data-dream-art-safe="center"],
  [data-dream-art-safe-area="center"]
) {
  --ds-hero-scrim: linear-gradient(90deg,
    transparent 0%,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-mid)) 26%,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-strong)) 50%,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-mid)) 74%,
    transparent 100%);
}

html.codex-dream-skin:is([data-dream-art-safe="none"], [data-dream-art-safe-area="none"]) {
  --ds-hero-scrim: linear-gradient(180deg,
    rgb(var(--ds-panel-rgb) / var(--ds-hero-soft)),
    rgb(var(--ds-panel-rgb) / var(--ds-hero-soft)));
}

html.codex-dream-skin[data-dream-shell="dark"]:is(
  [data-dream-art-safe="none"],
  [data-dream-art-safe-area="none"]
) {
  --ds-hero-scrim: linear-gradient(180deg,
    rgb(var(--ds-bg-rgb) / var(--ds-hero-soft)),
    rgb(var(--ds-bg-rgb) / var(--ds-hero-soft)));
}

html.codex-dream-skin,
html.codex-dream-skin body {
  background-color: var(--ds-bg) !important;
  color: var(--ds-text) !important;
}

/* A skin may explicitly declare a typeface. When it does not, Codex keeps its
   native UI and code fonts instead of receiving one global LingGlow stack. */
html.codex-dream-skin[data-lingglow-custom-ui-font="true"] body {
  font-family: var(--ds-ui-font) !important;
}

html.codex-dream-skin[data-lingglow-custom-ui-font="true"]
  :is(textarea, input, button, select, [contenteditable="true"], [role="textbox"]) {
  font-family: inherit !important;
}

html.codex-dream-skin[data-lingglow-custom-code-font="true"] :is(pre, code, kbd, samp) {
  font-family: var(--ds-code-font) !important;
}

/* Codex keeps its native Electron appearance class after a LingGlow skin is
   applied. Newer builds therefore continue resolving individual utility
   classes through stale dark tokens even while the skin is locked to light
   (and vice versa). Bind semantic tokens to the selected skin as one unit. */
html.codex-dream-skin {
  --vscode-foreground: var(--ds-text) !important;
  --vscode-descriptionForeground: var(--ds-muted) !important;
  --vscode-disabledForeground: rgb(var(--ds-muted-rgb) / .68) !important;
  --vscode-icon-foreground: var(--ds-text) !important;
  --vscode-editor-foreground: var(--ds-text) !important;
  --vscode-editor-background: transparent !important;
  --vscode-input-foreground: var(--ds-text) !important;
  --vscode-input-placeholderForeground: rgb(var(--ds-muted-rgb) / .78) !important;
  --vscode-dropdown-foreground: var(--ds-text) !important;
  --vscode-dropdown-background: rgb(var(--ds-panel-rgb) / .98) !important;
  --vscode-menu-foreground: var(--ds-text) !important;
  --vscode-menu-background: rgb(var(--ds-panel-rgb) / .98) !important;
  --vscode-button-foreground: var(--ds-text) !important;
  --vscode-button-secondaryForeground: var(--ds-text) !important;
  --vscode-textLink-foreground: var(--ds-green) !important;
  --color-token-foreground: var(--ds-text) !important;
  --color-token-description-foreground: var(--ds-muted) !important;
  --color-token-disabled-foreground: rgb(var(--ds-muted-rgb) / .68) !important;
  --color-token-conversation-header: var(--ds-text) !important;
  --color-token-conversation-body: var(--ds-text) !important;
  --color-token-conversation-summary-leading: var(--ds-text) !important;
  --color-token-conversation-summary-trailing: var(--ds-muted) !important;
  --color-token-non-assistant-body-descendant: var(--ds-text) !important;
  --color-token-text-primary: var(--ds-text) !important;
  --color-token-text-secondary: var(--ds-muted) !important;
  --color-token-text-tertiary: rgb(var(--ds-muted-rgb) / .76) !important;
  --color-token-icon-foreground: var(--ds-text) !important;
  --color-token-link: var(--ds-green) !important;
  --color-token-text-link-foreground: var(--ds-green) !important;
  --color-token-text-link-active-foreground: var(--ds-green) !important;
  --color-token-input-foreground: var(--ds-text) !important;
  --color-token-input-placeholder-foreground: rgb(var(--ds-muted-rgb) / .78) !important;
  --color-token-input-background: rgb(var(--ds-panel-rgb) / .96) !important;
  --color-token-dropdown-foreground: var(--ds-text) !important;
  --color-token-dropdown-background: rgb(var(--ds-panel-rgb) / .98) !important;
  --color-token-menu-background: rgb(var(--ds-panel-rgb) / .98) !important;
  --color-token-button-foreground: var(--ds-text) !important;
  --color-token-badge-foreground: var(--ds-text) !important;
  --color-token-on-accent: var(--ds-on-accent) !important;
  --color-token-bg-primary: rgb(var(--ds-panel-rgb) / .96) !important;
  --color-token-bg-secondary: rgb(var(--ds-panel-2-rgb) / .88) !important;
  --color-token-bg-tertiary: rgb(var(--ds-panel-2-rgb) / .72) !important;
  --color-token-list-hover-background: rgb(var(--ds-accent-rgb) / .16) !important;
  --color-token-border: var(--ds-line) !important;
  --color-token-border-default: var(--ds-line) !important;
  --color-token-focus-border: var(--ds-green) !important;
  --color-token-focus-ring: rgb(var(--ds-accent-rgb) / .42) !important;
  --color-token-charts-blue: var(--ds-green) !important;
  --color-token-charts-green: #35b875 !important;
  --color-token-charts-red: var(--ds-danger) !important;
  --color-token-main-surface-primary: transparent !important;
  --color-token-side-bar-background: transparent !important;
}

html.codex-dream-skin :is(
  [class~="text-token-foreground"],
  [class~="text-token-conversation-header"],
  [class~="text-token-conversation-body"],
  [class~="text-token-conversation-summary-leading"],
  [class~="text-token-non-assistant-body-descendant"],
  [class~="text-token-text-primary"]
) {
  color: var(--ds-text) !important;
  -webkit-text-fill-color: var(--ds-text) !important;
}

html.codex-dream-skin :is(
  [class~="text-token-description-foreground"],
  [class~="text-token-conversation-summary-trailing"],
  [class~="text-token-text-secondary"]
) {
  color: var(--ds-muted) !important;
  -webkit-text-fill-color: var(--ds-muted) !important;
}

html.codex-dream-skin :is(
  [class~="text-token-disabled-foreground"],
  [class~="text-token-text-tertiary"]
) {
  color: rgb(var(--ds-muted-rgb) / .72) !important;
  -webkit-text-fill-color: rgb(var(--ds-muted-rgb) / .72) !important;
}

html.codex-dream-skin [class~="bg-token-bg-primary"] {
  background: rgb(var(--ds-panel-rgb) / .96) !important;
}

html.codex-dream-skin [class~="bg-token-bg-secondary"] {
  background: rgb(var(--ds-panel-2-rgb) / .88) !important;
}

html.codex-dream-skin [class~="bg-token-bg-tertiary"] {
  background: rgb(var(--ds-panel-2-rgb) / .72) !important;
}

html.codex-dream-skin :is(
  [class~="bg-token-dropdown-background"],
  [class~="bg-token-input-background"]
) {
  background: rgb(var(--ds-panel-rgb) / .98) !important;
}

/* Native primary controls use foreground as their fill and dropdown
   background as their on-fill ink. The old adapter recolored only the text
   token, leaving a light native fill under light text in dark skins. */
html.codex-dream-skin [class~="bg-token-foreground"] {
  background: linear-gradient(145deg, rgb(var(--ds-accent-alt-rgb) / .98), var(--ds-green)) !important;
  color: var(--ds-on-accent) !important;
}

html.codex-dream-skin [class~="bg-token-foreground"] :where(*) {
  color: var(--ds-on-accent) !important;
  -webkit-text-fill-color: var(--ds-on-accent) !important;
}

/* The base LingGlow stylesheet owns the only full-window artwork layer on
   body::before.  Do not duplicate it on body or main: multiple translucent
   copies wash the image out and make route changes visibly flash. */
html.codex-dream-skin body {
  background-image: none !important;
}

/* When the native output panel is open, anchor the artwork to the right edge
   so the focal subject moves back into the visible conversation viewport. */
html.codex-dream-skin body:has([data-app-shell-focus-area="right-panel"])::before {
  background-position: center, right center !important;
}

html.codex-dream-skin aside.app-shell-left-panel {
  background: linear-gradient(
    90deg,
    rgb(var(--ds-panel-rgb) / .90) 0%,
    rgb(var(--ds-panel-rgb) / .86) calc(100% - 24px),
    rgb(var(--ds-panel-rgb) / .62) 100%
  ) !important;
  border-right: 0 !important;
  box-shadow: none !important;
  backdrop-filter: blur(22px) saturate(118%) !important;
  -webkit-backdrop-filter: blur(22px) saturate(118%) !important;
}

/* Codex paints its sidebar resize chrome just outside the panel. Preserve the
   native geometry and drag target, but dissolve that extension into the
   conversation instead of leaving a solid vertical strip. */
html.codex-dream-skin aside.app-shell-left-panel::after {
  background: linear-gradient(
    90deg,
    rgb(var(--ds-panel-rgb) / .62) 0%,
    rgb(var(--ds-panel-rgb) / .34) 46%,
    rgb(var(--ds-panel-rgb) / .10) 76%,
    transparent 100%
  ) !important;
  border: 0 !important;
  box-shadow: none !important;
}

html.codex-dream-skin main.main-surface {
  background-color: transparent !important;
  background-image: none !important;
}

html.codex-dream-skin [data-app-shell-main-content-layout],
html.codex-dream-skin .app-shell-main-content-frame {
  background-color: transparent !important;
  background-image: none !important;
  border-color: transparent !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* A wallpaper can contain white sky, dark machinery and saturated artwork in
   the same line of text. One global ink can never stay readable against every
   pixel. Keep the scroll shell unframed and give only the canonical semantic
   native turn a restrained reading surface. Never use the absence of a turn
   marker to paint the shared scroll viewport: loading and empty routes expose
   that exact state. */
html.codex-dream-skin .thread-scroll-container {
  background-color: transparent !important;
  background-image: none !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

html.codex-dream-skin .thread-scroll-container
  [data-lingglow-codex-turn-surface="true"] {
  background: linear-gradient(
    90deg,
    rgb(var(--ds-panel-rgb) / .42) 0%,
    rgb(var(--ds-panel-rgb) / .18) 68%,
    transparent 100%
  ) !important;
  border: 0 !important;
  border-radius: 18px !important;
  box-shadow: none !important;
  color: var(--ds-text) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Codex ships a full-height solid footer gradient behind the composer.  Keep
   only a shallow dissolving edge so content can scroll behind the composer
   without turning the lower half of the conversation into an opaque panel. */
html.codex-dream-skin [data-thread-scroll-footer="true"] > :first-child > :only-child {
  background: linear-gradient(
    to top,
    rgb(var(--ds-panel-rgb) / .38) 0%,
    rgb(var(--ds-panel-rgb) / .14) 48%,
    transparent 100%
  ) !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* The artwork already lives on body::before. The home surface only receives a
   route marker; painting it again creates a full-page pale veil. */
html.codex-dream-skin[data-dream-route-home="true"] [role="main"].dream-skin-home {
  background-color: transparent !important;
  background-image: none !important;
  border: 0 !important;
  border-radius: 24px !important;
  box-shadow: none !important;
  transition: none !important;
  animation: none !important;
}

/* A 3:1 Codex artwork remains a banner painted on the already-detected native
   home surface. It never reorders or resizes React-owned children. */
html.codex-dream-skin[data-dream-route-home="true"][data-dream-art-task-mode="banner"]
  [role="main"].dream-skin-home {
  --ds-home-banner-width: min(1160px, calc(100% - 44px));
  --ds-home-banner-height: clamp(176px, 26vw, 386px);
  background-image: var(--ds-hero-scrim), var(--dream-skin-home-art) !important;
  background-position: center 22px, center 22px !important;
  background-size:
    var(--ds-home-banner-width) var(--ds-home-banner-height),
    var(--ds-home-banner-width) auto !important;
  background-repeat: no-repeat, no-repeat !important;
}

html.codex-dream-skin[data-dream-route-home="true"][data-dream-art-task-mode="banner"]:has(
  [data-app-shell-focus-area="right-panel"]
) [role="main"].dream-skin-home {
  background-position: right 22px top 22px, right 22px top 22px !important;
}

html.codex-dream-skin[data-dream-route-home="true"][data-dream-art-task-mode="banner"]:is(
  [data-dream-art-safe="right"],
  [data-dream-art-safe-area="right"]
):has([data-app-shell-focus-area="right-panel"]) [role="main"].dream-skin-home {
  background-position: left 22px top 22px, left 22px top 22px !important;
}

/* A non-banner image becomes an ambient home layer only while the actual New
   Task surface is visible. Historical conversations keep the global image. */
html.codex-dream-skin[data-dream-route-home="true"][data-dream-art-task-mode="ambient"] body::before {
  inset: 0 !important;
  background:
    var(--ds-hero-scrim),
    var(--dream-skin-home-art) var(--ds-art-position) / cover no-repeat !important;
  opacity: 1 !important;
  filter: none !important;
  transform: none !important;
}

html.codex-dream-skin[data-dream-route-home="true"][data-dream-art-task-mode="ambient"]
  [role="main"].dream-skin-home {
  background: transparent !important;
}

html.codex-dream-skin[data-dream-route-home="true"][data-dream-art-task-mode="ambient"]:has(
  [data-app-shell-focus-area="right-panel"]
) body::before {
  background-position: center, right center !important;
}

html.codex-dream-skin[data-dream-route-home="true"][data-dream-art-task-mode="ambient"][data-dream-art-fit="contain"] body::before {
  background-size: auto, contain !important;
  background-position: center, var(--ds-art-position) !important;
}

html.codex-dream-skin[data-dream-route-home="true"][data-dream-art-task-mode="off"] body::before {
  background-image: none !important;
}

html.codex-dream-skin[data-dream-route-home="true"] .dream-skin-home [data-feature="game-source"] {
  color: var(--ds-text) !important;
  -webkit-text-fill-color: var(--ds-text) !important;
  text-shadow: 0 1px 14px rgb(var(--ds-panel-rgb) / .82) !important;
}

/* Keep every native task entry visible and clickable; only give it a themed
   surface.  No size, flex, position, overflow, or child-order assumptions. */
html.codex-dream-skin[data-dream-route-home="true"] .dream-skin-home .group\\/home-suggestions button {
  border-radius: 18px !important;
  border-color: rgb(var(--ds-accent-rgb) / .28) !important;
  background: rgb(var(--ds-panel-rgb) / .90) !important;
  color: var(--ds-text) !important;
  box-shadow: 0 8px 22px rgb(0 0 0 / .12) !important;
  transition: border-color .16s ease, box-shadow .16s ease, background-color .16s ease !important;
}

html.codex-dream-skin[data-dream-route-home="true"] .dream-skin-home .group\\/home-suggestions button :where(*) {
  color: var(--ds-text) !important;
  -webkit-text-fill-color: var(--ds-text) !important;
}

html.codex-dream-skin[data-dream-route-home="true"] .dream-skin-home .group\\/home-suggestions button:hover,
html.codex-dream-skin[data-dream-route-home="true"] .dream-skin-home .group\\/home-suggestions button:focus-visible {
  border-color: var(--ds-green) !important;
  background: rgb(var(--ds-panel-rgb) / .98) !important;
  box-shadow: 0 12px 28px rgb(0 0 0 / .17), 0 0 0 3px rgb(var(--ds-accent-rgb) / .16) !important;
}

html.codex-dream-skin [data-lingglow-codex-composer-anchor="true"] {
  background: var(--ds-panel) !important;
  border: 1px solid var(--ds-line) !important;
  border-radius: 22px !important;
  outline: 0 !important;
  box-sizing: border-box !important;
  background-clip: padding-box !important;
  isolation: isolate !important;
  box-shadow: 0 10px 30px rgb(0 0 0 / .16) !important;
  backdrop-filter: blur(22px) saturate(118%) !important;
  -webkit-backdrop-filter: blur(22px) saturate(118%) !important;
}

/* Codex nests its editable composer inside the visible surface chrome. Only
   the outer shell receives the rounded frame; the inner editor/tool rows do
   not draw a second rectangle. */
html.codex-dream-skin [data-lingglow-codex-composer-anchor="true"] :is(
  .composer-surface-chrome,
  [data-codex-composer-root],
  [data-codex-composer],
  [data-thread-find-composer]
) {
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* data-thread-find-composer and the legacy surface marker may wrap the
   canonical data-codex-composer-root. Clear those ancestors explicitly; a
   descendant-only reset cannot prevent the real DOM from drawing two frames. */
html.codex-dream-skin :is(
  [data-thread-find-composer],
  .composer-surface-chrome,
  [data-codex-composer]
):has([data-lingglow-codex-composer-anchor="true"]) {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
}

html.codex-dream-skin :is(
  [data-thread-find-composer],
  .composer-surface-chrome,
  [data-codex-composer]
):has([data-lingglow-codex-composer-anchor="true"])::before,
html.codex-dream-skin :is(
  [data-thread-find-composer],
  .composer-surface-chrome,
  [data-codex-composer]
):has([data-lingglow-codex-composer-anchor="true"])::after {
  background: transparent !important;
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
}

/* Some Codex builds draw the native focus ring with a pseudo-element on an
   inner composer surface. Preserve the anchor's ::after mascot, but dissolve
   native inner rings so the canonical root remains the only visible frame. */
html.codex-dream-skin [data-lingglow-codex-composer-anchor="true"]::before,
html.codex-dream-skin [data-lingglow-codex-composer-anchor="true"] :is(
  .composer-surface-chrome,
  [data-codex-composer-root],
  [data-codex-composer],
  [data-thread-find-composer]
)::before,
html.codex-dream-skin [data-lingglow-codex-composer-anchor="true"] :is(
  .composer-surface-chrome,
  [data-codex-composer-root],
  [data-codex-composer],
  [data-thread-find-composer]
)::after {
  background: transparent !important;
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
}

/* Above-composer portals and completed-turn diff summaries are independent
   native surfaces. They are outside the composer subtree, so they need their
   own semantic surface instead of inheriting a stale light renderer card. */
html.codex-dream-skin [data-lingglow-codex-surface="above-composer"] {
  background: transparent !important;
  color: var(--ds-text) !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

html.codex-dream-skin [data-lingglow-codex-surface="diff-summary"] {
  background: rgb(var(--ds-panel-rgb) / .96) !important;
  color: var(--ds-text) !important;
  border: 0 !important;
  border-radius: 16px !important;
  box-shadow: 0 8px 24px rgb(0 0 0 / .14) !important;
  backdrop-filter: blur(20px) saturate(116%) !important;
  -webkit-backdrop-filter: blur(20px) saturate(116%) !important;
}

html.codex-dream-skin [data-lingglow-codex-surface="diff-summary"] :is(button, [role="button"]) {
  border: 1px solid var(--ds-line) !important;
  border-radius: 999px !important;
  background: rgb(var(--ds-panel-2-rgb) / .90) !important;
  color: var(--ds-text) !important;
  -webkit-text-fill-color: var(--ds-text) !important;
  box-shadow: none !important;
}

html.codex-dream-skin [data-lingglow-codex-surface="diff-summary"] :is(button, [role="button"]) :where(*) {
  color: var(--ds-text) !important;
  -webkit-text-fill-color: var(--ds-text) !important;
}

html.codex-dream-skin [data-app-shell-focus-area="right-panel"] {
  background: rgb(var(--ds-panel-rgb) / .94) !important;
  color: var(--ds-text) !important;
  border-color: var(--ds-line) !important;
  box-shadow: -12px 0 34px rgb(0 0 0 / .10) !important;
  backdrop-filter: blur(22px) saturate(118%) !important;
  -webkit-backdrop-filter: blur(22px) saturate(118%) !important;
}

/* Sidebar selection, model chooser, permission pill and send/stop controls all
   receive an explicit state treatment instead of inheriting stock Codex grey. */
html.codex-dream-skin aside.app-shell-left-panel
  [data-lingglow-codex-sidebar-state="selected"] {
  border: 1px solid rgb(var(--ds-accent-rgb) / .48) !important;
  background: linear-gradient(90deg, rgb(var(--ds-accent-rgb) / .32), rgb(var(--ds-accent-rgb) / .11)) !important;
  color: var(--ds-text) !important;
  box-shadow:
    inset 4px 0 var(--ds-green),
    0 6px 18px rgb(var(--ds-bg-rgb) / .16) !important;
  border-radius: 12px !important;
  font-weight: 700 !important;
}

html.codex-dream-skin aside.app-shell-left-panel [data-lingglow-codex-sidebar-state="idle"] {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  font-weight: inherit !important;
}

html.codex-dream-skin aside.app-shell-left-panel [data-lingglow-codex-sidebar-state="idle"]:hover {
  background: rgb(var(--ds-accent-rgb) / .09) !important;
}

html.codex-dream-skin aside.app-shell-left-panel
  [data-lingglow-codex-sidebar-state="selected"] :where(*) {
  color: var(--ds-text) !important;
  -webkit-text-fill-color: var(--ds-text) !important;
}

html.codex-dream-skin [data-lingglow-codex-control="model"],
html.codex-dream-skin [data-lingglow-codex-control="permission"] {
  border: 1px solid rgb(var(--ds-accent-rgb) / .30) !important;
  border-radius: 999px !important;
  background: rgb(var(--ds-panel-rgb) / .82) !important;
  color: var(--ds-text) !important;
  box-shadow: 0 6px 18px rgb(0 0 0 / .12) !important;
}

html.codex-dream-skin :is(
  [data-lingglow-codex-control="model"],
  [data-lingglow-codex-control="permission"]
) :where(*) {
  color: var(--ds-text) !important;
  -webkit-text-fill-color: var(--ds-text) !important;
}

html.codex-dream-skin [data-lingglow-codex-control="model"]:hover,
html.codex-dream-skin [data-lingglow-codex-control="permission"]:hover,
html.codex-dream-skin [data-lingglow-codex-control="model"]:focus-visible,
html.codex-dream-skin [data-lingglow-codex-control="permission"]:focus-visible {
  border-color: var(--ds-green) !important;
  background: rgb(var(--ds-panel-rgb) / .96) !important;
  box-shadow: 0 0 0 3px rgb(var(--ds-accent-rgb) / .16) !important;
}

html.codex-dream-skin :is(
  [data-lingglow-codex-control="send"],
  [data-lingglow-codex-control="stop"]
) {
  position: relative !important;
  display: inline-grid !important;
  place-items: center !important;
  box-sizing: border-box !important;
  width: 40px !important;
  min-width: 40px !important;
  height: 40px !important;
  min-height: 40px !important;
  padding: 0 !important;
  border-radius: 999px !important;
  appearance: none !important;
  transform: translateY(0) scale(1) !important;
  transform-origin: center !important;
  transition:
    transform .16s ease,
    border-color .16s ease,
    background .16s ease,
    box-shadow .16s ease,
    filter .16s ease !important;
}

html.codex-dream-skin [data-lingglow-codex-control="send"] {
  border: 1px solid rgb(var(--ds-accent-alt-rgb) / .72) !important;
  background: linear-gradient(
    145deg,
    var(--ds-lime),
    var(--ds-green) 72%
  ) !important;
  color: var(--ds-on-accent) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .22),
    0 6px 16px rgb(var(--ds-accent-rgb) / .24) !important;
}

html.codex-dream-skin [data-lingglow-codex-control="send"] :where(*) {
  color: var(--ds-on-accent) !important;
  -webkit-text-fill-color: var(--ds-on-accent) !important;
}

html.codex-dream-skin [data-lingglow-codex-control="stop"] {
  border: 1px solid rgb(var(--ds-danger-rgb) / .46) !important;
  background: linear-gradient(
    145deg,
    rgb(var(--ds-panel-rgb) / .94),
    rgb(var(--ds-danger-rgb) / .16)
  ) !important;
  color: var(--ds-danger) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .18),
    0 5px 14px rgb(0 0 0 / .12) !important;
  animation: none !important;
}

html.codex-dream-skin [data-lingglow-codex-control="stop"] :where(*) {
  color: currentColor !important;
  -webkit-text-fill-color: currentColor !important;
}

html.codex-dream-skin :is(
  [data-lingglow-codex-control="send"],
  [data-lingglow-codex-control="stop"]
) svg {
  width: 19px !important;
  height: 19px !important;
  filter: drop-shadow(0 1px 1px rgb(0 0 0 / .22)) !important;
}

html.codex-dream-skin :is(
  [data-lingglow-codex-control="send"],
  [data-lingglow-codex-control="stop"]
) svg [fill]:not([fill="none"]) {
  fill: currentColor !important;
}

html.codex-dream-skin :is(
  [data-lingglow-codex-control="send"],
  [data-lingglow-codex-control="stop"]
) svg [stroke]:not([stroke="none"]) {
  stroke: currentColor !important;
}

html.codex-dream-skin [data-lingglow-codex-control="send"]:is(:hover, :focus-visible) {
  border-color: rgb(var(--ds-accent-alt-rgb) / .96) !important;
  filter: saturate(1.08) brightness(1.04) !important;
  transform: translateY(-1px) scale(1.025) !important;
  box-shadow: 0 8px 20px rgb(var(--ds-accent-rgb) / .30),
    0 0 0 3px rgb(var(--ds-accent-rgb) / .13) !important;
}

html.codex-dream-skin [data-lingglow-codex-control="stop"]:is(:hover, :focus-visible) {
  border-color: rgb(var(--ds-danger-rgb) / .86) !important;
  background: var(--ds-danger) !important;
  color: var(--ds-on-danger) !important;
  filter: saturate(1.06) !important;
  transform: translateY(-1px) scale(1.025) !important;
  box-shadow: 0 8px 20px rgb(var(--ds-danger-rgb) / .26),
    0 0 0 3px rgb(var(--ds-danger-rgb) / .12) !important;
}

html.codex-dream-skin :is(
  [data-lingglow-codex-control="send"],
  [data-lingglow-codex-control="stop"]
):active {
  transform: translateY(0) scale(.965) !important;
}

/* A visible semantic stop control means the Agent is running. Some Codex
   builds transiently keep the native disabled attribute while swapping the
   submit icon, so only an unavailable send action receives the muted state. */
html.codex-dream-skin [data-lingglow-codex-control="send"]:is(:disabled, [aria-disabled="true"]) {
  background: linear-gradient(145deg, rgb(var(--ds-panel-rgb) / .82), rgb(var(--ds-panel-2-rgb) / .62)) !important;
  border-color: var(--ds-line) !important;
  color: var(--ds-muted) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .22) !important;
  filter: saturate(.35) !important;
  opacity: .68 !important;
  transform: none !important;
  animation: none !important;
}

html.codex-dream-skin [data-lingglow-codex-control="stop"]:is(:disabled, [aria-disabled="true"]) {
  border-color: rgb(var(--ds-danger-rgb) / .46) !important;
  background: linear-gradient(
    145deg,
    rgb(var(--ds-panel-rgb) / .94),
    rgb(var(--ds-danger-rgb) / .16)
  ) !important;
  color: var(--ds-danger) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .18),
    0 5px 14px rgb(0 0 0 / .12) !important;
  filter: none !important;
  opacity: 1 !important;
  transform: none !important;
  animation: none !important;
}

html.codex-dream-skin :is(
  [role="listbox"],
  [role="menu"],
  [data-radix-menu-content],
  [data-radix-select-content],
  [data-radix-popper-content-wrapper] > *
) {
  border: 1px solid var(--ds-line) !important;
  border-radius: 16px !important;
  background: rgb(var(--ds-panel-rgb) / .98) !important;
  color: var(--ds-text) !important;
  box-shadow: 0 18px 46px rgb(0 0 0 / .24) !important;
  backdrop-filter: blur(22px) saturate(118%) !important;
  -webkit-backdrop-filter: blur(22px) saturate(118%) !important;
}

html.codex-dream-skin :is(
  [role="listbox"],
  [role="menu"],
  [data-radix-menu-content],
  [data-radix-select-content],
  [data-radix-popper-content-wrapper] > *
) :where(
  [role="option"],
  [role="menuitem"],
  [role="menuitemradio"],
  [role="menuitemcheckbox"],
  [data-radix-collection-item],
  button,
  div,
  span,
  p,
  label,
  strong,
  small
) {
  color: var(--ds-text) !important;
  -webkit-text-fill-color: var(--ds-text) !important;
}

html.codex-dream-skin :is(
  [role="option"],
  [role="menuitem"],
  [role="menuitemradio"],
  [role="menuitemcheckbox"],
  [data-radix-collection-item]
):is(
  :hover,
  :focus-visible,
  [aria-selected="true"],
  [aria-checked="true"],
  [data-state="checked"],
  [data-state="active"]
) {
  border-radius: 10px !important;
  background: rgb(var(--ds-accent-rgb) / .14) !important;
  color: var(--ds-text) !important;
}

html.codex-dream-skin :is([role="separator"], [data-radix-menu-separator]) {
  background: var(--ds-line) !important;
  border-color: var(--ds-line) !important;
}

/* Text nodes do not own surfaces. The surrounding composer, card, menu or
   reading layer does, avoiding nested strips behind labels and editors. */
html.codex-dream-skin :where(h1, h2, h3, h4, h5, h6, p, label, legend, figcaption) {
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}

html.codex-dream-skin :is(textarea, input, [contenteditable="true"]) {
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  color: var(--ds-text) !important;
  caret-color: var(--ds-green) !important;
}

html.codex-dream-skin :is(textarea, input)::placeholder {
  color: rgb(var(--ds-muted-rgb) / .78) !important;
  -webkit-text-fill-color: rgb(var(--ds-muted-rgb) / .78) !important;
  opacity: 1 !important;
}

@media (prefers-reduced-motion: reduce) {
  html.codex-dream-skin *, html.codex-dream-skin *::before, html.codex-dream-skin *::after {
    animation: none !important;
    transition-duration: .01ms !important;
  }
}
`;
const styleRevision = createHash('sha256').update(cssText).digest('hex').slice(0, 16);

export function codexDreamSkinCssForTesting() {
  return cssText;
}

function dreamThemeFor(compiledSkin, image, homeImage = image) {
  const profile = compiledSkin?.profile || {};
  const official = profile.official || {};
  const advanced = profile.advanced || {};
  const id = profile.id || compiledSkin?.profileId || 'lingglow-custom';
  const appearance = official.variant === 'light' ? 'light' : 'dark';
  const surface = normalizeHexColor(
    official.surface,
    appearance === 'light' ? '#F4F6F8' : '#11161D',
  );
  const declaredInk = normalizeHexColor(
    official.ink,
    appearance === 'light' ? '#17212B' : '#F5FAFF',
  );
  const text = readableColor(declaredInk, surface, 4.5);
  const accent = contrastSafeAccent(official.accent || '#73C6F2', surface, appearance);
  const danger = contrastSafeAccent(
    official.semanticColors?.diffRemoved || '#EF4444',
    surface,
    appearance,
  );
  const onAccent = bestContrastingInk(accent);
  const onDanger = bestContrastingInk(danger);
  const accentAlt = actionRaisedColor(accent, onAccent);
  const dangerAlt = actionRaisedColor(danger, onDanger);
  const panelAlt = mixHex(surface, text, appearance === 'light' ? 0.07 : 0.11);
  const mutedCandidate = mixHex(text, surface, 0.30);
  const muted = readableColor(mutedCandidate, surface, 4.5);
  const controlRadius = Math.max(12, Math.min(16, Number(advanced.radius ?? 16) - 2));
  const uiFont = fontStack(official.fonts?.ui,
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif');
  const codeFont = fontStack(official.fonts?.code,
    '"SFMono-Regular", "SF Mono", Menlo, Consolas, monospace');
  const hasDedicatedHomeBanner = homeImage !== image && advanced.banner?.enabled !== false;
  const fallbackSafeArea = ['top-right', 'bottom-right'].includes(advanced.banner?.position)
    ? 'left'
    : 'center';
  const fallbackFocusX = fallbackSafeArea === 'left' ? 0.72 : 0.5;
  const scrimStrength = clampNumber(1.30 - Number(advanced.banner?.opacity ?? 0.55), 0.35, 0.85);
  return {
    schemaVersion: 1,
    id,
    name: profile.name || '灵妆 Codex Skin',
    brandSubtitle: 'LINGGLOW CODEX SKIN',
    tagline: advanced.workbuddy?.homeCopy?.subtitle || '把喜欢的画面变成可交互的 Codex 工作台。',
    projectPrefix: '选择项目 · ',
    projectLabel: '◉  选择项目',
    statusText: 'LINGGLOW THEME ONLINE',
    quote: 'MAKE SOMETHING WONDERFUL',
    homeTitle: advanced.homeCopy?.title || null,
    appearance,
    artKey: `${id}:${createHash('sha256').update(homeImage).digest('hex').slice(0, 16)}`,
    art: {
      // Existing Theme Packs already author their focal side through the
      // fixed banner position. Keep that explicit signal authoritative: pixel
      // saliency is useful for palette/aspect QA but can mistake bright empty
      // sky for the subject and flip the readability ramp.
      safeArea: fallbackSafeArea,
      focusX: fallbackFocusX,
      focusY: 0.5,
      taskMode: hasDedicatedHomeBanner ? 'banner' : 'ambient',
      fit: 'cover',
      scrimStrength,
    },
    // First-paint metadata mirrors the explicit author position. The renderer
    // still samples the actual image for palette/aspect QA, but it must not
    // override the authored safe side with a brightness-based guess.
    artMetadata: {
      safeArea: fallbackSafeArea,
      focusX: fallbackFocusX,
      focusY: 0.5,
      taskMode: hasDedicatedHomeBanner ? 'banner' : 'ambient',
    },
    colors: {
      background: surface,
      panel: surface,
      panelAlt,
      accent,
      accentAlt,
      danger,
      dangerAlt,
      onAccent,
      onDanger,
      text,
      muted,
    },
    explicitColorKeys: [
      'background', 'panel', 'panelAlt', 'accent', 'accentAlt', 'danger', 'dangerAlt',
      'onAccent', 'onDanger', 'text', 'muted',
    ],
    controlRadius,
    fonts: {ui: uiFont, code: codeFont},
  };
}

function clampNumber(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeHexColor(value, fallback) {
  return /^#[0-9a-f]{6}$/iu.test(String(value || ''))
    ? String(value).toUpperCase()
    : fallback.toUpperCase();
}

function colorChannels(value) {
  const normalized = normalizeHexColor(value, '#000000');
  return [1, 3, 5].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
}

function colorFromChannels(channels) {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function mixHex(from, to, ratio) {
  const first = colorChannels(from);
  const second = colorChannels(to);
  const amount = clampNumber(ratio, 0, 1);
  return colorFromChannels(first.map((channel, index) => channel * (1 - amount) + second[index] * amount));
}

function bestContrastingInk(surface) {
  return contrastRatio('#FFFFFF', surface) >= contrastRatio('#111111', surface)
    ? '#FFFFFF'
    : '#111111';
}

function readableColor(preferred, surface, minimum) {
  const normalized = normalizeHexColor(preferred, bestContrastingInk(surface));
  return contrastRatio(normalized, surface) >= minimum
    ? normalized
    : bestContrastingInk(surface);
}

function actionRaisedColor(fill, foreground) {
  return mixHex(fill, foreground === '#FFFFFF' ? '#000000' : '#FFFFFF', 0.08);
}

function contrastSafeAccent(value, surface, appearance) {
  const fallback = appearance === 'light' ? '#176B91' : '#73C6F2';
  const source = normalizeHexColor(value, fallback);
  if (contrastRatio(source, surface) >= 4.5) return source;
  const target = bestContrastingInk(surface);
  for (let step = 0; step <= 10; step += 1) {
    const ratio = step / 10;
    const candidate = mixHex(source, target, ratio);
    if (contrastRatio(candidate, surface) >= 4.5) return candidate;
  }
  return readableColor(fallback, surface, 4.5);
}

function fontStack(font, fallback) {
  const value = typeof font === 'string' ? font.trim() : '';
  if (!value) return null;
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `"${escaped}", ${fallback}`;
}

export function classifyCodexSubmitState(value) {
  const signature = String(value || '').trim();
  if (!signature) return null;
  const stop = /(?:^|[\s_:/-])(?:stop|interrupt)(?=$|[\s_:/-])|停止(?:生成|响应)?|中断|^(?:pause|暂停)$/iu;
  const queue = /(?:^|[\s_:/-])(?:queue|enqueue)(?=$|[\s_:/-])|排队|追加/iu;
  const steer = /(?:^|[\s_:/-])(?:steer|guide)(?=$|[\s_:/-])|引导|调整方向/iu;
  const send = /(?:^|[\s_:/-])(?:send|submit)(?=$|[\s_:/-])|(?:发送|提交)(?:消息|请求)?/iu;
  if (stop.test(signature)) return 'stop';
  if (queue.test(signature)) return 'queue';
  if (steer.test(signature)) return 'steer';
  if (send.test(signature)) return 'send';
  return null;
}

const runtimeRevision = createHash('sha256')
  .update(VERSION)
  .update(rendererTemplate)
  .update(isActiveHomeSurface.toString())
  .update(classifyCodexSubmitState.toString())
  .digest('hex')
  .slice(0, 16);

export function codexDreamSkinRuntimeRevisionForTesting() {
  return runtimeRevision;
}

export function codexDreamThemeForTesting(
  compiledSkin,
  image = 'data:image/png;base64,AA==',
  homeImage = image,
) {
  return dreamThemeFor(compiledSkin, image, homeImage);
}

export function codexDreamSkinInjectionSource(compiledSkin) {
  const image = compiledSkin?.profile?.advanced?.background?.image;
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return null;
  const configuredHomeImage = compiledSkin?.runtimeVisual?.codexHomeImage ??
    compiledSkin?.profile?.advanced?.banner?.image;
  const homeImage = typeof configuredHomeImage === 'string' && configuredHomeImage.startsWith('data:image/')
    ? configuredHomeImage
    : image;
  const theme = dreamThemeFor(compiledSkin, image, homeImage);
  const payloadRevision = createHash('sha256')
    .update(runtimeRevision)
    .update(styleRevision)
    .update(image)
    .update(homeImage)
    .update(JSON.stringify(theme))
    .digest('hex')
    .slice(0, 20);
  // Replacement callbacks, not strings: a skin name or home copy containing a
  // $-substitution pattern ($$, $&, $` or $') would otherwise be expanded by
  // GetSubstitution and rewrite the payload around the placeholder.
  const referencePayload = rendererTemplate
    .replaceAll('__DREAM_SKIN_VERSION_JSON__', () => JSON.stringify(VERSION))
    .replaceAll('__DREAM_SKIN_STYLE_REVISION_JSON__', () => JSON.stringify(styleRevision))
    .replaceAll('__DREAM_SKIN_PAYLOAD_REVISION_JSON__', () => JSON.stringify(payloadRevision))
    .replaceAll('__DREAM_SKIN_HOME_CLASSIFIER_SOURCE__', () => isActiveHomeSurface.toString())
    .replaceAll('__DREAM_SKIN_SUBMIT_CLASSIFIER_SOURCE__', () => classifyCodexSubmitState.toString())
    .replaceAll('__DREAM_SKIN_CSS_JSON__', () => JSON.stringify(cssText))
    .replaceAll('__DREAM_SKIN_ART_JSON__', () => JSON.stringify(image))
    .replaceAll('__DREAM_SKIN_HOME_ART_JSON__', () => JSON.stringify(homeImage))
    .replaceAll('__DREAM_SKIN_THEME_JSON__', () => JSON.stringify(theme));
  return `(() => {
    const existing = window.__CODEX_DREAM_SKIN_STATE__;
    if (existing?.revision === ${JSON.stringify(payloadRevision)} && existing?.themeId === ${JSON.stringify(theme.id)}) {
      existing.ensure?.({root: true, route: true, layout: true});
      return {installed: true, reused: true, version: ${JSON.stringify(VERSION)}, themeId: ${JSON.stringify(theme.id)}, revision: ${JSON.stringify(payloadRevision)}};
    }
    const result = ${referencePayload};
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    if (!state) return result;
    const customHomeTitle = ${JSON.stringify(theme.homeTitle)};
    const syncLingGlowHomeTitle = () => {
      if (!customHomeTitle) return;
      const heading = document.querySelector('[data-feature="game-source"]');
      const projectButton = heading?.querySelector('button');
      if (!heading || !projectButton) return;
      let textNodes = [...heading.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
      if (!heading.hasAttribute('data-lingglow-original-codex-home-copy')) {
        heading.dataset.lingglowOriginalCodexHomeCopy = JSON.stringify(textNodes.map((node) => node.nodeValue || ''));
      }
      if (textNodes.length < 2) {
        const trailing = document.createTextNode('');
        projectButton.after(trailing);
        textNodes = [...heading.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
      }
      const projectPlaceholder = customHomeTitle.includes('{project}') ? '{project}' : '{项目}';
      const parts = customHomeTitle.split(projectPlaceholder);
      textNodes[0].nodeValue = parts.length > 1 ? parts[0] : customHomeTitle + ' ';
      for (let index = 1; index < textNodes.length; index += 1) textNodes[index].nodeValue = '';
      if (parts.length > 1 && textNodes[1]) textNodes[1].nodeValue = parts.slice(1).join(projectPlaceholder);
    };
    const referenceEnsure = state.ensure;
    state.ensure = (options) => {
      const output = referenceEnsure?.(options);
      syncLingGlowHomeTitle();
      return output;
    };
    syncLingGlowHomeTitle();
    const referenceCleanup = state.cleanup;
    state.cleanup = () => {
      document.querySelectorAll('[data-lingglow-original-codex-home-copy]').forEach((heading) => {
        try {
          const originals = JSON.parse(heading.dataset.lingglowOriginalCodexHomeCopy || '[]');
          const textNodes = [...heading.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
          textNodes.forEach((node, index) => { node.nodeValue = originals[index] || ''; });
        } catch {}
        delete heading.dataset.lingglowOriginalCodexHomeCopy;
      });
      return referenceCleanup?.();
    };
    return result;
  })()`;
}
