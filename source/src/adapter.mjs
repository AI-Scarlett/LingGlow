import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  CLIENT_TRUST_POLICIES,
  clientIdForBundleId,
  clientPolicy,
} from './client-app.mjs';
import {
  createGenericSafeDoubaoTransportAuthorization,
  createReviewedDoubaoTransportVerification,
  doubaoAppIdentityFromAdapter,
  DOUBAO_TARGET_ALLOWLIST,
  validateDoubaoCandidateEvidence,
  verifyTransportEvidence,
} from './transport-strategy.mjs';
import {
  DOUBAO_QA_EVIDENCE_KIND,
  DOUBAO_QA_EVIDENCE_SCHEMA_VERSION,
} from './doubao-qa-policy.mjs';
import {
  CODEX_QA_EVIDENCE_SCHEMA_VERSION,
  CODEX_RUNTIME_EVIDENCE_REQUIREMENTS,
  EXACT_PROMOTION_STATUS,
} from './runtime-qa-matrix.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ALL_CAPABILITIES = Object.freeze([
  'background',
  'palette',
  'glass',
  'composer',
  'banner',
  'motion',
  'sidebar-width',
  'brand',
  'navigation',
  'controls',
  'project-hero',
  'composer-avatar',
]);

// These features are fixed, declarative decorations whose selectors are
// deliberately defensive: if a renderer moves the semantic anchor the rule
// simply becomes a no-op.  They do not depend on an exact adapter evidence
// chain and therefore remain available across fast Agent version updates.
export const FIXED_DECORATIVE_CAPABILITIES = Object.freeze([
  'composer-avatar',
]);

export const GENERIC_SAFE_CAPABILITIES = Object.freeze([
  'background',
  'palette',
  'glass',
  ...FIXED_DECORATIVE_CAPABILITIES,
]);

export const ADAPTER_VALIDATION_STATUSES = Object.freeze([
  'runtime-verified',
  'static-candidate',
]);

// Re-exported for existing callers.  The checklist generator and the exact
// Adapter gate intentionally share this same route/state vocabulary.
export {CODEX_RUNTIME_EVIDENCE_REQUIREMENTS};

export const DOUBAO_ARTIFACT_KEYS = Object.freeze([
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

export const DOUBAO_EXACT_REVIEW_EVIDENCE_KIND =
  'lingglow.doubao-exact-adapter-review';
export const DOUBAO_EXACT_REVIEW_SCHEMA_VERSION = 1;
export const DOUBAO_EXACT_REVIEW_STATUS = 'exact-promotion-approved';

// The adapter itself is immutable data, but the fact that its evidence chain
// was verified must not be serialisable or reconstructable from JSON.  This
// association exists only for adapters loaded through `loadAdapters()` after
// all three digest-pinned documents have been checked.
const reviewedDoubaoAdapterTransports = new WeakMap();

// A Codex exact Adapter is also a runtime permission boundary, not merely a
// shape-valid JSON document.  It receives this private marker only after
// loadAdapters() has re-hashed both evidence files and checked the complete
// review chain.  In particular, API callers cannot promote a hand-written or
// cloned `runtime-verified` object by passing it to compatibilityFor().
const reviewedCodexExactAdapters = new WeakSet();

const doubaoAdapterBase = Object.freeze({
  schemaVersion: 1,
  clientId: 'doubao',
  bundleId: 'com.bot.pc.doubao',
  teamId: '96L78H6LMH',
  nestedBundleId: 'com.bot.pc.doubao.browser',
  nestedTeamId: '96L78H6LMH',
  chromiumFrameworkVersion: '135.0.7049.72',
  extensionId: 'obkcimipmjdkghadnfcjojepocldeggd',
  targetAllowlist: DOUBAO_TARGET_ALLOWLIST,
  probeKind: 'doubao-v1',
  // Phase one intentionally exposes no injection capability. Static identity
  // matching is useful for Doctor, but transport and live DOM remain gated.
  capabilities: Object.freeze([]),
  requiredSignals: Object.freeze([
    'appUrlEntry',
    'semanticSelectors',
    'designTokens',
    'productMarker',
    'nestedSignature',
    'frameworkIdentity',
    'resourceHashes',
    'targetAllowlist',
    'transportVerified',
  ]),
});

export const BUILT_IN_ADAPTERS = Object.freeze([
  Object.freeze({
    schemaVersion: 1,
    adapterId: 'workbuddy-macos-5.2.6-build-5.2.6',
    clientId: 'workbuddy',
    bundleId: 'com.workbuddy.workbuddy',
    teamId: 'FN2V63AD2J',
    versions: Object.freeze(['5.2.6']),
    builds: Object.freeze(['5.2.6']),
    asarSha256: Object.freeze(['c5eef2ddf63f8da45b5c268a0d9b49dc51d5652690da453721281977613ed0c5']),
    targetPath: 'renderer/index.html',
    probeKind: 'workbuddy-v1',
    capabilities: Object.freeze([
      'background', 'palette', 'glass', 'brand', 'navigation', 'controls', 'project-hero', 'composer-avatar',
    ]),
    requiredSignals: Object.freeze([
      'appUrlEntry',
      'semanticSelectors',
      'designTokens',
      'productMarker',
    ]),
  }),
  Object.freeze({
    schemaVersion: 1,
    adapterId: 'workbuddy-macos-5.3.3-build-5.3.3',
    clientId: 'workbuddy',
    bundleId: 'com.workbuddy.workbuddy',
    teamId: 'FN2V63AD2J',
    versions: Object.freeze(['5.3.3']),
    builds: Object.freeze(['5.3.3']),
    asarSha256: Object.freeze(['68c9d776c2d557981cbbb6c334931e1efd3ab799032d23ba9172e3868eae3acd']),
    targetPath: 'renderer/index.html',
    probeKind: 'workbuddy-v1',
    capabilities: Object.freeze([
      'background', 'palette', 'glass', 'brand', 'navigation', 'controls', 'project-hero', 'composer-avatar',
    ]),
    requiredSignals: Object.freeze([
      'appUrlEntry',
      'semanticSelectors',
      'designTokens',
      'productMarker',
    ]),
  }),
  Object.freeze({
    schemaVersion: 1,
    adapterId: 'workbuddy-macos-5.3.5-build-5.3.5',
    clientId: 'workbuddy',
    bundleId: 'com.workbuddy.workbuddy',
    teamId: 'FN2V63AD2J',
    versions: Object.freeze(['5.3.5']),
    builds: Object.freeze(['5.3.5']),
    asarSha256: Object.freeze(['becf5e6c2ddaafc807707e8bdd5281b9fc744019b86262f9c8a81c59b67b72b0']),
    targetPath: 'renderer/index.html',
    probeKind: 'workbuddy-v1',
    capabilities: Object.freeze([
      'background', 'palette', 'glass', 'brand', 'navigation', 'controls', 'project-hero', 'composer-avatar',
    ]),
    requiredSignals: Object.freeze([
      'appUrlEntry',
      'semanticSelectors',
      'designTokens',
      'productMarker',
    ]),
  }),
  Object.freeze({
    ...doubaoAdapterBase,
    adapterId: 'doubao-macos-2.12.7-build-2.12.7-static',
    versions: Object.freeze(['2.12.7']),
    builds: Object.freeze(['2.12.7']),
    mainCDHash: Object.freeze(['03cb0115474cfda8c160194cadbcde2675deb986']),
    nestedCDHash: Object.freeze(['4e71a96af0503c4c55a8d00b38172a4b6f13e068']),
    manifestCommit: Object.freeze(['24612824c4abb2cfefa9ef6aaf8484b4fa69c3c7']),
    extensionVersion: Object.freeze(['1.0.0.4978']),
    artifactSha256: Object.freeze({
      mainExecutable: Object.freeze(['3da5804092c077d11d4996de1958b5b1526125d2c1379a914ce37745494974dc']),
      mainManifest: Object.freeze(['8e7595888df35f7fa2b91f324e82da6de44cd0ce9ddb7b9b66abe93598231de3']),
      nestedExecutable: Object.freeze(['99a7cc56a90cbd4b668309f854a3f6a94321a2889ec4dd501753a6be4bd15aaf']),
      chromiumFramework: Object.freeze(['97b8fee03ae51272a39788416102e16318d55a46fc2a62fd6ec8ae9578473003']),
      extensionManifest: Object.freeze(['eb2263a7a3a062d30b3ab1a290e56ebd20405cb9b267808266740068e1f2f39d']),
      sidePanelHtml: Object.freeze(['cd4e088cd5dec6bb8074ca0d37574174b9e1734f1359ea9af6a0b6c2893e98f8']),
      sidePanelJavaScript: Object.freeze(['c003038ccd4e498648371cdc4a7b6aa564a148941c39dd9bca3274d024b5887a']),
      sidePanelStylesheet: Object.freeze(['174fcf022b4bff7816724fc0b132115ae599b2e84c5bc8d8bc0fef10ccbd4552']),
      designTokensStylesheet: Object.freeze(['bb86d0a21a1b81634d0d548c4174bd9f459153db5c69ee4e86f012310f0fbc54']),
    }),
  }),
  Object.freeze({
    ...doubaoAdapterBase,
    adapterId: 'doubao-macos-2.19.9-build-2.19.9-static',
    versions: Object.freeze(['2.19.9']),
    builds: Object.freeze(['2.19.9']),
    mainCDHash: Object.freeze(['d253e4d81b463aa3269156e32dbdbc161b99b01e']),
    nestedCDHash: Object.freeze(['853c671fc6413efe8ba5cece9ad87a305671f09e']),
    manifestCommit: Object.freeze(['3a04c286fa3f5511d21e6f8d228a88f80cda771c']),
    extensionVersion: Object.freeze(['1.0.0.6640']),
    artifactSha256: Object.freeze({
      mainExecutable: Object.freeze(['3f0c9e057bc0a65ae9a678fb3486e9cbbe24f8cd40d97c3865ae47b8e456ac00']),
      mainManifest: Object.freeze(['d68b65ad7dd41dac882099751ace8b27a0577274034a8640b1c58adb9b567473']),
      nestedExecutable: Object.freeze(['3ae362fc11fdd9775c683380a69e72f8a62455b4722c53427b44fa259d3a664e']),
      chromiumFramework: Object.freeze(['ff7b32b6900e442f5dd4e84687ea54884c848ae7dbce3e543ba5b5aef0381e69']),
      extensionManifest: Object.freeze(['bd638eb1fc2012b08765c7057a93810005f8452337f4efad91737f632a0fe130']),
      sidePanelHtml: Object.freeze(['db02238f6156e22beb0f6c1aa8d2e59d94dea542f9b5e1513a5300eb58c9a4ea']),
      sidePanelJavaScript: Object.freeze(['0d6c2c0be5eda7c31a6ac8e215c163fa92995ea2bf634684a1a87e6e79a74f16']),
      sidePanelStylesheet: Object.freeze(['174fcf022b4bff7816724fc0b132115ae599b2e84c5bc8d8bc0fef10ccbd4552']),
      designTokensStylesheet: Object.freeze(['b681c1669af8a9268e6da18e57dfb7499144a53fa01040ff3c564589195dadae']),
    }),
  }),
]);

const capabilityAllowlist = new Set(ALL_CAPABILITIES);

function validStringArray(value, {allowEmpty = false} = {}) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) &&
    value.every((item) => typeof item === 'string' && item.length > 0);
}

function validHashArray(value) {
  return validStringArray(value) && value.every((hash) => /^[a-f0-9]{64}$/u.test(hash));
}

function validSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function validEvidencePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || !value.endsWith('.json')) {
    return false;
  }
  const segments = value.split('/');
  return segments[0] === 'qa' && segments.every((segment) => segment && segment !== '.' &&
    segment !== '..' && /^[a-zA-Z0-9._-]+$/u.test(segment));
}

function normalizeValidation(value) {
  if (value == null) {
    return Object.freeze({
      status: 'runtime-verified',
      runtimeEvidenceRequired: false,
      legacyImplicit: true,
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !ADAPTER_VALIDATION_STATUSES.includes(value.status) ||
      typeof value.runtimeEvidenceRequired !== 'boolean') return null;
  const hasStaticBaseline = value.staticBaseline != null || value.staticBaselineSha256 != null;
  const hasCandidateEvidence = value.candidateEvidence != null ||
    value.candidateEvidenceSha256 != null;
  if (hasStaticBaseline && (!validEvidencePath(value.staticBaseline) ||
      !validSha256(value.staticBaselineSha256))) return null;
  if (hasCandidateEvidence && (!validEvidencePath(value.candidateEvidence) ||
      !validSha256(value.candidateEvidenceSha256) ||
      typeof value.candidateEvidenceKind !== 'string' ||
      !/^lingglow\.[a-z0-9.-]{3,80}$/u.test(value.candidateEvidenceKind))) return null;
  if (value.staticCandidateAdapterId != null &&
      (typeof value.staticCandidateAdapterId !== 'string' ||
        !/^doubao-macos-[a-zA-Z0-9._-]{1,180}$/u.test(value.staticCandidateAdapterId))) {
    return null;
  }
  if (value.status === 'static-candidate') {
    if (value.runtimeEvidenceRequired !== true || !hasStaticBaseline ||
        typeof value.runtimeEvidenceKind !== 'string' ||
        !/^lingglow\.[a-z0-9.-]{3,80}$/u.test(value.runtimeEvidenceKind) ||
        value.runtimeEvidence != null || value.runtimeEvidenceSha256 != null ||
        hasCandidateEvidence || value.staticCandidateAdapterId != null) return null;
  }
  if (value.status === 'runtime-verified' && value.runtimeEvidenceRequired) {
    if (!validEvidencePath(value.runtimeEvidence) || !validSha256(value.runtimeEvidenceSha256) ||
        typeof value.runtimeEvidenceKind !== 'string' ||
        !/^lingglow\.[a-z0-9.-]{3,80}$/u.test(value.runtimeEvidenceKind)) return null;
  }
  if (hasCandidateEvidence && (value.status !== 'runtime-verified' ||
      value.runtimeEvidenceRequired !== true)) return null;
  return Object.freeze({
    status: value.status,
    runtimeEvidenceRequired: value.runtimeEvidenceRequired,
    // Preserve the built-in static-diagnostic marker so re-normalising an
    // already-loaded adapter (compatibilityFor) does not drop Doubao/WorkBuddy
    // legacy adapters into the three-digest exact path and reject them.
    ...(value.legacyImplicit === true ? {legacyImplicit: true} : {}),
    ...(hasStaticBaseline ? {
      staticBaseline: value.staticBaseline,
      staticBaselineSha256: value.staticBaselineSha256,
    } : {}),
    ...(value.runtimeEvidenceKind ? {runtimeEvidenceKind: value.runtimeEvidenceKind} : {}),
    ...(value.runtimeEvidence ? {
      runtimeEvidence: value.runtimeEvidence,
      runtimeEvidenceSha256: value.runtimeEvidenceSha256,
    } : {}),
    ...(hasCandidateEvidence ? {
      candidateEvidence: value.candidateEvidence,
      candidateEvidenceSha256: value.candidateEvidenceSha256,
      candidateEvidenceKind: value.candidateEvidenceKind,
    } : {}),
    ...(value.staticCandidateAdapterId ? {
      staticCandidateAdapterId: value.staticCandidateAdapterId,
    } : {}),
  });
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifiedEvidenceJson(relativePath, expected, evidenceRoot) {
  try {
    const resolved = path.resolve(evidenceRoot, relativePath);
    if (!resolved.startsWith(`${path.resolve(evidenceRoot)}${path.sep}`)) return null;
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 ||
        stat.size > 4 * 1024 * 1024) return null;
    // The digest must cover exactly the bytes that get parsed: a second read
    // could observe content a concurrent writer swapped in after hashing.
    const raw = fs.readFileSync(resolved);
    if (raw.length <= 0 || raw.length > 4 * 1024 * 1024 ||
        sha256Hex(raw) !== expected) return null;
    const value = JSON.parse(raw.toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function codexStaticBaselineMatchesAdapter(adapter, snapshot) {
  return snapshot?.auditKind === 'static-only' && snapshot.runtimeValidationPerformed === false &&
    snapshot.app?.bundleId === adapter.bundleId && snapshot.app?.teamId === adapter.teamId &&
    adapter.versions.includes(snapshot.app?.version) && adapter.builds.includes(snapshot.app?.build) &&
    adapter.asarSha256.includes(snapshot.integrity?.asarRawSha256) &&
    snapshot.adapterDrift?.staticCandidateAdapter === adapter.adapterId;
}

function validFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function builtInDoubaoStaticCandidate(adapterId) {
  const candidate = BUILT_IN_ADAPTERS.find((item) => item.adapterId === adapterId);
  return candidate?.clientId === 'doubao' && candidate.capabilities?.length === 0 ? candidate : null;
}

function doubaoStaticBaselineMatchesAdapter(adapter, snapshot) {
  const staticCandidate = builtInDoubaoStaticCandidate(adapter.validation.staticCandidateAdapterId);
  // Accept both the production QA shape (top-level localExtension) and the
  // compact fixture shape (app.localExtension) used by exact-review unit tests.
  const localExtension = snapshot?.app?.localExtension ?? snapshot?.localExtension;
  return Boolean(
    staticCandidate && snapshot?.auditKind === 'static-only' &&
    snapshot.runtimeValidationPerformed === false &&
    snapshot.app?.bundleId === adapter.bundleId && snapshot.app?.teamId === adapter.teamId &&
    adapter.versions.includes(snapshot.app?.version) && adapter.builds.includes(snapshot.app?.build) &&
    adapter.mainCDHash.includes(snapshot.app?.cdHash) &&
    snapshot.app?.nestedBrowser?.bundleId === adapter.nestedBundleId &&
    snapshot.app?.nestedBrowser?.teamId === adapter.nestedTeamId &&
    adapter.nestedCDHash.includes(snapshot.app?.nestedBrowser?.cdHash) &&
    snapshot.app?.chromiumFrameworkVersion === adapter.chromiumFrameworkVersion &&
    adapter.manifestCommit.includes(snapshot.app?.manifestCommit) &&
    localExtension?.id === adapter.extensionId &&
    adapter.extensionVersion.includes(localExtension?.version) &&
    DOUBAO_ARTIFACT_KEYS.every((key) =>
      adapter.artifactSha256[key].includes(snapshot.integrity?.artifactSha256?.[key])) &&
    sameStrings(snapshot.targetAllowlist, adapter.targetAllowlist) &&
    snapshot.adapterDrift?.staticCandidateAdapter === staticCandidate.adapterId
  );
}

function validReviewRecordId(value) {
  return typeof value === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/u.test(value);
}

function runtimeEvidenceMatchesAdapter(adapter, evidence, snapshot) {
  const required = CODEX_RUNTIME_EVIDENCE_REQUIREMENTS;
  const staticCandidateAdapterId = snapshot?.adapterDrift?.staticCandidateAdapter;
  const chromium = snapshot?.app?.chromium;
  return adapter.clientId === 'codex' && evidence?.schemaVersion === CODEX_QA_EVIDENCE_SCHEMA_VERSION &&
    evidence?.kind === adapter.validation.runtimeEvidenceKind &&
    evidence.status === EXACT_PROMOTION_STATUS && evidence.exactAdapterEnabled === true &&
    evidence.cleanupVerified === true && evidence.stockRestoreVerified === true &&
    evidence.adapterId === adapter.adapterId &&
    evidence.staticBaselineSha256 === adapter.validation.staticBaselineSha256 &&
    typeof staticCandidateAdapterId === 'string' &&
    evidence.staticCandidateAdapterId === staticCandidateAdapterId &&
    evidence.manualApproval?.decision === 'approved' &&
    validReviewRecordId(evidence.manualApproval?.reviewRecordId) &&
    evidence.app?.bundleId === adapter.bundleId && evidence.app?.teamId === adapter.teamId &&
    adapter.versions.includes(evidence.app?.version) && adapter.builds.includes(evidence.app?.build) &&
    adapter.asarSha256.includes(evidence.app?.asarSha256) &&
    typeof chromium === 'string' && evidence.app?.chromium === chromium &&
    evidence.browserProduct === `Chrome/${chromium}` &&
    evidence.strategyId === 'direct-pipe' && evidence.transport === 'pipe' &&
    evidence.pageTargetInventoryComplete === true &&
    sameStrings(evidence.pageTargets, adapter.targetAllowlist) &&
    evidence.testCssRemoved === true &&
    evidence.integrity?.asarBefore === evidence.app.asarSha256 &&
    evidence.integrity?.asarAfter === evidence.app.asarSha256 &&
    sameStrings(evidence.targetAllowlist, adapter.targetAllowlist) &&
    sameStringSet(evidence.capabilitiesVerified, adapter.capabilities) &&
    required.routes.every((route) => evidence.routesVerified?.includes(route)) &&
    required.states.every((state) => evidence.statesVerified?.includes(state));
}

function doubaoCandidateEvidenceMatchesAdapter(adapter, evidence) {
  const validation = validateDoubaoCandidateEvidence(evidence, {
    targetAllowlist: adapter.targetAllowlist,
  });
  if (!validation.valid || evidence?.kind !== adapter.validation.candidateEvidenceKind ||
      evidence.kind !== DOUBAO_QA_EVIDENCE_KIND ||
      evidence.schemaVersion !== DOUBAO_QA_EVIDENCE_SCHEMA_VERSION ||
      !validFingerprint(evidence.appFingerprint) ||
      evidence.appFingerprint !== evidence.app?.fingerprint ||
      evidence.app?.bundleId !== adapter.bundleId || evidence.app?.teamId !== adapter.teamId ||
      !adapter.versions.includes(evidence.app?.version) ||
      !adapter.builds.includes(evidence.app?.build) ||
      evidence.app?.chromium !== adapter.chromiumFrameworkVersion ||
      !adapter.mainCDHash.includes(evidence.app?.mainCdHash) ||
      !adapter.nestedCDHash.includes(evidence.app?.nestedCdHash) ||
      evidence.browserProduct !== `Chrome/${adapter.chromiumFrameworkVersion}` ||
      !evidence.fixedDomCounts?.every((counts) =>
        ['body', 'root', 'chatInput', 'chatInputInput', 'messageTextContent'].every((key) =>
          Number.isInteger(counts?.[key]) && counts[key] >= 0 && counts[key] <= 10000))) {
    return false;
  }
  const transportCandidate = verifyTransportEvidence({
    clientId: 'doubao',
    fingerprint: evidence.appFingerprint,
    chromium: adapter.chromiumFrameworkVersion,
  }, evidence, {targetAllowlist: adapter.targetAllowlist});
  return transportCandidate.candidateEvidenceValid === true;
}

function doubaoReviewEvidenceMatchesAdapter(adapter, candidate, review) {
  const {validation} = adapter;
  return review?.schemaVersion === DOUBAO_EXACT_REVIEW_SCHEMA_VERSION &&
    review.kind === DOUBAO_EXACT_REVIEW_EVIDENCE_KIND &&
    review.kind === validation.runtimeEvidenceKind &&
    review.status === DOUBAO_EXACT_REVIEW_STATUS && review.exactAdapterEnabled === true &&
    review.cleanupVerified === true && review.stockRestoreVerified === true &&
    review.manualApproval?.decision === 'approved' &&
    typeof review.manualApproval?.reviewRecordId === 'string' &&
    review.manualApproval.reviewRecordId.length > 0 &&
    review.adapterId === adapter.adapterId &&
    review.staticCandidateAdapterId === validation.staticCandidateAdapterId &&
    review.staticBaselineSha256 === validation.staticBaselineSha256 &&
    review.candidateEvidenceKind === validation.candidateEvidenceKind &&
    review.candidateEvidenceSha256 === validation.candidateEvidenceSha256 &&
    review.appFingerprint === candidate.appFingerprint &&
    review.app?.bundleId === adapter.bundleId && review.app?.teamId === adapter.teamId &&
    adapter.versions.includes(review.app?.version) && adapter.builds.includes(review.app?.build) &&
    adapter.mainCDHash.includes(review.app?.cdHash) &&
    review.app?.nestedBrowser?.bundleId === adapter.nestedBundleId &&
    review.app?.nestedBrowser?.teamId === adapter.nestedTeamId &&
    adapter.nestedCDHash.includes(review.app?.nestedBrowser?.cdHash) &&
    review.app?.chromiumFrameworkVersion === adapter.chromiumFrameworkVersion &&
    adapter.manifestCommit.includes(review.app?.manifestCommit) &&
    review.app?.localExtension?.id === adapter.extensionId &&
    adapter.extensionVersion.includes(review.app?.localExtension?.version) &&
    sameStrings(review.targetAllowlist, adapter.targetAllowlist) &&
    review.strategyId === 'launchservices-loopback' && review.transport === 'loopback-cdp' &&
    review.loopbackRuntimeCheck?.host === '127.0.0.1' &&
    review.loopbackRuntimeCheck?.portPolicy === 'random-high-port' &&
    review.loopbackRuntimeCheck?.browserProduct === `Chrome/${adapter.chromiumFrameworkVersion}` &&
    review.loopbackRuntimeCheck?.pageUrl === 'doubao://doubao-chat/chat' &&
    review.loopbackRuntimeCheck?.viewportNonZero === true &&
    review.loopbackRuntimeCheck?.mainArgumentForwarded === true &&
    review.loopbackRuntimeCheck?.nestedArgumentForwarded === true &&
    sameStringSet(review.capabilitiesVerified, adapter.capabilities);
}

function doubaoExactValidationArtifacts(adapter, evidenceRoot) {
  const {validation} = adapter;
  if (validation.status !== 'runtime-verified' || validation.runtimeEvidenceRequired !== true ||
      !validation.staticBaseline || !validation.staticCandidateAdapterId ||
      !validation.candidateEvidence || !validation.candidateEvidenceSha256 ||
      validation.candidateEvidenceKind !== DOUBAO_QA_EVIDENCE_KIND ||
      validation.runtimeEvidenceKind !== DOUBAO_EXACT_REVIEW_EVIDENCE_KIND ||
      !validation.runtimeEvidence || !validation.runtimeEvidenceSha256) {
    return null;
  }
  const snapshot = verifiedEvidenceJson(
    validation.staticBaseline,
    validation.staticBaselineSha256,
    evidenceRoot,
  );
  const candidate = verifiedEvidenceJson(
    validation.candidateEvidence,
    validation.candidateEvidenceSha256,
    evidenceRoot,
  );
  const review = verifiedEvidenceJson(
    validation.runtimeEvidence,
    validation.runtimeEvidenceSha256,
    evidenceRoot,
  );
  if (!doubaoStaticBaselineMatchesAdapter(adapter, snapshot) ||
      !doubaoCandidateEvidenceMatchesAdapter(adapter, candidate) ||
      !doubaoReviewEvidenceMatchesAdapter(adapter, candidate, review)) return null;
  const appIdentity = doubaoAppIdentityFromAdapter(adapter);
  if (!appIdentity) return null;
  return createReviewedDoubaoTransportVerification({
    appIdentity,
    appFingerprint: candidate.appFingerprint,
    adapterId: adapter.adapterId,
    strategyId: review.strategyId,
    targetAllowlist: adapter.targetAllowlist,
    capabilities: adapter.capabilities,
  });
}

function validationArtifactsFor(adapter, evidenceRoot) {
  const {validation} = adapter;
  if (adapter.clientId === 'doubao') {
    // Built-in static snapshots intentionally have no in-memory reviewed
    // transport. They remain visible to Doctor, but can never become exact.
    if (validation.legacyImplicit) return {valid: true, transportVerification: null};
    const transportVerification = doubaoExactValidationArtifacts(adapter, evidenceRoot);
    return {valid: Boolean(transportVerification), transportVerification};
  }
  let staticSnapshot = null;
  if (validation.staticBaseline) {
    staticSnapshot = verifiedEvidenceJson(
      validation.staticBaseline,
      validation.staticBaselineSha256,
      evidenceRoot,
    );
    if (!codexStaticBaselineMatchesAdapter(adapter, staticSnapshot)) return {valid: false};
  }
  if (validation.runtimeEvidenceRequired && validation.status === 'runtime-verified') {
    const evidence = verifiedEvidenceJson(
      validation.runtimeEvidence,
      validation.runtimeEvidenceSha256,
      evidenceRoot,
    );
    if (!runtimeEvidenceMatchesAdapter(adapter, evidence, staticSnapshot)) return {valid: false};
    return {valid: true, transportVerification: null, codexExactReviewed: true};
  }
  return {valid: true, transportVerification: null, codexExactReviewed: false};
}

function sameStrings(first, second) {
  return Array.isArray(first) && Array.isArray(second) && first.length === second.length &&
    first.every((item, index) => item === second[index]);
}

function sameStringSet(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
    return false;
  }
  // `Array#every(second.includes)` accepts `["background", "background"]`
  // as equivalent to `["background", "palette"]` when both arrays happen to
  // have the same length.  Runtime evidence controls whether a Codex Adapter
  // can become exact, so it needs genuine set equality: no duplicate claims
  // and no omitted declared capability.
  const firstSet = new Set(first);
  const secondSet = new Set(second);
  return firstSet.size === first.length && secondSet.size === second.length &&
    firstSet.size === secondSet.size && [...firstSet].every((item) => secondSet.has(item));
}

function validTargetPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..' &&
    /^[a-zA-Z0-9._-]+$/u.test(segment));
}

function normalizeAdapter(adapter) {
  if (!adapter || adapter.schemaVersion !== 1 || typeof adapter.adapterId !== 'string') return null;
  const clientId = adapter.clientId ?? clientIdForBundleId(adapter.bundleId);
  const policy = clientPolicy(clientId);
  if (!policy || adapter.bundleId !== policy.bundleId || adapter.teamId !== policy.teamId) return null;
  if (!validStringArray(adapter.versions) || !validStringArray(adapter.builds)) return null;
  if (clientId === 'doubao') {
    if (adapter.nestedBundleId !== policy.nestedBundleId || adapter.nestedTeamId !== policy.teamId ||
        adapter.extensionId !== policy.extensionId ||
        !/^\d+\.\d+\.\d+\.\d+$/u.test(adapter.chromiumFrameworkVersion ?? '') ||
        !validStringArray(adapter.mainCDHash) ||
        !adapter.mainCDHash.every((hash) => /^[a-f0-9]{40}$/u.test(hash)) ||
        !validStringArray(adapter.nestedCDHash) ||
        !adapter.nestedCDHash.every((hash) => /^[a-f0-9]{40}$/u.test(hash)) ||
        !validStringArray(adapter.manifestCommit) ||
        !adapter.manifestCommit.every((hash) => /^[a-f0-9]{40}$/u.test(hash)) ||
        !validStringArray(adapter.extensionVersion) ||
        !adapter.artifactSha256 || typeof adapter.artifactSha256 !== 'object' ||
        !sameStringSet(Object.keys(adapter.artifactSha256), DOUBAO_ARTIFACT_KEYS) ||
        !DOUBAO_ARTIFACT_KEYS.every((key) => validHashArray(adapter.artifactSha256[key]))) return null;
  } else if (!validHashArray(adapter.asarSha256)) return null;
  if (!validStringArray(adapter.requiredSignals, {allowEmpty: true})) return null;
  if (!validStringArray(adapter.capabilities, {allowEmpty: true}) ||
      !adapter.capabilities.every((name) => capabilityAllowlist.has(name))) return null;
  const validation = normalizeValidation(adapter.validation);
  if (!validation) return null;
  // A Codex adapter is allowed to reach `exact` only from an explicitly
  // reviewed, digest-pinned runtime evidence record.  Older file adapters
  // predate this rule and are intentionally retained as historical hashes,
  // not as a path around the isolated-QA gate.  WorkBuddy's built-in exact
  // adapter has separate real-device regression coverage and is unaffected.
  if (clientId === 'codex' && (validation.legacyImplicit ||
      (validation.status === 'runtime-verified' && validation.runtimeEvidenceRequired !== true))) {
    return null;
  }
  // Doubao can only obtain an exact adapter through the explicit three-record
  // chain below. Legacy built-ins are retained as zero-capability static
  // diagnostics, but a file adapter cannot omit any link and hope that a
  // caller-provided transport state fills the gap.
  if (clientId === 'doubao' && !validation.legacyImplicit &&
      validation.status === 'runtime-verified' &&
      (validation.runtimeEvidenceRequired !== true || !validation.staticBaseline ||
        !validation.staticCandidateAdapterId || !validation.candidateEvidence ||
        !validation.candidateEvidenceSha256 ||
        validation.candidateEvidenceKind !== DOUBAO_QA_EVIDENCE_KIND ||
        validation.runtimeEvidenceKind !== DOUBAO_EXACT_REVIEW_EVIDENCE_KIND ||
        !validation.runtimeEvidence || !validation.runtimeEvidenceSha256)) {
    return null;
  }
  const probeKind = adapter.probeKind ?? policy.defaultProbeKind;
  if (probeKind !== policy.defaultProbeKind) return null;
  const hasTargetUrl = typeof adapter.targetUrl === 'string';
  const hasTargetPath = typeof adapter.targetPath === 'string';
  const hasTargetAllowlist = Array.isArray(adapter.targetAllowlist);
  if (clientId === 'codex') {
    if (!hasTargetUrl || hasTargetPath || adapter.targetUrl !== policy.defaultTargetUrl ||
        (hasTargetAllowlist && !sameStrings(adapter.targetAllowlist, policy.targetAllowlist))) return null;
  } else if (clientId === 'workbuddy') {
    if (!hasTargetPath || hasTargetUrl || hasTargetAllowlist || !validTargetPath(adapter.targetPath) ||
        adapter.targetPath !== policy.rendererEntryPath) return null;
  } else if (!hasTargetAllowlist || hasTargetUrl || hasTargetPath ||
      !sameStrings(adapter.targetAllowlist, policy.targetAllowlist)) return null;
  const artifactSha256 = clientId === 'doubao'
    ? Object.freeze(Object.fromEntries(DOUBAO_ARTIFACT_KEYS.map((key) => [
        key,
        Object.freeze([...new Set(adapter.artifactSha256[key])]),
      ])))
    : null;
  return Object.freeze({
    ...adapter,
    clientId,
    probeKind,
    validation,
    versions: Object.freeze([...new Set(adapter.versions)]),
    builds: Object.freeze([...new Set(adapter.builds)]),
    asarSha256: Object.freeze(clientId === 'doubao' ? [] : [...new Set(adapter.asarSha256)]),
    mainCDHash: Object.freeze(clientId === 'doubao' ? [...new Set(adapter.mainCDHash)] : []),
    nestedCDHash: Object.freeze(clientId === 'doubao' ? [...new Set(adapter.nestedCDHash)] : []),
    manifestCommit: Object.freeze(clientId === 'doubao' ? [...new Set(adapter.manifestCommit)] : []),
    extensionVersion: Object.freeze(clientId === 'doubao' ? [...new Set(adapter.extensionVersion)] : []),
    artifactSha256,
    targetAllowlist: policy.targetAllowlist
      ? Object.freeze([...(adapter.targetAllowlist ?? policy.targetAllowlist)])
      : undefined,
    requiredSignals: Object.freeze([...new Set(adapter.requiredSignals)]),
    capabilities: Object.freeze([...new Set(adapter.capabilities)]),
  });
}

export function loadAdapters(directory = path.join(rootDir, 'adapters')) {
  const evidenceRoot = path.resolve(directory, '..');
  const fileAdapters = !fs.existsSync(directory) ? [] : fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const adapter = normalizeAdapter(JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
        const validation = adapter && validationArtifactsFor(adapter, evidenceRoot);
        if (!adapter || !validation?.valid) return [];
        if (validation.transportVerification) {
          reviewedDoubaoAdapterTransports.set(adapter, validation.transportVerification);
        }
        if (validation.codexExactReviewed === true) {
          reviewedCodexExactAdapters.add(adapter);
        }
        return [adapter];
      } catch {
        return [];
      }
    });
  return [
    ...BUILT_IN_ADAPTERS.map((adapter) => normalizeAdapter(adapter)).filter(Boolean),
    ...fileAdapters,
  ];
}

export function capabilitiesForCompatibility(compatibility) {
  if (compatibility?.level === 'exact' && compatibility.adapter) {
    return [...new Set([
      ...compatibility.adapter.capabilities,
      ...FIXED_DECORATIVE_CAPABILITIES,
    ])];
  }
  if (compatibility?.level === 'generic-safe') return [...GENERIC_SAFE_CAPABILITIES];
  return [];
}

export function resolveSkinCapabilityProfile(compatibility, {forceGenericSafe = false} = {}) {
  if (forceGenericSafe) {
    return {
      capabilityLevel: 'generic-safe',
      capabilities: [...GENERIC_SAFE_CAPABILITIES],
    };
  }
  if (compatibility?.level === 'exact') {
    return {
      capabilityLevel: 'exact',
      capabilities: capabilitiesForCompatibility(compatibility),
    };
  }
  if (compatibility?.level === 'generic-safe') {
    return {
      capabilityLevel: 'generic-safe',
      capabilities: [...GENERIC_SAFE_CAPABILITIES],
    };
  }
  return {
    capabilityLevel: 'generic-safe',
    capabilities: [],
  };
}

function matches(adapter, app) {
  const appClientId = app.clientId ?? clientIdForBundleId(app.bundleId);
  const base = adapter.clientId === appClientId &&
    adapter.bundleId === app.bundleId &&
    adapter.teamId === app.teamId &&
    adapter.versions.includes(app.version) &&
    adapter.builds.includes(app.build);
  if (!base) return false;
  if (appClientId !== 'doubao') return adapter.asarSha256.includes(app.asarSha256);
  return adapter.mainCDHash.includes(app.cdHash) &&
    adapter.nestedBundleId === app.nestedBrowser?.bundleId &&
    adapter.nestedTeamId === app.nestedBrowser?.teamId &&
    adapter.nestedCDHash.includes(app.nestedBrowser?.cdHash) &&
    adapter.chromiumFrameworkVersion === app.chromiumFrameworkVersion &&
    adapter.manifestCommit.includes(app.manifestCommit) &&
    adapter.extensionId === app.localExtension?.id &&
    adapter.extensionVersion.includes(app.localExtension?.version) &&
    DOUBAO_ARTIFACT_KEYS.every((key) =>
      adapter.artifactSha256[key].includes(app.artifactSha256?.[key]));
}

export function resolveAdapterTargetUrl(adapter, app) {
  if (!adapter) return null;
  const appClientId = app?.clientId ?? clientIdForBundleId(app?.bundleId);
  if (!appClientId || adapter.clientId !== appClientId) return null;
  if (adapter.targetUrl) return adapter.targetUrl;
  if (!adapter.targetPath || !app?.asarPath || !validTargetPath(adapter.targetPath)) return null;
  return pathToFileURL(path.join(app.asarPath, ...adapter.targetPath.split('/'))).href;
}

export function defaultTargetUrlForApp(app) {
  const policy = clientPolicy(app?.clientId) ?? clientPolicy(clientIdForBundleId(app?.bundleId));
  if (!policy) return null;
  if (policy.defaultTargetUrl) return policy.defaultTargetUrl;
  if (!app?.asarPath || !validTargetPath(policy.rendererEntryPath)) return null;
  return pathToFileURL(path.join(app.asarPath, ...policy.rendererEntryPath.split('/'))).href;
}

function blocked(app, reason, {
  matchedAdapter = null,
  targetAllowlist = [],
  probeKind = null,
} = {}) {
  return {
    clientId: app?.clientId ?? null,
    level: 'blocked',
    advancedAllowed: false,
    reason,
    adapter: null,
    candidateAdapter: null,
    matchedAdapter,
    targetUrl: null,
    targetAllowlist: [...targetAllowlist],
    probeKind,
    capabilities: [],
    transportVerification: app?.transportVerification ?? null,
    disabledFeatures: ['all-advanced-features'],
  };
}

function doubaoGenericSafe(app, policy, reason, {candidate = null, matchedAdapter = null} = {}) {
  const transportVerification = createGenericSafeDoubaoTransportAuthorization(app);
  if (!transportVerification) {
    return blocked(app, reason, {
      matchedAdapter,
      targetAllowlist: policy.targetAllowlist,
      probeKind: policy.defaultProbeKind,
    });
  }
  const capabilities = [...GENERIC_SAFE_CAPABILITIES];
  return {
    clientId: 'doubao',
    level: 'generic-safe',
    advancedAllowed: true,
    reason,
    adapter: null,
    candidateAdapter: candidate,
    candidateReason: candidate
      ? '已识别到相近版本；精确能力等待适配，兼容视觉层仍可应用。'
      : null,
    matchedAdapter,
    targetUrl: defaultTargetUrlForApp(app),
    targetAllowlist: [...policy.targetAllowlist],
    probeKind: policy.defaultProbeKind,
    capabilities,
    transportVerification,
    disabledFeatures: ALL_CAPABILITIES.filter((name) => !capabilities.includes(name)),
  };
}

function clientTrustFailureReason(app, policy) {
  const displayName = app?.displayName ?? policy?.displayName ?? '目标 Agent';
  if (!policy || app?.bundleId !== policy.bundleId) {
    return `${displayName} 的 Bundle ID 不符合官方应用标识。`;
  }
  if (app?.teamId !== policy.teamId || app?.trustedPublisher === false) {
    return `${displayName} 的发布者签名不符合官方发布者。`;
  }
  if (app?.signatureValid === false) {
    return `${displayName} 安装完整性校验失败（签名资源被新增、修改或缺失）；这不是皮肤错误，请重新安装官方版本后重新检测。`;
  }
  return `${displayName} 未通过安全启动检查；这不是皮肤错误，请重新检测官方应用。`;
}

export function compatibilityFor(app, adapters = loadAdapters()) {
  if (!app) return blocked(null, '未找到桌面客户端。');
  const appClientId = app.clientId ?? clientIdForBundleId(app.bundleId);
  const policy = clientPolicy(appClientId);
  if (!policy || app.bundleId !== policy.bundleId || app.teamId !== policy.teamId || !app.safeToLaunch) {
    return blocked(app, clientTrustFailureReason(app, policy));
  }
  // Adapters returned by loadAdapters() retain an in-memory record that their
  // Codex/Doubao review chain was checked. Re-normalising them would erase
  // that proof; raw caller data is still normalised but never receives it.
  const normalizedAdapters = adapters.map((adapter) =>
    reviewedDoubaoAdapterTransports.has(adapter) || reviewedCodexExactAdapters.has(adapter)
      ? adapter : normalizeAdapter(adapter)
  ).filter(Boolean);
  const exactMatches = normalizedAdapters.filter((adapter) =>
    adapter.validation.status === 'runtime-verified' && matches(adapter, app));
  const exact = appClientId === 'doubao'
    ? exactMatches.find((adapter) => reviewedDoubaoAdapterTransports.has(adapter)) ?? exactMatches[0]
    : appClientId === 'codex'
      ? exactMatches.find((adapter) => reviewedCodexExactAdapters.has(adapter)) ?? null
      : exactMatches[0];
  const candidate = normalizedAdapters.find((adapter) =>
    adapter.validation.status === 'static-candidate' && matches(adapter, app));
  if (appClientId === 'doubao') {
    if (!exact) {
      const knownReleaseIdentity = normalizedAdapters.some((adapter) =>
        adapter.clientId === 'doubao' && adapter.bundleId === app.bundleId &&
        adapter.teamId === app.teamId && adapter.versions.includes(app.version) &&
        adapter.builds.includes(app.build));
      if (knownReleaseIdentity && !candidate) {
        return blocked(
          app,
          '豆包版本号与已知版本相同，但签名资源指纹不一致；这不是普通版本更新，请重新安装官方版本。',
          {targetAllowlist: policy.targetAllowlist, probeKind: policy.defaultProbeKind},
        );
      }
      return doubaoGenericSafe(
        app,
        policy,
        '豆包版本已更新，可能存在适配问题；皮肤仍可应用，当前只启用背景、色板、玻璃与输入框机器人。',
        {candidate: candidate ?? null},
      );
    }
    const transportVerification = reviewedDoubaoAdapterTransports.get(exact) ?? null;
    const staticMissing = exact.requiredSignals.filter((name) =>
      name !== 'transportVerified' && !app.signals?.[name]);
    if (staticMissing.length) {
      return doubaoGenericSafe(
        app,
        policy,
        `豆包可能存在适配问题（未识别：${staticMissing.join(', ')}）；皮肤仍可应用，精确功能自动降级。`,
        {matchedAdapter: exact},
      );
    }
    if (!transportVerification) {
      return doubaoGenericSafe(
        app,
        policy,
        '豆包精确适配证据尚未匹配；皮肤仍可通过受限兼容通道应用，精确功能自动降级。',
        {matchedAdapter: exact},
      );
    }
    if (!exact.capabilities.length) {
      return doubaoGenericSafe(
        app,
        policy,
        '豆包精确适配暂未授予组件能力；皮肤仍可应用兼容视觉层。',
        {matchedAdapter: exact},
      );
    }
  }
  if (exact) {
    const missing = exact.requiredSignals.filter((name) =>
      !(appClientId === 'doubao' && name === 'transportVerified') && !app.signals?.[name]);
    const targetUrl = resolveAdapterTargetUrl(exact, app);
    const targetReady = Boolean(targetUrl || exact.targetAllowlist?.length);
    if (!missing.length && targetReady) {
      // Same set the compiler receives via capabilitiesForCompatibility: the
      // fixed decorative layer is not adapter-gated, so it must not be
      // reported as a disabled feature either.
      const capabilities = [...new Set([...exact.capabilities, ...FIXED_DECORATIVE_CAPABILITIES])];
      return {
        clientId: appClientId,
        level: 'exact',
        advancedAllowed: true,
        reason: '当前版本与已验证适配器完全匹配。',
        adapter: exact,
        candidateAdapter: null,
        targetUrl,
        probeKind: exact.probeKind,
        targetAllowlist: exact.targetAllowlist ?? [],
        capabilities,
        transportVerification: appClientId === 'doubao'
          ? reviewedDoubaoAdapterTransports.get(exact) ?? null
          : app.transportVerification ?? null,
        disabledFeatures: ALL_CAPABILITIES.filter((name) => !capabilities.includes(name)),
      };
    }
  }
  // Codex ships much more frequently than the exact Adapter review cycle.
  // Missing renderer tokens/selectors on a newly signed official build are
  // therefore compatibility warnings, not a reason to disable the entire
  // Agent.  Generic-safe compilation does not enable build-sensitive Banner,
  // composer, controls, motion or layout capabilities; it only attempts the
  // bounded background/palette/glass layer on the fixed app:// target.
  //
  // Keep appUrlEntry as a hard requirement.  Together with safeToLaunch above
  // (official Bundle ID, Team ID and valid seal), it proves that the target is
  // still the signed Codex renderer rather than an arbitrary application.
  const genericSignals = appClientId === 'workbuddy'
    ? ['appUrlEntry', 'semanticSelectors', 'designTokens', 'productMarker']
    : appClientId === 'codex'
      ? ['appUrlEntry']
      : ['appUrlEntry', 'semanticSelectors', 'designTokens'];
  const missing = genericSignals.filter((name) => !app.signals?.[name]);
  const targetUrl = defaultTargetUrlForApp(app);
  if (!missing.length && targetUrl) {
    const capabilities = [...GENERIC_SAFE_CAPABILITIES];
    const codexAdvisorySignals = appClientId === 'codex'
      ? ['semanticSelectors', 'designTokens'].filter((name) => !app.signals?.[name])
      : [];
    const reason = appClientId === 'codex'
      ? codexAdvisorySignals.length
        ? `Codex 版本已更新，可能存在适配问题（未识别：${codexAdvisorySignals.join(', ')}）；仍可使用背景、色板与基础玻璃层，Banner 和布局等精确功能暂时关闭。`
        : 'Codex 版本已变化；已启用兼容模式，可使用背景、色板与基础玻璃层，Banner 和布局等精确功能暂时关闭。'
      : '版本已变化；将自动降级为背景、色板与玻璃基础层，关闭 Banner 和布局适配。';
    return {
      clientId: appClientId,
      level: 'generic-safe',
      advancedAllowed: true,
      reason,
      adapter: null,
      candidateAdapter: candidate ?? null,
      candidateReason: candidate
        ? '已命中静态候选 Adapter；隔离运行矩阵与恢复证据完成前只开放 generic-safe。'
        : null,
      targetUrl,
      probeKind: policy.defaultProbeKind,
      targetAllowlist: policy.targetAllowlist ? [...policy.targetAllowlist] : [],
      capabilities,
      transportVerification: app.transportVerification ?? null,
      disabledFeatures: ALL_CAPABILITIES.filter((name) => !capabilities.includes(name)),
    };
  }
  return blocked(
    app,
    `缺少安全运行信号：${missing.length ? missing.join(', ') : 'targetUrl'}。高级皮肤已关闭。`,
  );
}

export const adapterTrustPolicies = CLIENT_TRUST_POLICIES;
