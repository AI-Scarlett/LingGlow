import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_TARGET_ALLOWLIST,
  DOUBAO_TARGET_ALLOWLIST,
  candidateLaunchStrategies,
  isForbiddenDebugEndpoint,
  launchStrategyFor,
  targetUrlMatchesAllowlist,
  unverifiedTransportStatus,
  validateDoubaoCandidateEvidence,
  verifyTransportEvidence,
} from '../src/transport-strategy.mjs';

const app = Object.freeze({
  clientId: 'doubao',
  fingerprint: 'doubao-fingerprint-2.19.9',
  chromium: '135.0.7049.72',
});

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'lingglow.doubao-isolated-qa-evidence',
    status: 'candidate-runtime-probe',
    cleanupVerified: true,
    stockRestoreVerified: true,
    noAutomaticPromotion: true,
    exactAdapterEnabled: false,
    capabilitiesElevated: false,
    isolationScope: 'temporary-user-data-dir-only',
    domProbeScope: 'fixed-dom-counts-no-content',
    appFingerprint: app.fingerprint,
    userAuthorized: true,
    isolatedProfile: true,
    isolatedUserDataDirForwarded: true,
    strategyId: 'wrapper-forwarded-pipe',
    mainPid: 501,
    nestedBrowserPid: 502,
    samanFromChatPid: 501,
    browserProduct: 'Chrome/135.0.7049.72',
    pageTargets: [
      {type: 'page', url: 'https://www.doubao.com/chat/isolated-verification'},
      {type: 'page', url: 'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html'},
    ],
    pageTargetInventoryComplete: true,
    processChain: [{pid: 501, ppid: 1, role: 'main-wrapper'}],
    fixedDomCounts: [{body: 1, root: 1, chatInput: 0, chatInputInput: 0, messageTextContent: 0}],
    pipeConnected: true,
    wrapperForwardedDebugArgument: true,
    nestedBrowserDebugArgument: true,
    devToolsActivePortPresent: false,
    ...overrides,
  };
}

test('Doubao discovery is unverified and exposes exact loopback plus evidence-only Pipe candidates', () => {
  const status = unverifiedTransportStatus(app);
  assert.equal(status.verified, false);
  assert.match(status.reason, /隔离重启验证/u);
  assert.deepEqual(candidateLaunchStrategies(app).map(({id}) => id), [
    'launchservices-loopback',
    'wrapper-forwarded-pipe',
  ]);
  const plan = launchStrategyFor(app, status);
  assert.equal(plan.allowed, false);
  assert.equal(plan.strategyId, null);
});

test('Codex target allowlist accepts only the top-level app renderer entry', () => {
  assert.deepEqual(CODEX_TARGET_ALLOWLIST, ['app://-/index.html']);
  assert.equal(targetUrlMatchesAllowlist('app://-/index.html', CODEX_TARGET_ALLOWLIST), true);
  assert.equal(targetUrlMatchesAllowlist('app://-/index.html?route=home#top', CODEX_TARGET_ALLOWLIST), true);
  for (const rejected of [
    'app://-/settings.html',
    'app://evil/index.html',
    'app://-@evil.example/index.html',
    'https://-/index.html',
    'file:///index.html',
  ]) {
    assert.equal(targetUrlMatchesAllowlist(rejected, CODEX_TARGET_ALLOWLIST), false, rejected);
  }
});

test('Doubao target allowlist accepts exact desktop, extension, and web chat surfaces', () => {
  assert.deepEqual(DOUBAO_TARGET_ALLOWLIST, [
    'doubao://doubao-chat/*',
    'chrome://doubao-chat/*',
    'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html',
    'https://www.doubao.com/chat/*',
  ]);
  assert.equal(targetUrlMatchesAllowlist('doubao://doubao-chat/chat'), true);
  assert.equal(targetUrlMatchesAllowlist('chrome://doubao-chat/chat'), true);
  assert.equal(targetUrlMatchesAllowlist('https://www.doubao.com/chat/abc?from=app'), true);
  assert.equal(targetUrlMatchesAllowlist(
    'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html#home',
  ), true);
  assert.equal(targetUrlMatchesAllowlist('https://www.doubao.com/chat/'), false);
  assert.equal(targetUrlMatchesAllowlist('https://www.doubao.com.evil.example/chat/abc'), false);
  assert.equal(targetUrlMatchesAllowlist('https://www.doubao.com/flow-account/client-login'), false);
  assert.equal(targetUrlMatchesAllowlist(
    'chrome-extension://obkcimipmjdkghadnfcjojepocldegga/side_panel.html',
  ), false);
});

test('bounded isolated pipe evidence is structurally checked but cannot auto-promote Doubao', () => {
  assert.equal(validateDoubaoCandidateEvidence(evidence()).valid, true);
  const verified = verifyTransportEvidence(app, evidence());
  assert.equal(verified.verified, false);
  assert.equal(verified.candidateEvidenceValid, true);
  assert.equal(verified.strategyId, null);
  assert.equal(launchStrategyFor(app, verified).allowed, false);
  assert.match(verified.reason, /不会自动提升/u);
  const forgedPromotion = launchStrategyFor(app, {
    verified: true,
    appFingerprint: app.fingerprint,
    strategyId: 'wrapper-forwarded-pipe',
    transport: 'pipe',
  });
  assert.equal(forgedPromotion.allowed, false);
  assert.match(forgedPromotion.reason, /不允许自动启用/u);

  assert.equal(verifyTransportEvidence(app, evidence({userAuthorized: false})).verified, false);
  assert.equal(verifyTransportEvidence(app, evidence({isolatedUserDataDirForwarded: false})).verified, false);
  assert.equal(verifyTransportEvidence(app, evidence({appFingerprint: 'stale'})).verified, false);
  assert.equal(verifyTransportEvidence(app, evidence({samanFromChatPid: 999})).verified, false);
  assert.equal(verifyTransportEvidence(app, evidence({browserProduct: 'Chrome/999.0.0.0'})).verified, false);
  assert.equal(verifyTransportEvidence(app, evidence({pageTargetInventoryComplete: false})).verified, false);
  assert.equal(verifyTransportEvidence(app, evidence({nestedBrowserDebugArgument: false})).verified, false);
  assert.equal(verifyTransportEvidence(app, evidence({devToolsActivePortPresent: undefined})).verified, false);
  assert.equal(verifyTransportEvidence(app, evidence({
    pageTargets: [{type: 'page', url: 'https://evil.example/chat/abc'}],
  })).verified, false);
  for (const invalid of [
    evidence({schemaVersion: 99}),
    evidence({kind: 'other'}),
    evidence({status: 'exact-promotion-approved'}),
    evidence({cleanupVerified: false}),
    evidence({stockRestoreVerified: false}),
    evidence({noAutomaticPromotion: false}),
    evidence({capabilitiesElevated: true}),
  ]) {
    assert.equal(validateDoubaoCandidateEvidence(invalid).valid, false);
    assert.equal(verifyTransportEvidence(app, invalid).verified, false);
  }
});

test('port 49853 is permanently rejected and candidate loopback evidence cannot self-promote', () => {
  assert.equal(isForbiddenDebugEndpoint(app, {host: '127.0.0.1', port: 49853}), true);
  const rejected = verifyTransportEvidence(app, evidence({
    strategyId: 'launchservices-loopback',
    pipeConnected: undefined,
    wrapperForwardedDebugArgument: undefined,
    endpoint: {host: '127.0.0.1', port: 49853},
    ephemeralPort: true,
    endpointOwnedByNestedBrowser: true,
    jsonVersionBrowser: 'Chrome/135.0.7049.72',
  }));
  assert.equal(rejected.verified, false);

  const verifiedFallback = verifyTransportEvidence(app, evidence({
    strategyId: 'launchservices-loopback',
    pipeConnected: undefined,
    wrapperForwardedDebugArgument: undefined,
    endpoint: {host: '127.0.0.1', port: 52177},
    ephemeralPort: true,
    endpointOwnedByNestedBrowser: true,
    jsonVersionBrowser: 'Chrome/135.0.7049.72',
  }));
  assert.equal(verifiedFallback.verified, false);
  assert.equal(verifiedFallback.candidateEvidenceValid, true);
  const plan = launchStrategyFor(app, verifiedFallback);
  assert.equal(plan.allowed, false);
  assert.match(plan.reason, /不允许自动启用/u);
});
