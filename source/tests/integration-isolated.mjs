#!/usr/bin/env node
// Explicit opt-in only.  This script is intentionally excluded from npm test.
// It refuses to run below a ChatGPT/Codex process tree, so it cannot turn the
// currently active Codex session into its own test target.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {findCodexApp} from '../src/codex-app.mjs';
import {PipeTransport} from '../src/cdp.mjs';
import {
  assertCodexQaAuthorization,
  assertCodexQaOutsideInteractiveAncestry,
  assertCodexStaticBaseline,
  codexQaLaunchArguments,
  createIsolatedCodexQaRoot,
  isolatedCodexEnvironment,
  removeIsolatedCodexQaRoot,
  terminateIsolatedCodexProcess,
} from '../src/codex-isolated-qa.mjs';
import {cleanupSource, compileSkin, injectionSource, skinRuntimeIds} from '../src/skin.mjs';

// Both checks happen before finding an app, creating a temporary root, or
// opening any transport.  The latter is a technical guard, not a prompt.
assertCodexQaAuthorization(process.env);
assertCodexQaOutsideInteractiveAncestry();

const app = findCodexApp({fresh: true});
if (!app?.safeToLaunch) throw new Error('No verified Codex app found');
const staticSnapshot = JSON.parse(fs.readFileSync(
  new URL('../qa/codex-static-26.707.91948.json', import.meta.url),
  'utf8',
));
const staticCandidate = JSON.parse(fs.readFileSync(
  new URL('../adapters/codex-macos-26.707.91948-build-5440-static-candidate.json', import.meta.url),
  'utf8',
));
const candidateCapabilities = Object.freeze([...staticCandidate.capabilities]);
if (staticCandidate.validation?.status !== 'static-candidate' ||
    !candidateCapabilities.includes('composer') ||
    !candidateCapabilities.includes('sidebar-width') ||
    ['banner', 'brand', 'motion', 'controls', 'navigation', 'project-hero']
      .some((capability) => candidateCapabilities.includes(capability))) {
  throw new Error('Codex isolated QA candidate capability boundary is invalid');
}
const baseline = assertCodexStaticBaseline(app, staticSnapshot);
const asarBefore = app.asarSha256;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForChildSpawn(child) {
  if (child?.pid && child.stdio?.[3] && child.stdio?.[4]) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onSpawn = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Isolated Codex exited before Pipe was ready (${code ?? signal ?? 'unknown'})`));
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function waitForTarget(transport) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const {targetInfos = []} = await transport.call('Target.getTargets');
    const target = targetInfos.find((item) =>
      item.type === 'page' && item.url.split(/[?#]/u, 1)[0] === 'app://-/index.html');
    if (target) return target;
    await delay(250);
  }
  throw new Error('Timed out waiting for isolated Codex target');
}

async function run() {
  let root = null;
  let child = null;
  let transport = null;
  let sessionId = null;
  let installedScriptIdentifier = null;
  let testCssMayBePresent = false;
  let evidence = null;
  let primaryError = null;
  const cleanupErrors = [];

  const removeTestCss = async () => {
    if (!transport || !sessionId || (!installedScriptIdentifier && !testCssMayBePresent)) return;
    const errors = [];
    if (installedScriptIdentifier) {
      try {
        await transport.call('Page.removeScriptToEvaluateOnNewDocument', {
          identifier: installedScriptIdentifier,
        }, sessionId);
        installedScriptIdentifier = null;
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      const cleanup = await transport.call('Runtime.evaluate', {
        expression: cleanupSource(),
        returnByValue: true,
      }, sessionId);
      if (cleanup.exceptionDetails || cleanup.result?.value?.ok !== true) {
        throw new Error('Isolated test CSS cleanup did not confirm success');
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) {
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'Isolated test CSS cleanup failed');
    }
    testCssMayBePresent = false;
  };

  try {
    // Everything after root creation is protected by the finalizer below.  If
    // setup, Pipe, or an assertion fails, the test CSS is removed when
    // reachable, only isolated descendants are stopped, and the private root
    // is removed only after the process check proves it is no longer in use.
    root = createIsolatedCodexQaRoot();
    const userData = path.join(root, 'electron');
    const codexHome = path.join(root, 'codex-home');
    fs.mkdirSync(userData, {mode: 0o700});
    fs.mkdirSync(codexHome, {mode: 0o700});
    fs.writeFileSync(
      path.join(codexHome, 'config.toml'),
      '[features]\nremote_plugin = false\napps = false\n',
      {mode: 0o600},
    );
    child = spawn(app.executable, codexQaLaunchArguments(), {
      env: isolatedCodexEnvironment(process.env, {userData, codexHome}),
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    });
    await waitForChildSpawn(child);
    transport = new PipeTransport(child);

    const version = await transport.call('Browser.getVersion');
    assert.equal(version.product, `Chrome/${baseline.chromium}`);
    const target = await waitForTarget(transport);
    const attached = await transport.call('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    sessionId = attached.sessionId;
    await transport.call('Page.enable', {}, sessionId);

    async function waitForStructure() {
      const deadline = Date.now() + 15000;
      let value;
      while (Date.now() < deadline) {
        const structure = await transport.call('Runtime.evaluate', {
          // This reads only fixed route/structure booleans, not page text,
          // inputs, storage, cookies, project names, or conversation data.
          expression: `({url:location.href,root:document.querySelectorAll('#root').length,electron:document.documentElement.getAttribute('data-codex-window-type')==='electron'||document.documentElement.classList.contains('electron-dark')||document.documentElement.classList.contains('electron-light'),designToken:Boolean(getComputedStyle(document.documentElement).getPropertyValue('--color-token-main-surface-primary').trim())})`,
          returnByValue: true,
        }, sessionId);
        if (!structure.exceptionDetails) {
          value = structure.result?.value;
          if (value?.url.split(/[?#]/u, 1)[0] === 'app://-/index.html' &&
              value.root === 1 && value.electron && value.designToken) return value;
        }
        await delay(150);
      }
      throw new Error(`Timed out waiting for runtime structure: ${JSON.stringify(value)}`);
    }

    const structure = await waitForStructure();
    assert.equal(structure.url.split(/[?#]/u, 1)[0], 'app://-/index.html');
    const selectorProbe = await transport.call('Runtime.evaluate', {
      expression: `(() => {
        const selectors = [
          '[data-app-shell-main-content-layout]',
          '[data-app-action-sidebar-scroll]',
          '[data-app-shell-tabs]',
          '[data-codex-composer]',
          '[data-diff]',
          '[data-settings-panel-slug]'
        ];
        return Object.fromEntries(selectors.map((selector) => [selector, document.querySelectorAll(selector).length]));
      })()`,
      returnByValue: true,
    }, sessionId);
    assert.equal(selectorProbe.exceptionDetails, undefined);
    const selectorCounts = selectorProbe.result?.value;
    assert.ok(selectorCounts && typeof selectorCounts === 'object');

    const compiled = compileSkin({
      id: 'integration-test', name: 'Integration Test',
      official: {surface: '#101827', ink: '#E5E7EB', accent: '#7AA2F7'},
      // Candidate QA must test only the statically-audited Composer/sidebar
      // projection. It never smuggles banner, brand, controls, or motion into
      // an isolated renderer simply because compileSkin defaults to all exact
      // capabilities when none are supplied.
      advanced: {enabled: true, banner: {enabled: false}, motion: 'none', sidebarWidth: 300},
    }, {
      clientId: 'codex',
      capabilityLevel: 'exact',
      capabilities: candidateCapabilities,
    });
    assert.equal(compiled.audit.bannerEnabled, false);
    assert.equal(compiled.audit.layoutFeaturesEnabled, true);
    assert.doesNotMatch(compiled.css, /body::after|@keyframes|button:hover/u);
    // Test CSS is bound to this one isolated app renderer.  It cannot apply on
    // a data: URL and it is removed below before this target is terminated.
    const installed = await transport.call('Page.addScriptToEvaluateOnNewDocument', {
      source: injectionSource(compiled, 'app://-/index.html'),
      worldName: 'codex-skin-studio-test',
      runImmediately: true,
    }, sessionId);
    assert.ok(installed.identifier);
    installedScriptIdentifier = installed.identifier;
    testCssMayBePresent = true;

    const presenceExpression = `({style:Boolean(document.getElementById(${JSON.stringify(skinRuntimeIds.styleId)})),attr:document.documentElement.getAttribute(${JSON.stringify(skinRuntimeIds.rootAttribute)})})`;
    async function waitForPresence(expected) {
      const deadline = Date.now() + 15000;
      let last;
      while (Date.now() < deadline) {
        try {
          const result = await transport.call('Runtime.evaluate', {
            expression: presenceExpression,
            returnByValue: true,
          }, sessionId);
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluation error');
          last = result.result?.value;
          const matches = expected
            ? last?.style === true && last?.attr === 'integration-test'
            : last?.style === false && last?.attr == null;
          if (matches) return last;
        } catch {
          // The page can be reconstructing after a permitted navigation.
        }
        await delay(150);
      }
      throw new Error(`Timed out waiting for injection state ${expected}: ${JSON.stringify(last)}`);
    }

    assert.deepEqual(await waitForPresence(true), {style: true, attr: 'integration-test'});
    await transport.call('Page.navigate', {url: 'data:text/html,<title>unauthorized</title>'}, sessionId);
    assert.deepEqual(await waitForPresence(false), {style: false, attr: null});
    await transport.call('Page.navigate', {url: 'app://-/index.html'}, sessionId);
    assert.deepEqual(await waitForPresence(true), {style: true, attr: 'integration-test'});

    await removeTestCss();
    await transport.call('Page.navigate', {url: 'app://-/index.html'}, sessionId);
    assert.deepEqual(await waitForPresence(false), {style: false, attr: null});

    evidence = Object.freeze({
      schemaVersion: 1,
      kind: 'lingglow.codex-isolated-qa-evidence',
      status: 'candidate-runtime-probe',
      exactAdapterEnabled: false,
      capabilitiesElevated: false,
      testCssScope: 'isolated-target-only',
      testCssRemoved: true,
      app: baseline,
      browserProduct: version.product,
      target: 'app://-/index.html',
      candidateCapabilities,
      structure,
      selectorCounts,
      cleanupVerified: true,
    });
  } catch (error) {
    primaryError = error;
  } finally {
    // If an assertion failed after installation, make a best-effort CDP
    // removal before closing the Pipe.  Failure here never skips process/root
    // cleanup; it becomes explicit evidence that the run was unsafe.
    try {
      await removeTestCss();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (transport && sessionId) {
      try {
        await transport.call('Target.detachFromTarget', {sessionId});
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (transport) {
      try { transport.close(); } catch (error) { cleanupErrors.push(error); }
    }
    if (root) {
      let processCleanupVerified = false;
      try {
        await terminateIsolatedCodexProcess(child, {root});
        processCleanupVerified = true;
      } catch (error) {
        cleanupErrors.push(error);
      }
      // Refuse deletion when process verification failed.  Retaining a 0700
      // private directory is safer than deleting files from a live renderer.
      if (processCleanupVerified) {
        try { removeIsolatedCodexQaRoot(root); } catch (error) { cleanupErrors.push(error); }
      }
    }
    try {
      const after = findCodexApp({fresh: true});
      assert.equal(after?.asarSha256, asarBefore);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  const errors = [primaryError, ...cleanupErrors].filter(Boolean);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Codex isolated QA did not complete safely');
  if (!evidence) throw new Error('Codex isolated QA produced no evidence');
  return evidence;
}

console.log(JSON.stringify(await run()));
