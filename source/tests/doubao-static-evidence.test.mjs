import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {BUILT_IN_ADAPTERS, DOUBAO_ARTIFACT_KEYS} from '../src/adapter.mjs';
import {CLIENT_TRUST_POLICIES} from '../src/client-app.mjs';

const evidencePath = fileURLToPath(new URL('../qa/doubao-static-2.19.9.json', import.meta.url));
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

test('Doubao 2.19.9 static evidence is locked to the built-in zero-capability adapter', () => {
  const adapter = BUILT_IN_ADAPTERS.find(({adapterId}) =>
    adapterId === 'doubao-macos-2.19.9-build-2.19.9-static');
  assert.ok(adapter);
  assert.equal(evidence.auditKind, 'static-only');
  assert.equal(evidence.runtimeValidationPerformed, false);
  assert.equal(evidence.app.bundleId, adapter.bundleId);
  assert.equal(evidence.app.teamId, adapter.teamId);
  assert.equal(evidence.app.version, adapter.versions[0]);
  assert.equal(evidence.app.build, adapter.builds[0]);
  assert.equal(evidence.app.cdHash, adapter.mainCDHash[0]);
  assert.equal(evidence.app.nestedBrowser.bundleId, adapter.nestedBundleId);
  assert.equal(evidence.app.nestedBrowser.cdHash, adapter.nestedCDHash[0]);
  assert.equal(evidence.app.chromiumFrameworkVersion, adapter.chromiumFrameworkVersion);
  assert.equal(evidence.app.manifestCommit, adapter.manifestCommit[0]);
  assert.equal(evidence.localExtension.id, adapter.extensionId);
  assert.equal(evidence.localExtension.version, adapter.extensionVersion[0]);
  for (const key of DOUBAO_ARTIFACT_KEYS) {
    assert.equal(evidence.integrity.artifactSha256[key], adapter.artifactSha256[key][0]);
  }
  assert.deepEqual(adapter.capabilities, []);
  assert.deepEqual(evidence.effectiveCompatibility, {
    level: 'blocked',
    transportVerified: false,
    runtimeDomVerified: false,
    capabilities: [],
    advancedAllowed: false,
  });
});

test('Doubao static switch and renderer hints cannot be mistaken for runtime proof', () => {
  assert.equal(evidence.staticRuntimeHints.evidenceClass, 'static-only');
  assert.equal(evidence.staticRuntimeHints.wrapperArgumentForwardingVerified, false);
  assert.equal(evidence.staticRuntimeHints.runtimeDomVerified, false);
  assert.equal(evidence.staticRuntimeHints.mainWrapper.markers['remote-debugging-pipe'], false);
  assert.equal(evidence.staticRuntimeHints.nestedLauncher.markers['remote-debugging-pipe'], false);
  assert.equal(evidence.staticRuntimeHints.chromiumFramework.markers['remote-debugging-pipe'], true);
  assert.equal(evidence.staticRuntimeHints.chromiumFramework.markers['saman-from-chat'], true);
  assert.equal(evidence.staticRendererAnchors.runtimeDomVerified, false);
  assert.equal(evidence.staticRendererAnchors.semanticSelectors.includes('send_message'), false);
  assert.equal(evidence.staticRendererAnchors.semanticSelectors.includes('message-list'), false);
  assert.deepEqual(evidence.targetAllowlist, CLIENT_TRUST_POLICIES.doubao.targetAllowlist);
  assert.equal(evidence.safetyBoundary.startedApp, false);
  assert.equal(evidence.safetyBoundary.quitOrRestartedApp, false);
  assert.equal(evidence.safetyBoundary.operatedAppUi, false);
  assert.equal(evidence.safetyBoundary.modifiedInstalledApp, false);
});

test('current-host signature diagnostic remains fail closed without claiming package damage', () => {
  assert.equal(evidence.app.signatureStatus, 'unverifiable-current-host-codesigning-subsystem');
  assert.equal(evidence.app.signatureCheck.providerOutcome, 'blocked');
  assert.match(evidence.app.signatureCheck.note, /not evidence that Doubao was modified/u);
  assert.equal(evidence.processObservation.runningMainProcessObserved, false);
  assert.match(evidence.processObservation.note, /no current argv claim/u);
});
