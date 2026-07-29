import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {runtimeHotfixInjectionSource} from '../src/runtime-hotfix.mjs';

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9wAAAAABJRU5ErkJggg==';

function compiled(clientId) {
  return {
    clientId,
    profile: {
      id: `visual-${clientId}`,
      official: {variant: 'light', accent: '#E56F8A', surface: '#F6F1EE', ink: '#213A39'},
      advanced: {
        background: {image: onePixelPng},
        glass: {enabled: true, blur: 18},
        workbuddy: {composerAvatar: {image: onePixelPng, activityMotion: 'float'}},
      },
    },
    audit: {composerAvatarEnabled: true},
  };
}

test('WorkBuddy hotfix keeps chat readable and limits account backgrounds to popup roots', () => {
  const source = runtimeHotfixInjectionSource(compiled('workbuddy'));
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /\.main-content\.main-content--chat :is\(\.chat-container, \.wb-cb-chat\)/u);
  assert.match(source, /\.main-content\.main-content--chat :is\(\.chat-container, \.wb-cb-chat\) \{[\s\S]*?background: transparent !important/u);
  assert.match(source, /\.automation-panel,[\s\S]*?\.automation-main-page[\s\S]*?background: transparent !important/u);
  assert.match(source, /:is\(\.atm-empty-state, \.atm-empty-state-hero, \.atm-empty-state-templates\)[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/u);
  assert.match(source, /--atm-template-card-bg: rgba\([^)]*, 0\.50\) !important/u);
  assert.match(source, /\[data-lingglow-workbuddy-composer=\\?"true\\?"\] \{[\s\S]*?rgba\([^)]*, 0\.58\) !important/u);
  assert.doesNotMatch(source,
    /\.main-content\.main-content--chat\s+:is\([^)]*\[class\*="_mainArea_"\][^)]*\)\s*\{/u);
  assert.match(source,
    /\.wb-cb-chat :is\([\s\S]*?\[class\^="_chatMessageContainer_"\],[\s\S]*?\[class\*=" _chatMessage_"\][\s\S]*?background-color: transparent !important/u);
  assert.doesNotMatch(source, /\[class\*="_chatMessage_"\]/u);
  assert.doesNotMatch(source,
    /\[data-lingglow-workbuddy-composer=\\?"true\\?"\]::after[\s\S]{0,240}?background(?:-image)?: transparent !important/u);
  assert.match(source, /\.main-content\.main-content--chat :is\([\s\S]*?textarea,[\s\S]*?\[contenteditable="true"\][\s\S]*?\) \{[\s\S]*?background: transparent !important/u);
  assert.match(source, /\.team-member-bar-slot::before[\s\S]*?background: transparent !important[\s\S]*?background-image: none !important/u);
  assert.match(source, /\.team-member-bar-slot::after[\s\S]*?rgba\([^)]*, 0\.34\)/u);
  assert.match(source, /\[class\*="_modelSelectorTrigger_"\][\s\S]*?background: rgba\([^)]*, 0\.34\) !important/u);
  assert.match(source, /\[class\*="_modelSelectorTrigger_"\]:is\(:hover, :focus-visible, \[aria-expanded="true"\]\)[\s\S]*?background: rgba\([^)]*, 0\.56\) !important/u);
  assert.match(source, /:is\(\[role="listbox"\], \[role="menu"\]\)[\s\S]*?background: (?:#[A-Fa-f0-9]{6}|rgba\([^;]+\)) !important/u);
  assert.match(source, /:is\(\[role="listbox"\], \[role="menu"\]\) :where\(p, span, label, div, button\)/u);
  assert.doesNotMatch(source, /\.main-content\.main-content--chat :is\(\.chat-container, \.wb-cb-chat\) \{[\s\S]*?background: rgba\([^)]*, 0\.72\) !important/u);
  assert.match(source, /\.wb-cb-chat table/u);
  assert.match(source, /_assistantTextContent_/u);
  assert.match(source, /\.automation-panel, \.code-buddy-automation, \.automation-main-page/u);
  assert.match(source, /\.user-menu-popover/u);
  assert.match(source, /\.daily-checkin-info/u);
  assert.match(source, /\.daily-checkin-btn-primary:not\(\.is-claimed\)/u);
  assert.match(source, /for \(const surface of popover\.querySelectorAll\('div, article, form, header, footer, section, ul, ol'\)\)/u);
  assert.match(source, /const surfaceMismatch = workbuddyNativeTheme === "dark"/u);
  assert.match(source, /const effectivePopupBackground = \(node\) =>/u);
  assert.match(source, /popupContrast\(popupDarkInk, contrastBackground\)/u);
  assert.match(source, /\.user-menu-item-label/u);
  assert.match(source, /syncPlainTextSurfaces/u);
  assert.match(source, /data-lingglow-plain-text-surface/u);
  assert.match(source, /data-lingglow-plain-text-surface/u);
  assert.equal(source.match(/syncPlainTextSurfaces\(\)/gu)?.length, 2);
  assert.match(source, /\.wb-cb-chat \[data-cb-chat-input-toolbar-right=\\?"true\\?"\]/u);
  assert.match(source, /const exactInputArea = toolbar\.closest\('\[class\*="_input-area-container_"\]'\)/u);
  assert.match(source, /const legacySection = toolbar\.closest\('section\[class\*="_container_"\]'\)/u);
  assert.match(source, /const composer = isComposerRegion\(exactInputArea\)[\s\S]*?isComposerRegion\(legacySection\)/u);
  assert.match(source, /rect\.height > Math\.max\(360, window\.innerHeight \* 0\.42\)/u);
  assert.match(source, /data-lingglow-workbuddy-composer/u);
  assert.match(source, /data-lingglow-workbuddy-landing-composer/u);
  assert.match(source, /\.wb-home-composer \.wb-home-composer__input-slot/u);
  assert.match(source, /closest\('\.wb-home-composer, \.wb-home-page'\)/u);
  assert.match(source, /&& !landingComposer/u);
  assert.match(source, /const composerAvatarEnabled = visual\?\.composerAvatarEnabled === true/u);
  assert.match(source, /display: \$\{composerAvatarEnabled \? "none" : "block"\} !important/u);
  assert.doesNotMatch(source, /\[class\*="user-menu" i\]/u);
  assert.doesNotMatch(source, /\[class\*="userMenu" i\]/u);
});

test('runtime hotfix resolves text against the painted surface instead of the host mode', () => {
  const source = runtimeHotfixInjectionSource({
    ...compiled('workbuddy'),
    profile: {
      ...compiled('workbuddy').profile,
      official: {variant: 'dark', accent: '#E56F8A', surface: '#F6F1EE', ink: '#FFFFFF'},
    },
  });
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /const surfaceLuminance = relativeLuminance/u);
  assert.match(source, /const fallbackInk = contrast\(darkInkLuminance, surfaceLuminance\)/u);
  assert.match(source, /contrast\(requestedInkLuminance, surfaceLuminance\) >= 4\.5/u);
  assert.match(source, /readablePhotoOverlayAlpha/u);
  assert.match(source, /overBlack/u);
  assert.match(source, /overWhite/u);
  assert.match(source, /"surface":"#F6F1EE"/u);
  assert.match(source, /"ink":"#FFFFFF"/u);
});

test('Doubao hotfix uses a continuous contrast-safe reading surface and bounded stage cleanup', () => {
  const source = runtimeHotfixInjectionSource(compiled('doubao'));
  assert.doesNotThrow(() => new vm.Script(source));
  assert.doesNotMatch(source, /data-lingglow-doubao-stage="true"\]::before/u);
  assert.match(source, /doubaoReadingAlpha\.toFixed\(2\)/u);
  assert.match(source, /background: rgba\(\$\{surfaceRgb\}, 0\.92\) !important/u);
  assert.match(source, /text-shadow: \$\{doubaoTextShadow\} !important/u);
  assert.match(source, /text-g-send-msg-bubble-text/u);
  assert.match(source, /:where\(input, textarea, \[contenteditable="true"\], \[role="textbox"\]\)/u);
  assert.match(source, /:is\(textarea, input, \[contenteditable="true"\], \.ProseMirror, \[class\*="editable"\]\) \{[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/u);
  assert.match(source, /data-lingglow-plain-text-surface/u);
  assert.match(source, /if \(client !== "doubao"\) syncPlainTextSurfaces\(\)/u);
  assert.match(source, /"ink":"#213A39"/u);
  assert.match(source, /color: \$\{ink\} !important/u);
  assert.match(source, /doubaoObserver\.observe\(document\.documentElement/u);
  assert.match(source, /syncDoubaoComposerAvatar/u);
  assert.match(source, /data-lingglow-doubao-composer/u);
  assert.match(source, /currentWrappers\.find\(\(candidate\) => candidate\.contains\(input\)\) \|\| input\.parentElement/u);
  assert.match(source, /wrapperRect\.width \+ 2 < inputRect\.width/u);
  assert.match(source, /const desiredWrappers = new Set\(\)/u);
  assert.match(source, /if \(desiredWrappers\.has\(node\)\) return;[\s\S]*?delete node\.dataset\.lingglowDoubaoComposer/u);
  assert.match(source, /if \(wrapper\.dataset\.lingglowDoubaoComposer !== "true"\)/u);
  assert.match(source, /setComposerMascotTravel\(wrapper, 78\)/u);
  assert.match(source, /if \(!\(node instanceof HTMLElement\) \|\| \+\+inspected > 96\) break/u);
  assert.doesNotMatch(source, /main\.querySelectorAll\("\*"\)/u);
  assert.match(source, /setTimeout\(markLargeStages, 120\)/u);
  assert.doesNotMatch(source,
    /querySelectorAll\('\[data-lingglow-doubao-composer=\\"true\\"\]'\)\.forEach\(\(node\) => \{\s+delete node\.dataset\.lingglowDoubaoComposer/u);
});

test('composer activity monitor follows semantic stop controls and keeps Doubao scanning bounded', () => {
  for (const clientId of ['workbuddy', 'codex', 'doubao']) {
    const source = runtimeHotfixInjectionSource(compiled(clientId));
    assert.doesNotThrow(() => new vm.Script(source), clientId);
    assert.match(source, /data-lingglow-agent-active/u, clientId);
    assert.match(source, new RegExp(`\\)\\(${JSON.stringify(clientId)}, true\\);`, 'u'), clientId);
  }
  const source = runtimeHotfixInjectionSource(compiled('doubao'));
  assert.match(source, /data-lingglow-codex-control=\\?"stop/u);
  assert.match(source, /data-track-id=\\?"agent_task_interrupted/u);
  assert.match(source, /querySelectorAll\('\[data-testid="chat_input"\]'\)/u);
  assert.match(source, /chat_input_local_break_button/u);
  assert.match(source, /button, \[role="button"\], \[data-testid\]/u);
  assert.match(source, /if \(\+\+inspected > 48\) return false/u);
  assert.match(source, /stop\|cancel\|interrupt\|break\|abort/u);
  assert.match(source, /'class', 'style'/u);
  assert.match(source, /style\.display === 'none'/u);
  assert.match(source, /visibilitychange/u);
  assert.match(source, /document\.hidden !== true/u);
  assert.doesNotMatch(source, /button\.textContent/u);
});

test('Doubao 2.19.9 break control starts the mascot and hidden controls or pages stop it', () => {
  const completeSource = runtimeHotfixInjectionSource(compiled('doubao'));
  const activityStart = completeSource.lastIndexOf(';(function installComposerActivityMonitor');
  assert.ok(activityStart > 0);
  const activitySource = completeSource.slice(activityStart);

  class FakeElement {
    constructor() {
      this.attributes = new Map();
      this.hidden = false;
      this.isConnected = true;
      this.parentElement = null;
      this.styleState = {display: 'block', visibility: 'visible', opacity: '1'};
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    matches() { return false; }
    getClientRects() { return [{}]; }
  }

  const root = new FakeElement();
  const breakControl = new FakeElement();
  let exposeBreakControl = true;
  const documentEvents = new Map();
  const windowEvents = new Map();
  const frames = new Map();
  let nextFrame = 1;
  const fakeDocument = {
    documentElement: root,
    hidden: false,
    visibilityState: 'visible',
    querySelectorAll(selector) {
      if (selector.includes('chat_input_local_break_button')) {
        return exposeBreakControl ? [breakControl] : [];
      }
      return [];
    },
    addEventListener(name, listener) { documentEvents.set(name, listener); },
    removeEventListener(name, listener) {
      if (documentEvents.get(name) === listener) documentEvents.delete(name);
    },
  };
  const fakeWindow = {
    addEventListener(name, listener) { windowEvents.set(name, listener); },
    removeEventListener(name, listener) {
      if (windowEvents.get(name) === listener) windowEvents.delete(name);
    },
  };
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  const context = vm.createContext({
    document: fakeDocument,
    window: fakeWindow,
    HTMLElement: FakeElement,
    MutationObserver: FakeMutationObserver,
    getComputedStyle: (node) => node.styleState,
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout: () => 101,
    clearTimeout() {},
  });
  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };

  vm.runInContext(activitySource, context);
  flushFrame();
  assert.equal(root.getAttribute('data-lingglow-agent-active'), 'true');

  breakControl.styleState = {display: 'none', visibility: 'visible', opacity: '1'};
  fakeWindow.__LINGGLOW_COMPOSER_ACTIVITY_STATE__.sync();
  flushFrame();
  assert.equal(root.getAttribute('data-lingglow-agent-active'), null);

  breakControl.styleState = {display: 'block', visibility: 'visible', opacity: '1'};
  exposeBreakControl = true;
  fakeWindow.__LINGGLOW_COMPOSER_ACTIVITY_STATE__.sync();
  flushFrame();
  assert.equal(root.getAttribute('data-lingglow-agent-active'), 'true');
  fakeDocument.hidden = true;
  fakeDocument.visibilityState = 'hidden';
  documentEvents.get('visibilitychange')();
  assert.equal(root.getAttribute('data-lingglow-agent-active'), null);
  fakeWindow.__LINGGLOW_COMPOSER_ACTIVITY_STATE__.cleanup();
});

test('still mascot disables the activity marker even when the image is enabled', () => {
  const value = compiled('codex');
  value.profile.advanced.workbuddy.composerAvatar.activityMotion = 'still';
  assert.match(runtimeHotfixInjectionSource(value), /\)\("codex", false\);/u);
});
