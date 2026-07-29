import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CLIENT_TRUST_POLICIES,
  clientAppTestInternals,
  findDoubaoApp,
  findWorkBuddyApp,
} from '../src/client-app.mjs';
import {
  BUILT_IN_ADAPTERS,
  capabilitiesForCompatibility,
  compatibilityFor,
  loadAdapters,
} from '../src/adapter.mjs';

test('client trust anchors are built in for Codex, WorkBuddy, and Doubao', () => {
  assert.deepEqual(
    {
      bundleId: CLIENT_TRUST_POLICIES.codex.bundleId,
      teamId: CLIENT_TRUST_POLICIES.codex.teamId,
    },
    {bundleId: 'com.openai.codex', teamId: '2DC432GLL2'},
  );
  assert.deepEqual(
    {
      bundleId: CLIENT_TRUST_POLICIES.workbuddy.bundleId,
      teamId: CLIENT_TRUST_POLICIES.workbuddy.teamId,
    },
    {bundleId: 'com.workbuddy.workbuddy', teamId: 'FN2V63AD2J'},
  );
  assert.deepEqual(
    {
      bundleId: CLIENT_TRUST_POLICIES.doubao.bundleId,
      teamId: CLIENT_TRUST_POLICIES.doubao.teamId,
      nestedBundleId: CLIENT_TRUST_POLICIES.doubao.nestedBundleId,
      extensionId: CLIENT_TRUST_POLICIES.doubao.extensionId,
    },
    {
      bundleId: 'com.bot.pc.doubao',
      teamId: '96L78H6LMH',
      nestedBundleId: 'com.bot.pc.doubao.browser',
      extensionId: 'obkcimipmjdkghadnfcjojepocldeggd',
    },
  );
  assert.equal(Object.isFrozen(CLIENT_TRUST_POLICIES), true);
  assert.deepEqual(CLIENT_TRUST_POLICIES.codex.targetAllowlist, ['app://-/index.html']);
  assert.equal(Object.isFrozen(CLIENT_TRUST_POLICIES.codex.targetAllowlist), true);
  assert.equal(Object.isFrozen(CLIENT_TRUST_POLICIES.workbuddy), true);
  assert.equal(Object.isFrozen(CLIENT_TRUST_POLICIES.doubao), true);
  assert.equal(Object.isFrozen(CLIENT_TRUST_POLICIES.doubao.targetAllowlist), true);
});

test('Doubao reviewed exact identity receives only digest-pinned capabilities', () => {
  const adapter = BUILT_IN_ADAPTERS.find((item) => item.adapterId.includes('2.19.9'));
  assert.ok(adapter);
  const app = {
    clientId: 'doubao',
    safeToLaunch: true,
    bundleId: adapter.bundleId,
    teamId: adapter.teamId,
    version: adapter.versions[0],
    build: adapter.builds[0],
    cdHash: adapter.mainCDHash[0],
    nestedBrowser: {
      bundleId: adapter.nestedBundleId,
      teamId: adapter.nestedTeamId,
      cdHash: adapter.nestedCDHash[0],
    },
    chromium: adapter.chromiumFrameworkVersion,
    chromiumFrameworkVersion: adapter.chromiumFrameworkVersion,
    manifestCommit: adapter.manifestCommit[0],
    localExtension: {id: adapter.extensionId, version: adapter.extensionVersion[0]},
    artifactSha256: Object.fromEntries(Object.entries(adapter.artifactSha256)
      .map(([key, hashes]) => [key, hashes[0]])),
    fingerprint: 'doubao-static-2.19.9',
    transportVerification: {
      verified: false,
      appFingerprint: 'doubao-static-2.19.9',
      reason: '未验证',
    },
    signals: Object.fromEntries(adapter.requiredSignals.map((signal) => [
      signal,
      signal !== 'transportVerified',
    ])),
  };
  const compatibility = compatibilityFor(app);
  assert.equal(compatibility.level, 'exact');
  assert.equal(compatibility.advancedAllowed, true);
  assert.equal(compatibility.adapter.adapterId, 'doubao-macos-2.19.9-build-2.19.9-exact');
  assert.equal(compatibility.candidateAdapter, null);
  assert.deepEqual(compatibility.targetAllowlist, CLIENT_TRUST_POLICIES.doubao.targetAllowlist);
  assert.deepEqual(capabilitiesForCompatibility(compatibility), [
    'background', 'palette', 'glass', 'composer-avatar',
  ]);

  const staticHintsCannotUnlock = compatibilityFor({
    ...app,
    staticRuntimeHints: {
      evidenceClass: 'static-only',
      runtimeDomVerified: false,
      wrapperArgumentForwardingVerified: false,
      chromiumFramework: {markers: {'remote-debugging-pipe': true}},
    },
  });
  assert.equal(staticHintsCannotUnlock.level, 'exact');
  assert.deepEqual(capabilitiesForCompatibility(staticHintsCannotUnlock), [
    'background', 'palette', 'glass', 'composer-avatar',
  ]);

  assert.equal(compatibilityFor({
    ...app,
    artifactSha256: {...app.artifactSha256, mainExecutable: 'f'.repeat(64)},
  }).level, 'blocked');
});

test('main-process classifier accepts only stock or exact pipe command', () => {
  const executable = '/Applications/WorkBuddy.app/Contents/MacOS/Electron';
  const classify = clientAppTestInternals.classifyMainProcessCommand;
  assert.equal(classify(executable, executable), 'stock');
  assert.equal(classify(executable, `${executable} --remote-debugging-pipe`), 'pipe');
  assert.equal(classify(executable, `${executable} --remote-debugging-port=9333`), null);
  assert.equal(classify(executable, `${executable} --remote-debugging-pipe --secret=value`), null);
  assert.equal(classify(executable, `${executable} --type=utility`), null);
});

test('bounded binary marker scanner detects chunk-boundary literals without treating hints as runtime proof', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-doubao-markers-'));
  const fixture = path.join(directory, 'fixture.bin');
  try {
    const prefix = Buffer.alloc(1024 * 1024 - 8, 0x78);
    fs.writeFileSync(fixture, Buffer.concat([
      prefix,
      Buffer.from('remote-debugging-pipe\0saman-from-chat', 'ascii'),
    ]), {mode: 0o600});
    const result = clientAppTestInternals.binaryMarkerPresence(
      fixture,
      ['remote-debugging-pipe', 'remote-debugging-port', 'saman-from-chat'],
    );
    assert.deepEqual(result.markers, {
      'remote-debugging-pipe': true,
      'remote-debugging-port': false,
      'saman-from-chat': true,
    });
    assert.equal(result.fileFullyScanned, true);
    assert.equal(result.allMarkersFound, false);

    const bounded = clientAppTestInternals.binaryMarkerPresence(fixture, ['remote-debugging-pipe'], 16);
    assert.equal(bounded.fileFullyScanned, false);
    assert.equal(bounded.allMarkersFound, false);
    assert.equal(bounded.bytesScanned, 0);
    assert.equal(bounded.markers['remote-debugging-pipe'], false);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('WorkBuddy signature exception accepts only one bounded generated SDK log at the exact vendor path', () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-workbuddy-signature-'));
  const relative = clientAppTestInternals.WORKBUDDY_RUNTIME_MUTABLE_RESOURCES[0];
  const logPath = path.join(appPath, relative);
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  fs.writeFileSync(logPath, 'Editor SDK server listening on 127.0.0.1\n', {mode: 0o644});
  try {
    const diagnostic = [
      `${appPath}: a sealed resource is missing or invalid`,
      `file added: ${logPath}`,
    ].join('\n');
    assert.equal(
      clientAppTestInternals.scopedWorkBuddySignatureException(appPath, diagnostic),
      relative,
    );
    assert.equal(
      clientAppTestInternals.scopedWorkBuddySignatureException(
        appPath,
        `${diagnostic}\nfile modified: ${path.join(appPath, 'Contents/Resources/app.asar')}`,
      ),
      null,
      'any second resource-envelope failure must reject the scoped exception',
    );
    fs.writeFileSync(logPath, Buffer.alloc(64 * 1024 + 1), {mode: 0o644});
    assert.equal(
      clientAppTestInternals.scopedWorkBuddySignatureException(appPath, diagnostic),
      null,
      'an unbounded generated log must not bypass strict resource validation',
    );
  } finally {
    fs.rmSync(appPath, {recursive: true, force: true});
  }
});

test('WorkBuddy mutable SDK log cache state ignores normal appends but rejects unsafe growth', () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-workbuddy-log-state-'));
  const relative = clientAppTestInternals.WORKBUDDY_RUNTIME_MUTABLE_RESOURCES[0];
  const logPath = path.join(appPath, relative);
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  fs.writeFileSync(logPath, 'first line\n', {mode: 0o644});
  try {
    const first = clientAppTestInternals.signatureMutableResourceSafetyStates('workbuddy', appPath);
    fs.appendFileSync(logPath, 'second line\n');
    const appended = clientAppTestInternals.signatureMutableResourceSafetyStates('workbuddy', appPath);
    assert.deepEqual(appended, first, 'safe log writes must not look like application code drift');
    fs.writeFileSync(logPath, Buffer.alloc(64 * 1024 + 1), {mode: 0o644});
    const oversized = clientAppTestInternals.signatureMutableResourceSafetyStates('workbuddy', appPath);
    assert.equal(oversized[relative].present, true);
    assert.equal(oversized[relative].safe, false);
  } finally {
    fs.rmSync(appPath, {recursive: true, force: true});
  }
});

test('WorkBuddy exact adapters expose only audited component layers', () => {
  const adapter = BUILT_IN_ADAPTERS.find((item) =>
    item.adapterId === 'workbuddy-macos-5.2.6-build-5.2.6');
  assert.ok(adapter);
  const app = {
    clientId: 'workbuddy',
    safeToLaunch: true,
    bundleId: 'com.workbuddy.workbuddy',
    teamId: 'FN2V63AD2J',
    version: '5.2.6',
    build: '5.2.6',
    asarPath: '/Applications/WorkBuddy.app/Contents/Resources/app.asar',
    asarSha256: 'c5eef2ddf63f8da45b5c268a0d9b49dc51d5652690da453721281977613ed0c5',
    signals: {
      appUrlEntry: true,
      semanticSelectors: true,
      designTokens: true,
      productMarker: true,
    },
  };
  const compatibility = compatibilityFor(app);
  assert.equal(compatibility.level, 'exact');
  assert.equal(compatibility.probeKind, 'workbuddy-v1');
  assert.equal(
    compatibility.targetUrl,
    'file:///Applications/WorkBuddy.app/Contents/Resources/app.asar/renderer/index.html',
  );
  assert.deepEqual(capabilitiesForCompatibility(compatibility), [
    'background', 'palette', 'glass', 'brand', 'navigation', 'controls', 'project-hero', 'composer-avatar',
  ]);
  assert.equal(compatibility.disabledFeatures.includes('banner'), true);
  assert.equal(compatibility.disabledFeatures.includes('composer'), true);
});

test('adapter trust cannot be moved to a different WorkBuddy publisher', () => {
  const app = {
    clientId: 'workbuddy',
    safeToLaunch: true,
    bundleId: 'com.workbuddy.workbuddy',
    teamId: 'ATTACKER00',
    version: '5.2.6',
    build: '5.2.6',
    asarPath: '/tmp/app.asar',
    asarSha256: 'c5eef2ddf63f8da45b5c268a0d9b49dc51d5652690da453721281977613ed0c5',
    signals: {appUrlEntry: true, semanticSelectors: true, designTokens: true, productMarker: true},
  };
  assert.equal(compatibilityFor(app).level, 'blocked');
});

test('unknown WorkBuddy builds downgrade safely and adapter paths cannot escape ASAR', () => {
  const app = {
    clientId: 'workbuddy',
    safeToLaunch: true,
    bundleId: 'com.workbuddy.workbuddy',
    teamId: 'FN2V63AD2J',
    version: '5.2.7',
    build: 'future-build',
    asarPath: '/Applications/WorkBuddy.app/Contents/Resources/app.asar',
    asarSha256: 'f'.repeat(64),
    signals: {appUrlEntry: true, semanticSelectors: true, designTokens: true, productMarker: true},
  };
  const compatibility = compatibilityFor(app);
  assert.equal(compatibility.level, 'generic-safe');
  assert.equal(compatibility.probeKind, 'workbuddy-v1');
  assert.deepEqual(capabilitiesForCompatibility(compatibility), [
    'background', 'palette', 'glass', 'composer-avatar',
  ]);
  assert.equal(compatibility.disabledFeatures.includes('brand'), true);
  assert.equal(compatibility.disabledFeatures.includes('navigation'), true);
  assert.equal(compatibility.disabledFeatures.includes('controls'), true);

  const escapingAdapter = {
    schemaVersion: 1,
    adapterId: 'unsafe-path',
    clientId: 'workbuddy',
    bundleId: app.bundleId,
    teamId: app.teamId,
    versions: [app.version],
    builds: [app.build],
    asarSha256: [app.asarSha256],
    targetPath: '../main/index.html',
    probeKind: 'workbuddy-v1',
    capabilities: ['background'],
    requiredSignals: [],
  };
  assert.equal(compatibilityFor(app, [escapingAdapter]).level, 'generic-safe');
});

test('WorkBuddy static candidates are digest-pinned but cannot self-promote beyond generic-safe', () => {
  for (const version of ['5.3.3', '5.3.5']) {
    const adapter = loadAdapters().find((item) =>
      item.adapterId === `workbuddy-macos-${version}-build-${version}-static-candidate`);
    assert.ok(adapter, version);
    assert.equal(adapter.validation.status, 'static-candidate', version);
    assert.deepEqual(adapter.capabilities, [
      'background', 'palette', 'glass', 'brand', 'navigation', 'controls', 'project-hero',
      'composer-avatar',
    ], version);
    const app = {
      clientId: 'workbuddy',
      safeToLaunch: true,
      bundleId: adapter.bundleId,
      teamId: adapter.teamId,
      version: adapter.versions[0],
      build: adapter.builds[0],
      asarPath: '/Applications/WorkBuddy.app/Contents/Resources/app.asar',
      asarSha256: adapter.asarSha256[0],
      signals: Object.fromEntries(adapter.requiredSignals.map((signal) => [signal, true])),
    };
    const compatibility = compatibilityFor(app, [adapter]);
    assert.equal(compatibility.level, 'generic-safe', version);
    assert.equal(compatibility.candidateAdapter?.adapterId, adapter.adapterId, version);
    assert.deepEqual(capabilitiesForCompatibility(compatibility), [
      'background', 'palette', 'glass', 'composer-avatar',
    ], version);
  }
});

test('installed WorkBuddy is recognized statically without launching it', {timeout: 30000}, (t) => {
  if (process.platform !== 'darwin' || !fs.existsSync('/Applications/WorkBuddy.app')) {
    t.skip('WorkBuddy is not installed on this test host');
    return;
  }
  const app = findWorkBuddyApp({fresh: true});
  assert.ok(app);
  assert.equal(app.clientId, 'workbuddy');
  assert.equal(app.bundleId, 'com.workbuddy.workbuddy');
  assert.equal(app.teamId, 'FN2V63AD2J');
  if (!app.signatureValid) {
    t.skip('当前测试沙箱无法使用 macOS Code Signing 子系统完成主机签名核验');
    return;
  }
  assert.equal(app.signatureValid, true);
  assert.equal(app.trustedPublisher, true);
  assert.equal(app.safeToLaunch, true);
  assert.equal(app.signals.appUrlEntry, true);
  assert.equal(app.signals.semanticSelectors, true);
  assert.equal(app.signals.designTokens, true);
  assert.equal(app.signals.productMarker, true);
  assert.match(app.chromium ?? '', /^\d+\.\d+\.\d+\.\d+$/u);
  const compatibility = compatibilityFor(app);
  if (app.version === '5.2.6') {
    assert.equal(compatibility.level, 'exact');
  } else if (app.version === '5.3.3') {
    assert.equal(compatibility.level, 'exact');
    assert.equal(compatibility.adapter?.adapterId, 'workbuddy-macos-5.3.3-build-5.3.3');
    assert.equal(compatibility.candidateAdapter, null);
  } else if (app.version === '5.3.5') {
    assert.equal(compatibility.level, 'exact');
    assert.equal(compatibility.adapter?.adapterId, 'workbuddy-macos-5.3.5-build-5.3.5');
    assert.equal(compatibility.candidateAdapter, null);
  } else {
    assert.equal(compatibility.level, 'generic-safe');
  }
  assert.equal(compatibility.probeKind, 'workbuddy-v1');
});

test('installed reviewed Doubao is discovered read-only and receives exact capabilities', {timeout: 60000}, (t) => {
  if (process.platform !== 'darwin' || !fs.existsSync('/Applications/Doubao.app')) {
    t.skip('Doubao is not installed on this test host');
    return;
  }
  const app = findDoubaoApp({fresh: true});
  assert.ok(app);
  assert.equal(app.clientId, 'doubao');
  assert.equal(app.bundleId, 'com.bot.pc.doubao');
  assert.equal(app.teamId, '96L78H6LMH');
  assert.equal(app.nestedBrowser.bundleId, 'com.bot.pc.doubao.browser');
  assert.equal(app.nestedBrowser.teamId, '96L78H6LMH');
  assert.equal(app.chromium, '135.0.7049.72');
  assert.equal(app.transportVerification.verified, false);
  assert.deepEqual(app.launchStrategies.map(({id}) => id), [
    'launchservices-loopback',
    'wrapper-forwarded-pipe',
  ]);
  if (!app.signatureValid || !app.nestedBrowser.signatureValid) {
    t.skip('当前测试沙箱无法使用 macOS Code Signing 子系统完成主机签名核验');
    return;
  }
  assert.equal(app.safeToLaunch, true);
  assert.equal(app.localExtension.id, 'obkcimipmjdkghadnfcjojepocldeggd');
  assert.equal(app.signals.appUrlEntry, true);
  assert.equal(app.signals.semanticSelectors, true);
  assert.equal(app.signals.designTokens, true);
  assert.equal(app.signals.productMarker, true);
  assert.equal(app.signals.transportVerified, false);
  assert.equal(app.staticRuntimeHints.evidenceClass, 'static-only');
  assert.equal(app.staticRuntimeHints.runtimeDomVerified, false);
  assert.equal(app.staticRuntimeHints.wrapperArgumentForwardingVerified, false);
  assert.equal(
    app.staticRuntimeHints.chromiumFramework.markers['remote-debugging-pipe'],
    true,
  );
  assert.equal(app.staticRuntimeHints.chromiumFramework.markers['saman-from-chat'], true);
  assert.equal(app.staticRuntimeHints.localExtension.manifestVersion, 3);
  assert.equal(app.staticRuntimeHints.localExtension.sidePanelDefaultPath, 'side_panel.html');
  assert.equal(app.staticRuntimeHints.localExtension.homepageDocumentStart, true);
  const compatibility = compatibilityFor(app);
  assert.equal(compatibility.level, 'exact');
  assert.deepEqual(capabilitiesForCompatibility(compatibility), [
    'background', 'palette', 'glass', 'composer-avatar',
  ]);
});
