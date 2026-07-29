import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {
  BUILT_IN_ADAPTERS,
  DOUBAO_ARTIFACT_KEYS,
  compatibilityFor,
  loadAdapters,
} from '../src/adapter.mjs';
import {SkinSessionManager} from '../src/cdp.mjs';
import {
  beginReviewedDoubaoSessionAttempt,
  bindReviewedDoubaoSessionChild,
  bindReviewedDoubaoSessionLoopback,
  bindReviewedDoubaoSessionTransport,
  cleanupReviewedDoubaoSessionAttempt,
  createReviewedDoubaoSessionPlan,
  DOUBAO_TARGET_ALLOWLIST,
  launchStrategyFor,
  reviewedDoubaoLoopbackLaunchOptions,
  reviewedDoubaoSessionLaunchOptions,
  validateDoubaoCandidateEvidence,
  verifyTransportEvidence,
} from '../src/transport-strategy.mjs';

const STATIC_ADAPTER = BUILT_IN_ADAPTERS.find((adapter) =>
  adapter.adapterId === 'doubao-macos-2.19.9-build-2.19.9-static');

// Production discovery derives a SHA-256 fingerprint.  Keep this fixture in
// the same representation so validation cannot accidentally accept a friendly
// label in test while rejecting the real app fingerprint format.
const APP_FINGERPRINT = '3c8fa2f2ee0afd2c9d4895e0548cddc2a0f19e244f33cb674e8b964b8d26d445';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function artifactHashes(adapter = STATIC_ADAPTER) {
  return Object.fromEntries(DOUBAO_ARTIFACT_KEYS.map((key) => [
    key,
    adapter.artifactSha256[key][0],
  ]));
}

function appFor(adapter = STATIC_ADAPTER, overrides = {}) {
  return {
    clientId: 'doubao',
    safeToLaunch: true,
    executable: '/Applications/Doubao.app/Contents/MacOS/Doubao',
    displayName: '豆包',
    bundleId: adapter.bundleId,
    teamId: adapter.teamId,
    version: adapter.versions[0],
    build: adapter.builds[0],
    cdHash: adapter.mainCDHash[0],
    nestedBrowser: {
      bundleId: adapter.nestedBundleId,
      teamId: adapter.nestedTeamId,
      cdHash: adapter.nestedCDHash[0],
      executable: '/Applications/Doubao.app/Contents/Helpers/Doubao Browser.app/Contents/MacOS/Doubao Browser',
    },
    chromium: adapter.chromiumFrameworkVersion,
    chromiumFrameworkVersion: adapter.chromiumFrameworkVersion,
    manifestCommit: adapter.manifestCommit[0],
    localExtension: {id: adapter.extensionId, version: adapter.extensionVersion[0]},
    artifactSha256: artifactHashes(adapter),
    fingerprint: APP_FINGERPRINT,
    // A caller-owned status must not be the source of a Doubao exact grant.
    transportVerification: {
      verified: false,
      appFingerprint: APP_FINGERPRINT,
      reason: '应用发现阶段尚未获得内部审计授权。',
    },
    signals: Object.fromEntries(adapter.requiredSignals.map((signal) => [
      signal,
      signal !== 'transportVerified',
    ])),
    ...overrides,
  };
}

function candidateEvidence(overrides = {}) {
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
    appFingerprint: APP_FINGERPRINT,
    app: {
      fingerprint: APP_FINGERPRINT,
      bundleId: STATIC_ADAPTER.bundleId,
      teamId: STATIC_ADAPTER.teamId,
      version: STATIC_ADAPTER.versions[0],
      build: STATIC_ADAPTER.builds[0],
      chromium: STATIC_ADAPTER.chromiumFrameworkVersion,
      mainCdHash: STATIC_ADAPTER.mainCDHash[0],
      nestedCdHash: STATIC_ADAPTER.nestedCDHash[0],
    },
    userAuthorized: true,
    isolatedProfile: true,
    isolatedUserDataDirForwarded: true,
    strategyId: 'wrapper-forwarded-pipe',
    mainPid: 10001,
    nestedBrowserPid: 10002,
    samanFromChatPid: 10001,
    browserProduct: `Chrome/${STATIC_ADAPTER.chromiumFrameworkVersion}`,
    pageTargets: [
      {type: 'page', url: 'https://www.doubao.com/chat/isolated-review-fixture'},
      {
        type: 'page',
        url: 'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html',
      },
    ],
    pageTargetInventoryComplete: true,
    processChain: [{pid: 10001, ppid: 1, role: 'main-wrapper'}],
    fixedDomCounts: [{body: 1, root: 1, chatInput: 0, chatInputInput: 0, messageTextContent: 0}],
    pipeConnected: true,
    wrapperForwardedDebugArgument: true,
    nestedBrowserDebugArgument: true,
    devToolsActivePortPresent: false,
    ...overrides,
  };
}

function staticBaseline(adapter = STATIC_ADAPTER) {
  return {
    auditKind: 'static-only',
    runtimeValidationPerformed: false,
    app: {
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
      chromiumFrameworkVersion: adapter.chromiumFrameworkVersion,
      manifestCommit: adapter.manifestCommit[0],
      localExtension: {id: adapter.extensionId, version: adapter.extensionVersion[0]},
    },
    integrity: {artifactSha256: artifactHashes(adapter)},
    targetAllowlist: [...DOUBAO_TARGET_ALLOWLIST],
    adapterDrift: {staticCandidateAdapter: adapter.adapterId},
  };
}

function exactAdapterFixture({staticDigest, candidateDigest, reviewDigest}) {
  const capabilities = ['background', 'palette', 'glass', 'composer'];
  return {
    ...STATIC_ADAPTER,
    adapterId: 'doubao-macos-2.19.9-build-2.19.9-exact-review-fixture',
    capabilities,
    validation: {
      status: 'runtime-verified',
      staticBaseline: 'qa/static.json',
      staticBaselineSha256: staticDigest,
      staticCandidateAdapterId: STATIC_ADAPTER.adapterId,
      candidateEvidence: 'qa/candidate.json',
      candidateEvidenceSha256: candidateDigest,
      candidateEvidenceKind: 'lingglow.doubao-isolated-qa-evidence',
      runtimeEvidenceRequired: true,
      runtimeEvidenceKind: 'lingglow.doubao-exact-adapter-review',
      runtimeEvidence: 'qa/review.json',
      runtimeEvidenceSha256: reviewDigest,
    },
  };
}

function reviewEvidence({adapter, candidateDigest, staticDigest, overrides = {}}) {
  return {
    schemaVersion: 1,
    kind: 'lingglow.doubao-exact-adapter-review',
    status: 'exact-promotion-approved',
    exactAdapterEnabled: true,
    cleanupVerified: true,
    stockRestoreVerified: true,
    adapterId: adapter.adapterId,
    staticCandidateAdapterId: STATIC_ADAPTER.adapterId,
    staticBaselineSha256: staticDigest,
    candidateEvidenceKind: 'lingglow.doubao-isolated-qa-evidence',
    candidateEvidenceSha256: candidateDigest,
    appFingerprint: APP_FINGERPRINT,
    app: staticBaseline().app,
    targetAllowlist: [...DOUBAO_TARGET_ALLOWLIST],
    strategyId: 'launchservices-loopback',
    transport: 'loopback-cdp',
    loopbackRuntimeCheck: {
      host: '127.0.0.1',
      portPolicy: 'random-high-port',
      browserProduct: `Chrome/${STATIC_ADAPTER.chromiumFrameworkVersion}`,
      pageUrl: 'doubao://doubao-chat/chat',
      viewportNonZero: true,
      mainArgumentForwarded: true,
      nestedArgumentForwarded: true,
    },
    capabilitiesVerified: [...adapter.capabilities],
    manualApproval: {decision: 'approved', reviewRecordId: 'fixture-only'},
    ...overrides,
  };
}

function writeJson(directory, name, value) {
  const text = JSON.stringify(value);
  fs.writeFileSync(path.join(directory, name), text, {mode: 0o600});
  return {text, digest: sha256(text)};
}

function createReviewedAdapterFixture(t, {reviewOverrides = {}, adapterOverrides = {}} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-doubao-exact-review-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const adaptersDir = path.join(root, 'adapters');
  const qaDir = path.join(root, 'qa');
  fs.mkdirSync(adaptersDir);
  fs.mkdirSync(qaDir);

  const staticRecord = writeJson(qaDir, 'static.json', staticBaseline());
  const candidateRecord = writeJson(qaDir, 'candidate.json', candidateEvidence());
  // The adapter ID and capability list are part of the review payload, so
  // generate it once before calculating the review digest.
  const provisional = exactAdapterFixture({
    staticDigest: staticRecord.digest,
    candidateDigest: candidateRecord.digest,
    reviewDigest: '0'.repeat(64),
  });
  const reviewRecord = writeJson(qaDir, 'review.json', reviewEvidence({
    adapter: provisional,
    candidateDigest: candidateRecord.digest,
    staticDigest: staticRecord.digest,
    overrides: reviewOverrides,
  }));
  const adapter = {
    ...exactAdapterFixture({
      staticDigest: staticRecord.digest,
      candidateDigest: candidateRecord.digest,
      reviewDigest: reviewRecord.digest,
    }),
    ...adapterOverrides,
  };
  fs.writeFileSync(path.join(adaptersDir, 'exact.json'), JSON.stringify(adapter), {mode: 0o600});
  return {root, adaptersDir, qaDir, adapter, staticRecord, candidateRecord, reviewRecord};
}

test('forged exact proof cannot elevate Doubao, while official identity gets only generic-safe transport', () => {
  assert.ok(STATIC_ADAPTER);
  const forged = {
    verified: true,
    appFingerprint: APP_FINGERPRINT,
    reviewedExactAdapterId: 'anything-a-caller-can-type',
    strategyId: 'wrapper-forwarded-pipe',
    transport: 'pipe',
  };
  const app = appFor(STATIC_ADAPTER, {
    transportVerification: forged,
    signals: Object.fromEntries(STATIC_ADAPTER.requiredSignals.map((name) => [name, true])),
  });
  // Only the zero-capability built-in is loaded — no digest-pinned exact file adapter.
  const compatibility = compatibilityFor(app, [STATIC_ADAPTER]);
  assert.equal(compatibility.level, 'generic-safe');
  assert.equal(compatibility.advancedAllowed, true);
  assert.equal(compatibility.adapter, null);
  assert.deepEqual(compatibility.capabilities, [
    'background', 'palette', 'glass', 'composer-avatar',
  ]);
  assert.match(compatibility.reason, /仍可.*兼容|仍可应用/u);
  assert.equal(launchStrategyFor(app, forged).allowed, false);
  const genericLaunch = launchStrategyFor(app, compatibility.transportVerification);
  assert.equal(genericLaunch.allowed, true);
  assert.equal(genericLaunch.genericSafeFallback, true);
});

test('a newly signed Doubao version stays applicable through the bounded generic-safe channel', () => {
  const app = appFor(STATIC_ADAPTER, {
    version: '2.20.0',
    build: '2.20.0',
    fingerprint: '4'.repeat(64),
    signals: {appUrlEntry: true},
  });
  const compatibility = compatibilityFor(app, [STATIC_ADAPTER]);
  assert.equal(compatibility.level, 'generic-safe');
  assert.equal(compatibility.advancedAllowed, true);
  assert.match(compatibility.reason, /版本已更新/u);
  assert.deepEqual(compatibility.capabilities, [
    'background', 'palette', 'glass', 'composer-avatar',
  ]);
  assert.deepEqual(compatibility.targetAllowlist, DOUBAO_TARGET_ALLOWLIST);
  const strategy = launchStrategyFor(app, compatibility.transportVerification);
  assert.equal(strategy.allowed, true);
  assert.equal(strategy.strategyId, 'launchservices-loopback');
  assert.equal(strategy.genericSafeFallback, true);
});

test('candidate evidence remains non-promoting and cannot launch even with a forged exact-shaped object', async () => {
  const app = appFor();
  const candidate = candidateEvidence();
  assert.equal(validateDoubaoCandidateEvidence(candidate).valid, true);
  const candidateStatus = verifyTransportEvidence(app, candidate);
  assert.equal(candidateStatus.verified, false);
  assert.equal(launchStrategyFor(app, candidateStatus).allowed, false);

  const forged = {
    verified: true,
    appFingerprint: APP_FINGERPRINT,
    reviewedExactAdapterId: 'doubao-macos-2.19.9-build-2.19.9-exact-review-fixture',
    strategyId: 'wrapper-forwarded-pipe',
    transport: 'pipe',
  };
  assert.equal(launchStrategyFor(app, forged).allowed, false);

  const manager = new SkinSessionManager();
  let spawned = false;
  manager.spawnPipe = async () => {
    spawned = true;
    throw new Error('the test must never spawn Doubao');
  };
  await assert.rejects(() => manager.launch({
    app: {...app, transportVerification: forged},
    profile: {advanced: {enabled: true}},
    compatibility: {advancedAllowed: true, transportVerification: forged},
  }), /豆包|自动启用|传输/u);
  assert.equal(spawned, false);
});

test('only a digest-pinned static baseline plus candidate plus manual review can promote Doubao exact loopback', (t) => {
  const fixture = createReviewedAdapterFixture(t);
  const accepted = loadAdapters(fixture.adaptersDir).find(({adapterId}) =>
    adapterId === fixture.adapter.adapterId);

  // This is intentionally a failing-first contract.  The implementation must
  // validate all three digest-pinned documents, mint a non-forgeable transport
  // verification object, and keep that object associated with this exact
  // adapter rather than accepting a caller-provided `{verified: true}`.
  assert.ok(accepted, 'exact adapter requires all three reviewed evidence documents');
  const compatibility = compatibilityFor(appFor(accepted), [accepted]);
  assert.equal(compatibility.level, 'exact', compatibility.reason);
  assert.equal(compatibility.advancedAllowed, true);
  assert.equal(compatibility.adapter?.adapterId, fixture.adapter.adapterId);
  assert.equal(compatibility.transportVerification?.verified, true);
  assert.equal(compatibility.transportVerification?.reviewedExactAdapterId, fixture.adapter.adapterId);
  assert.equal(launchStrategyFor(appFor(accepted), compatibility.transportVerification).allowed, true);

  // A serialized/spread clone has exactly the same visible values, but no
  // longer has the in-memory approval identity minted while loading adapters.
  const copiedVerification = {...compatibility.transportVerification};
  assert.equal(launchStrategyFor(appFor(accepted), copiedVerification).allowed, false);
});

test('reviewed Doubao session plans keep fresh private profiles, reject clones, and require child plus handle proof before cleanup', async (t) => {
  const fixture = createReviewedAdapterFixture(t);
  const accepted = loadAdapters(fixture.adaptersDir).find(({adapterId}) =>
    adapterId === fixture.adapter.adapterId);
  const exactApp = appFor(accepted);
  const compatibility = compatibilityFor(exactApp, [accepted]);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-doubao-production-plan-'));
  t.after(() => fs.rmSync(parent, {recursive: true, force: true}));

  const plan = createReviewedDoubaoSessionPlan(
    exactApp,
    compatibility.transportVerification,
    {
      temporaryDirectory: parent,
      baseEnvironment: {
        HOME: os.homedir(),
        USER: 'reviewed-user',
        PATH: '/usr/bin:/bin',
        LANG: 'zh_CN.UTF-8',
        OPENAI_API_KEY: 'must-not-cross',
        DODO_PAYMENTS_API_KEY: 'must-not-cross',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
      },
    },
  );
  assert.ok(plan);
  assert.deepEqual(Object.keys(plan).sort(), [
    'appFingerprint',
    'clientId',
    'reviewedExactAdapterId',
  ]);
  assert.equal(
    createReviewedDoubaoSessionPlan(exactApp, {...compatibility.transportVerification}),
    null,
    'a serialised verification cannot mint a production plan',
  );
  assert.equal(
    await beginReviewedDoubaoSessionAttempt({...plan}, exactApp, compatibility.transportVerification),
    null,
    'a copied plan cannot materialize argv, environment, or a profile',
  );

  const firstAttempt = await beginReviewedDoubaoSessionAttempt(
    plan,
    exactApp,
    compatibility.transportVerification,
  );
  assert.ok(firstAttempt);
  const firstOptions = reviewedDoubaoSessionLaunchOptions(firstAttempt);
  assert.equal(firstOptions.argumentsList[0], '--remote-debugging-pipe');
  assert.equal(firstOptions.argumentsList[1], `--user-data-dir=${firstOptions.userDataDirectory}`);
  assert.match(firstOptions.argumentsList[2], /^--saman-from-chat=\d+$/u);
  assert.equal(firstOptions.argumentsList.length, 3);
  assert.match(firstOptions.argumentsList[2], /^--saman-from-chat=\d+$/u);
  assert.deepEqual(firstOptions.environment, {
    HOME: os.homedir(),
    USER: 'reviewed-user',
    PATH: '/usr/bin:/bin',
    LANG: 'zh_CN.UTF-8',
  });
  assert.equal(firstOptions.environment.OPENAI_API_KEY, undefined);
  assert.equal(firstOptions.environment.DODO_PAYMENTS_API_KEY, undefined);
  assert.equal(firstOptions.environment.HTTPS_PROXY, undefined);
  assert.equal(fs.lstatSync(firstOptions.userDataDirectory).mode & 0o777, 0o700);

  const child = {pid: 91001, exitCode: null, signalCode: null};
  const transport = {closed: false};
  assert.equal(bindReviewedDoubaoSessionChild(firstAttempt, child), true);
  assert.equal(bindReviewedDoubaoSessionTransport(firstAttempt, transport), true);
  await assert.rejects(
    () => cleanupReviewedDoubaoSessionAttempt(firstAttempt),
    /仍在运行|Pipe/u,
  );
  assert.equal(fs.existsSync(firstOptions.userDataDirectory), true);

  child.exitCode = 0;
  transport.closed = true;
  let handleProofCalled = false;
  const cleanup = await cleanupReviewedDoubaoSessionAttempt(firstAttempt, {
    waitForNoHandles: async (directory) => {
      handleProofCalled = true;
      assert.equal(directory, firstOptions.userDataDirectory);
      return [];
    },
  });
  assert.equal(handleProofCalled, true);
  assert.equal(cleanup.removed, true);
  assert.equal(fs.existsSync(firstOptions.userDataDirectory), false);

  // A clean retry does not reuse the previous profile.  It must construct a
  // second fresh 0700 directory from the same opaque reviewed plan.
  const retryAttempt = await beginReviewedDoubaoSessionAttempt(
    plan,
    exactApp,
    compatibility.transportVerification,
  );
  const retryOptions = reviewedDoubaoSessionLaunchOptions(retryAttempt);
  assert.notEqual(retryOptions.userDataDirectory, firstOptions.userDataDirectory);
  await cleanupReviewedDoubaoSessionAttempt(retryAttempt, {
    waitForNoHandles: async () => [],
  });
  assert.equal(fs.existsSync(retryOptions.userDataDirectory), false);
});

test('reviewed Doubao plans mint only random local loopback launch arguments', async (t) => {
  const fixture = createReviewedAdapterFixture(t);
  const accepted = loadAdapters(fixture.adaptersDir).find(({adapterId}) =>
    adapterId === fixture.adapter.adapterId);
  const exactApp = appFor(accepted);
  const compatibility = compatibilityFor(exactApp, [accepted]);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-doubao-manager-plan-'));
  t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  const plan = createReviewedDoubaoSessionPlan(
    exactApp,
    compatibility.transportVerification,
    {
      temporaryDirectory: parent,
      baseEnvironment: {
        HOME: os.homedir(),
        USER: 'manager-review',
        PATH: '/usr/bin:/bin',
        OPENAI_API_KEY: 'must-not-cross',
        DODO_PAYMENTS_API_KEY: 'must-not-cross',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
      },
    },
  );
  const attempt = await beginReviewedDoubaoSessionAttempt(
    plan,
    exactApp,
    compatibility.transportVerification,
  );
  const options = reviewedDoubaoLoopbackLaunchOptions(attempt, {port: 49152});
  assert.deepEqual(options.argumentsList, [
    '--remote-debugging-port=49152',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${options.userDataDirectory}`,
  ]);
  assert.deepEqual(options.environment, {
    HOME: os.homedir(),
    USER: 'manager-review',
    PATH: '/usr/bin:/bin',
  });
  assert.equal(options.environment.OPENAI_API_KEY, undefined);
  const transport = {closed: false, close() { this.closed = true; }};
  assert.equal(bindReviewedDoubaoSessionLoopback(attempt, {
    mainPid: 91001,
    nestedBrowserPid: 91002,
    port: 49152,
    transport,
  }), true);
  transport.close();
  await cleanupReviewedDoubaoSessionAttempt(attempt, {
    waitForNoHandles: async () => [],
  });
});

test('a tampered candidate or review binding never loads an exact Doubao adapter', (t) => {
  const cases = [
    {
      name: 'review binds a different candidate digest',
      reviewOverrides: {candidateEvidenceSha256: 'f'.repeat(64)},
    },
    {
      name: 'review binds a different app fingerprint',
      reviewOverrides: {appFingerprint: 'other-app'},
    },
    {
      name: 'review asks for a non-loopback transport',
      reviewOverrides: {transport: 'pipe'},
    },
    {
      name: 'review widens an allowlist target',
      reviewOverrides: {
        targetAllowlist: [...DOUBAO_TARGET_ALLOWLIST, 'https://www.doubao.com/*'],
      },
    },
  ];
  for (const item of cases) {
    const fixture = createReviewedAdapterFixture(t, item);
    assert.equal(
      loadAdapters(fixture.adaptersDir).some(({adapterId}) => adapterId === fixture.adapter.adapterId),
      false,
      item.name,
    );
  }
});

test('missing candidate digest metadata cannot turn a reviewed-looking adapter into exact', (t) => {
  const fixture = createReviewedAdapterFixture(t);
  const malformed = {
    ...fixture.adapter,
    validation: {...fixture.adapter.validation},
  };
  // The exact release contract requires this binding; a review path without
  // it is not a substitute for candidate isolation evidence.
  delete malformed.validation.candidateEvidenceSha256;
  fs.writeFileSync(path.join(fixture.adaptersDir, 'exact.json'), JSON.stringify(malformed), {mode: 0o600});
  assert.equal(
    loadAdapters(fixture.adaptersDir).some(({adapterId}) => adapterId === fixture.adapter.adapterId),
    false,
  );
});
