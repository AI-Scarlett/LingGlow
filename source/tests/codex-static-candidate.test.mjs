import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  CODEX_RUNTIME_EVIDENCE_REQUIREMENTS,
  GENERIC_SAFE_CAPABILITIES,
  capabilitiesForCompatibility,
  compatibilityFor,
  loadAdapters,
} from '../src/adapter.mjs';
import {compileSkin} from '../src/skin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE_PATH = path.join(
  ROOT,
  'adapters',
  'codex-macos-26.707.91948-build-5440-static-candidate.json',
);
const HISTORICAL_CODEX_ADAPTER_PATH = path.join(
  ROOT,
  'adapters',
  'macos-26.707.72221.json',
);
const BASELINE_PATH = path.join(ROOT, 'qa', 'codex-static-26.707.91948.json');
const candidateSource = JSON.parse(fs.readFileSync(CANDIDATE_PATH, 'utf8'));
const historicalCodexAdapter = JSON.parse(fs.readFileSync(HISTORICAL_CODEX_ADAPTER_PATH, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function candidateApp(overrides = {}) {
  return {
    clientId: 'codex',
    safeToLaunch: true,
    bundleId: candidateSource.bundleId,
    teamId: candidateSource.teamId,
    version: candidateSource.versions[0],
    build: candidateSource.builds[0],
    asarSha256: candidateSource.asarSha256[0],
    signals: Object.fromEntries(candidateSource.requiredSignals.map((name) => [name, true])),
    ...overrides,
  };
}

test('Codex 5440 static candidate is pinned to the bounded baseline and cannot become exact', () => {
  const actualBaselineDigest = sha256(fs.readFileSync(BASELINE_PATH));
  assert.equal(candidateSource.validation.staticBaselineSha256, actualBaselineDigest);
  assert.equal(candidateSource.validation.status, 'static-candidate');
  assert.equal(candidateSource.validation.runtimeEvidenceRequired, true);
  assert.equal(baseline.auditKind, 'static-only');
  assert.equal(baseline.runtimeValidationPerformed, false);
  assert.equal(baseline.app.version, '26.707.91948');
  assert.equal(baseline.app.build, '5440');
  assert.equal(baseline.integrity.asarRawSha256, candidateSource.asarSha256[0]);
  assert.equal(baseline.adapterDrift.staticCandidateAdapter, candidateSource.adapterId);

  const adapter = loadAdapters().find(({adapterId}) => adapterId === candidateSource.adapterId);
  assert.ok(adapter);
  assert.deepEqual(adapter.targetAllowlist, ['app://-/index.html']);
  assert.deepEqual(adapter.capabilities, [
    'background', 'palette', 'glass', 'composer', 'sidebar-width',
  ]);

  const compatibility = compatibilityFor(candidateApp());
  assert.equal(compatibility.level, 'generic-safe');
  assert.equal(compatibility.adapter, null);
  assert.equal(compatibility.candidateAdapter.adapterId, candidateSource.adapterId);
  assert.deepEqual(compatibility.targetAllowlist, ['app://-/index.html']);
  assert.deepEqual(capabilitiesForCompatibility(compatibility), GENERIC_SAFE_CAPABILITIES);
  assert.equal(compatibility.disabledFeatures.includes('composer'), true);
  assert.equal(compatibility.disabledFeatures.includes('sidebar-width'), true);

  const untrustedHost = compatibilityFor(candidateApp({safeToLaunch: false}));
  assert.equal(untrustedHost.level, 'blocked');
  assert.deepEqual(untrustedHost.capabilities, []);
});

test('historical Codex adapter without digest-pinned isolated evidence cannot become exact', () => {
  assert.equal(historicalCodexAdapter.validation, undefined);
  assert.equal(
    loadAdapters().some(({adapterId}) => adapterId === historicalCodexAdapter.adapterId),
    false,
  );

  const compatibility = compatibilityFor({
    clientId: 'codex',
    safeToLaunch: true,
    bundleId: historicalCodexAdapter.bundleId,
    teamId: historicalCodexAdapter.teamId,
    version: historicalCodexAdapter.versions[0],
    build: historicalCodexAdapter.builds[0],
    asarSha256: historicalCodexAdapter.asarSha256[0],
    signals: {
      appUrlEntry: true,
      semanticSelectors: true,
      designTokens: true,
    },
  });
  assert.equal(compatibility.level, 'generic-safe');
  assert.equal(compatibility.adapter, null);
  assert.deepEqual(capabilitiesForCompatibility(compatibility), GENERIC_SAFE_CAPABILITIES);
});

test('5440 advanced candidates use semantic hooks only and omit unproven Banner, brand, and motion', () => {
  const composerSelectors = baseline.surfaces.composer.selectors;
  assert.equal(baseline.surfaces.composer.status, 'candidate-static');
  assert.equal(composerSelectors.includes('[data-codex-composer]'), true);
  assert.equal(composerSelectors.includes('[data-codex-composer-root]'), true);
  assert.equal(baseline.designTokens.shapeAndLayout.includes('--spacing-token-sidebar'), true);
  assert.equal(baseline.surfaces.sendAndStop.status, 'pending-runtime');
  assert.equal(baseline.surfaces.appShellLogo.status, 'pending-runtime');
  assert.equal(baseline.surfaces.banner.status, 'pending-runtime');
  assert.equal(candidateSource.capabilities.includes('banner'), false);
  assert.equal(candidateSource.capabilities.includes('brand'), false);
  assert.equal(candidateSource.capabilities.includes('motion'), false);

  const profile = {
    id: 'codex-5440-static-candidate-test',
    name: 'Codex 5440 candidate',
    official: {accent: '#7AA2F7', surface: '#111827', ink: '#E5E7EB'},
    advanced: {
      enabled: true,
      banner: {enabled: true},
      glass: {enabled: true, blur: 18},
      motion: 'subtle',
      sidebarWidth: 300,
    },
  };
  const compiled = compileSkin(profile, {
    clientId: 'codex',
    capabilityLevel: 'exact',
    capabilities: candidateSource.capabilities,
  });
  assert.match(compiled.css, /\[data-codex-composer\]/u);
  assert.match(compiled.css, /--spacing-token-sidebar: 300px/u);
  assert.doesNotMatch(compiled.css, /body::after|@keyframes codex-skin-breathe|aria-label|nth-child/u);
  assert.equal(compiled.audit.bannerEnabled, false);
  assert.equal(compiled.audit.layoutFeaturesEnabled, true);
});

test('runtime-required adapter promotion accepts only a digest-pinned, reviewed matrix', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-codex-adapter-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const adaptersDir = path.join(root, 'adapters');
  const qaDir = path.join(root, 'qa');
  fs.mkdirSync(adaptersDir);
  fs.mkdirSync(qaDir);

  const staticDocument = {
    auditKind: 'static-only',
    runtimeValidationPerformed: false,
    app: {
      bundleId: candidateSource.bundleId,
      teamId: candidateSource.teamId,
      version: candidateSource.versions[0],
      build: candidateSource.builds[0],
      chromium: '150.0.7871.115',
    },
    integrity: {asarRawSha256: candidateSource.asarSha256[0]},
    adapterDrift: {staticCandidateAdapter: candidateSource.adapterId},
  };
  const staticText = JSON.stringify(staticDocument);
  const runtimeDocument = {
    schemaVersion: 1,
    kind: candidateSource.validation.runtimeEvidenceKind,
    status: 'exact-promotion-approved',
    exactAdapterEnabled: true,
    cleanupVerified: true,
    stockRestoreVerified: true,
    adapterId: candidateSource.adapterId,
    staticCandidateAdapterId: candidateSource.adapterId,
    staticBaselineSha256: sha256(staticText),
    manualApproval: {
      decision: 'approved',
      reviewRecordId: 'codex-5440-isolated-review-20260717',
    },
    app: {
      bundleId: candidateSource.bundleId,
      teamId: candidateSource.teamId,
      version: candidateSource.versions[0],
      build: candidateSource.builds[0],
      asarSha256: candidateSource.asarSha256[0],
      chromium: staticDocument.app.chromium,
    },
    browserProduct: `Chrome/${staticDocument.app.chromium}`,
    strategyId: 'direct-pipe',
    transport: 'pipe',
    pageTargetInventoryComplete: true,
    pageTargets: candidateSource.targetAllowlist,
    testCssRemoved: true,
    integrity: {
      asarBefore: candidateSource.asarSha256[0],
      asarAfter: candidateSource.asarSha256[0],
    },
    targetAllowlist: candidateSource.targetAllowlist,
    capabilitiesVerified: candidateSource.capabilities,
    routesVerified: [...CODEX_RUNTIME_EVIDENCE_REQUIREMENTS.routes],
    statesVerified: [...CODEX_RUNTIME_EVIDENCE_REQUIREMENTS.states],
  };
  const runtimeText = JSON.stringify(runtimeDocument);
  fs.writeFileSync(path.join(qaDir, 'static.json'), staticText, {mode: 0o600});
  fs.writeFileSync(path.join(qaDir, 'runtime.json'), runtimeText, {mode: 0o600});
  const promoted = {
    ...candidateSource,
    validation: {
      status: 'runtime-verified',
      staticBaseline: 'qa/static.json',
      staticBaselineSha256: sha256(staticText),
      runtimeEvidenceRequired: true,
      runtimeEvidenceKind: candidateSource.validation.runtimeEvidenceKind,
      runtimeEvidence: 'qa/runtime.json',
      runtimeEvidenceSha256: sha256(runtimeText),
    },
  };
  fs.writeFileSync(
    path.join(adaptersDir, 'promoted.json'),
    JSON.stringify(promoted),
    {mode: 0o600},
  );
  const accepted = loadAdapters(adaptersDir).find(({adapterId}) => adapterId === promoted.adapterId);
  assert.ok(accepted);
  assert.equal(compatibilityFor(candidateApp(), [accepted]).level, 'exact');
  // File hashes are only one part of the trust decision.  A caller cannot
  // deserialize or clone this adapter to manufacture an exact permission.
  assert.equal(
    compatibilityFor(candidateApp(), [JSON.parse(JSON.stringify(accepted))]).level,
    'generic-safe',
  );
  assert.equal(compatibilityFor(candidateApp(), [{...accepted}]).level, 'generic-safe');

  const wrongPipeText = JSON.stringify({
    ...runtimeDocument,
    strategyId: 'loopback-fallback',
  });
  fs.writeFileSync(path.join(qaDir, 'runtime.json'), wrongPipeText, {mode: 0o600});
  fs.writeFileSync(
    path.join(adaptersDir, 'promoted.json'),
    JSON.stringify({
      ...promoted,
      validation: {...promoted.validation, runtimeEvidenceSha256: sha256(wrongPipeText)},
    }),
    {mode: 0o600},
  );
  assert.equal(
    loadAdapters(adaptersDir).some(({adapterId}) => adapterId === promoted.adapterId),
    false,
    'an exact record must prove the audited direct Pipe transport and one-page inventory',
  );

  const duplicatedCapabilitiesText = JSON.stringify({
    ...runtimeDocument,
    capabilitiesVerified: [
      runtimeDocument.capabilitiesVerified[0],
      runtimeDocument.capabilitiesVerified[0],
      ...runtimeDocument.capabilitiesVerified.slice(2),
    ],
  });
  fs.writeFileSync(path.join(qaDir, 'runtime.json'), duplicatedCapabilitiesText, {mode: 0o600});
  fs.writeFileSync(
    path.join(adaptersDir, 'promoted.json'),
    JSON.stringify({
      ...promoted,
      validation: {...promoted.validation, runtimeEvidenceSha256: sha256(duplicatedCapabilitiesText)},
    }),
    {mode: 0o600},
  );
  assert.equal(
    loadAdapters(adaptersDir).some(({adapterId}) => adapterId === promoted.adapterId),
    false,
    'duplicate capabilities must not stand in for a complete verified capability set',
  );

  const unreviewedText = JSON.stringify({...runtimeDocument, status: 'candidate-runtime-probe'});
  fs.writeFileSync(path.join(qaDir, 'runtime.json'), unreviewedText, {mode: 0o600});
  fs.writeFileSync(
    path.join(adaptersDir, 'promoted.json'),
    JSON.stringify({
      ...promoted,
      validation: {...promoted.validation, runtimeEvidenceSha256: sha256(unreviewedText)},
    }),
    {mode: 0o600},
  );
  assert.equal(
    loadAdapters(adaptersDir).some(({adapterId}) => adapterId === promoted.adapterId),
    false,
  );

  const unsignedReviewText = JSON.stringify({
    ...runtimeDocument,
    manualApproval: {decision: 'approved', reviewRecordId: 'short'},
  });
  fs.writeFileSync(path.join(qaDir, 'runtime.json'), unsignedReviewText, {mode: 0o600});
  fs.writeFileSync(
    path.join(adaptersDir, 'promoted.json'),
    JSON.stringify({
      ...promoted,
      validation: {...promoted.validation, runtimeEvidenceSha256: sha256(unsignedReviewText)},
    }),
    {mode: 0o600},
  );
  assert.equal(
    loadAdapters(adaptersDir).some(({adapterId}) => adapterId === promoted.adapterId),
    false,
    'a runtime matrix without a durable manual-review record cannot promote Codex',
  );
});

test('candidate metadata cannot bypass runtime validation or widen the target', () => {
  const missingRuntimeEvidence = {
    ...candidateSource,
    validation: {...candidateSource.validation, status: 'runtime-verified'},
  };
  const widenedTarget = {
    ...candidateSource,
    targetAllowlist: ['app://-/index.html', 'app://-/settings.html'],
  };
  for (const adapter of [missingRuntimeEvidence, widenedTarget]) {
    const compatibility = compatibilityFor(candidateApp(), [adapter]);
    assert.equal(compatibility.level, 'generic-safe');
    assert.equal(compatibility.adapter, null);
    assert.equal(compatibility.candidateAdapter, null);
  }
});
