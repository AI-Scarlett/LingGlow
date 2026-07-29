import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {
  classifyCodexSubmitState,
  codexDreamSkinCssForTesting,
  codexDreamSkinInjectionSource,
  codexDreamSkinRuntimeRevisionForTesting,
  codexDreamThemeForTesting,
} from '../src/codex-dream-skin-adapter.mjs';
import {listRegisteredThemePacks} from '../src/catalog/theme-pack.mjs';
import {isActiveHomeSurface} from '../src/codex-home-detection.mjs';
import {contrastRatio} from '../src/profile.mjs';
import {StudioServer} from '../src/server.mjs';

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9wAAAAABJRU5ErkJggg==';

function splitSelectorList(value) {
  const output = [];
  let start = 0;
  let brackets = 0;
  let parentheses = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') brackets += 1;
    else if (character === ']') brackets -= 1;
    else if (character === '(') parentheses += 1;
    else if (character === ')') parentheses -= 1;
    else if (character === ',' && brackets === 0 && parentheses === 0) {
      output.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  output.push(value.slice(start).trim());
  return output.filter(Boolean);
}

function simpleSelectorMatches(node, rawSelector) {
  const selector = rawSelector.trim().replaceAll('\\/', '/');
  const structural = selector.replace(/\[[^\]]*\]/gu, '');
  if (!selector || /:is\(|:has\(|:not\(|:checked/u.test(selector) || /[ >+~]/u.test(structural)) {
    return false;
  }
  const tag = /^([a-z][a-z0-9-]*)/iu.exec(selector)?.[1];
  if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  const classes = [...selector.matchAll(/\.((?:\\.|[\w/-])+)/gu)]
    .map((match) => match[1].replaceAll('\\/', '/'));
  if (classes.some((name) => !node.classList.contains(name))) return false;
  const attributes = [...selector.matchAll(
    /\[([^\]\s~*|^$=]+)(?:\s*(~=|\*=|=)\s*["']?([^"'\]\s]+)["']?(?:\s+i)?)?\]/gu,
  )];
  for (const match of attributes) {
    const [, name, operator, expected] = match;
    if (!node.hasAttribute(name)) return false;
    if (!operator) continue;
    const actual = node.getAttribute(name) || '';
    if (operator === '=' && actual !== expected) return false;
    if (operator === '~=' && !actual.split(/\s+/u).includes(expected)) return false;
    if (operator === '*=' && !actual.toLowerCase().includes(expected.toLowerCase())) return false;
  }
  return true;
}

class FixtureStyle {
  #values = new Map();

  getPropertyValue(name) {
    return this.#values.get(name) || '';
  }

  setProperty(name, value) {
    this.#values.set(name, String(value));
  }

  removeProperty(name) {
    const previous = this.getPropertyValue(name);
    this.#values.delete(name);
    return previous;
  }
}

class FixtureClassList {
  constructor(owner, values = []) {
    this.owner = owner;
    this.values = new Set(values);
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }

  toString() {
    return [...this.values].join(' ');
  }
}

class FixtureElement {
  constructor(tagName = 'div', {
    attributes = {}, classes = [], rect = {width: 1000, height: 100},
    computedStyle = {}, documentRoot = false,
  } = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes).map(([name, value]) => [name, String(value)]));
    this.classList = new FixtureClassList(this, classes);
    this.rect = {x: 0, y: 0, ...rect};
    this.computedStyle = {
      display: 'block', visibility: 'visible', opacity: '1', colorScheme: 'light',
      backgroundColor: 'transparent', ...computedStyle,
    };
    this.children = [];
    this.childNodes = this.children;
    this.parentElement = null;
    this.style = new FixtureStyle();
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.id = '';
    this.documentRoot = documentRoot;
  }

  get className() {
    return this.classList.toString();
  }

  get isConnected() {
    let current = this;
    while (current.parentElement) current = current.parentElement;
    return current.documentRoot === true;
  }

  appendChild(child) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  matches(selector) {
    return splitSelectorList(selector).some((entry) => simpleSelectorMatches(this, entry));
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }

  querySelectorAll(selector) {
    const output = [];
    const visit = (parent) => {
      for (const child of parent.children) {
        if (child.matches(selector)) output.push(child);
        visit(child);
      }
    };
    visit(this);
    return output;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getClientRects() {
    return this.rect.width > 0 && this.rect.height > 0 ? [this.rect] : [];
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

class FixtureDocument {
  constructor() {
    this.documentElement = new FixtureElement('html', {
      rect: {width: 1800, height: 1200}, documentRoot: true,
    });
    this.head = this.documentElement.appendChild(new FixtureElement('head'));
    this.body = this.documentElement.appendChild(new FixtureElement('body', {
      rect: {width: 1800, height: 1200},
    }));
  }

  querySelectorAll(selector) {
    const output = this.documentElement.matches(selector) ? [this.documentElement] : [];
    return output.concat(this.documentElement.querySelectorAll(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getElementById(id) {
    return this.querySelectorAll('*').find((node) => node.id === id) || null;
  }

  createElement(tagName) {
    return new FixtureElement(tagName);
  }

  createTextNode(value) {
    return {nodeType: 3, nodeValue: value};
  }
}

function createCodexRuntimeFixture() {
  const document = new FixtureDocument();
  const clock = {now: 0};
  const location = {pathname: '/loading', search: '', hash: ''};
  const shell = document.body.appendChild(new FixtureElement('main', {
    attributes: {'data-app-shell-main-content-layout': ''}, classes: ['main-surface'],
    rect: {width: 1400, height: 1100},
  }));
  const main = shell.appendChild(new FixtureElement('section', {
    attributes: {role: 'main'}, rect: {width: 1300, height: 1000},
  }));
  const scroll = main.appendChild(new FixtureElement('div', {
    classes: ['thread-scroll-container'], rect: {width: 1200, height: 760},
  }));
  const findComposer = main.appendChild(new FixtureElement('div', {
    attributes: {'data-thread-find-composer': ''}, rect: {width: 1000, height: 190},
  }));
  const surface = findComposer.appendChild(new FixtureElement('div', {
    classes: ['composer-surface-chrome'], rect: {width: 980, height: 170},
  }));
  const staleRoot = surface.appendChild(new FixtureElement('div', {
    attributes: {'data-codex-composer-root': ''}, rect: {width: 1200, height: 220},
    computedStyle: {opacity: '0'},
  }));
  staleRoot.appendChild(new FixtureElement('div', {
    attributes: {contenteditable: 'true'}, rect: {width: 1100, height: 90},
  }));
  const noEditorRoot = surface.appendChild(new FixtureElement('div', {
    attributes: {'data-codex-composer-root': ''}, rect: {width: 1100, height: 210},
  }));
  const liveRoot = surface.appendChild(new FixtureElement('div', {
    attributes: {'data-codex-composer-root': ''}, rect: {width: 940, height: 150},
  }));
  const innerComposer = liveRoot.appendChild(new FixtureElement('div', {
    attributes: {'data-codex-composer': ''}, rect: {width: 920, height: 130},
  }));
  innerComposer.appendChild(new FixtureElement('div', {
    attributes: {contenteditable: 'true'}, rect: {width: 850, height: 80},
  }));

  const window = {
    location,
    matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
    addEventListener() {},
    removeEventListener() {},
  };
  class FixtureMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  let objectUrl = 0;
  const context = {
    window,
    document,
    HTMLElement: FixtureElement,
    Node: {TEXT_NODE: 3},
    MutationObserver: FixtureMutationObserver,
    getComputedStyle: (node) => node.computedStyle,
    URL: {
      createObjectURL: () => `blob:fixture-${objectUrl += 1}`,
      revokeObjectURL() {},
    },
    Blob,
    Uint8Array,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    performance: {now: () => clock.now},
    setTimeout,
    clearTimeout,
    console,
  };
  return {
    context, clock, location, main, scroll, findComposer, surface,
    staleRoot, noEditorRoot, liveRoot, innerComposer,
  };
}

test('Codex payload revision includes renderer and classifier implementation changes', () => {
  const adapterSource = readFileSync(
    new URL('../src/codex-dream-skin-adapter.mjs', import.meta.url),
    'utf8',
  );
  assert.match(codexDreamSkinRuntimeRevisionForTesting(), /^[0-9a-f]{16}$/u);
  assert.match(adapterSource, /\.update\(rendererTemplate\)/u);
  assert.match(adapterSource, /\.update\(isActiveHomeSurface\.toString\(\)\)/u);
  assert.match(adapterSource, /\.update\(classifyCodexSubmitState\.toString\(\)\)/u);
  assert.match(adapterSource, /\.update\(runtimeRevision\)[\s\S]*?\.update\(styleRevision\)/u);
});

test('Codex New Task skin preserves the native card layout and installs without polling', () => {
  const source = codexDreamSkinInjectionSource({
    clientId: 'codex',
    profileId: 'new-task-qa',
    profile: {
      id: 'new-task-qa',
      name: 'New Task QA',
      official: {
        variant: 'light', accent: '#176b91', surface: '#F8F2EA', ink: '#241B16',
        fonts: {ui: 'Avenir Next', code: 'JetBrains Mono'},
        semanticColors: {diffRemoved: '#b42318'},
      },
      advanced: {
        background: {image: onePixelPng},
        banner: {image: onePixelPng},
      },
    },
    runtimeVisual: {codexHomeImage: onePixelPng},
  });

  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /data-dream-route-home/u);
  assert.match(source, /data-app-shell-main-content-layout/u);
  assert.ok(source.includes('body:has([data-app-shell-focus-area=\\"right-panel\\"])::before {\\n  background-position: center, right center !important;'));
  assert.ok(source.includes('main.main-surface {\\n  background-color: transparent !important;\\n  background-image: none !important;'));
  assert.ok(source.includes('[role=\\"main\\"].dream-skin-home {\\n  background-color: transparent !important;\\n  background-image: none !important;'));
  assert.match(source, /var\(--dream-skin-home-art/u);
  assert.match(source, /data-dream-route-home=\\"true\\"\]\[data-dream-art-task-mode=\\"banner\\"\]/u);
  assert.match(source, /data-dream-route-home=\\"true\\"\]\[data-dream-art-task-mode=\\"ambient\\"\]/u);
  assert.doesNotMatch(source, /__DREAM_SKIN_[A-Z_]+__/u);
  assert.match(source, /--color-token-conversation-body: var\(--ds-text\) !important/u);
  assert.match(source, /--vscode-foreground: var\(--ds-text\) !important/u);
  assert.match(source, /\[class~=\\"text-token-conversation-body\\"\]/u);
  assert.match(source, /\[class~=\\"bg-token-bg-secondary\\"\]/u);
  assert.match(source, /role=\\"menuitemradio\\"/u);
  assert.match(source, /data-radix-menu-content/u);
  assert.match(source, /aria-checked=\\"true\\"/u);
  assert.match(source, /data-lingglow-appearance/u);
  assert.match(source, /data-app-shell-focus-area/u);
  assert.ok(source.includes('aside.app-shell-left-panel::after'));
  assert.ok(source.includes('rgb(var(--ds-panel-rgb) / .34) 46%,\\n    rgb(var(--ds-panel-rgb) / .10) 76%,\\n    transparent 100%'));
  assert.ok(source.includes('border-right: 0 !important;'));
  assert.ok(source.includes('[data-app-shell-main-content-layout],\\nhtml.codex-dream-skin .app-shell-main-content-frame'));
  assert.ok(source.includes('html.codex-dream-skin .thread-scroll-container {\\n  background-color: transparent !important;\\n  background-image: none !important;'));
  assert.match(source, /data-chatgpt-conversation-turn="true"/u);
  assert.ok(source.includes('rgb(var(--ds-panel-rgb) / .42) 0%,\\n    rgb(var(--ds-panel-rgb) / .18) 68%,\\n    transparent 100%'));
  assert.ok(source.includes('border-radius: 18px !important;'));
  assert.match(source,
    /data-lingglow-codex-turn-surface=\\"true\\"[\s\S]*?backdrop-filter: none !important/u);
  assert.doesNotMatch(source,
    /data-lingglow-codex-turn-surface=\\"true\\"[\s\S]{0,500}?backdrop-filter: blur/u);
  assert.doesNotMatch(source, /thread-scroll-container:not\(:has\(/u);
  assert.doesNotMatch(source, /thread-scroll-container :has\(> \[data-turn-key\]\)/u);
  assert.doesNotMatch(source, /--ds-reading-(?:strong|medium|soft)/u);
  assert.ok(source.includes('[data-thread-scroll-footer=\\"true\\"] > :first-child > :only-child'));
  assert.ok(source.includes('rgb(var(--ds-panel-rgb) / .14) 48%,\\n    transparent 100%'));
  assert.doesNotMatch(source, /html\.codex-dream-skin body \{\s*background-image:\s*linear-gradient/u);
  assert.match(source, /data-codex-intelligence-trigger/u);
  assert.match(source, /model\|gpt\|glm\|claude\|gemini\|sol\|terra/u);
  assert.match(source, /button\[type="submit"\]/u);
  assert.match(source, /data-lingglow-codex-control/u);
  assert.match(source, /data-lingglow-codex-sidebar-state/u);
  assert.match(source, /data-lingglow-codex-sidebar-state=\\"selected\\"/u);
  assert.match(source, /data-lingglow-codex-sidebar-state=\\"idle\\"/u);
  assert.match(source, /const selectedSidebarRowSelector/u);
  assert.match(source, /const selectedSidebarChildSelector/u);
  assert.match(source, /row\.matches\(selectedSidebarRowSelector\)/u);
  assert.match(source, /child\.matches\?\.\(selectedSidebarChildSelector\)/u);
  assert.match(source, /data-app-action-sidebar-thread-active="true"/u);
  assert.doesNotMatch(source, /'\[data-app-action-sidebar-thread-active\]'/u);
  assert.doesNotMatch(source,
    /aside\.app-shell-left-panel :is\([\s\S]*?aria-selected=\\"true\\"[\s\S]*?linear-gradient/u);
  assert.match(source, /data-lingglow-codex-surface/u);
  assert.match(source, /data-lingglow-codex-composer-anchor/u);
  assert.ok(source.includes('[data-lingglow-codex-composer-anchor=\\"true\\"] :is(\\n  .composer-surface-chrome,'));
  assert.match(source, /const composerCandidates/u);
  assert.match(source, /const canonicalComposer/u);
  assert.match(source, /const composerAnchor/u);
  assert.match(source, /routeState\?\.routeReady === true/u);
  assert.match(source,
    /canonicalComposer = editorComposerCandidates[\s\S]*?candidate\.node\.matches\('\[data-codex-composer-root\]'\)/u);
  assert.match(source, /clearComposerAnchorState\(node\)/u);
  assert.match(source, /for \(const composer of composerAnchor \? \[composerAnchor\] : \[\]\)/u);
  assert.match(source, /data-above-composer-portal/u);
  assert.match(source, /data-composer-overlay-floating-ui/u);
  assert.match(source, /group\/turn-diff-header/u);
  assert.match(source, /above-composer/u);
  assert.match(source, /diff-summary/u);
  assert.match(source, /\[class~=\\"bg-token-dropdown-background\\"\]/u);
  assert.match(source, /\[class~=\\"bg-token-input-background\\"\]/u);
  assert.match(source, /--ds-danger/u);
  assert.match(source, /--ds-on-accent/u);
  assert.match(source, /--ds-on-danger/u);
  assert.match(source, /--ds-ui-font/u);
  assert.match(source, /--ds-code-font/u);
  assert.match(source, /data-lingglow-custom-ui-font/u);
  assert.match(source, /data-lingglow-custom-code-font/u);
  assert.ok(source.includes('"danger":"#B42318"'));
  assert.match(source, /var\(--ds-lime\)/u);
  assert.match(source, /rgb\(var\(--ds-danger-rgb\) \/ \.16\)/u);
  assert.doesNotMatch(source, /lingglow-codex-stop-breathe/u);
  assert.match(source, /width: 40px !important/u);
  assert.match(source, /border-radius: 999px !important/u);
  assert.doesNotMatch(source, /data-lingglow-codex-control=\\"stop\\"[\s\S]{0,400}content: none/u);
  assert.match(source, /svg \[fill\]:not\(\[fill=\\"none\\"\]\)/u);
  assert.match(source, /data-lingglow-codex-submit-state/u);
  assert.match(source, /queue\|enqueue/u);
  assert.match(source, /steer\|guide/u);
  assert.match(source, /const submitCandidates/u);
  assert.match(source, /filter\(\(button\) => visibleElement\(button\)/u);
  assert.match(source, /hasPrimaryStructure: explicitAction \|\| nativePrimary/u);
  assert.match(source,
    /filter\(\(candidate\) => candidate\.state && candidate\.hasPrimaryStructure\)/u);
  assert.match(source, /if \(primary\) markSubmitControl\(primary\.button, primary\.state\)/u);
  assert.doesNotMatch(source, /submitState\([^)]*\) \|\| 'send'/u);
  assert.match(source, /transform: translateY\(-1px\) scale\(1\.025\)/u);
  assert.match(source, /filter: saturate\(\.35\)/u);
  assert.match(source,
    /data-lingglow-codex-control=\\"stop\\"\]:is\(:disabled,[\s\S]*?opacity: 1 !important/u);
  assert.doesNotMatch(source, /let inspected = 0/u);
  assert.match(source, /background-color: transparent !important/u);
  assert.match(source, /(?:full access|完全访问)/u);
  assert.match(source, /(?:send|发送)/u);
  assert.match(source, /lastHomeSeenAt/u);
  assert.match(source, /group\\\\\/home-suggestions/u);
  assert.match(source, /const classifyHomeSurface = function isActiveHomeSurface/u);
  assert.match(source, /const shellMain = boundedShellMain\(\)/u);
  assert.match(source, /shellMain\.querySelectorAll\('\[role="main"\]'\)/u);
  assert.doesNotMatch(source, /document\.querySelectorAll\('\[role="main"\]'\)/u);
  assert.match(source, /visibleTaskContent,/u);
  assert.match(source,
    /routeReady: Boolean\(detectedHome \|\| graceHome \|\| routeState\.visibleTaskContent\)/u);
  assert.match(source, /const routeState = syncRouteState\(\);\s+syncSemanticControls\(routeState\)/u);
  assert.match(source, /const graceHome = !routeState\.visibleTaskContent/u);
  assert.match(source, /node\.hidden/u);
  assert.match(source, /closest\('\[hidden\], \[aria-hidden="true"\], \[inert\]'\)/u);
  assert.match(source, /rects\.some\(\(rect\) => rect\.width > 0 && rect\.height > 0\)/u);
  assert.match(source, /Number\.parseFloat\(style\.opacity \|\| '1'\) <= 0/u);
  assert.match(source,
    /for \(let current = node; current instanceof HTMLElement; current = current\.parentElement\)/u);
  assert.match(source, /\.filter\(Boolean\)\)\]\.find\(isRenderedElement\) \|\| null/u);
  assert.match(source, /style\.visibility === 'hidden'/u);
  assert.doesNotMatch(source, /data-testid="home-icon"/u);
  assert.doesNotMatch(source, /setInterval\(\(\) => ensure/u);
  assert.doesNotMatch(source, /dream-skin-home-shell/u);
  assert.doesNotMatch(source, /dream-skin-home-utility/u);
  assert.doesNotMatch(source, /flex-basis:/u);
  assert.doesNotMatch(source, /\.group\\\\\/home-suggestions button \{[^}]*min-height:/u);
  assert.ok(source.includes('[data-lingglow-codex-surface=\\"above-composer\\"] {\\n  background: transparent !important;'));
  assert.match(source,
    /data-lingglow-codex-surface=\\"diff-summary\\"[\s\S]*?-webkit-text-fill-color: var\(--ds-text\) !important/u);
});

test('Codex keeps loading routes transparent and frames only a canonical ready composer', () => {
  const css = codexDreamSkinCssForTesting();
  const source = codexDreamSkinInjectionSource({
    clientId: 'codex',
    profileId: 'route-ready-regression',
    profile: {
      id: 'route-ready-regression',
      official: {
        variant: 'light', accent: '#176b91', surface: '#F8F2EA', ink: '#241B16',
      },
      advanced: {background: {image: onePixelPng}},
    },
  });

  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(css,
    /thread-scroll-container\s+\[data-lingglow-codex-turn-surface="true"\]/u);
  assert.doesNotMatch(css, /thread-scroll-container:not\(:has\(/u);
  assert.doesNotMatch(css, /thread-scroll-container[^}]*background:\s*var\(--ds-panel\)/u);
  assert.doesNotMatch(css, /thread-scroll-container[\s\S]{0,320}data-message-author-role/u);
  assert.match(css,
    /data-lingglow-codex-composer-anchor="true"\] :is\([\s\S]*?data-thread-find-composer[\s\S]*?border: 0 !important/u);
  assert.match(css,
    /data-thread-find-composer[\s\S]*?:has\(\[data-lingglow-codex-composer-anchor="true"\]\)[\s\S]*?border: 0 !important/u);
  assert.match(css,
    /data-lingglow-codex-composer-anchor="true"\]::before[\s\S]*?box-shadow: none !important/u);
  assert.doesNotMatch(css, /data-lingglow-codex-composer-anchor="true"\]::after[\s\S]*?background: transparent/u);
  assert.match(source, /\[data-chatgpt-conversation-turn="true"\]/u);
  assert.match(source, /routeReady: false/u);
  assert.match(source, /routeState\?\.routeReady === true/u);
  assert.match(source, /const canonicalComposer = editorComposerCandidates[\s\S]*?data-codex-composer-root/u);
  assert.match(source, /syncCanonicalTurnSurfaces\(routeState\)/u);
  assert.match(source, /TURN_SURFACE_ATTR/u);
  assert.match(source, /const desired = new Set\(\)/u);
  assert.match(source, /if \(!desired\.has\(node\)\) node\.removeAttribute\(TURN_SURFACE_ATTR\)/u);
  assert.match(source, /node\.getAttribute\(TURN_SURFACE_ATTR\) !== 'true'/u);
  assert.match(source, /routeKey === lastHomeRouteKey/u);
  assert.match(source, /armHomeGraceExpiry\(510 - homeAge\)/u);
  assert.match(source, /clearComposerAnchorState\(node\)/u);
});

test('Codex executable DOM fixture gates canonical composer and turn surfaces by route', (t) => {
  const fixture = createCodexRuntimeFixture();
  const source = codexDreamSkinInjectionSource({
    clientId: 'codex',
    profileId: 'dom-route-fixture',
    profile: {
      id: 'dom-route-fixture',
      official: {
        variant: 'light', accent: '#176b91', surface: '#F8F2EA', ink: '#241B16',
      },
      advanced: {background: {image: onePixelPng}},
    },
  });
  vm.runInNewContext(source, fixture.context, {timeout: 2_000});
  const state = fixture.context.window.__CODEX_DREAM_SKIN_STATE__;
  t.after(() => state.cleanup());
  const anchor = 'data-lingglow-codex-composer-anchor';
  const turnSurface = 'data-lingglow-codex-turn-surface';
  const travel = '--lingglow-mascot-travel-x';

  // Loading exposes composer-shaped DOM, but it is not a ready route.
  assert.equal(fixture.context.document.querySelectorAll(`[${anchor}]`).length, 0);
  assert.equal(fixture.liveRoot.style.getPropertyValue(travel), '');

  // A real home signal enables only the visible canonical root. Hidden and
  // editor-less roots, its ancestor shell and its inner marker stay idle.
  fixture.clock.now = 100;
  fixture.location.pathname = '/new-task';
  const suggestions = fixture.main.appendChild(new FixtureElement('div', {
    classes: ['group/home-suggestions'], rect: {width: 900, height: 220},
  }));
  state.ensure({root: false, route: true});
  assert.deepEqual(fixture.context.document.querySelectorAll(`[${anchor}]`), [fixture.liveRoot]);
  assert.equal(fixture.staleRoot.hasAttribute(anchor), false);
  assert.equal(fixture.noEditorRoot.hasAttribute(anchor), false);
  assert.equal(fixture.findComposer.hasAttribute(anchor), false);
  assert.equal(fixture.surface.hasAttribute(anchor), false);
  assert.equal(fixture.innerComposer.hasAttribute(anchor), false);
  assert.match(fixture.liveRoot.style.getPropertyValue(travel), /^-\d+px$/u);

  // Same-route React reconciliation uses bounded grace, avoiding a frame flash
  // when the suggestions briefly disappear.
  fixture.clock.now = 150;
  suggestions.remove();
  state.ensure({root: false, route: true});
  assert.equal(fixture.liveRoot.getAttribute(anchor), 'true');

  // A route-key change is navigation, not refresh grace. Clear the frame and
  // every travel variable even if old composer DOM remains connected.
  fixture.clock.now = 170;
  fixture.location.pathname = '/loading-next-task';
  state.ensure({root: false, route: true});
  assert.equal(fixture.context.document.querySelectorAll(`[${anchor}]`).length, 0);
  assert.equal(fixture.liveRoot.style.getPropertyValue(travel), '');

  // Modern and legacy turns each receive one canonical surface. Nested message
  // markers are not painted as additional cards.
  fixture.clock.now = 220;
  fixture.location.pathname = '/thread/fixture';
  const modernTurn = fixture.scroll.appendChild(new FixtureElement('article', {
    attributes: {'data-chatgpt-conversation-turn': 'true'}, rect: {width: 1000, height: 260},
  }));
  const modernMessage = modernTurn.appendChild(new FixtureElement('div', {
    attributes: {'data-message-author-role': 'assistant'}, rect: {width: 960, height: 220},
  }));
  const legacyTurn = fixture.scroll.appendChild(new FixtureElement('article', {
    attributes: {'data-turn-key': 'turn-2'}, rect: {width: 1000, height: 180},
  }));
  const legacyMessage = legacyTurn.appendChild(new FixtureElement('div', {
    attributes: {'data-message-id': 'message-2'}, rect: {width: 960, height: 140},
  }));
  state.ensure({root: false, route: true});
  assert.deepEqual(fixture.context.document.querySelectorAll(`[${turnSurface}]`), [modernTurn, legacyTurn]);
  assert.equal(modernMessage.hasAttribute(turnSurface), false);
  assert.equal(legacyMessage.hasAttribute(turnSurface), false);
  assert.deepEqual(fixture.context.document.querySelectorAll(`[${anchor}]`), [fixture.liveRoot]);

  // Streaming child mutations may run the route pass repeatedly. Stable turn
  // markers must be diffed in place instead of removed and re-added each time.
  const writesBeforeStablePass = state.metrics.attributeWrites;
  const stableTurnSurfaces = fixture.context.document.querySelectorAll(`[${turnSurface}]`);
  state.ensure({root: false, route: true});
  assert.equal(state.metrics.attributeWrites, writesBeforeStablePass);
  assert.deepEqual(fixture.context.document.querySelectorAll(`[${turnSurface}]`), stableTurnSurfaces);

  modernTurn.remove();
  legacyTurn.remove();
  fixture.clock.now = 260;
  fixture.location.pathname = '/loading-after-thread';
  state.ensure({root: false, route: true});
  assert.equal(fixture.context.document.querySelectorAll(`[${turnSurface}]`).length, 0);
  assert.equal(fixture.context.document.querySelectorAll(`[${anchor}]`).length, 0);
  assert.equal(fixture.liveRoot.style.getPropertyValue(travel), '');
});

test('Codex dark conversation uses the same single-layer surface contract', () => {
  const source = codexDreamSkinInjectionSource({
    clientId: 'codex',
    profileId: 'dark-conversation-qa',
    profile: {
      id: 'dark-conversation-qa',
      name: 'Dark Conversation QA',
      official: {
        variant: 'dark', accent: '#73C6F2', surface: '#11161D', ink: '#F2F7FB',
        semanticColors: {diffRemoved: '#FF8A80'},
      },
      advanced: {background: {image: onePixelPng}},
    },
  });

  assert.doesNotThrow(() => new vm.Script(source));
  assert.ok(source.includes('--ds-panel-rgb: 21 29 38;'));
  assert.ok(source.includes('"onAccent":"#111111"'));
  assert.ok(source.includes('"onDanger":"#111111"'));
  assert.ok(source.includes('"danger":"#FF8A80"'));
  assert.ok(source.includes('[data-thread-scroll-footer=\\"true\\"] > :first-child > :only-child'));
  assert.ok(source.includes('rgb(var(--ds-panel-rgb) / .38) 0%'));
  assert.ok(source.includes('background: rgb(var(--ds-panel-rgb) / .98) !important;'));
});

test('Codex uses each skin home image for banner analysis without changing conversation art', () => {
  const homeImage = 'data:image/png;base64,SE9NRS1BUlQ=';
  const compiled = {
    profile: {
      id: 'per-skin-home-art',
      official: {variant: 'dark', surface: '#11161D', ink: '#F2F7FB', accent: '#73C6F2'},
      advanced: {
        background: {image: onePixelPng},
        banner: {enabled: true, image: homeImage, opacity: 0.55, position: 'top-right'},
      },
    },
    runtimeVisual: {codexHomeImage: homeImage},
  };
  const theme = codexDreamThemeForTesting(compiled, onePixelPng, homeImage);
  const source = codexDreamSkinInjectionSource(compiled);
  const css = codexDreamSkinCssForTesting();

  assert.equal(theme.art.safeArea, 'left');
  assert.equal(theme.art.focusX, 0.72);
  assert.equal(theme.art.taskMode, 'banner');
  assert.equal(theme.artMetadata.safeArea, 'left');
  assert.ok(theme.art.scrimStrength >= 0.35 && theme.art.scrimStrength <= 0.85);
  assert.match(source, /const homeArtUrl = hasSeparateHomeArt/u);
  assert.match(source, /image\.src = homeArtUrl/u);
  assert.match(source, /setStyleProperty\(root, "--dream-skin-home-art"/u);
  assert.doesNotMatch(source, /lingglowHomeArtUrl/u);
  assert.doesNotMatch(source, /__DREAM_SKIN_[A-Z_]+__/u);
  assert.match(css,
    /data-dream-route-home="true"\]\[data-dream-art-task-mode="banner"\][\s\S]*?var\(--dream-skin-home-art\)/u);
  assert.match(css,
    /data-dream-route-home="true"\]\[data-dream-art-task-mode="ambient"\] body::before[\s\S]*?var\(--dream-skin-home-art\)/u);
  assert.doesNotMatch(css,
    /data-dream-route-home="false"[^}]*var\(--dream-skin-home-art\)/u);
});

test('all registered Codex packs preserve their complete banner recipe through the real service chain', (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lingglow-codex-banner-chain-'));
  t.after(() => rmSync(dataDir, {recursive: true, force: true}));
  const studio = new StudioServer({dataDir});
  const packs = listRegisteredThemePacks({clientId: 'codex'});

  assert.equal(packs.length, 32);
  for (const pack of packs) {
    const expected = {
      enabled: pack.base['codex.banner.enabled'],
      opacity: pack.base['codex.banner.opacity'],
      height: pack.base['codex.banner.height'],
      width: pack.base['codex.banner.width'],
      position: pack.base['codex.banner.position'],
    };
    assert.equal(expected.enabled, true, `${pack.id}: banner enabled`);
    assert.equal(expected.position, 'top-right', `${pack.id}: authored safe side`);

    const resolved = studio.resolveSkin(pack.id, 'codex');
    assert.equal(resolved?.profileKind, 'theme-pack', `${pack.id}: resolved Theme Pack`);
    const resolvedBanner = resolved.profile.advanced.banner;
    for (const [field, value] of Object.entries(expected)) {
      assert.equal(resolvedBanner[field], value, `${pack.id}: resolved banner.${field}`);
    }
    assert.match(resolvedBanner.image, /^data:image\/webp;base64,/u, `${pack.id}: resolved banner image`);

    const compiled = studio.compileFor(resolved.profile, {clientId: 'codex'});
    const compiledBanner = compiled.profile.advanced.banner;
    for (const [field, value] of Object.entries(expected)) {
      assert.equal(compiledBanner[field], value, `${pack.id}: compiled banner.${field}`);
    }
    assert.equal(compiled.audit.bannerEnabled, false, `${pack.id}: legacy CSS banner stays disabled`);
    assert.ok(!compiled.audit.enabledCapabilities.includes('banner'),
      `${pack.id}: legacy banner capability stays filtered`);
    assert.equal(compiled.runtimeVisual?.codexHomeImage, resolvedBanner.image,
      `${pack.id}: runtime receives the selected home image`);

    const conversationImage = compiled.profile.advanced.background.image;
    const homeImage = compiled.runtimeVisual.codexHomeImage;
    assert.notEqual(homeImage, conversationImage, `${pack.id}: home image differs from global background`);
    const theme = codexDreamThemeForTesting(compiled, conversationImage, homeImage);
    assert.equal(theme.art.taskMode, 'banner', `${pack.id}: runtime task mode`);
    assert.equal(theme.art.safeArea, 'left', `${pack.id}: safe area`);
    assert.equal(theme.art.focusX, 0.72, `${pack.id}: focus x`);
    assert.equal(theme.art.scrimStrength,
      Math.min(0.85, Math.max(0.35, 1.30 - expected.opacity)),
      `${pack.id}: scrim strength`);

    const source = codexDreamSkinInjectionSource(compiled);
    assert.ok(source, `${pack.id}: injection source`);
    assert.doesNotMatch(source, /__DREAM_SKIN_[A-Z_]+__/u, `${pack.id}: unresolved placeholder`);
  }
});

test('Codex theme derives readable text and action foregrounds from each skin', () => {
  const theme = codexDreamThemeForTesting({
    profile: {
      id: 'mixed-wallpaper',
      name: 'Mixed Wallpaper',
      official: {
        variant: 'light',
        surface: '#FFF3E8',
        ink: '#FFFDFB',
        accent: '#F2B8A0',
        fonts: {ui: 'Avenir Next', code: 'JetBrains Mono'},
        semanticColors: {diffRemoved: '#F3A6AA'},
      },
      advanced: {radius: 18, glass: {enabled: true, opacity: 0.68}},
    },
  });

  assert.equal(theme.colors.panel, '#FFF3E8');
  assert.ok(contrastRatio(theme.colors.text, theme.colors.panel) >= 4.5);
  assert.ok(contrastRatio(theme.colors.muted, theme.colors.panel) >= 4.5);
  assert.ok(contrastRatio(theme.colors.accent, theme.colors.panel) >= 4.5);
  assert.ok(contrastRatio(theme.colors.danger, theme.colors.panel) >= 4.5);
  assert.ok(contrastRatio(theme.colors.onAccent, theme.colors.accent) >= 4.5);
  assert.ok(contrastRatio(theme.colors.onAccent, theme.colors.accentAlt) >= 4.5);
  assert.ok(contrastRatio(theme.colors.onDanger, theme.colors.danger) >= 4.5);
  assert.ok(contrastRatio(theme.colors.onDanger, theme.colors.dangerAlt) >= 4.5);
  assert.equal(theme.controlRadius, 16);
  assert.equal(theme.reading, undefined);
  assert.match(theme.fonts.ui, /^"Avenir Next",/u);
  assert.match(theme.fonts.code, /^"JetBrains Mono",/u);
});

test('Codex keeps native fonts unless a skin explicitly declares them', () => {
  const theme = codexDreamThemeForTesting({
    profile: {
      id: 'native-fonts',
      official: {
        variant: 'dark', surface: '#11161D', ink: '#F2F7FB', accent: '#73C6F2',
        fonts: {ui: null, code: null}, semanticColors: {diffRemoved: '#FF8A80'},
      },
      advanced: {},
    },
  });

  assert.deepEqual(theme.fonts, {ui: null, code: null});
});

test('Codex submit classifier only maps an explicit primary action state', () => {
  assert.equal(classifyCodexSubmitState('composer-stop-button'), 'stop');
  assert.equal(classifyCodexSubmitState('composer_interrupt_button'), 'stop');
  assert.equal(classifyCodexSubmitState('composer-send-button'), 'send');
  assert.equal(classifyCodexSubmitState('停止生成'), 'stop');
  assert.equal(classifyCodexSubmitState('暂停'), 'stop');
  assert.equal(classifyCodexSubmitState('queue-message'), 'queue');
  assert.equal(classifyCodexSubmitState('steer-response'), 'steer');
  assert.equal(classifyCodexSubmitState('取消上传'), null);
  assert.equal(classifyCodexSubmitState('暂停录音'), null);
  assert.equal(classifyCodexSubmitState('generic primary action'), null);
});

test('Codex home classifier requires a rendered native home signal and lets task content veto it', () => {
  const base = {
    withinShell: true,
    connected: true,
    rendered: true,
    visibleGameSource: false,
    visibleSuggestions: false,
    visibleTaskContent: false,
  };
  const cases = [
    ['missing signals', null, false],
    ['outside bounded shell', {...base, withinShell: false, visibleSuggestions: true}, false],
    ['detached surface', {...base, connected: false, visibleSuggestions: true}, false],
    ['hidden surface', {...base, rendered: false, visibleSuggestions: true}, false],
    ['no native home signal', base, false],
    ['visible game source', {...base, visibleGameSource: true}, true],
    ['visible suggestions', {...base, visibleSuggestions: true}, true],
    ['task content overrides game source', {
      ...base, visibleGameSource: true, visibleTaskContent: true,
    }, false],
    ['task content overrides suggestions', {
      ...base, visibleSuggestions: true, visibleTaskContent: true,
    }, false],
  ];
  for (const [name, signals, expected] of cases) {
    assert.equal(isActiveHomeSurface(signals), expected, name);
  }
});
