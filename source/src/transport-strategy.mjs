import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DOUBAO_QA_CANDIDATE_STATUS,
  DOUBAO_QA_DOM_PROBE_SCOPE,
  DOUBAO_QA_EVIDENCE_KIND,
  DOUBAO_QA_EVIDENCE_SCHEMA_VERSION,
  DOUBAO_QA_ISOLATION_SCOPE,
} from './doubao-qa-policy.mjs';
import {
  createIsolatedDoubaoUserDataDirectory,
  doubaoIsolatedEnvironmentSnapshot,
  doubaoIsolatedLaunchArguments,
  isolatedDoubaoEnvironment,
  removeIsolatedDoubaoProfileAfterProof,
} from './doubao-isolation.mjs';

const DOUBAO_EXTENSION_ID = 'obkcimipmjdkghadnfcjojepocldeggd';

// A plain JSON `{verified: true}` must never become a permission to start
// Doubao with a debugging pipe.  Exact Doubao adapters create one of these
// objects only after their static snapshot, isolated candidate evidence, and
// human review record have all been digest-verified by adapter.mjs.  Keeping
// membership private makes copies, deserialised state, and caller-supplied
// lookalikes fail closed.
const reviewedDoubaoVerifications = new WeakSet();
// A fast Doubao release may not yet have a digest-pinned DOM review.  It can
// still receive the fixed generic-safe CSS layer after the installed app has
// passed the official publisher/signature gate.  This opaque authorization
// permits only the already bounded random-loopback transport; it never grants
// exact adapter capabilities and cannot be forged through JSON.
const genericSafeDoubaoAuthorizations = new WeakSet();

// A reviewed transport verification is necessary but not by itself a launch
// descriptor.  These maps bind a one-process session plan to that private
// verification identity.  JSON, object spreads, and caller-provided lookalikes
// lose the membership marker and cannot reach the production Pipe path.
const reviewedDoubaoSessionPlans = new WeakMap();
const reviewedDoubaoSessionAttempts = new WeakMap();

export const CODEX_TARGET_ALLOWLIST = Object.freeze([
  'app://-/index.html',
]);

export const DOUBAO_TARGET_ALLOWLIST = Object.freeze([
  // Primary desktop UI surface (what users actually see in Doubao.app).
  'doubao://doubao-chat/*',
  'chrome://doubao-chat/*',
  `chrome-extension://${DOUBAO_EXTENSION_ID}/side_panel.html`,
  'https://www.doubao.com/chat/*',
]);

export const TRANSPORT_POLICIES = Object.freeze({
  codex: Object.freeze({
    clientId: 'codex',
    preferred: 'direct-pipe',
    verifiedByDefault: true,
    forbiddenLoopbackPorts: Object.freeze([]),
    candidates: Object.freeze([
      Object.freeze({id: 'direct-pipe', transport: 'pipe', priority: 1, executionImplemented: true}),
    ]),
  }),
  workbuddy: Object.freeze({
    clientId: 'workbuddy',
    preferred: 'direct-pipe',
    verifiedByDefault: true,
    forbiddenLoopbackPorts: Object.freeze([]),
    candidates: Object.freeze([
      Object.freeze({id: 'direct-pipe', transport: 'pipe', priority: 1, executionImplemented: true}),
    ]),
  }),
  doubao: Object.freeze({
    clientId: 'doubao',
    preferred: 'launchservices-loopback',
    verifiedByDefault: false,
    // 49853 is Doubao's local share-plugin service in the audited builds. It
    // answers neither /json/version nor the CDP protocol and must never be
    // promoted to a debugging endpoint.
    forbiddenLoopbackPorts: Object.freeze([49853]),
    candidates: Object.freeze([
      Object.freeze({
        id: 'launchservices-loopback',
        transport: 'loopback-cdp',
        priority: 1,
        executionImplemented: true,
        requiresIsolatedVerification: true,
      }),
      Object.freeze({
        id: 'wrapper-forwarded-pipe',
        transport: 'pipe',
        priority: 2,
        executionImplemented: false,
        evidenceOnly: true,
      }),
    ]),
  }),
});

function clientIdOf(value) {
  return typeof value === 'string' ? value : value?.clientId;
}

export function transportPolicyFor(value) {
  return TRANSPORT_POLICIES[clientIdOf(value)] ?? null;
}

export function candidateLaunchStrategies(value) {
  const policy = transportPolicyFor(value);
  return policy ? policy.candidates.map((candidate) => ({...candidate})) : [];
}

function normalizedBaseUrl(value) {
  try {
    const url = new URL(String(value));
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

export function targetUrlMatchesAllowlist(value, allowlist = DOUBAO_TARGET_ALLOWLIST) {
  if (!Array.isArray(allowlist) || !allowlist.length) return false;
  const url = normalizedBaseUrl(value);
  if (!url || url.username || url.password) return false;
  return allowlist.some((pattern) => {
    if (pattern === CODEX_TARGET_ALLOWLIST[0]) {
      return url.protocol === 'app:' && url.hostname === '-' && url.port === '' &&
        url.pathname === '/index.html';
    }
    if (pattern === 'doubao://doubao-chat/*') {
      return url.protocol === 'doubao:' && url.hostname === 'doubao-chat' && url.port === '';
    }
    if (pattern === 'chrome://doubao-chat/*') {
      return url.protocol === 'chrome:' && url.hostname === 'doubao-chat' && url.port === '' &&
        (url.pathname === '/chat' || url.pathname.startsWith('/chat/'));
    }
    if (pattern === `chrome-extension://${DOUBAO_EXTENSION_ID}/side_panel.html`) {
      return url.protocol === 'chrome-extension:' && url.hostname === DOUBAO_EXTENSION_ID &&
        url.port === '' && url.pathname === '/side_panel.html';
    }
    if (pattern === 'https://www.doubao.com/chat/*') {
      return url.protocol === 'https:' && url.hostname === 'www.doubao.com' && url.port === '' &&
        url.pathname.startsWith('/chat/') && url.pathname.length > '/chat/'.length;
    }
    return false;
  });
}

export function isForbiddenDebugEndpoint(value, endpoint) {
  const policy = transportPolicyFor(value);
  if (!policy || !endpoint || typeof endpoint !== 'object') return false;
  const host = String(endpoint.host ?? '');
  const port = Number(endpoint.port);
  return ['127.0.0.1', 'localhost', '::1'].includes(host) &&
    policy.forbiddenLoopbackPorts.includes(port);
}

function failed(app, reason) {
  return Object.freeze({
    clientId: app?.clientId ?? null,
    verified: false,
    strategyId: null,
    transport: null,
    appFingerprint: app?.fingerprint ?? null,
    reason,
  });
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 1;
}

function validFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function validAdapterId(value) {
  return typeof value === 'string' && /^doubao-macos-[a-zA-Z0-9._-]{1,180}$/u.test(value);
}

function sameStrings(first, second) {
  return Array.isArray(first) && Array.isArray(second) && first.length === second.length &&
    first.every((item, index) => item === second[index]);
}

function sameStringSet(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
    return false;
  }
  const firstSet = new Set(first);
  const secondSet = new Set(second);
  return firstSet.size === first.length && secondSet.size === second.length &&
    firstSet.size === secondSet.size && [...firstSet].every((item) => secondSet.has(item));
}

const DOUBAO_IDENTITY_ARTIFACT_KEYS = Object.freeze([
  'mainExecutable',
  'mainManifest',
  'nestedExecutable',
  'chromiumFramework',
  'extensionManifest',
  'sidePanelHtml',
  'sidePanelJavaScript',
  'sidePanelStylesheet',
  'designTokensStylesheet',
]);

function validHashArray(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash));
}

function validCdHashArray(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((hash) => typeof hash === 'string' && /^[a-f0-9]{40}$/u.test(hash));
}

/**
 * Stable install identity for reviewed Doubao transport tokens.
 * Host-local path/inode fingerprints must never gate multi-machine product
 * launches; session plans still use live app.fingerprint mid-session.
 */
export function normalizeDoubaoAppIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  if (typeof identity.bundleId !== 'string' || typeof identity.teamId !== 'string' ||
      typeof identity.nestedBundleId !== 'string' || typeof identity.nestedTeamId !== 'string' ||
      typeof identity.chromiumFrameworkVersion !== 'string' ||
      !/^\d+\.\d+\.\d+\.\d+$/u.test(identity.chromiumFrameworkVersion) ||
      typeof identity.extensionId !== 'string' ||
      !Array.isArray(identity.versions) || !identity.versions.length ||
      !identity.versions.every((item) => typeof item === 'string' && item.length > 0) ||
      !Array.isArray(identity.builds) || !identity.builds.length ||
      !identity.builds.every((item) => typeof item === 'string' && item.length > 0) ||
      !validCdHashArray(identity.mainCDHash) || !validCdHashArray(identity.nestedCDHash) ||
      !validCdHashArray(identity.manifestCommit) ||
      !Array.isArray(identity.extensionVersion) || !identity.extensionVersion.length ||
      !identity.extensionVersion.every((item) => typeof item === 'string' && item.length > 0) ||
      !identity.artifactSha256 || typeof identity.artifactSha256 !== 'object' ||
      !sameStringSet(Object.keys(identity.artifactSha256), DOUBAO_IDENTITY_ARTIFACT_KEYS) ||
      !DOUBAO_IDENTITY_ARTIFACT_KEYS.every((key) => validHashArray(identity.artifactSha256[key]))) {
    return null;
  }
  return Object.freeze({
    bundleId: identity.bundleId,
    teamId: identity.teamId,
    nestedBundleId: identity.nestedBundleId,
    nestedTeamId: identity.nestedTeamId,
    chromiumFrameworkVersion: identity.chromiumFrameworkVersion,
    extensionId: identity.extensionId,
    versions: Object.freeze([...new Set(identity.versions)]),
    builds: Object.freeze([...new Set(identity.builds)]),
    mainCDHash: Object.freeze([...new Set(identity.mainCDHash)]),
    nestedCDHash: Object.freeze([...new Set(identity.nestedCDHash)]),
    manifestCommit: Object.freeze([...new Set(identity.manifestCommit)]),
    extensionVersion: Object.freeze([...new Set(identity.extensionVersion)]),
    artifactSha256: Object.freeze(Object.fromEntries(DOUBAO_IDENTITY_ARTIFACT_KEYS.map((key) => [
      key,
      Object.freeze([...new Set(identity.artifactSha256[key])]),
    ]))),
  });
}

export function doubaoAppIdentityFromAdapter(adapter) {
  if (!adapter || adapter.clientId !== 'doubao') return null;
  return normalizeDoubaoAppIdentity({
    bundleId: adapter.bundleId,
    teamId: adapter.teamId,
    nestedBundleId: adapter.nestedBundleId,
    nestedTeamId: adapter.nestedTeamId,
    chromiumFrameworkVersion: adapter.chromiumFrameworkVersion,
    extensionId: adapter.extensionId,
    versions: adapter.versions,
    builds: adapter.builds,
    mainCDHash: adapter.mainCDHash,
    nestedCDHash: adapter.nestedCDHash,
    manifestCommit: adapter.manifestCommit,
    extensionVersion: adapter.extensionVersion,
    artifactSha256: adapter.artifactSha256,
  });
}

export function liveAppMatchesDoubaoIdentity(app, identity) {
  const normalized = normalizeDoubaoAppIdentity(identity);
  if (!app || app.clientId !== 'doubao' || !normalized) return false;
  const chromium = app.chromium ?? app.chromiumFrameworkVersion;
  return app.bundleId === normalized.bundleId &&
    app.teamId === normalized.teamId &&
    normalized.versions.includes(app.version) &&
    normalized.builds.includes(app.build) &&
    normalized.mainCDHash.includes(app.cdHash) &&
    app.nestedBrowser?.bundleId === normalized.nestedBundleId &&
    app.nestedBrowser?.teamId === normalized.nestedTeamId &&
    normalized.nestedCDHash.includes(app.nestedBrowser?.cdHash) &&
    chromium === normalized.chromiumFrameworkVersion &&
    normalized.manifestCommit.includes(app.manifestCommit) &&
    app.localExtension?.id === normalized.extensionId &&
    normalized.extensionVersion.includes(app.localExtension?.version) &&
    DOUBAO_IDENTITY_ARTIFACT_KEYS.every((key) =>
      normalized.artifactSha256[key].includes(app.artifactSha256?.[key]));
}

// This factory is intentionally useful only to the local adapter verifier.
// It does not inspect runtime evidence, launch apps, or accept a candidate
// observation as input.  Callers must first establish the review chain.
// Host path/inode fingerprints are audit-only on candidate evidence; product
// launch binds to digest-locked stable identity so the same exact Adapter can
// serve every install of that Doubao build.
export function createReviewedDoubaoTransportVerification({
  appIdentity,
  adapterId,
  strategyId,
  targetAllowlist,
  capabilities,
  // Accepted for backward-compatible call sites / audit display only.
  appFingerprint = null,
} = {}) {
  const policy = TRANSPORT_POLICIES.doubao;
  const candidate = policy.candidates.find(({id}) => id === strategyId);
  const identity = normalizeDoubaoAppIdentity(appIdentity);
  if (!identity || !validAdapterId(adapterId) ||
      !candidate || !candidate.executionImplemented ||
      !Array.isArray(targetAllowlist) || !targetAllowlist.length ||
      !targetAllowlist.every((url) => typeof url === 'string') ||
      !Array.isArray(capabilities) || !capabilities.length ||
      !capabilities.every((capability) => typeof capability === 'string')) {
    return null;
  }
  const verification = Object.freeze({
    clientId: 'doubao',
    verified: true,
    reviewedExactAdapterId: adapterId,
    strategyId: candidate.id,
    transport: candidate.transport,
    appIdentity: identity,
    // Live sessions still capture the host fingerprint; this field is only a
    // non-authoritative audit echo of the QA install that produced evidence.
    appFingerprint: validFingerprint(appFingerprint) ? appFingerprint : null,
    targetAllowlist: Object.freeze([...targetAllowlist]),
    capabilities: Object.freeze([...capabilities]),
    reason: '豆包 exact Adapter 的静态基线、隔离候选证据和人工审核记录均已摘要锁定。',
  });
  reviewedDoubaoVerifications.add(verification);
  return verification;
}

function reviewedDoubaoVerificationMatches(app, verification) {
  const policy = transportPolicyFor(app);
  const reviewedCandidate = policy?.candidates.find(({id}) => id === verification?.strategyId);
  return Boolean(
    app?.clientId === 'doubao' &&
    verification && reviewedDoubaoVerifications.has(verification) &&
    verification.clientId === 'doubao' &&
    verification.verified === true &&
    liveAppMatchesDoubaoIdentity(app, verification.appIdentity) &&
    validAdapterId(verification.reviewedExactAdapterId) &&
    reviewedCandidate?.executionImplemented === true &&
    reviewedCandidate?.transport === verification.transport &&
    sameStrings(verification.targetAllowlist, DOUBAO_TARGET_ALLOWLIST) &&
    Array.isArray(verification.capabilities) && verification.capabilities.length
  );
}

function genericSafeDoubaoAuthorizationMatches(app, authorization) {
  return Boolean(
    authorization && genericSafeDoubaoAuthorizations.has(authorization) &&
    app?.clientId === 'doubao' && app.safeToLaunch === true &&
    app.bundleId === 'com.bot.pc.doubao' && app.teamId === '96L78H6LMH' &&
    app.nestedBrowser?.bundleId === 'com.bot.pc.doubao.browser' &&
    app.nestedBrowser?.teamId === '96L78H6LMH' &&
    app.fingerprint === authorization.appFingerprint &&
    authorization.strategyId === 'launchservices-loopback' &&
    authorization.transport === 'loopback-cdp' &&
    sameStrings(authorization.targetAllowlist, DOUBAO_TARGET_ALLOWLIST)
  );
}

export function createGenericSafeDoubaoTransportAuthorization(app) {
  if (!app || app.clientId !== 'doubao' || app.safeToLaunch !== true ||
      app.bundleId !== 'com.bot.pc.doubao' || app.teamId !== '96L78H6LMH' ||
      app.nestedBrowser?.bundleId !== 'com.bot.pc.doubao.browser' ||
      app.nestedBrowser?.teamId !== '96L78H6LMH' ||
      app.signatureValid === false || app.nestedBrowser?.signatureValid === false ||
      typeof app.fingerprint !== 'string' || !app.fingerprint) return null;
  const authorization = Object.freeze({
    verified: false,
    genericSafe: true,
    clientId: 'doubao',
    appFingerprint: app.fingerprint,
    strategyId: 'launchservices-loopback',
    transport: 'loopback-cdp',
    targetAllowlist: DOUBAO_TARGET_ALLOWLIST,
    reason: '官方签名豆包版本尚未完成精确适配；仅开放固定页面的兼容视觉层。',
  });
  genericSafeDoubaoAuthorizations.add(authorization);
  return authorization;
}

function doubaoSessionError(message, code = 'DOUBAO_SESSION_UNVERIFIED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function reviewedDoubaoSessionPlanMatches(plan, app, verification) {
  const state = reviewedDoubaoSessionPlans.get(plan);
  return Boolean(
    state && plan &&
    reviewedDoubaoVerificationMatches(app, verification) &&
    state.verification === verification &&
    state.appFingerprint === app?.fingerprint &&
    state.reviewedExactAdapterId === verification.reviewedExactAdapterId &&
    plan.clientId === 'doubao' &&
    plan.appFingerprint === state.appFingerprint &&
    plan.reviewedExactAdapterId === state.reviewedExactAdapterId &&
    state.closed !== true
  );
}

// This factory intentionally returns an opaque authorization object rather
// than argv/env/profile values.  It can only be created from the exact object
// minted after adapter.mjs validates all digest-pinned review records.
export function createReviewedDoubaoSessionPlan(app, verification, {
  baseEnvironment = process.env,
  temporaryDirectory,
} = {}) {
  if (!reviewedDoubaoVerificationMatches(app, verification)) return null;
  const plan = Object.freeze({
    clientId: 'doubao',
    appFingerprint: app.fingerprint,
    reviewedExactAdapterId: verification.reviewedExactAdapterId,
  });
  reviewedDoubaoSessionPlans.set(plan, {
    verification,
    appFingerprint: app.fingerprint,
    reviewedExactAdapterId: verification.reviewedExactAdapterId,
    // Capture only the pre-approved environment keys.  The parent process and
    // its credentials are never retained as a plan dependency.
    environment: doubaoIsolatedEnvironmentSnapshot(baseEnvironment),
    temporaryDirectory,
    activeAttempt: null,
    closed: false,
  });
  return plan;
}

// A clean single-instance retry is a new launch, so it always receives a
// brand-new private profile.  A plan can have only one live attempt at a time;
// callers must prove cleanup before trying again.
export async function beginReviewedDoubaoSessionAttempt(plan, app, verification) {
  if (!reviewedDoubaoSessionPlanMatches(plan, app, verification)) return null;
  const planState = reviewedDoubaoSessionPlans.get(plan);
  if (planState.activeAttempt) return null;
  let userDataDirectory = null;
  try {
    // Production skin apply must paint the user's real Doubao profile.  Isolated
    // temp profiles are only for QA evidence generation; they never look like the
    // window the user actually uses.
    // Prefer the real profile for normal apply sessions.  QA/unit plans that
    // set temporaryDirectory keep using disposable isolated profiles.
    const preferStockProfile = process.env.LINGGLOW_DOUBAO_USE_ISOLATED_PROFILE !== '1' &&
      planState.temporaryDirectory === undefined;
    if (preferStockProfile) {
      const stock = path.join(os.homedir(), 'Library', 'Application Support', 'Doubao');
      if (!fs.existsSync(stock)) {
        throw doubaoSessionError(`豆包用户数据目录不存在：${stock}`);
      }
      userDataDirectory = stock;
    } else {
      userDataDirectory = createIsolatedDoubaoUserDataDirectory(
        planState.temporaryDirectory === undefined
          ? undefined
          : {temporaryDirectory: planState.temporaryDirectory},
      );
    }
    const argumentsList = doubaoIsolatedLaunchArguments(userDataDirectory, {
      samanFromChatPid: process.pid,
      allowStockProfile: preferStockProfile,
    });
    const environment = isolatedDoubaoEnvironment(planState.environment, {
      userDataDirectory,
      allowStockProfile: preferStockProfile,
    });
    const attempt = Object.freeze({
      clientId: 'doubao',
      appFingerprint: planState.appFingerprint,
      reviewedExactAdapterId: planState.reviewedExactAdapterId,
    });
    reviewedDoubaoSessionAttempts.set(attempt, {
      plan,
      userDataDirectory,
      argumentsList,
      environment,
      child: null,
      transport: null,
      state: 'prepared',
      cleanupPromise: null,
      cleanupResult: null,
    });
    planState.activeAttempt = attempt;
    return attempt;
  } catch (error) {
    // At this point no child handle was recorded.  Still require the same
    // empty-handle proof before deleting a fresh profile; otherwise preserve
    // the private 0700 directory for manual inspection instead of guessing.
    if (userDataDirectory) {
      try {
        await removeIsolatedDoubaoProfileAfterProof({userDataDirectory});
      } catch (cleanupError) {
        throw doubaoSessionError(
          `${error.message}; 隔离 profile 创建失败后的清理未获证明：${cleanupError.message}`,
          'DOUBAO_SESSION_CLEANUP_UNPROVEN',
        );
      }
    }
    throw error;
  }
}

export function reviewedDoubaoSessionLaunchOptions(attempt) {
  const state = reviewedDoubaoSessionAttempts.get(attempt);
  if (!state || state.state !== 'prepared') return null;
  return Object.freeze({
    argumentsList: state.argumentsList,
    environment: state.environment,
    userDataDirectory: state.userDataDirectory,
  });
}

export function reviewedDoubaoLoopbackLaunchOptions(attempt, {port} = {}) {
  const state = reviewedDoubaoSessionAttempts.get(attempt);
  if (!state || state.state !== 'prepared' || !Number.isInteger(port) ||
      port < 1024 || port > 65535 || port === 49853) return null;
  const stockProfile = path.join(os.homedir(), 'Library', 'Application Support', 'Doubao');
  const argumentsList = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
  ];
  if (state.userDataDirectory !== stockProfile) {
    argumentsList.push(`--user-data-dir=${state.userDataDirectory}`);
  }
  return Object.freeze({
    argumentsList: Object.freeze(argumentsList),
    environment: state.environment,
    userDataDirectory: state.userDataDirectory,
    endpoint: Object.freeze({host: '127.0.0.1', port}),
  });
}

export function bindReviewedDoubaoSessionLoopback(attempt, {
  mainPid,
  nestedBrowserPid,
  port,
  transport,
} = {}) {
  const state = reviewedDoubaoSessionAttempts.get(attempt);
  if (!state || state.state !== 'prepared' || state.transport ||
      !positiveInteger(mainPid) || !positiveInteger(nestedBrowserPid) ||
      mainPid === nestedBrowserPid || !Number.isInteger(port) ||
      port < 1024 || port > 65535 || port === 49853 ||
      !transport || typeof transport !== 'object') return false;
  state.mainPid = mainPid;
  state.nestedBrowserPid = nestedBrowserPid;
  state.loopbackPort = port;
  state.transport = transport;
  state.state = 'loopback-active';
  return true;
}

export function bindReviewedDoubaoSessionChild(attempt, child) {
  const state = reviewedDoubaoSessionAttempts.get(attempt);
  if (!state || state.state !== 'prepared' || state.child ||
      !child || typeof child !== 'object' || !Number.isInteger(child.pid) || child.pid <= 1) {
    return false;
  }
  state.child = child;
  state.state = 'spawned';
  return true;
}

export function bindReviewedDoubaoSessionTransport(attempt, transport) {
  const state = reviewedDoubaoSessionAttempts.get(attempt);
  if (!state || state.state !== 'spawned' || state.transport ||
      !transport || typeof transport !== 'object') return false;
  state.transport = transport;
  return true;
}

export async function cleanupReviewedDoubaoSessionAttempt(attempt, {
  waitForNoHandles,
} = {}) {
  const state = reviewedDoubaoSessionAttempts.get(attempt);
  if (!state) {
    throw doubaoSessionError('豆包隔离会话不是当前已审核计划创建的实例。');
  }
  if (state.state === 'cleaned') return state.cleanupResult;
  if (state.cleanupPromise) return state.cleanupPromise;
  const planState = reviewedDoubaoSessionPlans.get(state.plan);
  if (!planState || planState.activeAttempt !== attempt) {
    throw doubaoSessionError('豆包隔离会话计划状态不一致，拒绝清理。');
  }
  const stockProfile = path.join(os.homedir(), 'Library', 'Application Support', 'Doubao');
  const isStockProfile = state.userDataDirectory === stockProfile;
  state.cleanupPromise = (async () => {
    // Never delete the user's real Doubao profile.  Only terminate the debug
    // child/transport, then mark the attempt cleaned.
    if (isStockProfile) {
      if (state.transport && !state.transport.closed) {
        try { state.transport.close(); } catch {}
      }
      if (state.child && state.child.exitCode == null && state.child.signalCode == null) {
        try { state.child.kill('SIGTERM'); } catch {}
      }
      const result = Object.freeze({removed: false, stockProfilePreserved: true});
      state.state = 'cleaned';
      state.cleanupResult = result;
      planState.activeAttempt = null;
      return result;
    }
    return removeIsolatedDoubaoProfileAfterProof({
      userDataDirectory: state.userDataDirectory,
      child: state.child,
      transport: state.transport,
      ...(waitForNoHandles ? {waitForNoHandles} : {}),
    }).then((result) => {
      state.state = 'cleaned';
      state.cleanupResult = result;
      planState.activeAttempt = null;
      return result;
    });
  })().catch((error) => {
    state.cleanupPromise = null;
    throw error;
  });
  return state.cleanupPromise;
}

function invalidCandidateEvidence(reason) {
  return Object.freeze({valid: false, reason});
}

// Candidate runtime evidence is intentionally a review artifact, not a
// capability grant.  Keep its shape strict so an old/static/malformed file
// cannot be mistaken for a completed cleanup-and-restore run.
export function validateDoubaoCandidateEvidence(evidence, {
  targetAllowlist = DOUBAO_TARGET_ALLOWLIST,
} = {}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return invalidCandidateEvidence('豆包尚未提供候选隔离运行时证据。');
  }
  if (evidence.schemaVersion !== DOUBAO_QA_EVIDENCE_SCHEMA_VERSION ||
      evidence.kind !== DOUBAO_QA_EVIDENCE_KIND ||
      evidence.status !== DOUBAO_QA_CANDIDATE_STATUS) {
    return invalidCandidateEvidence('豆包候选证据的 kind、schemaVersion 或 status 不受当前协议认可。');
  }
  if (evidence.cleanupVerified !== true || evidence.stockRestoreVerified !== true ||
      evidence.noAutomaticPromotion !== true) {
    return invalidCandidateEvidence('豆包候选证据没有证明清理、原版恢复和禁止自动提升。');
  }
  if (evidence.exactAdapterEnabled !== false || evidence.capabilitiesElevated !== false ||
      evidence.isolationScope !== DOUBAO_QA_ISOLATION_SCOPE ||
      evidence.domProbeScope !== DOUBAO_QA_DOM_PROBE_SCOPE) {
    return invalidCandidateEvidence('豆包候选证据超出了临时 profile、只读 DOM 计数与零能力边界。');
  }
  if (evidence.userAuthorized !== true || evidence.isolatedProfile !== true ||
      evidence.isolatedUserDataDirForwarded !== true) {
    return invalidCandidateEvidence('豆包候选证据缺少用户授权或隔离 profile 转发证明。');
  }
  if (!Array.isArray(evidence.processChain) || !evidence.processChain.length ||
      !Array.isArray(evidence.fixedDomCounts) || !evidence.fixedDomCounts.length) {
    return invalidCandidateEvidence('豆包候选证据缺少有界进程链或固定 DOM 计数。');
  }
  if (evidence.pageTargetInventoryComplete !== true ||
      !Array.isArray(evidence.pageTargets) || !evidence.pageTargets.length ||
      !evidence.pageTargets.every((target) => target?.type === 'page' &&
        targetUrlMatchesAllowlist(target.url, targetAllowlist))) {
    return invalidCandidateEvidence('豆包候选证据没有提供完整且全部位于固定白名单内的 page target 清单。');
  }
  return Object.freeze({valid: true, reason: '豆包候选隔离运行时证据结构有效；仍需人工审查。'});
}

// This is deliberately a pure evidence verifier. It never launches, attaches
// to, probes, or restarts an application. A future isolated integration test
// can feed its bounded result into this function; ordinary discovery cannot
// manufacture a verified Doubao transport state.
export function verifyTransportEvidence(app, evidence, {targetAllowlist = DOUBAO_TARGET_ALLOWLIST} = {}) {
  const policy = transportPolicyFor(app);
  if (!policy) return failed(app, '未知客户端传输策略。');
  if (policy.verifiedByDefault) {
    return Object.freeze({
      clientId: app.clientId,
      verified: true,
      strategyId: policy.preferred,
      transport: 'pipe',
      appFingerprint: app.fingerprint ?? null,
      reason: '该客户端使用已实现的直接 CDP Pipe 启动路径。',
    });
  }
  if (app?.clientId !== 'doubao') return failed(app, '客户端没有可验证的传输策略。');
  const candidateValidation = validateDoubaoCandidateEvidence(evidence, {targetAllowlist});
  if (!candidateValidation.valid) return failed(app, candidateValidation.reason);
  if (!app.fingerprint || evidence.appFingerprint !== app.fingerprint) {
    return failed(app, '传输证据与当前豆包应用指纹不匹配。');
  }
  if (evidence.userAuthorized !== true || evidence.isolatedProfile !== true ||
      evidence.isolatedUserDataDirForwarded !== true) {
    return failed(app, '豆包传输验证必须由用户授权，并证明隔离 user-data-dir 已转发到嵌套浏览器。');
  }
  if (!positiveInteger(evidence.mainPid) || !positiveInteger(evidence.nestedBrowserPid) ||
      evidence.mainPid === evidence.nestedBrowserPid || evidence.samanFromChatPid !== evidence.mainPid) {
    return failed(app, '未验证豆包主进程与 --saman-from-chat 嵌套浏览器链路。');
  }
  const expectedProduct = `Chrome/${app.chromium ?? app.chromiumFrameworkVersion ?? ''}`;
  if (!app.chromium || evidence.browserProduct !== expectedProduct) {
    return failed(app, 'CDP Browser.getVersion 与已锁定 Chromium 版本不匹配。');
  }
  const candidate = policy.candidates.find(({id}) => id === evidence.strategyId);
  if (!candidate) return failed(app, '豆包传输证据使用了未声明的启动策略。');

  if (candidate.transport === 'pipe') {
    if (evidence.pipeConnected !== true || evidence.wrapperForwardedDebugArgument !== true ||
        evidence.nestedBrowserDebugArgument !== true || evidence.devToolsActivePortPresent !== false) {
      return failed(app, '尚未证明豆包主包装器正确转发 CDP Pipe。');
    }
  } else {
    const endpoint = evidence.endpoint;
    if (!endpoint || endpoint.host !== '127.0.0.1' || !Number.isInteger(endpoint.port) ||
        endpoint.port < 1024 || endpoint.port > 65535 || evidence.ephemeralPort !== true ||
        evidence.endpointOwnedByNestedBrowser !== true || isForbiddenDebugEndpoint(app, endpoint) ||
        evidence.jsonVersionBrowser !== expectedProduct) {
      return failed(app, '隔离 Loopback 证据不满足本机、临时端口、进程归属和版本约束。');
    }
  }

  return Object.freeze({
    clientId: app.clientId,
    verified: false,
    candidateEvidenceValid: true,
    strategyId: null,
    transport: null,
    appFingerprint: app.fingerprint,
    reason: '豆包候选隔离证据与当前指纹、进程链和目标白名单一致；它不会自动提升传输、Adapter 或皮肤能力，需人工审查并发布新的 exact Adapter。',
  });
}

export function unverifiedTransportStatus(app) {
  const policy = transportPolicyFor(app);
  if (!policy) return failed(app, '未知客户端传输策略。');
  if (policy.verifiedByDefault) return verifyTransportEvidence(app, null);
  return failed(app, '豆包 CDP 启动参数转发尚未经过隔离重启验证；注入保持关闭。');
}

export function launchStrategyFor(app, verification = app?.transportVerification) {
  const policy = transportPolicyFor(app);
  const candidates = candidateLaunchStrategies(app);
  const allowUnverifiedMode = process.env.LINGGLOW_ALLOW_UNVERIFIED_CLIENTS === '1';
  if (!policy) return {allowed: false, reason: '未知客户端传输策略。', candidates};
  // No released Doubao adapter may consume a runtime observation directly.
  // Promotion must be represented by a separately reviewed exact Adapter.  A
  // persisted or caller-supplied `verified: true` is deliberately insufficient.
  if (app?.clientId === 'doubao') {
    if (reviewedDoubaoVerificationMatches(app, verification)) {
      const candidate = policy.candidates.find(({id}) => id === verification.strategyId);
      if (!candidate) {
        return {
          allowed: false,
          reason: '候选 transport 策略未在当前策略表定义中。',
          strategyId: null,
          transport: null,
          executionImplemented: false,
          reviewedExactAdapterId: null,
          candidates,
        };
      }
      return {
        allowed: candidate.executionImplemented,
        reason: '已选择由人工审核 exact Adapter 授权的豆包启动策略。',
        strategyId: candidate.id,
        transport: candidate.transport,
        executionImplemented: candidate.executionImplemented,
        reviewedExactAdapterId: verification.reviewedExactAdapterId,
        candidates,
      };
    }
    if (genericSafeDoubaoAuthorizationMatches(app, verification)) {
      const candidate = policy.candidates.find(({id}) => id === verification.strategyId);
      return {
        allowed: candidate?.executionImplemented === true,
        reason: '已选择官方签名豆包的受限兼容启动通道。',
        strategyId: candidate?.id ?? null,
        transport: candidate?.transport ?? null,
        executionImplemented: candidate?.executionImplemented === true,
        reviewedExactAdapterId: null,
        candidates,
        unverifiedFallback: true,
        genericSafeFallback: true,
      };
    }
    if (allowUnverifiedMode) {
      const fallbackStrategy = candidates.find(({id}) => id === (verification?.strategyId || policy.preferred)) ??
        candidates.find(({executionImplemented}) => executionImplemented) ??
        candidates[0];
      if (fallbackStrategy) {
        return {
          allowed: fallbackStrategy.executionImplemented,
          reason: '本地放宽模式：未匹配 exact Adapter，按开发通道临时允许该 Doubao 启动策略。生产环境请关闭该开关。',
          strategyId: fallbackStrategy.id,
          transport: fallbackStrategy.transport,
          executionImplemented: fallbackStrategy.executionImplemented,
          reviewedExactAdapterId: null,
          candidates,
          unverifiedFallback: true,
        };
      }
    }
    const priorReason = typeof verification?.reason === 'string' && verification.reason
      ? `${verification.reason}；`
      : '';
    return {
      allowed: false,
      reason: `${priorReason}豆包仅接受由 digest 锁定的人工审核 exact Adapter 启动许可；候选隔离证据或伪造 verified 状态均不允许自动启用传输或皮肤注入。`,
      strategyId: null,
      transport: null,
      executionImplemented: false,
      candidates,
    };
  }
  const effectiveVerification = verification ??
    (policy.verifiedByDefault ? verifyTransportEvidence(app, null) : null);
  if (!effectiveVerification?.verified ||
      effectiveVerification.appFingerprint !== (app?.fingerprint ?? null)) {
    return {
      allowed: false,
      reason: effectiveVerification?.reason ?? '传输尚未验证。',
      strategyId: null,
      transport: null,
      executionImplemented: false,
      candidates,
    };
  }
  const candidate = policy.candidates.find(({id}) => id === effectiveVerification.strategyId);
  if (!candidate) {
    return {allowed: false, reason: '验证结果不属于当前启动策略白名单。', candidates};
  }
  return {
    allowed: candidate.executionImplemented,
    reason: candidate.executionImplemented
      ? '已选择经过验证的启动策略。'
      : '传输证据有效，但该回退执行器尚未实现。',
    strategyId: candidate.id,
    transport: candidate.transport,
    executionImplemented: candidate.executionImplemented,
    candidates,
  };
}

export const transportStrategyTestInternals = Object.freeze({
  DOUBAO_EXTENSION_ID,
  normalizedBaseUrl,
  reviewedDoubaoVerificationMatches,
});
