import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  CODEX_RUNTIME_EVIDENCE_REQUIREMENTS as ADAPTER_CODEX_REQUIREMENTS,
} from '../src/adapter.mjs';
import {
  CODEX_RUNTIME_EVIDENCE_REQUIREMENTS,
  RUNTIME_QA_COVERAGE_KIND,
  runtimeQaCoverageChecklistFor,
  runtimeQaCoverageChecklistGaps,
  runtimeQaCoverageRequirementsFor,
} from '../src/runtime-qa-matrix.mjs';
import {
  CODEX_TARGET_ALLOWLIST,
  DOUBAO_TARGET_ALLOWLIST,
  launchStrategyFor,
} from '../src/transport-strategy.mjs';
import {
  DOUBAO_QA_CANDIDATE_STATUS,
  DOUBAO_QA_DOM_PROBE_SCOPE,
  DOUBAO_QA_EVIDENCE_KIND,
  DOUBAO_QA_EVIDENCE_SCHEMA_VERSION,
  DOUBAO_QA_ISOLATION_SCOPE,
} from '../src/doubao-qa-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function completedChecklist(clientId) {
  const checklist = runtimeQaCoverageChecklistFor(clientId);
  checklist.status = 'completed-review';
  checklist.targetInventory.pageTargetInventoryComplete = true;
  checklist.targetInventory.observedTargets = [...checklist.targetInventory.expectedAllowlist];
  checklist.routes.verified = [...checklist.routes.required];
  checklist.states.verified = [...checklist.states.required];
  checklist.selectorProof.verified = checklist.selectorProof.required.map(({id}) => ({
    id,
    method: 'count-only',
  }));
  for (const field of Object.keys(checklist.cleanup)) checklist.cleanup[field] = true;
  return checklist;
}

test('Codex runtime QA checklist and exact Adapter gate share one route/state source of truth', () => {
  const checklist = runtimeQaCoverageChecklistFor('codex');
  assert.equal(checklist.kind, RUNTIME_QA_COVERAGE_KIND);
  assert.equal(checklist.promotionAuthority, 'none');
  assert.deepEqual(checklist.targetInventory.expectedAllowlist, CODEX_TARGET_ALLOWLIST);
  assert.deepEqual(checklist.routes.required, CODEX_RUNTIME_EVIDENCE_REQUIREMENTS.routes);
  assert.deepEqual(checklist.states.required, CODEX_RUNTIME_EVIDENCE_REQUIREMENTS.states);
  assert.equal(ADAPTER_CODEX_REQUIREMENTS, CODEX_RUNTIME_EVIDENCE_REQUIREMENTS);
  assert.deepEqual(
    checklist.selectorProof.required.map(({id}) => id),
    ['root', 'shell', 'sidebar', 'composer', 'diff', 'settings', 'send-stop', 'plugins'],
  );
  assert.equal(
    checklist.selectorProof.required.find(({id}) => id === 'send-stop').source,
    'pending-runtime-discovery',
  );
  assert.ok(runtimeQaCoverageChecklistGaps(checklist).length > 0);
});

test('Doubao checklist reuses its candidate-evidence policy and never treats static anchors as a promotion', () => {
  const checklist = runtimeQaCoverageChecklistFor('doubao');
  assert.equal(checklist.evidence.schemaVersion, DOUBAO_QA_EVIDENCE_SCHEMA_VERSION);
  assert.equal(checklist.evidence.candidateKind, DOUBAO_QA_EVIDENCE_KIND);
  assert.equal(checklist.evidence.candidateStatus, DOUBAO_QA_CANDIDATE_STATUS);
  assert.equal(checklist.evidence.isolationBoundary, DOUBAO_QA_ISOLATION_SCOPE);
  assert.equal(checklist.evidence.domProbeScope, DOUBAO_QA_DOM_PROBE_SCOPE);
  assert.deepEqual(checklist.targetInventory.expectedAllowlist, DOUBAO_TARGET_ALLOWLIST);
  assert.deepEqual(checklist.routes.required, ['side-panel', 'chat', 'history-navigation']);
  assert.deepEqual(checklist.states.required, ['composer-idle', 'composer-send', 'composer-stop']);
  assert.equal(checklist.promotionAuthority, 'none');

  const reviewed = completedChecklist('doubao');
  assert.deepEqual(runtimeQaCoverageChecklistGaps(reviewed), []);
  assert.equal(
    launchStrategyFor({clientId: 'doubao', fingerprint: 'a'.repeat(64)}, reviewed).allowed,
    false,
    'a fully filled planning document must not become a transport permission',
  );
});

test('coverage checklist completeness requires full target inventory, each route/state, count-only selector proof and cleanup', () => {
  const checklist = completedChecklist('codex');
  assert.deepEqual(runtimeQaCoverageChecklistGaps(checklist), []);

  checklist.targetInventory.observedTargets = [];
  checklist.states.verified = checklist.states.verified.filter((state) => state !== 'reduced-motion');
  checklist.selectorProof.verified = checklist.selectorProof.verified.filter(({id}) => id !== 'plugins');
  checklist.cleanup.stockRestoreVerified = false;
  const gaps = runtimeQaCoverageChecklistGaps(checklist);
  assert.deepEqual(gaps, [
    {section: 'target-inventory', id: 'complete-allowlisted-pages'},
    {section: 'states', id: 'reduced-motion'},
    {section: 'selector-proof', id: 'plugins'},
    {section: 'cleanup', id: 'stockRestoreVerified'},
  ]);
});

test('coverage matrix is a pure, local planning aid with no target-launch implementation', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'runtime-qa-matrix.mjs'), 'utf8');
  assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|PipeTransport|Runtime\.evaluate/u);
  assert.equal(runtimeQaCoverageRequirementsFor('workbuddy'), null);
  assert.equal(runtimeQaCoverageChecklistFor('workbuddy'), null);
  assert.deepEqual(runtimeQaCoverageChecklistGaps({clientId: 'workbuddy'}), [
    {section: 'client', id: 'unsupported-client'},
  ]);
});
