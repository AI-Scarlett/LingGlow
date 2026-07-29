import {contrastRatio, normalizeProfile, officialThemeString} from './profile.mjs';
import {compilerConsumptionAudit} from './capability-schema.mjs';

const STYLE_ID = '__codex_skin_studio_style_v1__';
const ROOT_ATTRIBUTE = 'data-codex-skin-studio';
const DEFERRED_APPLY_KEY = '__codex_skin_studio_deferred_apply_v1__';

function rgb(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

function rgba(hex, alpha) {
  return 'rgba(' + rgb(hex).join(', ') + ', ' + Number(alpha).toFixed(3) + ')';
}

function mixHex(colorA, colorB, weight = 0.5) {
  const ratio = Math.max(0, Math.min(1, Number(weight)));
  const a = rgb(colorA);
  const b = rgb(colorB);
  return '#' + a.map((channel, index) => Math.round(channel * ratio + b[index] * (1 - ratio))
    .toString(16).padStart(2, '0')).join('').toUpperCase();
}

function readableInkForSurface(ink, surface, minimum = 4.2) {
  if (contrastRatio(ink, surface) >= minimum) return ink;
  return contrastRatio('#171717', surface) >= contrastRatio('#F7F7F5', surface)
    ? '#171717'
    : '#F7F7F5';
}

function cssString(value) {
  return JSON.stringify(String(value));
}

const defaultExactCapabilities = Object.freeze([
  'background', 'palette', 'glass', 'composer', 'banner', 'motion', 'sidebar-width',
  'brand', 'navigation', 'controls', 'project-hero',
  'composer-avatar',
]);
const defaultGenericCapabilities = Object.freeze(['background', 'palette', 'glass', 'composer-avatar']);

function backgroundRule(profile, enabled) {
  if (!enabled) return '';
  const {background} = profile.advanced;
  const image = background.image ? `url("${background.image}")` : 'none';
  const blurShift = background.blur ? '-' + (background.blur * 2) + 'px' : '0';
  return 'html[' + ROOT_ATTRIBUTE + '] body::before {\n'
    + '  content: "";\n'
    + '  position: fixed;\n'
    + '  inset: ' + blurShift + ';\n'
    + '  z-index: 0;\n'
    + '  pointer-events: none;\n'
    + '  background:\n'
    + '    linear-gradient(' + rgba(profile.official.surface, background.overlay) + ', '
    + rgba(profile.official.surface, background.overlay) + '),\n'
    + '    ' + image + ' ' + background.position + ' / cover no-repeat;\n'
    + '  opacity: ' + background.opacity + ';\n'
    + '  filter: blur(' + background.blur + 'px);\n'
    + '  transform: scale(1.02);\n}';
}

function bannerRule(profile, enabled) {
  const {banner} = profile.advanced;
  if (!enabled || !banner.enabled || !banner.image) return '';
  const positions = {
    'top-center': 'top: 58px; left: 50%; transform: translateX(-50%);',
    'top-right': 'top: 58px; right: 24px;',
    'bottom-right': 'bottom: 84px; right: 24px;',
  };
  return 'html[' + ROOT_ATTRIBUTE + '] body::after {\n'
    + '  content: "";\n'
    + '  position: fixed;\n'
    + '  ' + positions[banner.position] + '\n'
    + '  width: min(' + banner.width + 'px, calc(100vw - 48px));\n'
    + '  height: ' + banner.height + 'px;\n'
    + '  z-index: 0;\n'
    + '  pointer-events: none;\n'
    + '  border-radius: ' + profile.advanced.radius + 'px;\n'
    + '  background:\n'
    + '    linear-gradient(90deg, ' + rgba(profile.official.surface, 0.58) + ', '
    + rgba(profile.official.surface, 0.72) + '),\n'
    + '    url("' + banner.image + '") center / cover no-repeat;\n'
    + '  opacity: ' + banner.opacity + ';\n'
    + '  box-shadow: 0 18px 54px rgba(0, 0, 0, .28), inset 0 0 0 1px rgba(255, 255, 255, .10);\n'
    + '  filter: saturate(.75) brightness(.78);\n'
    + '}';
}

function motionRules(profile, {enabled, backgroundEnabled}) {
  if (!enabled || profile.advanced.motion === 'none') return '';
  const duration = profile.advanced.motion === 'float' ? '9s' : '18s';
  const rootSelector = 'html[' + ROOT_ATTRIBUTE + ']';
  const backgroundAnimation = backgroundEnabled
    ? rootSelector + ' body::before { animation: codex-skin-breathe-v1 ' + duration + ' ease-in-out infinite; }'
    : '';
  return '@keyframes codex-skin-breathe-v1 {\n'
    + '  0%, 100% { transform: scale(1.02) translate3d(0, 0, 0); }\n'
    + '  50% { transform: scale(1.045) translate3d(0, -3px, 0); }\n'
    + '}\n'
    + backgroundAnimation + '\n'
    + rootSelector + ' button { transition: transform 140ms ease, filter 140ms ease; }\n'
    + rootSelector + ' button:hover { filter: brightness(1.05); }\n'
    + '@media (prefers-reduced-motion: reduce) {\n'
    + '  ' + rootSelector + ' body::before, ' + rootSelector + ' button { animation: none !important; transition: none !important; }\n'
    + '}';
}

function workbuddyNavigationRules(profile, {enabled, panel, border, accentInk}) {
  if (!enabled) return '';
  const accent = profile.official.accent;
  const ink = readableInkForSurface(profile.official.ink, profile.official.surface);
  const radius = Math.min(profile.advanced.radius, 14);
  return `
/* WorkBuddy exact adapter: navigation and selection language. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list {
  border-right: 1px solid ${rgba(accent, 0.14)} !important;
  box-shadow: 10px 0 28px ${rgba(ink, 0.08)} !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-topbar-actions button,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-search-button,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-task-filter-trigger,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .msg-center-bell-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-trigger-miniprogram {
  border-radius: ${radius}px !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-topbar-actions button:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-search-button:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-task-filter-trigger:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .msg-center-bell-btn:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-trigger-miniprogram:hover {
  background: ${rgba(accent, 0.10)} !important;
  color: ${accent} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tabs button.conversation-list-tab-button,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tabs button.conversation-list-tab-button-more,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-nav-item,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-sidebar-nav__item {
  border: 1px solid ${rgba(accent, 0.08)} !important;
  border-radius: ${radius}px !important;
  background: ${rgba(profile.official.surface, 0.42)} !important;
  color: ${ink} !important;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tab-row {
  border: 1px solid ${rgba(accent, 0.08)} !important;
  border-radius: ${radius}px !important;
  background: ${rgba(profile.official.surface, 0.42)} !important;
  color: ${ink} !important;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tab-row > button.conversation-list-tab-button {
  border-color: transparent !important;
  background: transparent !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tabs button.conversation-list-tab-button:not(.active):not([aria-selected="true"]):hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tabs button.conversation-list-tab-button-more:not(.active):not([aria-selected="true"]):hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tab-row:not(.active):not(:has(> button[aria-selected="true"])):hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-nav-item:not(.conversation-list-nav-item-active):hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-sidebar-nav__item:not(.cb-sidebar-nav__item--disabled):hover {
  background: ${rgba(accent, 0.09)} !important;
  border-color: ${rgba(accent, 0.13)} !important;
  color: ${accent} !important;
  transform: translateX(2px);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tabs button.conversation-list-tab-button-box:is(.active, [aria-selected="true"]),
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tabs button.conversation-list-tab-button-more:is(.active, [aria-selected="true"]),
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tab-row:is(.active, :has(> button[aria-selected="true"])),
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-nav-item-active,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-sidebar-nav__item--selected {
  background: linear-gradient(90deg, ${rgba(accent, 0.18)}, ${rgba(accent, 0.08)}) !important;
  border-color: ${rgba(accent, 0.24)} !important;
  box-shadow: inset 3px 0 0 ${accent} !important;
  color: ${accent} !important;
  font-weight: 650 !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tab-row:is(.active, :has(> button[aria-selected="true"])) > button.conversation-list-tab-button {
  border-color: transparent !important;
  background: transparent !important;
  box-shadow: none !important;
  color: ${accent} !important;
  font-weight: 650 !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tabs button svg,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-tabs button svg path,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-nav-item svg,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-sidebar-nav__item svg {
  color: currentColor !important;
  fill: currentColor;
  stroke: currentColor;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-sidebar-nav__item--disabled {
  opacity: .38 !important;
  filter: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-agent-card[role="button"] {
  border: 1px solid transparent !important;
  border-radius: ${radius}px !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-agent-card[role="button"]:hover {
  background: ${rgba(accent, 0.08)} !important;
  border-color: ${rgba(accent, 0.18)} !important;
  transform: translateX(2px);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-trigger--workbuddy {
  border: 1px solid transparent !important;
  border-radius: ${radius}px !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-trigger--workbuddy:hover {
  background: ${rgba(accent, 0.09)} !important;
  border-color: ${rgba(accent, 0.16)} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-scene-tabs {
  width: fit-content;
  padding: 3px !important;
  border: 1px solid ${rgba(accent, 0.13)} !important;
  border-radius: ${radius}px !important;
  background: ${rgba(profile.official.surface, 0.72)} !important;
  backdrop-filter: blur(12px) saturate(112%);
  -webkit-backdrop-filter: blur(12px) saturate(112%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-scene-tabs__pill {
  border: 1px solid transparent !important;
  border-radius: ${Math.max(8, radius - 2)}px !important;
  background: transparent !important;
  color: ${ink} !important;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-scene-tabs__pill:hover {
  background: ${rgba(accent, 0.10)} !important;
  border-color: ${rgba(accent, 0.15)} !important;
  color: ${accent} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-scene-tabs__pill--active {
  background: linear-gradient(145deg, ${accent}, ${rgba(accent, 0.82)}) !important;
  border-color: ${rgba(accent, 0.92)} !important;
  box-shadow: 0 5px 14px ${rgba(accent, 0.24)} !important;
  color: ${accentInk} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .um-header__tabs[role="tablist"] > .um-tab,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-detail-view__scope-tab,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-detail-view__activity-tab,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .skill-selector__tab,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .plugins-marketplace-tab,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-segmented__item {
  border: 1px solid ${rgba(accent, 0.09)} !important;
  border-radius: ${Math.max(8, radius - 2)}px !important;
  background: ${rgba(profile.official.surface, 0.52)} !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .um-header__tabs[role="tablist"] > .um-tab:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-detail-view__scope-tab:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-detail-view__activity-tab:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .skill-selector__tab:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .plugins-marketplace-tab:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-segmented__item:hover {
  border-color: ${rgba(accent, 0.22)} !important;
  background: ${rgba(accent, 0.10)} !important;
  color: ${accent} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .um-header__tabs[role="tablist"] > .um-tab:is(.um-tab--active, [aria-selected="true"]),
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-detail-view__scope-tab--active,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-detail-view__activity-tab--active,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .skill-selector__tab--active,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .plugins-marketplace-tab--active,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-segmented__item--active,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-segmented__item[aria-selected="true"] {
  border-color: ${rgba(accent, 0.72)} !important;
  background: ${accent} !important;
  box-shadow: 0 5px 14px ${rgba(accent, 0.22)} !important;
  color: ${accentInk} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-popover.wb-dropdown.conversation-list-more-dropdown {
  border: 1px solid ${rgba(accent, 0.18)} !important;
  border-radius: ${radius}px !important;
  background: ${rgba(profile.official.surface, 0.94)} !important;
  box-shadow: 0 16px 42px ${rgba(ink, 0.18)} !important;
  backdrop-filter: blur(18px) saturate(118%);
  -webkit-backdrop-filter: blur(18px) saturate(118%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-more-dropdown .wb-dropdown__item[role="menuitem"] {
  border: 1px solid transparent !important;
  border-radius: ${Math.max(8, radius - 3)}px !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-more-dropdown .wb-dropdown__item[role="menuitem"]:hover {
  border-color: ${rgba(accent, 0.16)} !important;
  background: ${rgba(accent, 0.10)} !important;
  color: ${accent} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-more-dropdown .wb-dropdown__item--selected[aria-checked="true"] {
  border-color: ${rgba(accent, 0.26)} !important;
  background: ${rgba(accent, 0.16)} !important;
  color: ${accent} !important;
  font-weight: 650 !important;
}
/* Account surfaces are visually independent from the sidebar.  They need an
   opaque panel in dark skins so artwork never competes with account actions. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .user-menu-popover,
  .user-menu-submenu,
  .user-menu-panel,
  .user-menu-dropdown,
  [data-lingglow-semantic-popup="true"]
) {
  border: 1px solid ${rgba(accent, 0.22)} !important;
  border-radius: ${radius}px !important;
  background: ${rgba(profile.official.surface, 0.985)} !important;
  color: ${ink} !important;
  box-shadow: 0 18px 46px ${rgba(ink, 0.26)} !important;
  backdrop-filter: blur(20px) saturate(118%);
  -webkit-backdrop-filter: blur(20px) saturate(118%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .user-menu-popover,
  .user-menu-submenu,
  .user-menu-panel,
  .user-menu-dropdown,
  [data-lingglow-semantic-popup="true"]
) :where(button, a, p, span, label, h1, h2, h3, small) {
  color: ${ink} !important;
  -webkit-text-fill-color: ${ink} !important;
  opacity: 1 !important;
  text-shadow: none !important;
}
/* Account widgets can contain their own hard-coded light cards even while the
   popup root has correctly switched to a dark skin.  Treat those descendants
   as semantic structures, not as independent host-theme islands.  These rules
   are profile-driven and therefore apply to every current and future skin. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-popover :is(
  .daily-checkin-info,
  .daily-checkin-actions,
  .account-panel__credits-section,
  .account-panel__plan-card
) {
  background: ${rgba(profile.official.surface, 0.96)} !important;
  border-color: ${rgba(ink, 0.14)} !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-popover :is(
  .daily-checkin-info,
  .daily-checkin-actions,
  .account-panel__credits-section,
  .account-panel__plan-card
) :where(p, span, label, strong, small, div) {
  color: ${ink} !important;
  -webkit-text-fill-color: ${ink} !important;
  opacity: 1 !important;
  text-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-popover .daily-checkin-divider,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-popover .account-panel__plan-divider {
  border-color: ${rgba(ink, 0.14)} !important;
  background-color: ${rgba(ink, 0.14)} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-popover .daily-checkin-btn-primary:not(.is-claimed) {
  background: ${accent} !important;
  border-color: ${rgba(accent, 0.84)} !important;
  color: ${accentInk} !important;
  -webkit-text-fill-color: ${accentInk} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-popover .daily-checkin-btn-primary.is-claimed,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .user-menu-popover .daily-checkin-btn-secondary {
  background: ${rgba(ink, 0.09)} !important;
  border-color: ${rgba(ink, 0.16)} !important;
  color: ${ink} !important;
  -webkit-text-fill-color: ${ink} !important;
  opacity: 1 !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .user-menu-popover,
  .user-menu-submenu,
  .user-menu-panel,
  .user-menu-dropdown
) :where(
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
`;
}

function workbuddyProjectHeroRule(profile, {enabled}) {
  const hero = profile.advanced.workbuddy?.projectHero;
  if (!enabled || !hero?.image) return '';
  const surface = profile.official.surface;
  const isDark = profile.official.variant === 'dark';
  return `
/* WorkBuddy 5.2.6 / 5.3.3 exact adapter: project-list Hero artwork.
   Keep the audited native image node, but turn it into a fading art layer
   instead of a second rectangular banner on top of the selected wallpaper. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-collab .landing > header.landing-header {
  position: relative !important;
  isolation: isolate;
  overflow: hidden !important;
  border: 1px solid ${rgba(profile.official.accent, 0.16)} !important;
  border-radius: ${Math.max(22, profile.advanced.radius + 6)}px !important;
  background: ${rgba(surface, isDark ? 0.34 : 0.28)} !important;
  box-shadow: 0 18px 46px ${rgba('#000000', 0.14)} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-collab .landing > header.landing-header > img.landing-hero {
  content: url(${cssString(hero.image)}) !important;
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  object-fit: ${hero.fit} !important;
  object-position: ${hero.position} !important;
  border: 0 !important;
  border-radius: inherit !important;
  box-shadow: none !important;
  filter: saturate(.90) contrast(.94) brightness(${isDark ? '.82' : '.94'}) !important;
  mix-blend-mode: normal !important;
  opacity: ${isDark ? '.60' : '.52'} !important;
  background: transparent !important;
  pointer-events: none !important;
  z-index: 0 !important;
  -webkit-mask-image: radial-gradient(ellipse 92% 92% at 61% 50%, #000 46%, rgba(0, 0, 0, .84) 70%, transparent 100%);
  mask-image: radial-gradient(ellipse 92% 92% at 61% 50%, #000 46%, rgba(0, 0, 0, .84) 70%, transparent 100%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-collab .landing > header.landing-header::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  z-index: 1;
  pointer-events: none;
  background:
    linear-gradient(90deg, ${rgba(surface, isDark ? 0.66 : 0.52)} 0%, ${rgba(surface, isDark ? 0.24 : 0.16)} 48%, transparent 84%),
    linear-gradient(180deg, transparent 50%, ${rgba(surface, isDark ? 0.30 : 0.18)} 100%);
  -webkit-mask-image: radial-gradient(ellipse 98% 96% at 56% 48%, #000 56%, rgba(0, 0, 0, .90) 78%, transparent 100%);
  mask-image: radial-gradient(ellipse 98% 96% at 56% 48%, #000 56%, rgba(0, 0, 0, .90) 78%, transparent 100%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-collab .landing > header.landing-header > :not(img.landing-hero) {
  position: relative;
  z-index: 2;
}
`;
}

function composerMascotRule(profile, {enabled, clientId}) {
  const avatar = profile.advanced.workbuddy?.composerAvatar;
  if (!enabled || !avatar?.image) return '';
  // Theme Pack mascots are deliberately validated as static WebP assets. Walk
  // and crawl use bounded translation/pose motion; they do not pretend to be
  // frame-by-frame sprite animation.
  const allowedMotions = new Set(['still', 'float', 'walk', 'roll', 'crawl', 'hop']);
  const activityMotion = allowedMotions.has(avatar.activityMotion) ? avatar.activityMotion : 'float';
  const radius = avatar.shape === 'circle' ? '50%' : avatar.shape === 'rounded' ? '14px' : '0';
  const shadow = rgba(profile.official.accent, profile.official.variant === 'dark' ? 0.34 : 0.24);
  const nativeWorkBuddyRule = clientId === 'workbuddy' ? `
/* WorkBuddy already renders a native composer mascot. The selected Theme Pack
   supplies the single travelling pseudo-element below, so hide the native copy
   instead of showing two mascots in the same slot. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer img[src*="mascot" i],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer img[src*="robot" i],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer img[alt*="robot" i],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer img[alt*="机器人"],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer [class*="topRightSlotStandalone"] img[alt=""],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot img[alt=""][style*="width: 140px"][style*="height: 140px"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  border: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  pointer-events: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot div[style*="width: 120px"][style*="height: 120px"] video {
  display: none !important;
}
/* The New Task screen keeps one skin-specific mascot in the native slot, but
   does not run the conversation traversal animation. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-lingglow-workbuddy-landing-composer="true"] {
  position: relative !important;
  overflow: visible !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-lingglow-workbuddy-landing-composer="true"]::after {
  content: "" !important;
  position: absolute !important;
  width: 74px !important;
  height: 74px !important;
  top: -58px !important;
  right: 18px !important;
  z-index: 4 !important;
  pointer-events: none !important;
  border: 0 !important;
  border-radius: ${radius} !important;
  background-color: transparent !important;
  background-image: url(${cssString(avatar.image)}) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: ${avatar.fit} !important;
  box-shadow: none !important;
  filter: drop-shadow(0 8px 13px ${shadow}) !important;
  opacity: 1 !important;
  animation: none !important;
  transform: none !important;
}
` : '';
  const anchors = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-cb-chat [data-lingglow-workbuddy-composer="true"]`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] [data-lingglow-doubao-composer="true"]`
      : `html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-composer-anchor="true"]`;
  const activeAnchors = anchors.replaceAll(
    `html[${ROOT_ATTRIBUTE}]`,
    `html[${ROOT_ATTRIBUTE}][data-lingglow-agent-active="true"]`,
  );
  const size = clientId === 'workbuddy' ? 74 : 78;
  const top = clientId === 'workbuddy' ? -58 : -64;
  const motionDuration = {
    float: '8.2s', walk: '7.2s', roll: '6.4s', crawl: '9.6s', hop: '7.8s',
  }[activityMotion];
  const motionFrames = {
    float: `
  0% { transform: translate3d(0, 0, 0) scaleX(-1) rotate(0deg); }
  25% { transform: translate3d(var(--lingglow-mascot-half-travel-x, -120px), -7px, 0) scaleX(-1) rotate(-2deg); }
  49.9% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 0, 0) scaleX(-1) rotate(2deg); }
  50.1% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 0, 0) scaleX(1) rotate(2deg); }
  75% { transform: translate3d(var(--lingglow-mascot-half-travel-x, -120px), -7px, 0) scaleX(1) rotate(1deg); }
  100% { transform: translate3d(0, 0, 0) scaleX(1) rotate(0deg); }`,
    walk: `
  0% { transform: translate3d(0, 0, 0) scaleX(-1) rotate(0deg); }
  12.5% { transform: translate3d(var(--lingglow-mascot-quarter-travel-x, -60px), -4px, 0) scaleX(-1) rotate(-2deg); }
  25% { transform: translate3d(var(--lingglow-mascot-half-travel-x, -120px), 0, 0) scaleX(-1) rotate(1deg); }
  37.5% { transform: translate3d(var(--lingglow-mascot-three-quarter-travel-x, -180px), -4px, 0) scaleX(-1) rotate(-2deg); }
  49.9% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 0, 0) scaleX(-1) rotate(0deg); }
  50.1% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 0, 0) scaleX(1) rotate(0deg); }
  62.5% { transform: translate3d(var(--lingglow-mascot-three-quarter-travel-x, -180px), -4px, 0) scaleX(1) rotate(2deg); }
  75% { transform: translate3d(var(--lingglow-mascot-half-travel-x, -120px), 0, 0) scaleX(1) rotate(-1deg); }
  87.5% { transform: translate3d(var(--lingglow-mascot-quarter-travel-x, -60px), -4px, 0) scaleX(1) rotate(2deg); }
  100% { transform: translate3d(0, 0, 0) scaleX(1) rotate(0deg); }`,
    roll: `
  0% { transform: translate3d(0, 0, 0) rotate(0deg); }
  49% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 0, 0) rotate(-720deg); }
  51% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 0, 0) rotate(-720deg); }
  100% { transform: translate3d(0, 0, 0) rotate(0deg); }`,
    crawl: `
  0% { transform: translate3d(0, 3px, 0) scaleX(-1) rotate(-5deg); }
  25% { transform: translate3d(var(--lingglow-mascot-half-travel-x, -120px), 1px, 0) scaleX(-1) rotate(4deg); }
  49.9% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 3px, 0) scaleX(-1) rotate(-5deg); }
  50.1% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 3px, 0) scaleX(1) rotate(5deg); }
  75% { transform: translate3d(var(--lingglow-mascot-half-travel-x, -120px), 1px, 0) scaleX(1) rotate(-4deg); }
  100% { transform: translate3d(0, 3px, 0) scaleX(1) rotate(5deg); }`,
    hop: `
  0% { transform: translate3d(0, 0, 0) scaleX(-1) rotate(0deg); }
  12.5% { transform: translate3d(var(--lingglow-mascot-quarter-travel-x, -60px), -15px, 0) scaleX(-1) rotate(-4deg); }
  25% { transform: translate3d(var(--lingglow-mascot-half-travel-x, -120px), 0, 0) scaleX(-1) rotate(0deg); }
  37.5% { transform: translate3d(var(--lingglow-mascot-three-quarter-travel-x, -180px), -15px, 0) scaleX(-1) rotate(4deg); }
  49.9% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 0, 0) scaleX(-1) rotate(0deg); }
  50.1% { transform: translate3d(var(--lingglow-mascot-travel-x, -240px), 0, 0) scaleX(1) rotate(0deg); }
  62.5% { transform: translate3d(var(--lingglow-mascot-three-quarter-travel-x, -180px), -15px, 0) scaleX(1) rotate(-4deg); }
  75% { transform: translate3d(var(--lingglow-mascot-half-travel-x, -120px), 0, 0) scaleX(1) rotate(0deg); }
  87.5% { transform: translate3d(var(--lingglow-mascot-quarter-travel-x, -60px), -15px, 0) scaleX(1) rotate(4deg); }
  100% { transform: translate3d(0, 0, 0) scaleX(1) rotate(0deg); }`,
  }[activityMotion];
  const motionRule = activityMotion === 'still' ? '' : `
${anchors}::after {
  animation: lingglow-composer-${activityMotion} ${motionDuration} linear infinite both !important;
  animation-play-state: paused !important;
  will-change: auto !important;
}
${activeAnchors}::after {
  animation-play-state: running !important;
  will-change: transform !important;
}
@keyframes lingglow-composer-${activityMotion} {${motionFrames}
}
@media (prefers-reduced-motion: reduce) {
  ${anchors}::after {
    animation: none !important;
    right: 18px !important;
    transform: none !important;
  }
}`;
  // Codex owns native attachment clipping on the canonical composer shell.
  // Forcing that shell to overflow visibly lets stale attachment previews
  // escape while a task is switching. Preserve Codex's native overflow value;
  // WorkBuddy and Doubao still need visible overflow for their outer anchors.
  const anchorOverflow = clientId === 'codex' ? '' : 'overflow: visible !important;';
  return `${nativeWorkBuddyRule}
/* Moving three-Agent composer mascot. WorkBuddy deliberately exposes this
   travelling anchor only on history conversations; Doubao uses a dedicated
   wrapper so its native input-border pseudo-element remains untouched. The
   selected skin controls motion independently for every Agent. */
${anchors} {
  position: relative !important;
  ${anchorOverflow}
}
${anchors}::after {
  content: "" !important;
  position: absolute !important;
  width: ${size}px !important;
  height: ${size}px !important;
  top: ${top}px !important;
  right: 18px !important;
  z-index: 4 !important;
  pointer-events: none !important;
  border: 0 !important;
  border-radius: ${radius} !important;
  background-color: transparent !important;
  background-image: url(${cssString(avatar.image)}) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: ${avatar.fit} !important;
  box-shadow: none !important;
  filter: drop-shadow(0 8px 13px ${shadow}) !important;
  opacity: 1 !important;
  transform-origin: center center !important;
  backface-visibility: hidden !important;
}${motionRule}`;
}

function themeBorderRules(profile, {enabled, clientId}) {
  if (!enabled) return '';
  const semantic = profile.official.semanticColors;
  const ink = readableInkForSurface(profile.official.ink, profile.official.surface);
  const primary = mixHex(profile.official.accent, semantic.skill ?? semantic.diffAdded, 0.68);
  const secondary = mixHex(profile.official.accent, semantic.diffAdded, 0.56);
  const contrast = profile.official.contrast;
  const width = contrast >= 70 ? 2 : contrast >= 42 ? 1.5 : 1;
  const softAlpha = profile.official.variant === 'dark' ? 0.24 : 0.19;
  const strongAlpha = profile.official.variant === 'dark' ? 0.54 : 0.46;
  const highlight = profile.official.variant === 'dark'
    ? rgba('#FFFFFF', 0.12)
    : rgba('#FFFFFF', 0.58);
  const shadow = profile.official.variant === 'dark'
    ? rgba('#000000', 0.24)
    : rgba(profile.official.ink, 0.12);
  const primaryBlocks = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .wb-home-composer__input-slot,
  .project-grid__card,
  .landing-template-card,
  .atm-template-card,
  .atm-detail-page,
  .atm-modal,
  .ec-featured-scene-card,
  .skill-card,
  .cb-plugin-detail-card,
  .connector-card,
  .connectors-panel__card,
  .inspiration-card,
  .artifact-slot-panel__card,
  .expert-dependency-gate
)`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] :is(
  [data-testid="chat_input"],
  [data-testid="onboarding_sug_item"],
  [data-testid="guidance-skill-bar"],
  .semi-card,
  .dbx-dialog,
  .dbx-modal,
  .suspension-dialog,
  .chat-popup
      )`
      : `html[${ROOT_ATTRIBUTE}] :is(
  [data-lingglow-codex-composer-anchor="true"],
  .atm-template-card,
  .atm-detail-page,
  .atm-modal,
  .chat-popup,
  .modal,
  .drawer
)`;
  const secondaryBlocks = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .quick-actions__item,
  .wb-practice-cases__card,
  .atm-row,
  .project-grid__search,
  .atm-search-input,
  .connector-panel-search,
  .cb-search-input,
  .skills-search,
  .ob-input,
  .project-detail-view__chat-input,
  .message-input
)`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] :is(
  .skeleton-input,
  .skeleton-circle-send-btn,
  #flow_chat_sidebar input,
  [data-testid="chat_list_thread_item"]
)`
      : '';
  const roundedRadius = Math.max(14, profile.advanced.radius);
  const secondaryRules = secondaryBlocks ? `
${secondaryBlocks} {
  border-style: solid !important;
  border-width: max(1px, calc(var(--lingglow-border-width) - .5px)) !important;
  border-color: var(--lingglow-border-secondary) !important;
  border-radius: ${roundedRadius}px !important;
  box-shadow:
    inset 0 0 0 1px var(--lingglow-border-soft),
    inset 0 1px 0 var(--lingglow-border-highlight) !important;
}
${secondaryBlocks}:is(:hover, :focus-within) {
  border-color: ${primary} !important;
  box-shadow:
    0 0 0 3px ${rgba(primary, 0.14)},
    inset 0 1px 0 var(--lingglow-border-highlight),
    0 14px 34px var(--lingglow-border-shadow) !important;
}` : '';
  const codexSurfaceRules = clientId === 'codex' ? `
html[${ROOT_ATTRIBUTE}] :is(
  [data-lingglow-codex-surface="above-composer"],
  [data-codex-composer-request-navigation],
  [data-composer-utility-bar-scroll-area],
  [data-composer-overlay-floating-ui]
) {
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}
html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-surface="diff-summary"] {
  border: 0 !important;
  border-radius: ${roundedRadius}px !important;
  outline: 0 !important;
  box-shadow: 0 8px 24px var(--lingglow-border-shadow) !important;
}
html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-surface="diff-summary"] :is(button, [role="button"]) {
  border: 1px solid var(--lingglow-border-secondary) !important;
  border-radius: 999px !important;
  background: ${rgba(profile.official.surface, profile.official.variant === 'dark' ? 0.88 : 0.94)} !important;
  color: ${ink} !important;
  -webkit-text-fill-color: ${ink} !important;
  box-shadow: none !important;
}` : '';
  return `
/* Per-skin border signature. Every color, weight and shadow is derived from
   the active skin instead of using one neutral border for every theme. */
html[${ROOT_ATTRIBUTE}] {
  --lingglow-border-primary: ${rgba(primary, strongAlpha)};
  --lingglow-border-secondary: ${rgba(secondary, Math.max(0.30, strongAlpha - 0.10))};
  --lingglow-border-soft: ${rgba(primary, softAlpha)};
  --lingglow-border-highlight: ${highlight};
  --lingglow-border-width: ${width}px;
  --lingglow-border-shadow: ${shadow};
}
${primaryBlocks},
html[${ROOT_ATTRIBUTE}] :is([role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]) {
  border-style: solid !important;
  border-width: var(--lingglow-border-width) !important;
  border-color: var(--lingglow-border-primary) !important;
  border-radius: ${roundedRadius}px !important;
  box-shadow:
    inset 0 0 0 1px var(--lingglow-border-soft),
    inset 0 1px 0 var(--lingglow-border-highlight),
    0 10px 28px var(--lingglow-border-shadow) !important;
}
${primaryBlocks}:is(:hover, :focus-within) {
  border-color: ${primary} !important;
  box-shadow:
    0 0 0 3px ${rgba(primary, 0.14)},
    inset 0 1px 0 var(--lingglow-border-highlight),
    0 14px 34px var(--lingglow-border-shadow) !important;
}
${secondaryRules}
${codexSurfaceRules}`;
}

function composerStructureRules(profile, {enabled, clientId}) {
  if (!enabled) return '';
  const accent = profile.official.accent;
  const ink = readableInkForSurface(profile.official.ink, profile.official.surface);
  const radius = Math.max(18, profile.advanced.radius);
  const frameOverflow = clientId === 'codex' ? '' : 'overflow: visible !important;';
  const frame = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .wb-home-composer__input-slot,
  [data-lingglow-workbuddy-composer="true"]
)`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"]`
      : `html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-composer-anchor="true"]`;
  const inner = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .wb-home-composer__input-slot,
  [data-lingglow-workbuddy-composer="true"]
) :is(
  input,
  textarea,
  [role="textbox"],
  [contenteditable="true"],
  [class^="_mainArea_"],
  [class^="_content_"],
  [data-cb-chat-input-toolbar-right="true"],
  :has(> input),
  :has(> textarea),
  :has(> [role="textbox"]),
  :has(> [contenteditable="true"])
)`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] :is(
  [data-testid="chat_input_input"],
  [data-testid="guidance-skill-bar"],
  input,
  textarea,
  [role="textbox"],
  [contenteditable="true"],
  :has(> input),
  :has(> textarea),
  :has(> [role="textbox"]),
  :has(> [contenteditable="true"])
)`
      : `html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-composer-anchor="true"] :is(
  input,
  textarea,
  [role="textbox"],
  [contenteditable="true"],
  .ProseMirror,
  :has(> input),
  :has(> textarea),
  :has(> [role="textbox"]),
  :has(> [contenteditable="true"]),
  :has(> .ProseMirror)
),
html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-composer-anchor="true"] :is(
  .composer-surface-chrome,
  [data-codex-composer-root],
  [data-codex-composer]
),
html[${ROOT_ATTRIBUTE}] :is(
  [data-composer-overlay-floating-ui],
  [data-codex-composer-request-navigation],
  [data-composer-utility-bar-scroll-area]
)`;
  return `
/* Three-Agent composer structure: exactly one rounded frame. Text editing,
   workspace/context rows and utility containers remain borderless inside it. */
${frame} {
  border: 1px solid ${rgba(accent, 0.28)} !important;
  border-radius: ${radius}px !important;
  box-sizing: border-box !important;
  background-clip: padding-box !important;
  isolation: isolate !important;
  outline: 0 !important;
  box-shadow: 0 14px 36px ${rgba(ink, profile.official.variant === 'dark' ? 0.16 : 0.10)} !important;
  ${frameOverflow}
}
${frame}:focus-within {
  border-color: ${rgba(accent, 0.56)} !important;
  outline: 0 !important;
  box-shadow: 0 16px 40px ${rgba(ink, profile.official.variant === 'dark' ? 0.18 : 0.12)} !important;
}
${inner},
${inner}:is(:hover, :focus, :focus-visible, :focus-within) {
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background-color: transparent !important;
  background-image: none !important;
}
`;
}

function composerActionRules(profile, {enabled, clientId}) {
  if (!enabled) return '';
  const accent = profile.official.accent;
  const danger = profile.official.semanticColors.diffRemoved;
  const ink = readableInkForSurface(profile.official.ink, profile.official.surface);
  const accentInk = contrastRatio('#FFFFFF', accent) >= contrastRatio('#111111', accent)
    ? '#FFFFFF'
    : '#111111';
  const dangerInk = contrastRatio('#FFFFFF', danger) >= contrastRatio('#111111', danger)
    ? '#FFFFFF'
    : '#111111';
  const accentRaised = mixHex(accent, accentInk === '#FFFFFF' ? '#000000' : '#FFFFFF', 0.92);
  const send = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_session_input_status"]`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] :is(
  .skeleton-circle-send-btn,
  button[type="submit"],
  button[data-testid*="send" i],
  button[aria-label*="发送"],
  button[title*="发送"]
)`
      : `html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-control="send"]`;
  const stop = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_task_interrupted"]`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] :is(
  button[data-testid*="stop" i],
  button[data-testid*="interrupt" i],
  button[data-testid*="break" i],
  button[aria-label*="停止"],
  button[aria-label*="中断"],
  button[title*="停止"],
  button[title*="中断"]
)`
      : `html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-control="stop"]`;
  return `
/* Three-Agent composer actions: preserve each native action and icon while
   giving send, stop, hover, pressed and disabled states one visual system. */
${send},
${stop} {
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
  transition: transform .16s ease, border-color .16s ease, background .16s ease,
    box-shadow .16s ease, filter .16s ease, opacity .16s ease !important;
}
${send} {
  border: 1px solid ${rgba(accent, 0.74)} !important;
  background: linear-gradient(145deg, ${accentRaised}, ${accent} 72%) !important;
  color: ${accentInk} !important;
  box-shadow: inset 0 1px 0 ${rgba('#FFFFFF', 0.22)},
    0 6px 16px ${rgba(accent, 0.24)} !important;
}
${stop} {
  border: 1px solid ${rgba(danger, 0.46)} !important;
  background: linear-gradient(145deg,
    ${rgba(profile.official.surface, 0.94)}, ${rgba(danger, 0.16)}) !important;
  color: ${danger} !important;
  box-shadow: inset 0 1px 0 ${rgba('#FFFFFF', 0.18)},
    0 5px 14px ${rgba('#000000', 0.12)} !important;
  animation: none !important;
}
${send} :where(*),
${stop} :where(*) {
  color: currentColor !important;
  -webkit-text-fill-color: currentColor !important;
}
${send} svg,
${stop} svg {
  width: 19px !important;
  height: 19px !important;
  color: currentColor !important;
  filter: drop-shadow(0 1px 1px ${rgba('#000000', 0.22)}) !important;
}
${send} svg [fill]:not([fill="none"]),
${stop} svg [fill]:not([fill="none"]) {
  fill: currentColor !important;
}
${send} svg [stroke]:not([stroke="none"]),
${stop} svg [stroke]:not([stroke="none"]) {
  stroke: currentColor !important;
}
${send}:is(:hover, :focus-visible),
${stop}:is(:hover, :focus-visible) {
  filter: saturate(1.08) brightness(1.05) !important;
  transform: translateY(-1px) scale(1.025) !important;
}
${send}:is(:hover, :focus-visible) {
  box-shadow: 0 8px 20px ${rgba(accent, 0.30)}, 0 0 0 3px ${rgba(accent, 0.13)} !important;
}
${stop}:is(:hover, :focus-visible) {
  background: ${danger} !important;
  color: ${dangerInk} !important;
  box-shadow: 0 8px 20px ${rgba(danger, 0.26)}, 0 0 0 3px ${rgba(danger, 0.12)} !important;
}
${send}:active,
${stop}:active {
  transform: translateY(0) scale(.96) !important;
}
${send}:is(:disabled, [aria-disabled="true"]),
${stop}:is(:disabled, [aria-disabled="true"]) {
  border-color: ${rgba(ink, 0.18)} !important;
  background: ${rgba(profile.official.surface, 0.78)} !important;
  color: ${rgba(ink, 0.46)} !important;
  box-shadow: inset 0 1px 0 ${rgba('#FFFFFF', 0.18)} !important;
  filter: saturate(.30) !important;
  opacity: .62 !important;
  transform: none !important;
  animation: none !important;
}
@media (prefers-reduced-motion: reduce) {
  ${send},
  ${stop} {
    transition: none !important;
    animation: none !important;
  }
}
`;
}

function sidebarItemStructureRules(profile, {enabled, clientId}) {
  if (!enabled) return '';
  const accent = profile.official.accent;
  const ink = readableInkForSurface(profile.official.ink, profile.official.surface);
  const radius = Math.max(10, Math.min(14, profile.advanced.radius));
  const section = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .conversation-list-tabs,
  .conversation-list-nav
)`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="sidebar-section-item"]`
      : `html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-section]`;
  const item = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .conversation-list-tabs button.conversation-list-tab-button,
  .conversation-list-tabs button.conversation-list-tab-button-more,
  .conversation-list-tab-row,
  .conversation-list-nav-item,
  .cb-sidebar-nav__item,
  .conversation-agent-card[role="button"]
)`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar :is(
  [data-testid="chat_list_thread_item"],
  [data-testid="create_conversation_button"],
  [data-testid="create_office_task_button"],
  [data-testid="app-open-website"],
  [data-testid="ai_space_nav_button"],
  [data-testid^="skill-page-item-"]
)`
      : `html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-scroll] :is(
  [data-app-action-sidebar-row],
  [data-app-action-sidebar-project-row],
  [data-app-action-sidebar-thread-row]
)`;
  const selected = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .conversation-list-tabs button.conversation-list-tab-button.active,
  .conversation-list-tabs button.conversation-list-tab-button[aria-selected="true"],
  .conversation-list-tabs button.conversation-list-tab-button-more.active,
  .conversation-list-tabs button.conversation-list-tab-button-more[aria-selected="true"],
  .conversation-list-tab-row.active,
  .conversation-list-tab-row:has(> button[aria-selected="true"]),
  .conversation-list-nav-item-active,
  .cb-sidebar-nav__item--selected,
  .conversation-agent-card[aria-current="page"],
  .conversation-agent-card[aria-selected="true"]
)`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar :is(
  [data-testid="chat_list_thread_item"],
  [data-testid="create_conversation_button"],
  [data-testid="create_office_task_button"],
  [data-testid="app-open-website"],
  [data-testid="ai_space_nav_button"],
  [data-testid^="skill-page-item-"]
):is(
  [aria-current="page"],
  [aria-current="true"],
  [aria-selected="true"],
  [data-state="active"],
  [data-state="selected"],
  [data-active="true"],
  .active,
  .is-selected
)`
      : `html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-scroll]
  [data-lingglow-codex-sidebar-state="selected"]`;
  return `
/* Three-Agent sidebar structure: ordinary rows are unframed. Only the current
   selection receives the skin's rounded outline and selection fill. */
${section} {
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}
${item},
${item}:hover {
  border: 0 !important;
  border-radius: ${radius}px !important;
  outline: 0 !important;
  box-shadow: none !important;
}
${item} {
  background: transparent !important;
}
${item}:hover {
  background: ${rgba(accent, 0.09)} !important;
}
${selected},
${selected}:hover {
  border: 1px solid ${rgba(accent, 0.56)} !important;
  border-radius: ${radius}px !important;
  background: linear-gradient(90deg, ${rgba(accent, 0.28)}, ${rgba(accent, 0.10)}) !important;
  color: ${ink} !important;
  box-shadow: inset 4px 0 0 ${accent}, 0 6px 18px ${rgba(ink, 0.12)} !important;
  font-weight: 700 !important;
}
`;
}

function mainWorkspaceStructureRules({enabled, clientId}) {
  if (!enabled) return '';
  const workspace = clientId === 'workbuddy'
    ? `html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .teams-main-content,
  .main-content,
  .main-content--chat,
  .chat-container,
  .wb-cb-chat,
  .workbuddy-collab
)`
    : clientId === 'doubao'
      ? `html[${ROOT_ATTRIBUTE}] :is(
  #chat-route-layout,
  #chat-route-main,
  #chat-route-main > main,
  #chat-route-main main
)`
      : `html[${ROOT_ATTRIBUTE}] :is(
  [data-app-shell-main-content-layout],
  main.main-surface
)`;
  return `
/* The Agent workspace is the wallpaper canvas, not another card. Keep the
   right-hand content region unframed in all three clients. */
${workspace},
${workspace}:is(:hover, :focus, :focus-within) {
  border: 0 !important;
  outline: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
`;
}

function workbuddyControlRules(profile, {enabled, panel, border, accentInk}) {
  if (!enabled) return '';
  const accent = profile.official.accent;
  const ink = readableInkForSurface(profile.official.ink, profile.official.surface);
  const radius = profile.advanced.radius;
  const card = rgba(profile.official.surface, Math.min(0.92, profile.advanced.glass.opacity + 0.18));
  const danger = profile.official.semanticColors.diffRemoved;
  return `
/* WorkBuddy exact adapter: controls, composer, cards, send and stop states. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] {
  --wb-color-bg-primary-default: ${panel};
  --wb-color-bg-primary-hover: ${rgba(accent, 0.10)};
  --wb-color-bg-primary-active: ${rgba(accent, 0.16)};
  --wb-color-bg-secondary-default: ${rgba(profile.official.surface, 0.72)};
  --wb-color-bg-secondary-hover-active: ${rgba(accent, 0.12)};
  --wb-color-text-primary: ${ink};
  --wb-color-text-secondary: ${rgba(ink, 0.74)};
  --wb-color-text-tertiary: ${rgba(ink, 0.58)};
  --wb-sidebar-bg: ${panel};
  --wb-sidebar-border: ${rgba(accent, 0.14)};
  --wb-control-selected-bg: ${rgba(accent, 0.18)};
  --wb-control-selected-bg-hover: ${rgba(accent, 0.24)};
  --wb-control-selected-fg: ${accent};
  --wb-bg-pill-active: ${accent};
  --wb-bg-pill-hover: ${rgba(accent, 0.10)};
  --wb-todo-menu-bg-hover: ${rgba(accent, 0.10)};
  --wb-todo-menu-bg-active: ${rgba(accent, 0.18)};
  --wb-todo-menu-icon-default: ${ink};
  --wb-todo-menu-text-default: ${ink};
  --wb-button-primary-bg: ${accent};
  --wb-button-primary-bg-hover: ${rgba(accent, 0.90)};
  --wb-button-primary-bg-active: ${rgba(accent, 0.82)};
  --wb-button-primary-bg-disabled: ${rgba(accent, 0.34)};
  --wb-button-primary-fg: ${accentInk};
  --wb-button-secondary-bg: ${rgba(profile.official.surface, 0.74)};
  --wb-button-secondary-bg-hover: ${rgba(accent, 0.10)};
  --wb-button-secondary-bg-active: ${rgba(accent, 0.16)};
  --wb-button-secondary-fg: ${ink};
  --wb-button-ghost-bg-hover: ${rgba(accent, 0.09)};
  --wb-button-ghost-bg-active: ${rgba(accent, 0.15)};
  --wb-button-ghost-fg: ${ink};
  --wb-button-danger-bg: ${danger};
  --wb-button-danger-bg-hover: ${rgba(danger, 0.88)};
  --wb-button-danger-bg-active: ${rgba(danger, 0.80)};
  --wb-button-danger-fg: #FFFFFF;
  --cb-content-background: ${panel};
  --cb-main-area-background: transparent;
  --cb-input-background: ${card};
  --cb-input-border: ${rgba(accent, 0.18)};
  --cb-input-border-color: ${rgba(accent, 0.18)};
  --cb-input-focus-border: ${accent};
  --cb-focus-border: ${accent};
  --cb-button-primary: ${accent};
  --cb-button-primary-foreground: ${accentInk};
  --cb-dropdown-item-hover-bg-color: ${rgba(accent, 0.10)};
  --wb-accent-color: ${accent};
  --wb-card-background: ${card};
  --wb-card-border: ${rgba(accent, 0.14)};
  --ec-featured-scene-area-bg: transparent;
  --ec-featured-scene-bg: ${card};
  --ec-featured-scene-overlay: linear-gradient(180deg, ${rgba(profile.official.surface, 0.12)}, ${rgba(profile.official.surface, 0.72)});
  --ec-featured-scene-border: linear-gradient(145deg, ${rgba(accent, 0.34)}, ${rgba(profile.official.surface, 0.28)});
  --ec-featured-scene-shadow: 0 10px 28px ${rgba(ink, 0.12)};
  --ec-featured-scene-fade-mask: linear-gradient(90deg, transparent, ${rgba(profile.official.surface, 0.78)});
  --ec-featured-scene-row-hover-bg: ${rgba(accent, 0.12)};
  --ec-featured-scene-tag-bg: ${rgba(accent, 0.13)};
  --ec-featured-scene-tag-color: ${accent};
  --ec-bg-primary: transparent;
  --ec-bg-secondary: ${rgba(profile.official.surface, 0.66)};
  --ec-bg-tertiary: ${rgba(profile.official.surface, 0.54)};
  --ec-card-bg: ${card};
  --ec-text-strong: ${ink};
  --ec-text-primary: ${rgba(ink, 0.82)};
  --ec-text-contrast: ${accentInk};
  --ec-primary: ${accent};
  --ec-surface-muted: ${rgba(accent, 0.12)};
  --ec-border: ${rgba(accent, 0.15)};
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] button,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [role="button"],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [role="combobox"] {
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease, transform 150ms ease, opacity 150ms ease !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] button:focus-visible,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [role="button"]:focus-visible,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [role="combobox"]:focus-visible {
  outline: 2px solid ${accent} !important;
  outline-offset: 2px !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] button:disabled,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [aria-disabled="true"] {
  color: ${rgba(ink, 0.38)} !important;
  box-shadow: none !important;
  filter: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .quick-actions__item,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-practice-cases__card {
  border: 1px solid ${rgba(accent, 0.16)} !important;
  border-radius: ${Math.min(radius, 14)}px !important;
  background: ${card} !important;
  color: ${ink} !important;
  box-shadow: 0 6px 18px ${rgba(ink, 0.06)} !important;
  backdrop-filter: blur(12px) saturate(112%);
  -webkit-backdrop-filter: blur(12px) saturate(112%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .quick-actions__item:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-practice-cases__card:hover {
  background: ${rgba(accent, 0.10)} !important;
  border-color: ${rgba(accent, 0.34)} !important;
  box-shadow: 0 12px 26px ${rgba(ink, 0.12)} !important;
  color: ${accent} !important;
  transform: translateY(-2px);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot {
  overflow: visible !important;
  border: 1px solid ${rgba(accent, 0.20)} !important;
  border-radius: ${radius}px !important;
  background: ${card} !important;
  box-shadow: 0 12px 30px ${rgba(ink, 0.11)} !important;
  backdrop-filter: blur(${profile.advanced.glass.blur}px) saturate(116%);
  -webkit-backdrop-filter: blur(${profile.advanced.glass.blur}px) saturate(116%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot:focus-within {
  border-color: ${accent} !important;
  box-shadow: 0 0 0 3px ${rgba(accent, 0.15)}, 0 14px 34px ${rgba(ink, 0.13)} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot > *,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot [class^="_mainArea_"],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot [class^="_content_"] {
  background: transparent !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot [role="textbox"] {
  color: ${ink} !important;
  caret-color: ${accent} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot [role="combobox"],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-input-footer button {
  border: 1px solid ${rgba(accent, 0.13)} !important;
  border-radius: ${Math.min(radius, 12)}px !important;
  background: ${rgba(profile.official.surface, 0.66)} !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-composer__input-slot [role="combobox"]:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-input-footer button:hover {
  border-color: ${rgba(accent, 0.30)} !important;
  background: ${rgba(accent, 0.09)} !important;
  color: ${accent} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_session_input_status"] {
  border: 1px solid ${rgba(accent, 0.88)} !important;
  border-radius: 50% !important;
  background: ${accent} !important;
  box-shadow: 0 5px 14px ${rgba(accent, 0.28)} !important;
  color: ${accentInk} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_session_input_status"]:hover {
  filter: brightness(.90) saturate(1.06) !important;
  transform: translateY(-1px) scale(1.03);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_session_input_status"]:active {
  filter: brightness(.82) saturate(1.08) !important;
  transform: scale(.96);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_session_input_status"][aria-disabled="true"],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_session_input_status"]:disabled,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_session_input_status"].disabled {
  opacity: .46 !important;
  box-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_task_interrupted"] {
  border: 1px solid ${rgba(danger, 0.94)} !important;
  border-radius: 50% !important;
  background: ${danger} !important;
  box-shadow: 0 0 0 3px ${rgba(danger, 0.15)}, 0 5px 14px ${rgba(danger, 0.28)} !important;
  color: #FFFFFF !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_task_interrupted"]:hover {
  filter: brightness(.86) saturate(1.08) !important;
  transform: translateY(-1px) scale(1.03);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_task_interrupted"]:active {
  filter: brightness(.78) saturate(1.10) !important;
  transform: scale(.96);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_session_input_status"] svg,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [data-track-id="agent_task_interrupted"] svg {
  color: currentColor !important;
  fill: currentColor !important;
  stroke: currentColor !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [class^="_topRightSlotStandalone_"] > div > div:has(> img[data-lingglow-custom-avatar="true"]) {
  border: 0 !important;
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  overflow: visible !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [class^="_topRightSlotStandalone_"] > div > div:has(> img[data-lingglow-custom-avatar="true"])::before,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [class^="_topRightSlotStandalone_"] > div > div:has(> img[data-lingglow-custom-avatar="true"])::after {
  content: none !important;
  display: none !important;
}
/* WorkBuddy places a transparent 70x70 click target immediately after the
   mascot image host. Preserve the native click target without painting it as
   a card or allowing decorative pseudo-elements to cover the custom avatar. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [class^="_topRightSlotStandalone_"] > div > div:has(> img[data-lingglow-custom-avatar="true"]) + div {
  border: 0 !important;
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [class^="_topRightSlotStandalone_"] > div > div:has(> img[data-lingglow-custom-avatar="true"]) + div::before,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] [class^="_topRightSlotStandalone_"] > div > div:has(> img[data-lingglow-custom-avatar="true"]) + div::after {
  content: none !important;
  display: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .ec-main-content,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-grid__body,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-detail-view__body,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-detail-content,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connector-panel-content,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connectors-panel__scroll-content,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .skills-content,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .insp-body,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-empty-state,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-empty-state-hero,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-empty-state-templates {
  background: transparent !important;
  background-image: none !important;
  border-color: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-grid__card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .landing-template-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-template-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-row,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .ec-featured-scene-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .skill-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-plugin-detail-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connector-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connectors-panel__card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .inspiration-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .ob-sample-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .ob-interest-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .artifact-slot-panel__card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .expert-dependency-gate {
  border: 1px solid ${rgba(accent, 0.16)} !important;
  border-radius: ${Math.min(radius, 18)}px !important;
  background: ${card} !important;
  box-shadow: 0 8px 24px ${rgba(ink, 0.09)} !important;
  backdrop-filter: blur(12px) saturate(112%);
  -webkit-backdrop-filter: blur(12px) saturate(112%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-grid__card:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .landing-template-card:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-template-card:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-row:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .skill-card:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connector-card:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connectors-panel__card:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .inspiration-card:hover {
  border-color: ${rgba(accent, 0.38)} !important;
  background: ${rgba(accent, 0.11)} !important;
  box-shadow: 0 13px 30px ${rgba(ink, 0.14)} !important;
  transform: translateY(-2px);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-grid__search,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-search-input,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connector-panel-search,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-search-input,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .skills-search,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .ob-input,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-detail-view__chat-input,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .message-input {
  border-color: ${rgba(accent, 0.18)} !important;
  border-radius: ${Math.min(radius, 14)}px !important;
  background: ${card} !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-grid__search:focus-within,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-search-input:focus-within,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connector-panel-search:focus-within,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-search-input:focus-within,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .skills-search:focus-within,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .project-detail-view__chat-input:focus-within,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .message-input:focus-within {
  border-color: ${accent} !important;
  box-shadow: 0 0 0 3px ${rgba(accent, 0.14)} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-button--primary,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-button--primary,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-btn-primary,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connector-detail-btn--primary,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connectors-panel__btn--primary {
  border-color: ${rgba(accent, 0.82)} !important;
  background: ${accent} !important;
  color: ${accentInk} !important;
  box-shadow: 0 5px 14px ${rgba(accent, 0.22)} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .cb-button--secondary,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-button--secondary,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .atm-btn-secondary,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connector-detail-btn--secondary,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .connectors-panel__btn--secondary {
  border-color: ${rgba(accent, 0.16)} !important;
  background: ${rgba(profile.official.surface, 0.70)} !important;
  color: ${ink} !important;
}
/* WorkBuddy 5.2.6 / 5.3.3 exact adapter: More-page roots and component blocks. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-panel,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .ima-panel,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-panel,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .discover-panel-page {
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .discover-panel-page {
  --dc-bg-primary: transparent;
  --dc-bg-secondary: ${rgba(profile.official.surface, 0.68)};
  --dc-bg-tertiary: ${rgba(profile.official.surface, 0.54)};
  --dc-bg-hover: ${rgba(accent, 0.11)};
  --dc-bg-active: ${rgba(accent, 0.17)};
  --dc-text-primary: ${ink};
  --dc-text-secondary: ${rgba(ink, 0.74)};
  --dc-text-tertiary: ${rgba(ink, 0.56)};
  --dc-text-placeholder: ${rgba(ink, 0.38)};
  --dc-primary: ${accent};
  --dc-primary-light: ${rgba(accent, 0.12)};
  --dc-primary-hover: ${rgba(accent, 0.90)};
  --dc-primary-active: ${rgba(accent, 0.82)};
  --dc-primary-shadow: ${rgba(accent, 0.22)};
  --dc-primary-bg-solid: ${rgba(accent, 0.10)};
  --dc-border: ${rgba(accent, 0.16)};
  --dc-border-light: ${rgba(accent, 0.10)};
  --dc-border-hover: ${rgba(accent, 0.34)};
  --dc-card-bg: ${card};
  --dc-card-shadow: 0 8px 24px ${rgba(ink, 0.09)};
  --dc-card-shadow-hover: 0 13px 30px ${rgba(ink, 0.14)};
  --dc-btn-gradient: linear-gradient(145deg, ${accent}, ${rgba(accent, 0.82)});
  --dc-btn-text: ${accentInk};
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-tab,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__tab,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-category-tab {
  border: 1px solid ${rgba(accent, 0.10)} !important;
  border-radius: ${Math.max(8, radius - 2)}px !important;
  background: ${rgba(profile.official.surface, 0.52)} !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-tab:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__tab:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-category-tab:hover {
  border-color: ${rgba(accent, 0.24)} !important;
  background: ${rgba(accent, 0.10)} !important;
  color: ${accent} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-tab.active,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__tab--active,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-category-tab.is-active {
  border-color: ${rgba(accent, 0.76)} !important;
  background: ${accent} !important;
  box-shadow: 0 5px 14px ${rgba(accent, 0.22)} !important;
  color: ${accentInk} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-search,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-search-bar,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-search-input {
  border: 1px solid ${rgba(accent, 0.18)} !important;
  border-radius: ${Math.min(radius, 14)}px !important;
  background: ${card} !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-search:focus-within,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-search-bar:focus-within,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-search-input:focus-within {
  border-color: ${accent} !important;
  box-shadow: 0 0 0 3px ${rgba(accent, 0.14)} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-flat-row,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-cloud-row,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-ws-section,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-empty,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tdoc-file-list-item,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tdoc-empty-state,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .kb-onboarding-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__license-banner,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-banner,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-list__row,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-catalog__row,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .lexiang-post-activation-gate__card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-playbook-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-featured-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-source-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-artifact-card,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-detail-modal,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-confirm-dialog,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-launch-dialog {
  border: 1px solid ${rgba(accent, 0.16)} !important;
  border-radius: ${Math.min(radius, 18)}px !important;
  background: ${card} !important;
  color: ${ink} !important;
  box-shadow: 0 8px 24px ${rgba(ink, 0.09)} !important;
  backdrop-filter: blur(12px) saturate(112%);
  -webkit-backdrop-filter: blur(12px) saturate(112%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-flat-row:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-cloud-row:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tdoc-file-list-item:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-list__row:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-catalog__row:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-playbook-card:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-playbook-card.is-hovered,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-featured-card:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-source-card:hover {
  border-color: ${rgba(accent, 0.38)} !important;
  background: ${rgba(accent, 0.11)} !important;
  box-shadow: 0 13px 30px ${rgba(ink, 0.14)} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-auth-guide__permissions,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .ima-auth-guide__permissions,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .lexiang-auth-guide__permissions {
  border: 1px solid ${rgba(accent, 0.16)} !important;
  border-radius: ${Math.min(radius, 18)}px !important;
  background: ${card} !important;
  box-shadow: 0 8px 24px ${rgba(ink, 0.09)} !important;
  backdrop-filter: blur(12px) saturate(112%);
  -webkit-backdrop-filter: blur(12px) saturate(112%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-auth-guide__permission-item,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .ima-auth-guide__permission-item,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .lexiang-auth-guide__permission-item {
  border: 1px solid ${rgba(accent, 0.10)} !important;
  border-radius: ${Math.max(8, radius - 3)}px !important;
  background: ${rgba(profile.official.surface, 0.56)} !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-context-menu,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-filter-menu,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__settings-menu,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-panel__settings-menu,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tdoc-import-menu,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-source-panel {
  border: 1px solid ${rgba(accent, 0.18)} !important;
  border-radius: ${radius}px !important;
  background: ${rgba(profile.official.surface, 0.94)} !important;
  color: ${ink} !important;
  box-shadow: 0 16px 42px ${rgba(ink, 0.18)} !important;
  backdrop-filter: blur(18px) saturate(118%);
  -webkit-backdrop-filter: blur(18px) saturate(118%);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-auth-guide__btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .ima-auth-guide__btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .lexiang-auth-guide__btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__create-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__upload-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-banner__create-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-banner__upload-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-panel__goto-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .lexiang-post-activation-gate__btn--primary,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-detail-launch-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-launch-start-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-confirm-continue-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-detail-stage-action.primary {
  border-color: ${rgba(accent, 0.82)} !important;
  background: ${accent} !important;
  color: ${accentInk} !important;
  box-shadow: 0 5px 14px ${rgba(accent, 0.22)} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-filter-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-list-action-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__open-in-browser-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__settings-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-panel__settings-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-featured-refresh-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-favorites-btn,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-topbar-back-btn {
  border: 1px solid ${rgba(accent, 0.14)} !important;
  border-radius: ${Math.max(8, radius - 3)}px !important;
  background: ${rgba(profile.official.surface, 0.68)} !important;
  color: ${ink} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-filter-btn:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .my-files-list-action-btn:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__open-in-browser-btn:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-docs-panel__settings-btn:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .tencent-lexiang-panel__settings-btn:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-featured-refresh-btn:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-favorites-btn:hover,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .dc-topbar-back-btn:hover {
  border-color: ${rgba(accent, 0.28)} !important;
  background: ${rgba(accent, 0.10)} !important;
  color: ${accent} !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] ::selection {
  background: ${rgba(accent, 0.24)};
}
`;
}

function workbuddyBrandRules(profile, {enabled, accentInk}) {
  const brand = profile.advanced.brand ?? {
    enabled: false,
    displayName: null,
    shortMark: null,
    logoStyle: 'original',
  };
  if (!enabled || !brand.enabled) return '';
  const accent = profile.official.accent;
  const ink = readableInkForSurface(profile.official.ink, profile.official.surface);
  const nameRules = brand.displayName ? `
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] a.conversation-list-logo > .logo-workbuddy-title,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .top-bar-workbuddy-title,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-header__title {
  font-size: 0 !important;
  color: transparent !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] a.conversation-list-logo > .logo-workbuddy-title::after,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .top-bar-workbuddy-title::after {
  content: ${cssString(brand.displayName)};
  font-size: 13px;
  line-height: 20px;
  font-weight: 750;
  letter-spacing: .01em;
  color: ${ink};
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .wb-home-header__title::after {
  content: ${cssString(brand.displayName)};
  display: block;
  font-size: 36px;
  line-height: 48px;
  font-weight: 760;
  letter-spacing: -.025em;
  color: ${ink};
}
` : '';
  const markShapes = {
    tile: 'border-radius: 8px;',
    circle: 'border-radius: 50%;',
    diamond: 'border-radius: 7px; clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);',
    original: '',
  };
  const markRules = brand.iconImage ? `
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] a.conversation-list-logo,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-topbar-logo,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .top-bar-workbuddy-logo {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  min-height: 26px;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] a.conversation-list-logo::before,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-topbar-logo::before,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .top-bar-workbuddy-logo::before,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-collapsed-top::before {
  content: "";
  display: inline-flex;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: url(${cssString(brand.iconImage)}) center / contain no-repeat !important;
  box-shadow: 0 5px 14px ${rgba(accent, 0.20)}, inset 0 0 0 1px rgba(255, 255, 255, .36);
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] a.conversation-list-logo > img.logo-workbuddy-icon[alt="WorkBuddy"],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-topbar-logo > img,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .top-bar-workbuddy-logo > img,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-collapsed-top > img.collapsed-logo[alt="WorkBuddy"] {
  display: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-collapsed-top {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-collapsed:hover .conversation-list-collapsed-top::before {
  display: none !important;
}
` : brand.shortMark && brand.logoStyle !== 'original' ? `
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] a.conversation-list-logo,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-topbar-logo,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .top-bar-workbuddy-logo {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  min-height: 26px;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] a.conversation-list-logo::before,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-topbar-logo::before,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .top-bar-workbuddy-logo::before,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-collapsed-top::before {
  content: ${cssString(brand.shortMark)};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  ${markShapes[brand.logoStyle] ?? markShapes.tile}
  background: linear-gradient(145deg, ${rgba(accent, 0.78)}, ${accent});
  box-shadow: 0 5px 14px ${rgba(accent, 0.25)}, inset 0 0 0 1px rgba(255, 255, 255, .42);
  color: ${accentInk};
  font-size: 8px;
  line-height: 1;
  font-weight: 800;
  letter-spacing: -.03em;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] a.conversation-list-logo > img.logo-workbuddy-icon[alt="WorkBuddy"],
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .workbuddy-topbar-logo > img,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .top-bar-workbuddy-logo > img,
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-collapsed-top > img.collapsed-logo[alt="WorkBuddy"] {
  display: none !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-collapsed-top {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-collapsed:hover .conversation-list-collapsed-top::before {
  display: none !important;
}
` : '';
  return `
/* WorkBuddy exact adapter: visual-only local brand treatment. */
${nameRules}
${markRules}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-version-badge {
  min-width: 36px;
  border: 1px solid ${rgba(accent, 0.24)};
  border-radius: 999px;
  padding: 1px 5px;
  background: ${rgba(accent, 0.09)};
  color: ${accent} !important;
  font-size: 0 !important;
  font-weight: 750 !important;
  text-align: center;
}
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] .conversation-list-version-badge::after {
  content: "SKIN";
  font-size: 8px;
  letter-spacing: .08em;
}
`;
}

function codexCompatibilityRules(profile, {enabled, panel}) {
  if (!enabled) return '';
  const ink = profile.official.ink;
  const accent = profile.official.accent;
  const baseRadius = Math.max(6, Math.min(30, profile.advanced.radius));
  const readableInk = readableInkForSurface(ink, profile.official.surface, 4.2);
  const readableSecondaryInk = rgba(readableInk, 0.74);
  const readablePlaceholderInk = rgba(readableInk, 0.58);
  const accentInk = contrastRatio('#FFFFFF', accent) >= 4.5 ? '#FFFFFF' : '#111111';
  const safeComposerBackground = rgba(profile.official.surface, 0.96);
  const safeDialogBackground = rgba(profile.official.surface, 0.98);
  return `
/* GPT/Codex 新布局兼容：左侧导航 + 主内容面板 + 侧栏选中态 + 输入/弹窗可读性。 */
html[${ROOT_ATTRIBUTE}] {
  --codex-base-accent: ${accent};
  --codex-base-contrast: ${accentInk};
  --codex-base-ink: ${ink};
  --codex-base-surface: ${panel};
  --color-token-main-surface-primary: ${panel};
  --color-token-bg-primary: ${panel};
  --color-token-bg-secondary: ${panel};
  --color-token-side-bar-background: ${panel};
  --color-token-editor-background: ${rgba(profile.official.surface, 0.94)};
  --color-token-diff-surface: ${rgba(profile.official.surface, 0.94)};
  --color-token-diff-editor-inserted-line-background: ${rgba(profile.official.accent, 0.14)};
  --color-token-diff-editor-removed-line-background: ${rgba('#F97316', 0.08)};
  --color-token-diff-editor-removed-text-background: ${rgba('#F97316', 0.10)};
  --codex-diffs-surface: ${rgba(profile.official.surface, 0.82)};
  --codex-diffs-surface-override: ${rgba(profile.official.surface, 0.82)};
  --codex-diffs-addition-hover: ${rgba(profile.official.accent, 0.20)};
  --codex-diffs-deletion-hover: ${rgba('#F97316', 0.24)};
  --color-token-foreground: ${readableInk};
  --color-token-text-primary: ${readableInk};
  --color-token-text-secondary: ${readableSecondaryInk};
  --color-token-text-tertiary: ${readableSecondaryInk};
  --color-token-description-foreground: ${readableSecondaryInk};
  --color-token-icon-foreground: ${readableInk};
  --color-token-on-accent: ${accentInk};
  --color-token-link: ${accent};
  --color-token-button-background: ${accent};
  --color-token-button-border: ${rgba(ink, 0.22)};
  --color-token-button-foreground: ${accentInk};
  --color-token-button-secondary-hover-background: ${rgba(accent, 0.12)};
  --color-token-input-background: ${rgba(profile.official.surface, 0.96)};
  --color-token-input-border: ${rgba(ink, 0.18)};
  --color-token-input-foreground: ${readableInk};
  --color-token-input-placeholder-foreground: ${readablePlaceholderInk};
  --color-token-interactive-bg-secondary-hover: ${rgba(accent, 0.12)};
  --color-token-interactive-bg-secondary-press: ${rgba(accent, 0.18)};
  --color-token-interactive-bg-secondary-selected: ${rgba(accent, 0.20)};
  --color-token-interactive-label-accent-default: ${accent};
  --color-token-border: ${rgba(ink, 0.16)};
  --color-token-border-default: ${rgba(ink, 0.16)};
  --color-token-border-heavy: ${rgba(ink, 0.20)};
  --color-token-border-light: ${rgba(ink, 0.12)};
  --color-token-focus-border: ${accent};
  --codex-corner-radius-scale: ${baseRadius};
  --codex-corner-shape: 1;
  --radius-token-composer-single-line: ${baseRadius};
  --spacing-token-button-composer: 10px;
}
html[${ROOT_ATTRIBUTE}] [data-app-shell-header-edge-scroll],
html[${ROOT_ATTRIBUTE}] [data-app-shell-sidebar-trigger],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tabs],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-strip-controller],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-controller],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-panel-controller],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-close-button],
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-scroll],
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar],
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-section],
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-section-heading],
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-section-toggle],
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-scroll] [role='list'],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tabs] [role='tab'],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-strip-controller] [role='tab'],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-controller] [role='tab'],
html[${ROOT_ATTRIBUTE}] aside.app-shell-left-panel {
  background: ${panel} !important;
  color: ${readableInk} !important;
  border-color: ${rgba(ink, 0.16)} !important;
}
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout],
html[${ROOT_ATTRIBUTE}] main.main-surface {
  background-color: transparent !important;
  background-image: none !important;
  border-color: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-top-fade] {
  background: linear-gradient(to bottom, ${rgba(profile.official.surface, 0.22)}, transparent) !important;
  box-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] aside.app-shell-left-panel [data-lingglow-codex-sidebar-state="selected"] {
  background: ${rgba(accent, 0.22)} !important;
  border: 1px solid ${rgba(accent, 0.48)} !important;
  border-left: 4px solid ${accent} !important;
  border-radius: 12px !important;
  color: ${readableInk} !important;
  font-weight: 650 !important;
  box-shadow: inset 2px 0 0 ${accent}, 0 6px 18px ${rgba(accent, 0.12)} !important;
}
html[${ROOT_ATTRIBUTE}] aside.app-shell-left-panel [data-lingglow-codex-sidebar-state="idle"] {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  color: ${readableInk} !important;
  font-weight: inherit !important;
}
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-scroll] [data-app-action-sidebar-section-toggle][aria-expanded="true"] {
  color: ${readableInk} !important;
  border-color: ${rgba(accent, 0.36)} !important;
}
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-thread-row]:hover,
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-project-row]:hover {
  background: ${rgba(ink, 0.06)} !important;
}
/* Renderer code marks exactly one outer composer only after the route is
   ready. Never paint every native composer marker: current Codex nests them
   and doing so produces two or three concentric frames. */
html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-composer-anchor="true"] {
  border-color: ${rgba(ink, 0.18)} !important;
  border-radius: ${baseRadius}px !important;
  background: ${safeComposerBackground} !important;
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [data-codex-composer],
html[${ROOT_ATTRIBUTE}] [data-codex-composer-root],
html[${ROOT_ATTRIBUTE}] [data-codex-composer] .ProseMirror,
html[${ROOT_ATTRIBUTE}] [data-codex-composer] [role="textbox"],
html[${ROOT_ATTRIBUTE}] [data-codex-composer-root] .ProseMirror,
html[${ROOT_ATTRIBUTE}] [data-codex-composer-root] [role="textbox"],
html[${ROOT_ATTRIBUTE}] .composer-surface-chrome .ProseMirror,
html[${ROOT_ATTRIBUTE}] .composer-surface-chrome [role="textbox"],
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout] [role="main"],
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout] [role="region"],
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout] [role="list"],
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout] [role="listitem"],
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-scroll] [role="list"],
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-scroll] [role="listitem"] {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [data-codex-composer-root] input,
html[${ROOT_ATTRIBUTE}] [data-codex-composer-root] textarea,
html[${ROOT_ATTRIBUTE}] [data-codex-composer-root] [role="textbox"],
html[${ROOT_ATTRIBUTE}] [data-codex-composer] input,
html[${ROOT_ATTRIBUTE}] [data-codex-composer] textarea,
html[${ROOT_ATTRIBUTE}] [data-codex-composer] [role="textbox"],
html[${ROOT_ATTRIBUTE}] [role="textbox"] {
  border-color: transparent !important;
  background: transparent !important;
  color: ${readableInk} !important;
  caret-color: ${accent} !important;
  box-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] [data-codex-composer-root] [role="textbox"]::placeholder,
html[${ROOT_ATTRIBUTE}] [data-codex-composer] [role="textbox"]::placeholder,
html[${ROOT_ATTRIBUTE}] [data-codex-composer-root] input::placeholder,
html[${ROOT_ATTRIBUTE}] [data-codex-composer] input::placeholder,
html[${ROOT_ATTRIBUTE}] [data-codex-composer-root] textarea::placeholder,
html[${ROOT_ATTRIBUTE}] [data-codex-composer] textarea::placeholder {
  color: ${readablePlaceholderInk} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] input::placeholder,
html[${ROOT_ATTRIBUTE}] [role="dialog"] textarea::placeholder,
html[${ROOT_ATTRIBUTE}] .chat-popup input::placeholder,
html[${ROOT_ATTRIBUTE}] .chat-popup textarea::placeholder,
html[${ROOT_ATTRIBUTE}] .modal input::placeholder,
html[${ROOT_ATTRIBUTE}] .modal textarea::placeholder,
html[${ROOT_ATTRIBUTE}] .drawer input::placeholder,
html[${ROOT_ATTRIBUTE}] .drawer textarea::placeholder {
  color: ${readablePlaceholderInk} !important;
}
html[${ROOT_ATTRIBUTE}] [data-composer-overlay-floating-ui],
html[${ROOT_ATTRIBUTE}] [data-codex-composer-request-navigation],
html[${ROOT_ATTRIBUTE}] [data-composer-utility-bar-scroll-area] {
  color: ${readableInk} !important;
  background: ${rgba(profile.official.surface, 0.94)} !important;
  border-color: ${rgba(ink, 0.18)} !important;
}
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-strip-controller] button,
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-controller] button {
  color: ${readableInk} !important;
  border-color: ${rgba(ink, 0.16)} !important;
}
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-strip-controller] .is-active,
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-controller] .is-active,
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-controller] [aria-selected="true"],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-strip-controller] [aria-selected="true"],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-strip-controller] [role='tab'],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-controller] [role='tab'],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-strip-controller] [role='tab'][aria-selected="true"],
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-controller] [role='tab'][aria-selected="true"] {
  color: ${accent} !important;
  border-color: ${rgba(accent, 0.56)} !important;
}
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-strip-controller] [role='tab']:hover,
html[${ROOT_ATTRIBUTE}] [data-app-shell-tab-controller] [role='tab']:hover {
  color: ${accent} !important;
  background: ${rgba(accent, 0.10)} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"],
html[${ROOT_ATTRIBUTE}] .chat-popup,
html[${ROOT_ATTRIBUTE}] .modal,
html[${ROOT_ATTRIBUTE}] .drawer,
html[${ROOT_ATTRIBUTE}] [role="alertdialog"] {
  border: 1px solid ${rgba(ink, 0.18)} !important;
  border-radius: ${baseRadius}px !important;
  background: ${panel} !important;
  color: ${readableInk} !important;
  box-shadow: 0 20px 46px rgba(0, 0, 0, 0.18) !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] button,
html[${ROOT_ATTRIBUTE}] .chat-popup button,
html[${ROOT_ATTRIBUTE}] .modal button,
html[${ROOT_ATTRIBUTE}] .drawer button {
  border-color: ${rgba(ink, 0.16)} !important;
  background: ${rgba(ink, 0.08)} !important;
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] input,
html[${ROOT_ATTRIBUTE}] .chat-popup input,
html[${ROOT_ATTRIBUTE}] .drawer input,
html[${ROOT_ATTRIBUTE}] .modal input,
html[${ROOT_ATTRIBUTE}] [role="dialog"] textarea,
html[${ROOT_ATTRIBUTE}] .chat-popup textarea,
html[${ROOT_ATTRIBUTE}] .drawer textarea,
html[${ROOT_ATTRIBUTE}] .modal textarea,
html[${ROOT_ATTRIBUTE}] [role="dialog"] select,
html[${ROOT_ATTRIBUTE}] .chat-popup select,
html[${ROOT_ATTRIBUTE}] .drawer select,
html[${ROOT_ATTRIBUTE}] .modal select {
  border: 1px solid ${rgba(ink, 0.18)} !important;
  background: ${safeComposerBackground} !important;
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] [data-app-action-sidebar-scroll],
html[${ROOT_ATTRIBUTE}] .chat-popup [data-app-action-sidebar-scroll],
html[${ROOT_ATTRIBUTE}] .drawer [data-app-action-sidebar-scroll],
html[${ROOT_ATTRIBUTE}] .modal [data-app-action-sidebar-scroll],
html[${ROOT_ATTRIBUTE}] [role="dialog"] [role="listitem"][aria-selected="true"],
html[${ROOT_ATTRIBUTE}] [role="dialog"] [role="listitem"][data-state="selected"],
html[${ROOT_ATTRIBUTE}] .chat-popup [role="listitem"][aria-selected="true"],
html[${ROOT_ATTRIBUTE}] .chat-popup [role="listitem"][data-state="selected"] {
  color: ${readableInk} !important;
  background: ${rgba(profile.official.surface, 0.12)} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] p,
html[${ROOT_ATTRIBUTE}] [role="dialog"] span,
html[${ROOT_ATTRIBUTE}] [role="dialog"] div,
html[${ROOT_ATTRIBUTE}] [role="dialog"] li,
html[${ROOT_ATTRIBUTE}] .chat-popup *:not(button):not(input):not(textarea):not(select),
html[${ROOT_ATTRIBUTE}] .modal *:not(button):not(input):not(textarea):not(select),
html[${ROOT_ATTRIBUTE}] .drawer *:not(button):not(input):not(textarea):not(select) {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] main.main-surface article,
html[${ROOT_ATTRIBUTE}] main.main-surface [role="main"],
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout] article,
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout] [role="main"],
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout] input::placeholder,
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout] textarea::placeholder {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [data-browser-sidebar-webview-host-root],
html[${ROOT_ATTRIBUTE}] [data-browser-sidebar-retained-webview],
html[${ROOT_ATTRIBUTE}] [data-mcp-app-side-panel-frame-container],
html[${ROOT_ATTRIBUTE}] iframe,
html[${ROOT_ATTRIBUTE}] webview {
  pointer-events: auto !important;
  color: initial;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] .ProseMirror,
html[${ROOT_ATTRIBUTE}] .chat-popup .ProseMirror,
html[${ROOT_ATTRIBUTE}] .drawer .ProseMirror {
  color: ${readableInk} !important;
  background: ${safeDialogBackground} !important;
}
`;
}

function doubaoCompatibilityRules(profile, {enabled}) {
  if (!enabled) return '';
  const ink = profile.official.ink;
  const accent = profile.official.accent;
  const panel = rgba(profile.official.surface, 0.96);
  const readableInk = readableInkForSurface(ink, profile.official.surface, 4.5);
  const readableSecondaryInk = rgba(readableInk, 0.74);
  const readablePlaceholderInk = rgba(readableInk, 0.58);
  const panelSurface = rgba(profile.official.surface, 0.96);
  const mainGlass = rgba(profile.official.surface, 0.58);
  const sidebarGlass = rgba(profile.official.surface, 0.84);
  const elevatedGlass = rgba(profile.official.surface, 0.92);
  const accentInk = contrastRatio('#FFFFFF', accent) >= 4.5 ? '#FFFFFF' : '#111111';
  return `
/* Doubao 新布局：稳定锚点 + 主面板 + 侧栏 + 输入区 + 弹窗可读性。 */
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"],
html[${ROOT_ATTRIBUTE}] .chat-input,
html[${ROOT_ATTRIBUTE}] #chat-input,
html[${ROOT_ATTRIBUTE}] [data-chat-input] {
  color: ${readableInk} !important;
  border-color: ${rgba(ink, 0.16)} !important;
  background: ${panelSurface} !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] textarea,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] textarea,
html[${ROOT_ATTRIBUTE}] [data-testid="message_text_content"],
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] [role="textbox"],
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] [role="textbox"] {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] .chat-input [role="textbox"],
html[${ROOT_ATTRIBUTE}] .chat-input [contenteditable],
html[${ROOT_ATTRIBUTE}] [data-chat-input],
html[${ROOT_ATTRIBUTE}] [data-chat-input] [role="textbox"],
html[${ROOT_ATTRIBUTE}] [data-chat-input] [contenteditable] {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] #chat-input,
html[${ROOT_ATTRIBUTE}] #chat-input [role="textbox"],
html[${ROOT_ATTRIBUTE}] #chat-input [contenteditable] {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] #chat-input input,
html[${ROOT_ATTRIBUTE}] #chat-input textarea {
  border-color: transparent !important;
  background: transparent !important;
  color: ${readableInk} !important;
  caret-color: ${accent} !important;
  box-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] input,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] textarea,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] [role="textbox"],
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] [contenteditable],
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"],
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] input,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] textarea,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] [role="textbox"],
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] [contenteditable],
html[${ROOT_ATTRIBUTE}] .chat-input [role="textbox"],
html[${ROOT_ATTRIBUTE}] .chat-input [contenteditable],
html[${ROOT_ATTRIBUTE}] [data-chat-input][role="textbox"],
html[${ROOT_ATTRIBUTE}] [data-chat-input][contenteditable],
html[${ROOT_ATTRIBUTE}] [data-chat-input] [role="textbox"],
html[${ROOT_ATTRIBUTE}] [data-chat-input] [contenteditable] {
  border-color: transparent !important;
  background: transparent !important;
  color: ${readableInk} !important;
  caret-color: ${accent} !important;
  box-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] input::placeholder,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] textarea::placeholder,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] input::placeholder,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] textarea::placeholder {
  color: ${readablePlaceholderInk} !important;
}
html[${ROOT_ATTRIBUTE}] .chat-input input::placeholder,
html[${ROOT_ATTRIBUTE}] .chat-input textarea::placeholder {
  color: ${readablePlaceholderInk} !important;
}
html[${ROOT_ATTRIBUTE}] .chat-input [role='textbox']::selection,
html[${ROOT_ATTRIBUTE}] #chat-input [role='textbox']::selection,
html[${ROOT_ATTRIBUTE}] #chat-input input::placeholder,
html[${ROOT_ATTRIBUTE}] #chat-input textarea::placeholder {
  color: ${readablePlaceholderInk} !important;
}
html[${ROOT_ATTRIBUTE}] [data-chat-input] input::placeholder,
html[${ROOT_ATTRIBUTE}] [data-chat-input] textarea::placeholder,
html[${ROOT_ATTRIBUTE}] [data-chat-input] [contenteditable]::selection {
  color: ${readablePlaceholderInk} !important;
}
html[${ROOT_ATTRIBUTE}] .skeleton-input,
html[${ROOT_ATTRIBUTE}] .skeleton-circle-send-btn {
  border-color: ${rgba(ink, 0.18)} !important;
  background: ${panelSurface} !important;
}
html[${ROOT_ATTRIBUTE}] .suspension-dialog,
html[${ROOT_ATTRIBUTE}] .dbx-dialog,
html[${ROOT_ATTRIBUTE}] .dbx-modal {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] .suspension-dialog *,
html[${ROOT_ATTRIBUTE}] .dbx-dialog *,
html[${ROOT_ATTRIBUTE}] .dbx-modal * {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] p,
html[${ROOT_ATTRIBUTE}] [role="dialog"] h1,
html[${ROOT_ATTRIBUTE}] [role="dialog"] h2,
html[${ROOT_ATTRIBUTE}] [role="dialog"] h3,
html[${ROOT_ATTRIBUTE}] [role="dialog"] span,
html[${ROOT_ATTRIBUTE}] .dbx-dialog p,
html[${ROOT_ATTRIBUTE}] .dbx-dialog h1,
html[${ROOT_ATTRIBUTE}] .dbx-dialog h2,
html[${ROOT_ATTRIBUTE}] .dbx-dialog h3,
html[${ROOT_ATTRIBUTE}] .dbx-dialog span,
html[${ROOT_ATTRIBUTE}] .dbx-modal p,
html[${ROOT_ATTRIBUTE}] .dbx-modal h1,
html[${ROOT_ATTRIBUTE}] .dbx-modal h2,
html[${ROOT_ATTRIBUTE}] .dbx-modal h3,
html[${ROOT_ATTRIBUTE}] .dbx-modal span,
html[${ROOT_ATTRIBUTE}] .suspension-dialog p,
html[${ROOT_ATTRIBUTE}] .suspension-dialog h1,
html[${ROOT_ATTRIBUTE}] .suspension-dialog h2,
html[${ROOT_ATTRIBUTE}] .suspension-dialog h3,
html[${ROOT_ATTRIBUTE}] .suspension-dialog span,
html[${ROOT_ATTRIBUTE}] .chat-popup p,
html[${ROOT_ATTRIBUTE}] .chat-popup h1,
html[${ROOT_ATTRIBUTE}] .chat-popup h2,
html[${ROOT_ATTRIBUTE}] .chat-popup h3,
html[${ROOT_ATTRIBUTE}] .chat-popup span {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] ::selection,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] ::selection,
html[${ROOT_ATTRIBUTE}] [contenteditable="true"] ::selection,
html[${ROOT_ATTRIBUTE}] .chat-input ::selection,
html[${ROOT_ATTRIBUTE}] .dbx-dialog ::selection,
html[${ROOT_ATTRIBUTE}] .dbx-modal ::selection,
html[${ROOT_ATTRIBUTE}] .suspension-dialog ::selection,
html[${ROOT_ATTRIBUTE}] [role="dialog"] ::selection {
  background: ${rgba(accent, 0.26)};
}
html[${ROOT_ATTRIBUTE}] [role="dialog"],
html[${ROOT_ATTRIBUTE}] .dbx-dialog,
html[${ROOT_ATTRIBUTE}] .dbx-modal,
html[${ROOT_ATTRIBUTE}] .suspension-dialog {
  color: ${readableInk} !important;
  border: 1px solid ${rgba(ink, 0.16)} !important;
  background: ${panel} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] button,
html[${ROOT_ATTRIBUTE}] .dbx-dialog button,
html[${ROOT_ATTRIBUTE}] .dbx-modal button,
html[${ROOT_ATTRIBUTE}] .suspension-dialog button {
  border-color: ${rgba(ink, 0.16)} !important;
  background: ${panelSurface} !important;
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] *:not(button),
html[${ROOT_ATTRIBUTE}] .dbx-dialog *:not(button),
html[${ROOT_ATTRIBUTE}] .dbx-modal *:not(button),
html[${ROOT_ATTRIBUTE}] .suspension-dialog *:not(button) {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] ::selection,
html[${ROOT_ATTRIBUTE}] .dbx-dialog ::selection,
html[${ROOT_ATTRIBUTE}] .dbx-modal ::selection,
html[${ROOT_ATTRIBUTE}] .suspension-dialog ::selection {
  background: ${rgba(accent, 0.26)};
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] input::placeholder,
html[${ROOT_ATTRIBUTE}] [role="dialog"] textarea::placeholder,
html[${ROOT_ATTRIBUTE}] .suspension-dialog input::placeholder,
html[${ROOT_ATTRIBUTE}] .suspension-dialog textarea::placeholder,
html[${ROOT_ATTRIBUTE}] .dbx-dialog input::placeholder,
html[${ROOT_ATTRIBUTE}] .dbx-dialog textarea::placeholder,
html[${ROOT_ATTRIBUTE}] .dbx-modal input::placeholder,
html[${ROOT_ATTRIBUTE}] .dbx-modal textarea::placeholder {
  color: ${readablePlaceholderInk} !important;
}
html[${ROOT_ATTRIBUTE}] [role="dialog"] input,
html[${ROOT_ATTRIBUTE}] [role="dialog"] textarea,
html[${ROOT_ATTRIBUTE}] .suspension-dialog input,
html[${ROOT_ATTRIBUTE}] .suspension-dialog textarea,
html[${ROOT_ATTRIBUTE}] .dbx-dialog input,
html[${ROOT_ATTRIBUTE}] .dbx-dialog textarea,
html[${ROOT_ATTRIBUTE}] .dbx-modal input,
html[${ROOT_ATTRIBUTE}] .dbx-modal textarea,
html[${ROOT_ATTRIBUTE}] .chat-popup input,
html[${ROOT_ATTRIBUTE}] .chat-popup textarea {
  border-color: ${rgba(ink, 0.18)} !important;
  background: ${panelSurface} !important;
  color: ${readableInk} !important;
}
/* 2.19.9 可见主窗口：只覆盖固定 ID 与 data-testid，不污染全局 div/span。 */
html[${ROOT_ATTRIBUTE}] #chat-route-layout,
html[${ROOT_ATTRIBUTE}] #chat-route-main {
  background: transparent !important;
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] #chat-route-main > main,
html[${ROOT_ATTRIBUTE}] #chat-route-main main {
  background: transparent !important;
  color: ${readableInk} !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar {
  border-color: ${rgba(accent, 0.22)} !important;
  background: ${sidebarGlass} !important;
  color: ${readableInk} !important;
  box-shadow: inset -1px 0 ${rgba('#FFFFFF', 0.06)}, 12px 0 36px ${rgba('#000000', 0.14)};
  backdrop-filter: blur(20px) saturate(116%);
  -webkit-backdrop-filter: blur(20px) saturate(116%);
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="sidebar-section-item"] {
  background: transparent !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="create_conversation_button"],
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="create_office_task_button"],
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="app-open-website"],
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="ai_space_nav_button"],
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid^="skill-page-item-"] {
  border-radius: 12px !important;
  color: ${readableSecondaryInk} !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="create_conversation_button"] {
  background: linear-gradient(90deg, ${rgba(accent, 0.24)}, ${rgba(accent, 0.10)}) !important;
  box-shadow: inset 3px 0 ${accent}, 0 8px 24px ${rgba(accent, 0.10)};
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="create_conversation_button"] > *,
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="create_conversation_button"] > * > * {
  background: transparent !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="create_conversation_button"] *,
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="create_office_task_button"] *,
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="app-open-website"] *,
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="ai_space_nav_button"] *,
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid^="skill-page-item-"] * {
  color: inherit !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="chat_list_thread_item"] {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="chat_list_thread_item"]:hover {
  background: ${rgba(accent, 0.14)} !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="chat_list_item_title"] {
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="view_all_chats_button"],
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar [data-testid="chat_item_dropdown_entry"],
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar svg {
  color: ${readableSecondaryInk} !important;
}
html[${ROOT_ATTRIBUTE}] #flow_chat_sidebar input {
  border-color: ${rgba('#FFFFFF', 0.10)} !important;
  background: ${rgba('#FFFFFF', 0.08)} !important;
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="onboarding_sug_item"] {
  border: 1px solid ${rgba('#FFFFFF', 0.08)} !important;
  background: ${rgba(profile.official.surface, 0.72)} !important;
  color: ${readableInk} !important;
  box-shadow: 0 8px 24px ${rgba('#000000', 0.12)};
  backdrop-filter: blur(12px) saturate(112%);
  -webkit-backdrop-filter: blur(12px) saturate(112%);
}
html[${ROOT_ATTRIBUTE}] [data-testid="onboarding_sug_item"]:hover {
  border-color: ${rgba(accent, 0.42)} !important;
  background: ${rgba(accent, 0.18)} !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="flow_chat_guidance_page"] [class*="greeting-text"]::after {
  background: transparent !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] {
  border: 1px solid ${rgba(accent, 0.26)} !important;
  background: ${elevatedGlass} !important;
  color: ${readableInk} !important;
  box-shadow: 0 18px 46px ${rgba('#000000', 0.24)}, 0 0 0 1px ${rgba('#FFFFFF', 0.06)} !important;
  backdrop-filter: blur(20px) saturate(116%);
  -webkit-backdrop-filter: blur(20px) saturate(116%);
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] > div,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] > div > div,
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input_input"] {
  background: transparent !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"]:focus-within {
  border-color: ${accent} !important;
  box-shadow: 0 18px 48px ${rgba('#000000', 0.28)}, 0 0 0 3px ${rgba(accent, 0.18)} !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] button,
html[${ROOT_ATTRIBUTE}] [data-testid="guidance-skill-bar"] button,
html[${ROOT_ATTRIBUTE}] [data-testid="asr_btn"] {
  border-color: ${rgba('#FFFFFF', 0.08)} !important;
  color: ${rgba(readableInk, 0.90)} !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] button *,
html[${ROOT_ATTRIBUTE}] [data-testid="guidance-skill-bar"] button *,
html[${ROOT_ATTRIBUTE}] [data-testid="asr_btn"] * {
  color: inherit !important;
}
${profile.official.variant === 'light' ? `
html[${ROOT_ATTRIBUTE}] [data-testid^="skill_bar_button_"] img[class~="dark:hidden"] { display: block !important; }
html[${ROOT_ATTRIBUTE}] [data-testid^="skill_bar_button_"] img[class~="dark:block"] { display: none !important; }
` : `
html[${ROOT_ATTRIBUTE}] [data-testid^="skill_bar_button_"] img[class~="dark:hidden"] { display: none !important; }
html[${ROOT_ATTRIBUTE}] [data-testid^="skill_bar_button_"] img[class~="dark:block"] { display: block !important; }
`}
html[${ROOT_ATTRIBUTE}] #chat-route-main :is(
  [class~="bg-g-send-msg-bubble-bg"],
  [class~="text-g-send-msg-bubble-text"]
),
html[${ROOT_ATTRIBUTE}] #chat-route-main :is(
  [class~="bg-g-send-msg-bubble-bg"],
  [class~="text-g-send-msg-bubble-text"]
) :where(*) {
  color: ${readableInk} !important;
  -webkit-text-fill-color: ${readableInk} !important;
  text-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] button:hover,
html[${ROOT_ATTRIBUTE}] [data-testid="guidance-skill-bar"] button:hover,
html[${ROOT_ATTRIBUTE}] [data-testid="asr_btn"]:hover {
  background: ${rgba(accent, 0.16)} !important;
  color: ${readableInk} !important;
}
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] [data-state="active"],
html[${ROOT_ATTRIBUTE}] [data-testid="chat_input"] button[aria-pressed="true"] {
  background: ${accent} !important;
  color: ${accentInk} !important;
}
`;
}

export function compileSkin(profileInput, {
  capabilityLevel = 'exact',
  capabilities,
  clientId = 'codex',
} = {}) {
  const profile = normalizeProfile(profileInput);
  const defaults = capabilityLevel === 'exact' ? defaultExactCapabilities : defaultGenericCapabilities;
  const enabledCapabilities = new Set(capabilities ?? defaults);
  // `advanced.enabled` is the single visual-layer kill switch.  The session
  // manager already refuses to attach when it is false, but compilation is
  // also used by the local preview and by callers which never launch a
  // renderer.  Keeping that path stock-safe avoids a preview that claims a
  // disabled profile will still repaint an Agent.
  const visualLayerEnabled = profile.advanced.enabled;
  const consumedCapabilities = visualLayerEnabled ? enabledCapabilities : new Set();
  const exact = capabilityLevel === 'exact';
  const has = (name) => consumedCapabilities.has(name);
  const codexSemanticLayout = clientId === 'codex' && has('palette') &&
    (exact || capabilityLevel === 'generic-safe');
  const glass = profile.advanced.glass;
  const surfaceAlpha = has('glass') && glass.enabled ? glass.opacity : 1;
  const panel = rgba(profile.official.surface, surfaceAlpha);
  const border = rgba(profile.official.ink, 0.12);
  const safeTextInk = readableInkForSurface(profile.official.ink, profile.official.surface, 4.2);
  const accentInk = contrastRatio('#FFFFFF', profile.official.accent) >=
    contrastRatio('#111111', profile.official.accent) ? '#FFFFFF' : '#111111';
  // Shell and composer selectors target build-sensitive Codex DOM structure
  // (aside.app-shell-left-panel, [data-codex-composer], etc.).  They must
  // require `exact` compatibility so a generic-safe version downgrade never
  // injects selectors whose DOM may have moved or been renamed.  Composer
  // rules additionally require the declared `composer` capability — gating
  // them on `palette` (which is always present in generic-safe) leaked
  // layout CSS into downgraded sessions and contradicted the
  // `layoutFeaturesEnabled` audit field.
  const shellSelectors = codexSemanticLayout ? `
html[${ROOT_ATTRIBUTE}] aside.app-shell-left-panel {
  background: linear-gradient(
    90deg,
    ${rgba(profile.official.surface, Math.min(1, surfaceAlpha + 0.08))} 0%,
    ${panel} calc(100% - 24px),
    ${rgba(profile.official.surface, Math.max(0.20, surfaceAlpha * 0.58))} 100%
  ) !important;
  border-right: 0 !important;
  box-shadow: none !important;
  ${glass.enabled ? `backdrop-filter: blur(${glass.blur}px) saturate(125%); -webkit-backdrop-filter: blur(${glass.blur}px) saturate(125%);` : ''}
}
html[${ROOT_ATTRIBUTE}] aside.app-shell-left-panel::after {
  background: linear-gradient(
    90deg,
    ${rgba(profile.official.surface, Math.max(0.20, surfaceAlpha * 0.58))} 0%,
    ${rgba(profile.official.surface, Math.max(0.12, surfaceAlpha * 0.32))} 46%,
    ${rgba(profile.official.surface, Math.max(0.04, surfaceAlpha * 0.10))} 76%,
    transparent 100%
  ) !important;
  border: 0 !important;
  box-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] [data-app-action-sidebar-scroll] {
  background: transparent !important;
}
html[${ROOT_ATTRIBUTE}] [data-app-shell-main-content-layout],
html[${ROOT_ATTRIBUTE}] main.main-surface {
  background-color: transparent !important;
  background-image: none !important;
  border-color: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
` : '';
  const composerSelectors = codexSemanticLayout && has('composer') ? `
html[${ROOT_ATTRIBUTE}] [data-lingglow-codex-composer-anchor="true"] {
  background: ${panel} !important;
  border-color: ${border} !important;
  border-radius: ${profile.advanced.radius}px !important;
  ${glass.enabled ? `backdrop-filter: blur(${glass.blur}px) saturate(125%); -webkit-backdrop-filter: blur(${glass.blur}px) saturate(125%);` : ''}
}
` : '';
  const workbuddyShellSelectors = clientId === 'workbuddy' && exact && has('background') ? `
/* WorkBuddy 5.2.6 / 5.3.3 / 5.3.5 exact adapter: audited full-window surfaces. */
html[${ROOT_ATTRIBUTE}] .teams-container,
html[${ROOT_ATTRIBUTE}] [class^="_gridViewItem_"],
html[${ROOT_ATTRIBUTE}] [data-view-id="sidebar"],
html[${ROOT_ATTRIBUTE}] .conversation-sidebar,
html[${ROOT_ATTRIBUTE}] .teams-main-content,
html[${ROOT_ATTRIBUTE}] .main-content,
html[${ROOT_ATTRIBUTE}] .main-content--welcome,
html[${ROOT_ATTRIBUTE}] .main-content--automation,
html[${ROOT_ATTRIBUTE}] .main-content--projects,
html[${ROOT_ATTRIBUTE}] .claw-workspace,
html[${ROOT_ATTRIBUTE}] .claw-workspace__main,
html[${ROOT_ATTRIBUTE}] .claw-workspace__pane,
html[${ROOT_ATTRIBUTE}] .workbuddy-collab,
html[${ROOT_ATTRIBUTE}] .landing,
html[${ROOT_ATTRIBUTE}] .landing-main,
html[${ROOT_ATTRIBUTE}] .welcome-container,
html[${ROOT_ATTRIBUTE}] .automation-main-page,
html[${ROOT_ATTRIBUTE}] .automation-panel,
html[${ROOT_ATTRIBUTE}] .project-detail-view,
html[${ROOT_ATTRIBUTE}] .project-detail-view__body,
html[${ROOT_ATTRIBUTE}] .project-detail-view__main,
html[${ROOT_ATTRIBUTE}] .project-detail-view__content,
html[${ROOT_ATTRIBUTE}] .expert-center-page,
html[${ROOT_ATTRIBUTE}] .skills-panel,
html[${ROOT_ATTRIBUTE}] .connector-panel,
html[${ROOT_ATTRIBUTE}] .inspiration-panel,
html[${ROOT_ATTRIBUTE}] .my-files-panel,
html[${ROOT_ATTRIBUTE}] .my-files-panel-content,
html[${ROOT_ATTRIBUTE}] .my-files-body,
html[${ROOT_ATTRIBUTE}] .tencent-docs-panel,
html[${ROOT_ATTRIBUTE}] .tencent-docs-panel__content,
html[${ROOT_ATTRIBUTE}] .tencent-docs-auth-guide,
html[${ROOT_ATTRIBUTE}] .ima-panel,
html[${ROOT_ATTRIBUTE}] .ima-panel__body,
html[${ROOT_ATTRIBUTE}] .ima-auth-guide,
html[${ROOT_ATTRIBUTE}] .tencent-lexiang-panel,
html[${ROOT_ATTRIBUTE}] .tencent-lexiang-panel__scroll,
html[${ROOT_ATTRIBUTE}] .lexiang-auth-guide,
html[${ROOT_ATTRIBUTE}] .discover-panel-page,
html[${ROOT_ATTRIBUTE}] .dc-content-wrapper {
  background: transparent !important;
}
/* 5.3.5 increased the native shell selector weight. Bind the transparent
   wallpaper canvas to the verified application root so its opaque route
   panels cannot cover the selected skin. */
html[${ROOT_ATTRIBUTE}] body[data-application-name="workbuddy"] :is(
  .teams-container,
  .teams-main-content,
  .main-content,
  .main-content--welcome,
  .main-content--automation,
  .main-content--projects,
  .main-content--chat,
  .chat-container,
  .wb-cb-chat,
  .workbuddy-collab,
  .landing,
  .landing-main,
  .welcome-container
) {
  background-color: transparent !important;
  background-image: none !important;
}
html[${ROOT_ATTRIBUTE}] .conversation-list {
  /* Keep the single viewport wallpaper visibly continuous beneath the sidebar. */
  background: ${rgba(profile.official.surface, glass.enabled
    ? Math.max(0.14, Math.min(0.24, surfaceAlpha - 0.40))
    : surfaceAlpha)} !important;
  border-color: ${border} !important;
  ${glass.enabled ? `backdrop-filter: blur(${Math.max(3, Math.min(8, Math.round(glass.blur * 0.28)))}px) saturate(118%); -webkit-backdrop-filter: blur(${Math.max(3, Math.min(8, Math.round(glass.blur * 0.28)))}px) saturate(118%);` : ''}
}
html[${ROOT_ATTRIBUTE}] .workbuddy-topbar {
  background: ${rgba(profile.official.surface, Math.max(0.40, Math.min(0.62, surfaceAlpha)))} !important;
  border-color: ${border} !important;
  ${glass.enabled ? `backdrop-filter: blur(${glass.blur}px) saturate(112%); -webkit-backdrop-filter: blur(${glass.blur}px) saturate(112%);` : ''}
}
html[${ROOT_ATTRIBUTE}] .wb-home-composer__input-slot,
html[${ROOT_ATTRIBUTE}] .wb-home-composer__input-slot > * {
  background: ${rgba(profile.official.surface, Math.min(0.90, surfaceAlpha + 0.18))} !important;
  border-color: ${border} !important;
  ${glass.enabled ? `backdrop-filter: blur(${glass.blur}px) saturate(112%); -webkit-backdrop-filter: blur(${glass.blur}px) saturate(112%);` : ''}
}
/* The conversation route is part of the wallpaper canvas. It must not draw a
   second rounded frame around the entire workspace. */
html[${ROOT_ATTRIBUTE}] .main-content--chat {
  background: transparent !important;
}
html[${ROOT_ATTRIBUTE}] .chat-container,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  color: ${profile.official.ink} !important;
  isolation: isolate;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html[${ROOT_ATTRIBUTE}] .chat-container,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat {
  color: ${profile.official.ink} !important;
}
/* Keep semantic text readable without flattening component-specific muted,
   disabled, syntax-highlight and icon colours. */
html[${ROOT_ATTRIBUTE}] .chat-container p,
html[${ROOT_ATTRIBUTE}] .chat-container span,
html[${ROOT_ATTRIBUTE}] .chat-container li,
html[${ROOT_ATTRIBUTE}] .chat-container td,
html[${ROOT_ATTRIBUTE}] .chat-container th,
html[${ROOT_ATTRIBUTE}] .chat-container label,
html[${ROOT_ATTRIBUTE}] .chat-container h1,
html[${ROOT_ATTRIBUTE}] .chat-container h2,
html[${ROOT_ATTRIBUTE}] .chat-container h3,
html[${ROOT_ATTRIBUTE}] .chat-container h4,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat p,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat span,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat li,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat td,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat th,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat label,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat h1,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat h2,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat h3,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat h4 {
  color: ${profile.official.ink} !important;
  -webkit-text-fill-color: ${profile.official.ink} !important;
  text-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] .wb-cb-chat :is(.cb-markdown, .cb-assistant-message),
html[${ROOT_ATTRIBUTE}] .wb-cb-chat :is(.cb-markdown, .cb-assistant-message) :where(p, span, li, td, th, label, h1, h2, h3, h4, blockquote) {
  color: ${profile.official.ink} !important;
  -webkit-text-fill-color: ${profile.official.ink} !important;
  text-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] .wb-cb-chat table {
  border-collapse: separate !important;
  border-spacing: 0 !important;
  border: 1px solid ${rgba(profile.official.ink, 0.14)} !important;
  border-radius: ${Math.max(10, Math.min(profile.advanced.radius, 16))}px !important;
  background: ${rgba(profile.official.surface, 0.80)} !important;
  color: ${profile.official.ink} !important;
  overflow: hidden !important;
}
html[${ROOT_ATTRIBUTE}] .wb-cb-chat :is(th, td) {
  border-color: ${rgba(profile.official.ink, 0.12)} !important;
  background: transparent !important;
  color: ${profile.official.ink} !important;
  -webkit-text-fill-color: ${profile.official.ink} !important;
}
html[${ROOT_ATTRIBUTE}] .wb-cb-chat th {
  background: ${rgba(profile.official.accent, 0.10)} !important;
}
html[${ROOT_ATTRIBUTE}] .chat-container button:not([aria-disabled="true"]):not(:disabled),
html[${ROOT_ATTRIBUTE}] .wb-cb-chat button:not([aria-disabled="true"]):not(:disabled) {
  color: ${profile.official.ink} !important;
  text-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] .chat-container button:not([aria-disabled="true"]):not(:disabled):hover,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat button:not([aria-disabled="true"]):not(:disabled):hover {
  color: ${profile.official.accent} !important;
  background: ${rgba(profile.official.accent, 0.10)} !important;
  border-radius: ${Math.min(profile.advanced.radius, 10)}px !important;
}
html[${ROOT_ATTRIBUTE}] .chat-container svg,
html[${ROOT_ATTRIBUTE}] .chat-container svg path,
html[${ROOT_ATTRIBUTE}] .chat-container svg circle,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat svg,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat svg path,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat svg circle {
  color: currentColor !important;
  fill: currentColor;
  stroke: currentColor;
  text-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] .chat-container a,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat a {
  color: ${profile.official.accent} !important;
  text-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] .chat-container code,
html[${ROOT_ATTRIBUTE}] .chat-container pre,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat code,
html[${ROOT_ATTRIBUTE}] .wb-cb-chat pre {
  background: ${rgba(profile.official.ink, 0.08)} !important;
  color: ${profile.official.ink} !important;
  border-radius: ${Math.max(4, Math.min(profile.advanced.radius, 8))}px !important;
  text-shadow: none !important;
}
/* WorkBuddy Automation ships both light and dark utility classes at runtime.
   Pin its native variables to the active skin so a light wallpaper never gets
   an opaque white slab with white labels. */
html[${ROOT_ATTRIBUTE}] :is(.automation-panel, .code-buddy-automation, .automation-main-page) {
  --atm-surface: ${rgba(profile.official.surface, 0.82)} !important;
  --atm-surface-muted: ${rgba(profile.official.surface, 0.68)} !important;
  --atm-surface-subtle: ${rgba(profile.official.surface, 0.60)} !important;
  --atm-surface-soft: ${rgba(profile.official.surface, 0.74)} !important;
  --atm-surface-hover: ${rgba(profile.official.accent, 0.10)} !important;
  --atm-surface-active: ${rgba(profile.official.accent, 0.16)} !important;
  --atm-template-card-bg: ${rgba(profile.official.surface, 0.78)} !important;
  --atm-template-card-bg-hover: ${rgba(profile.official.surface, 0.90)} !important;
  --atm-text-primary: ${profile.official.ink} !important;
  --atm-text-secondary: ${rgba(profile.official.ink, 0.74)} !important;
  --atm-text-tertiary: ${rgba(profile.official.ink, 0.62)} !important;
  --atm-text-muted: ${rgba(profile.official.ink, 0.56)} !important;
  --atm-text-subtle: ${rgba(profile.official.ink, 0.68)} !important;
  --atm-text-strong: ${profile.official.ink} !important;
  --atm-text-placeholder: ${rgba(profile.official.ink, 0.48)} !important;
  --atm-border: ${rgba(profile.official.ink, 0.14)} !important;
  --atm-border-secondary: ${rgba(profile.official.ink, 0.12)} !important;
  --cb-content-background: transparent !important;
  --cb-main-area-background: transparent !important;
  --cb-bg-color-container: ${rgba(profile.official.surface, 0.78)} !important;
  --cb-text-primary: ${profile.official.ink} !important;
  --cb-text-secondary: ${rgba(profile.official.ink, 0.72)} !important;
  background: ${rgba(profile.official.surface, 0.58)} !important;
  color: ${profile.official.ink} !important;
  border-radius: ${Math.max(20, profile.advanced.radius + 4)}px !important;
  backdrop-filter: blur(${Math.max(10, Math.min(18, glass.blur || 16))}px) saturate(114%) !important;
  -webkit-backdrop-filter: blur(${Math.max(10, Math.min(18, glass.blur || 16))}px) saturate(114%) !important;
}
html[${ROOT_ATTRIBUTE}] :is(.automation-panel, .code-buddy-automation, .automation-main-page) :where(h1, h2, h3, h4, p, span, label, button) {
  color: ${profile.official.ink} !important;
  -webkit-text-fill-color: ${profile.official.ink} !important;
  text-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] :is(.atm-empty-state, .atm-empty-state-hero, .atm-empty-state-templates) {
  background: transparent !important;
  background-image: none !important;
  border-color: transparent !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html[${ROOT_ATTRIBUTE}] :is(.atm-template-card, .atm-row, .atm-detail-page, .atm-modal) {
  border-color: ${rgba(profile.official.ink, 0.14)} !important;
  border-radius: ${Math.max(12, profile.advanced.radius)}px !important;
  background: ${rgba(profile.official.surface, 0.78)} !important;
  color: ${profile.official.ink} !important;
}
` : '';
  const workbuddyNavigationSelectors = workbuddyNavigationRules(profile, {
    enabled: clientId === 'workbuddy' && exact && has('navigation'),
    panel,
    border,
    accentInk,
  });
  const workbuddyControlSelectors = workbuddyControlRules(profile, {
    enabled: clientId === 'workbuddy' && exact && has('controls'),
    panel,
    border,
    accentInk,
  });
  const workbuddyBrandSelectors = workbuddyBrandRules(profile, {
    enabled: clientId === 'workbuddy' && exact && has('brand'),
    accentInk,
  });
  const workbuddyProjectHeroSelectors = workbuddyProjectHeroRule(profile, {
    enabled: clientId === 'workbuddy' && exact && has('project-hero'),
  });
  const composerMascotSelectors = composerMascotRule(profile, {
    enabled: has('composer-avatar'),
    clientId,
  });
  const themeBorderSelectors = themeBorderRules(profile, {
    enabled: has('palette'),
    clientId,
  });
  const composerStructureSelectors = composerStructureRules(profile, {
    enabled: has('palette'),
    clientId,
  });
  const composerActionSelectors = composerActionRules(profile, {
    enabled: clientId === 'workbuddy' ? exact && has('controls') : has('palette'),
    clientId,
  });
  const sidebarItemStructureSelectors = sidebarItemStructureRules(profile, {
    enabled: has('palette') && (clientId !== 'workbuddy' || exact),
    clientId,
  });
  const mainWorkspaceStructureSelectors = mainWorkspaceStructureRules({
    enabled: has('palette') && (clientId !== 'workbuddy' || exact),
    clientId,
  });
  const sidebarRule = codexSemanticLayout && has('sidebar-width')
    ? `html[${ROOT_ATTRIBUTE}] { --spacing-token-sidebar: ${profile.advanced.sidebarWidth}px; }`
    : '';
  const codexPaletteRule = has('palette') ? `
html[${ROOT_ATTRIBUTE}] {
  --codex-base-accent: ${profile.official.accent};
  --color-text-accent: ${profile.official.accent};
  --color-token-link: ${profile.official.accent};
  --color-token-main-surface-primary: ${panel};
  --color-token-side-bar-background: ${panel};
  --color-token-border-default: ${border};
  background: ${profile.official.surface};
}` : '';
  // codexCompatibilityRules emits build-sensitive Codex layout selectors
  // ([data-codex-composer], [data-app-action-sidebar], shell tabs, sidebar
  // selection states, composer input styling, ...).  These depend on a
  // verified DOM structure, so they require `exact` compatibility AND at
  // least one declared layout capability — matching the layoutFeaturesEnabled
  // audit field.  Gating on `palette` alone leaked all of these into
  // generic-safe downgrades and into exact sessions whose adapter never
  // declared composer/sidebar-width.  The basic palette CSS variables stay
  // available via codexPaletteRule above.
  const codexCompatibilityRule = codexSemanticLayout &&
    (has('composer') || has('sidebar-width'))
    ? codexCompatibilityRules(profile, {enabled: true, panel})
    : '';
  const doubaoCompatibilityRule = clientId === 'doubao' && has('palette')
    ? doubaoCompatibilityRules(profile, {enabled: true})
    : '';
  const workbuddyPaletteRule = has('palette') ? `
html[${ROOT_ATTRIBUTE}] {
  --vscode-editor-background: ${panel};
  --vscode-editorGroup-emptyBackground: ${panel};
  --vscode-editorGroupHeader-noTabsBackground: ${panel};
  --vscode-editorGroupHeader-tabsBackground: ${panel};
  --vscode-tab-activeBackground: ${panel};
  --vscode-tab-inactiveBackground: ${panel};
  --vscode-tab-unfocusedActiveBackground: ${panel};
  --vscode-tab-unfocusedInactiveBackground: ${panel};
  --vscode-sideBar-background: ${panel};
  --vscode-sideBarSectionHeader-background: ${panel};
  --vscode-panel-background: ${panel};
  --vscode-panelSectionHeader-background: ${panel};
  --vscode-activityBar-background: ${panel};
  --vscode-activityBarTop-background: ${panel};
  --vscode-titleBar-activeBackground: ${panel};
  --vscode-titleBar-inactiveBackground: ${panel};
  --vscode-statusBar-background: ${panel};
  --vscode-statusBar-noFolderBackground: ${panel};
  --vscode-terminal-background: ${panel};
  --vscode-welcomePage-background: ${panel};
  --vscode-input-background: transparent;
  --vscode-dropdown-background: ${rgba(profile.official.surface, Math.min(1, surfaceAlpha + 0.08))};
  --vscode-foreground: ${safeTextInk};
  --vscode-descriptionForeground: ${rgba(safeTextInk, 0.72)};
  --vscode-focusBorder: ${profile.official.accent};
  --vscode-button-background: ${profile.official.accent};
  --vscode-textLink-foreground: ${profile.official.accent};
  --vscode-widget-border: ${border};
  --cb-background: ${panel};
  --cb-main-area-background: ${panel};
  --cb-content-background: ${panel};
  --cb-bg-surface: ${rgba(profile.official.surface, Math.min(1, surfaceAlpha + 0.10))};
  --cb-card-background: ${rgba(profile.official.surface, Math.min(1, surfaceAlpha + 0.14))};
  --cb-modal-background: ${rgba(profile.official.surface, 0.98)};
  --cb-popover-background: ${rgba(profile.official.surface, 0.98)};
  --cb-input-background: transparent;
  --cb-sidebar-background: ${rgba(profile.official.surface, Math.max(0.72, surfaceAlpha))};
  --cb-sidebar-surface: ${rgba(profile.official.surface, Math.min(1, surfaceAlpha + 0.08))};
  --cb-foreground: ${safeTextInk};
  --cb-icon-foreground: ${safeTextInk};
  --cb-input-foreground: ${safeTextInk};
  --cb-sidebar-foreground: ${safeTextInk};
  --cb-sidebar-text: ${safeTextInk};
  --cb-text-primary: ${safeTextInk};
  --cb-text-primary-strong: ${safeTextInk};
  --cb-text-secondary: ${rgba(safeTextInk, 0.78)};
  --cb-text-tertiary: ${rgba(safeTextInk, 0.68)};
  --cb-text-muted: ${rgba(safeTextInk, 0.68)};
  --cb-text-placeholder: ${rgba(safeTextInk, 0.62)};
  --cb-description-foreground: ${rgba(safeTextInk, 0.74)};
  --cb-sidebar-text-secondary: ${rgba(safeTextInk, 0.78)};
  --cb-sidebar-text-muted: ${rgba(safeTextInk, 0.68)};
  --cb-link-foreground: ${profile.official.accent};
  --cb-list-item-selected-foreground: ${profile.official.accent};
  --cb-sidebar-item-hover-background: ${rgba(profile.official.accent, 0.10)};
  --cb-tab-active-background: ${rgba(profile.official.accent, 0.14)};
  --cb-tab-active-foreground: ${profile.official.accent};
  color: ${safeTextInk};
  background: ${profile.official.surface};
}` : '';
  const doubaoPaletteRule = has('palette') ? `
html[${ROOT_ATTRIBUTE}] {
  --s-color-bg-primary: ${panel};
  --s-color-bg-secondary: ${rgba(profile.official.surface, Math.min(1, surfaceAlpha + 0.06))};
  --s-color-bg-body: transparent;
  --bg-layer-base: ${rgba(profile.official.surface, Math.min(1, surfaceAlpha + 0.04))};
  --bg-input: transparent;
  --chat-bg-color: ${panel};
  --dbx-bg-base-web: ${rgba(profile.official.surface, Math.max(0.76, surfaceAlpha))};
  --dbx-text-primary: ${safeTextInk};
  --dbx-text-secondary: ${rgba(safeTextInk, 0.74)};
  --dbx-text-disabled: ${rgba(safeTextInk, 0.74)};
  --dbx-text-tertiary: ${rgba(safeTextInk, 0.64)};
  --dbx-fill-trans-10: ${rgba(profile.official.ink, 0.07)};
  --dbx-fill-trans-10-hover: ${rgba(profile.official.accent, 0.16)};
  --dbx-fill-trans-20: ${rgba(profile.official.surface, 0.72)};
  --dbx-fill-trans-20-hover: ${rgba(profile.official.accent, 0.18)};
  --dbx-line-10: ${rgba(profile.official.ink, 0.14)};
  --s-color-border-tertiary: ${rgba(profile.official.ink, 0.14)};
  --input-guidance-input-container-background: transparent;
  --input-guidance-input-container-border: transparent;
  --s-color-text-primary: ${safeTextInk};
  --s-color-text-secondary: ${rgba(safeTextInk, 0.74)};
  --s-color-text-placeholder: ${rgba(safeTextInk, 0.58)};
  --s-color-text-disabled: ${rgba(safeTextInk, 0.74)};
  --s-color-brand-primary: ${profile.official.accent};
  --s-color-brand-primary-default: ${profile.official.accent};
  --s-color-primary: ${profile.official.accent};
  --dbx-color-brand: ${profile.official.accent};
  --chat-input-skill-border-radius: ${Math.max(6, Math.min(24, profile.advanced.radius))}px;
  color: ${safeTextInk} !important;
  background: ${profile.official.surface} !important;
}
html[${ROOT_ATTRIBUTE}] body,
html[${ROOT_ATTRIBUTE}] #root,
html[${ROOT_ATTRIBUTE}] #root > * {
  color: ${safeTextInk} !important;
  background: ${has('background') ? 'transparent' : panel} !important;
}
` : '';
  const paletteRule = clientId === 'workbuddy'
    ? workbuddyPaletteRule
    : clientId === 'doubao'
      ? doubaoPaletteRule
      : codexPaletteRule;
  const backgroundTransparency = has('background') ? `
html[${ROOT_ATTRIBUTE}] body,
html[${ROOT_ATTRIBUTE}] #root {
  background: transparent !important;
}
${clientId !== 'codex' ? `
html[${ROOT_ATTRIBUTE}] body {
  position: relative;
  isolation: isolate;
}
html[${ROOT_ATTRIBUTE}] #root {
  position: relative;
  z-index: 1;
}` : ''}` : '';
  const textSurfaceReset = `
/* Cross-client surface discipline: readability belongs to structural
   containers, never to the glyph-bearing node itself. */
html[${ROOT_ATTRIBUTE}] :where(h1, h2, h3, h4, h5, h6, p, label, legend, figcaption),
html[${ROOT_ATTRIBUTE}] [data-lingglow-plain-text-surface="true"] {
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}
html[${ROOT_ATTRIBUTE}] :where(input, textarea, [contenteditable="true"], [role="textbox"]) {
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}
`;
  const css = visualLayerEnabled ? `
/* Generated by LingGlow (灵妆). Declarative visual layer only. */
${paletteRule}
${backgroundTransparency}
${backgroundRule(profile, has('background'))}
${shellSelectors}
${composerSelectors}
${workbuddyShellSelectors}
${workbuddyNavigationSelectors}
${workbuddyControlSelectors}
${workbuddyBrandSelectors}
${workbuddyProjectHeroSelectors}
${composerMascotSelectors}
${sidebarRule}
${codexCompatibilityRule}
${doubaoCompatibilityRule}
${textSurfaceReset}
${themeBorderSelectors}
${composerStructureSelectors}
${composerActionSelectors}
${sidebarItemStructureSelectors}
${mainWorkspaceStructureSelectors}
${bannerRule(profile, clientId === 'codex' && exact && has('banner'))}
${motionRules(profile, {
    enabled: clientId === 'codex' && exact && has('motion'),
    backgroundEnabled: has('background'),
  })}
`.trim() : '';
  const fieldConsumption = compilerConsumptionAudit(clientId, {
    enabledCapabilities: [...consumedCapabilities],
    visualLayerEnabled,
  });
  return {
    schemaVersion: 1,
    clientId,
    profile,
    capabilityLevel,
    css,
    officialThemeString: officialThemeString(profile),
    audit: {
      payloadKind: 'declarative-css',
      arbitraryJavaScript: false,
      remoteUrls: false,
      visualLayerEnabled,
      localImagesEmbedded: visualLayerEnabled &&
        Boolean(profile.advanced.background.image || profile.advanced.banner.image ||
          profile.advanced.workbuddy?.composerAvatar?.image),
      enabledCapabilities: [...enabledCapabilities].sort(),
      consumedCapabilities: [...consumedCapabilities].sort(),
      // These IDs do not authorize anything new.  They make explicit which
      // Union Schema fields reached a fixed CSS consumer in this particular
      // compilation and which Codex fields remain manual official imports.
      runtimeConsumedFieldIds: fieldConsumption.runtimeFieldIds,
      manualOfficialImportFieldIds: fieldConsumption.manualOfficialImportFieldIds,
      visualLayerGateFieldIds: fieldConsumption.visualLayerGateFieldIds,
      clientId,
      bannerEnabled: clientId === 'codex' && exact && has('banner') &&
        profile.advanced.banner.enabled && Boolean(profile.advanced.banner.image),
      brandEnabled: clientId === 'workbuddy' && exact && has('brand') &&
        Boolean(profile.advanced.brand?.enabled),
      navigationEnabled: clientId === 'workbuddy' && exact && has('navigation'),
      controlsEnabled: clientId === 'workbuddy' && exact && has('controls'),
      projectHeroEnabled: clientId === 'workbuddy' && exact && has('project-hero') &&
        Boolean(profile.advanced.workbuddy?.projectHero?.image),
      composerAvatarEnabled: has('composer-avatar') &&
        Boolean(profile.advanced.workbuddy?.composerAvatar?.image),
      layoutFeaturesEnabled: clientId === 'codex' && exact &&
        (has('composer') || has('sidebar-width')),
      contrastRatio: Number(contrastRatio(profile.official.ink, profile.official.surface).toFixed(2)),
      styleBytes: Buffer.byteLength(css),
    },
  };
}

function baseInjectionSource(compiled, targetUrlOrOptions = 'app://-/index.html') {
  const options = typeof targetUrlOrOptions === 'string' || targetUrlOrOptions == null
    ? {targetUrl: targetUrlOrOptions ?? 'app://-/index.html', targetAllowlist: []}
    : {
      targetUrl: targetUrlOrOptions.targetUrl ?? 'app://-/index.html',
      targetAllowlist: Array.isArray(targetUrlOrOptions.targetAllowlist)
        ? targetUrlOrOptions.targetAllowlist
        : [],
    };
  const cssLiteral = JSON.stringify(compiled.css);
  const profileLiteral = JSON.stringify(compiled.profile.id);
  const targetUrlLiteral = JSON.stringify(options.targetUrl);
  const allowlistLiteral = JSON.stringify(options.targetAllowlist);
  // Keep authorization logic in-page without importing modules.  Patterns match
  // transport-strategy targetUrlMatchesAllowlist for Doubao + Codex entries.
  // String matching (no URL constructor) keeps the inject path portable in
  // constrained runtimes and unit-test sandboxes.
  return `(() => {
    const styleId = ${JSON.stringify(STYLE_ID)};
    const targetUrl = ${targetUrlLiteral};
    const targetAllowlist = ${allowlistLiteral};
    const stripQueryHash = (href) => String(href || '').split(/[?#]/u, 1)[0];
    const urlMatchesAllowlist = (href, allowlist) => {
      if (!Array.isArray(allowlist) || !allowlist.length) return false;
      const current = stripQueryHash(href);
      if (!current) return false;
      // Reject userinfo in the authority only.  transport-strategy's
      // targetUrlMatchesAllowlist rejects url.username/url.password but allows
      // '@' inside a path, and both matchers must accept the same URL set.
      const authorityStart = current.indexOf('://');
      if (authorityStart >= 0 &&
          current.slice(authorityStart + 3).split('/', 1)[0].includes('@')) return false;
      return allowlist.some((pattern) => {
        if (pattern === 'app://-/index.html') return current === 'app://-/index.html';
        if (pattern === 'doubao://doubao-chat/*') {
          return current.startsWith('doubao://doubao-chat/');
        }
        if (pattern === 'chrome://doubao-chat/*') {
          return current === 'chrome://doubao-chat/chat' ||
            current.startsWith('chrome://doubao-chat/chat/');
        }
        if (typeof pattern === 'string' && pattern.startsWith('chrome-extension://') &&
            pattern.endsWith('/side_panel.html')) {
          return current === pattern;
        }
        if (pattern === 'https://www.doubao.com/chat/*') {
          return current.startsWith('https://www.doubao.com/chat/') &&
            current.length > 'https://www.doubao.com/chat/'.length;
        }
        return false;
      });
    };
    const isAuthorizedDocument = () => {
      if (window.top !== window) return false;
      const currentUrl = stripQueryHash(location.href);
      if (targetAllowlist.length) return urlMatchesAllowlist(location.href, targetAllowlist);
      return currentUrl === targetUrl;
    };
    const apply = () => {
      if (!isAuthorizedDocument()) return false;
      if (!document.documentElement) return false;
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = ${cssLiteral};
      document.documentElement.setAttribute(${JSON.stringify(ROOT_ATTRIBUTE)}, ${profileLiteral});
      return true;
    };
    if (!isAuthorizedDocument()) return { ok: false, styleId, skipped: 'unauthorized-document' };
    const deferredKey = ${JSON.stringify(DEFERRED_APPLY_KEY)};
    window[deferredKey]?.();
    const applied = apply();
    if (!applied) {
      // A pending replay must stay cancellable: cleanup can run while the
      // document is still loading, and an uncancelled listener would put the
      // skin back on a page the session has already released.
      const replay = () => { delete window[deferredKey]; apply(); };
      document.addEventListener('DOMContentLoaded', replay, { once: true });
      window[deferredKey] = () => {
        document.removeEventListener('DOMContentLoaded', replay);
        delete window[deferredKey];
      };
    }
    return { ok: true, styleId, profileId: ${profileLiteral}, deferred: !applied };
  })()`;
}

function baseCleanupSource() {
  return `(() => {
    window[${JSON.stringify(DEFERRED_APPLY_KEY)}]?.();
    document.getElementById(${JSON.stringify(STYLE_ID)})?.remove();
    document.documentElement.removeAttribute(${JSON.stringify(ROOT_ATTRIBUTE)});
    return { ok: true };
  })()`;
}

export const skinRuntimeIds = Object.freeze({styleId: STYLE_ID, rootAttribute: ROOT_ATTRIBUTE});

import { runtimeHotfixCleanupSource, runtimeHotfixInjectionSource } from "./runtime-hotfix.mjs";

export function injectionSource(compiledSkin, targetUrlOrOptions) {
  const baseSource = baseInjectionSource(compiledSkin, targetUrlOrOptions);
  const hotfixSource = runtimeHotfixInjectionSource(compiledSkin);
  return `(() => {
    const baseResult = ${baseSource};
    if (!baseResult?.ok) return baseResult;
    ${hotfixSource}
    return baseResult;
  })()`;
}

export function cleanupSource() {
  const baseSource = baseCleanupSource();
  const hotfixSource = runtimeHotfixCleanupSource();
  return `(() => {
    const baseResult = ${baseSource};
    ${hotfixSource}
    return baseResult;
  })()`;
}
