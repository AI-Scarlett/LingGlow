const MODES = new Set(['light', 'dark']);

const sharedRoot = (mode) => ({
  colorScheme: mode,
  attributes: {
    'data-lingglow-theme-mode': mode,
  },
  classes: {
    add: [mode],
    remove: [mode === 'dark' ? 'light' : 'dark'],
  },
});

const sharedBody = (mode) => ({
  colorScheme: mode,
  attributes: {
    'data-lingglow-theme-mode': mode,
    'data-theme': mode,
  },
  classes: {
    add: [mode],
    remove: [mode === 'dark' ? 'light' : 'dark'],
  },
});

const workbuddyTokens = Object.freeze({
  canvas: '--ec-bg-primary',
  surface: '--ec-bg-secondary',
  surfaceElevated: '--ec-bg-tertiary',
  surfaceHover: '--ec-bg-hover',
  surfaceActive: '--ec-bg-active',
  card: '--ec-expert-card-bg',
  cardHover: '--ec-expert-card-hover-bg',
  cardBorder: '--ec-card-border-static',
  cardBorderHover: '--ec-expert-card-hover-border',
  cardShadow: '--ec-expert-card-shadow',
  textPrimary: '--ec-text-primary',
  textStrong: '--ec-text-strong',
  textSecondary: '--ec-text-secondary',
  textMuted: '--ec-text-muted',
  textDescription: '--ec-text-desc',
  textPlaceholder: '--ec-text-placeholder',
  filterText: '--ec-filter-text',
  filterTextHover: '--ec-filter-text-hover',
  filterTextActive: '--ec-filter-text-active',
  filterBorder: '--ec-filter-border',
  buttonBackground: '--ec-btn-bg',
  buttonBackgroundHover: '--ec-btn-bg-hover',
  buttonText: '--ec-btn-text',
  searchBackground: '--ec-search-bg',
  searchText: '--ec-search-text',
  featuredBackground: '--ec-featured-scene-bg',
  featuredOverlay: '--ec-featured-scene-overlay',
  featuredTagBackground: '--ec-featured-scene-tag-bg',
  featuredTagText: '--ec-featured-scene-tag-color',
});

const codexTokens = Object.freeze({
  canvas: '--color-token-bg-primary',
  surface: '--color-token-bg-secondary',
  surfaceElevated: '--color-token-bg-tertiary',
  mainSurface: '--color-token-main-surface-primary',
  sidebar: '--color-token-side-bar-background',
  editor: '--color-token-editor-background',
  input: '--color-token-input-background',
  dropdown: '--color-token-dropdown-background',
  menu: '--color-token-menu-background',
  textPrimary: '--color-token-text-primary',
  textSecondary: '--color-token-text-secondary',
  textTertiary: '--color-token-text-tertiary',
  foreground: '--color-token-foreground',
  description: '--color-token-description-foreground',
  placeholder: '--color-token-input-placeholder-foreground',
  border: '--color-token-border',
  borderDefault: '--color-token-border-default',
  borderLight: '--color-token-border-light',
  buttonBackground: '--color-token-button-background',
  buttonText: '--color-token-button-foreground',
  selectedBackground: '--color-token-interactive-bg-secondary-selected',
  hoverBackground: '--color-token-interactive-bg-secondary-hover',
  accentLabel: '--color-token-interactive-label-accent-default',
  codeBlock: '--color-token-text-code-block-background',
  diffSurface: '--color-token-diff-surface',
});

const doubaoTokens = Object.freeze({
  canvas: '--semi-color-bg-0',
  surface: '--semi-color-bg-1',
  surfaceElevated: '--semi-color-bg-2',
  surfaceOverlay: '--semi-color-bg-3',
  textPrimary: '--semi-color-text-0',
  textSecondary: '--semi-color-text-1',
  textTertiary: '--semi-color-text-2',
  textPlaceholder: '--semi-color-text-3',
  border: '--semi-color-border',
  fill: '--semi-color-fill-0',
  fillHover: '--semi-color-fill-1',
  fillActive: '--semi-color-fill-2',
  primary: '--semi-color-primary',
  primaryHover: '--semi-color-primary-hover',
  primaryActive: '--semi-color-primary-active',
  focusBorder: '--semi-color-focus-border',
});

const clientMode = (clientId, mode) => {
  const root = sharedRoot(mode);
  const body = sharedBody(mode);
  if (clientId === 'workbuddy') {
    root.attributes['theme-mode'] = mode;
    root.attributes['data-theme'] = mode;
    body.attributes['theme-mode'] = mode;
    body.classes.add.push(mode === 'dark' ? 'vscode-dark' : 'vscode-light');
    body.classes.remove.push(mode === 'dark' ? 'vscode-light' : 'vscode-dark', 'vscode-high-contrast');
    return {
      mode,
      root,
      body,
      componentLocks: [{selector: '.expert-center-page, .expert-center-light, .expert-center-dark', lightClass: 'expert-center-light', darkClass: 'expert-center-dark'}],
      tokens: workbuddyTokens,
    };
  }
  if (clientId === 'doubao') {
    root.attributes['theme-mode'] = mode;
    root.attributes['data-theme'] = mode;
    return {mode, root, body, componentLocks: [], tokens: doubaoTokens};
  }
  return {mode, root, body, componentLocks: [], tokens: codexTokens};
};

export function normalizeNativeThemeMode(value) {
  return MODES.has(value) ? value : 'dark';
}

export function nativeThemeParametersFor(clientId, value) {
  return clientMode(clientId, normalizeNativeThemeMode(value));
}

export const nativeThemeTokenCatalog = Object.freeze({
  workbuddy: workbuddyTokens,
  codex: codexTokens,
  doubao: doubaoTokens,
});
