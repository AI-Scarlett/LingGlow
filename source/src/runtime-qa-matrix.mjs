import {
  CODEX_TARGET_ALLOWLIST,
  DOUBAO_TARGET_ALLOWLIST,
} from './transport-strategy.mjs';
import {
  DOUBAO_QA_CANDIDATE_STATUS,
  DOUBAO_QA_DOM_PROBE_SCOPE,
  DOUBAO_QA_EVIDENCE_KIND,
  DOUBAO_QA_EVIDENCE_SCHEMA_VERSION,
  DOUBAO_QA_ISOLATION_SCOPE,
} from './doubao-qa-policy.mjs';

// This is a planning/review contract only.  It does not launch an Agent,
// attach CDP, mutate an adapter, or mint any exact-compatibility permission.
// Keeping the route/state vocabulary here gives the Adapter gate and the
// human-readable checklist one source of truth.
export const RUNTIME_QA_COVERAGE_SCHEMA_VERSION = 1;
export const RUNTIME_QA_COVERAGE_KIND = 'lingglow.runtime-qa-coverage-checklist';
export const RUNTIME_QA_COVERAGE_STATUSES = Object.freeze([
  'planning-only',
  'completed-review',
]);

export const CODEX_QA_EVIDENCE_SCHEMA_VERSION = 1;
export const CODEX_QA_CANDIDATE_STATUS = 'candidate-runtime-probe';
export const EXACT_PROMOTION_STATUS = 'exact-promotion-approved';

export const CODEX_RUNTIME_EVIDENCE_REQUIREMENTS = Object.freeze({
  routes: Object.freeze([
    'home',
    'projects',
    'local-thread',
    'remote-thread',
    'diff-review',
    'settings',
    'plugins',
  ]),
  states: Object.freeze([
    'sidebar-expanded',
    'sidebar-collapsed',
    'composer-idle',
    'composer-send',
    'composer-stop',
    'composer-queue',
    'light',
    'dark',
    'narrow-window',
    'reduced-motion',
  ]),
});

const CODEX_SELECTOR_PROOF_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: 'root',
    selector: '#root',
    routes: Object.freeze([...CODEX_RUNTIME_EVIDENCE_REQUIREMENTS.routes]),
    states: Object.freeze([]),
    source: 'runtime-structure',
  }),
  Object.freeze({
    id: 'shell',
    selector: '[data-app-shell-main-content-layout]',
    routes: Object.freeze(['home', 'projects', 'local-thread', 'remote-thread', 'diff-review']),
    states: Object.freeze([]),
    source: 'candidate-static',
  }),
  Object.freeze({
    id: 'sidebar',
    selector: '[data-app-action-sidebar-scroll]',
    routes: Object.freeze(['home', 'projects']),
    states: Object.freeze(['sidebar-expanded', 'sidebar-collapsed']),
    source: 'candidate-static',
  }),
  Object.freeze({
    id: 'composer',
    selector: '[data-codex-composer]',
    routes: Object.freeze(['local-thread', 'remote-thread']),
    states: Object.freeze([
      'composer-idle',
      'composer-send',
      'composer-stop',
      'composer-queue',
    ]),
    source: 'candidate-static',
  }),
  Object.freeze({
    id: 'diff',
    selector: '[data-diff]',
    routes: Object.freeze(['diff-review']),
    states: Object.freeze([]),
    source: 'candidate-static',
  }),
  Object.freeze({
    id: 'settings',
    selector: '[data-settings-panel-slug]',
    routes: Object.freeze(['settings']),
    states: Object.freeze([]),
    source: 'candidate-static',
  }),
  // Static inspection found no stable selector for either item.  A future
  // exact review must record the newly audited selector/count-only proof;
  // screenshots, text and localized labels do not satisfy this slot.
  Object.freeze({
    id: 'send-stop',
    selector: null,
    routes: Object.freeze(['local-thread', 'remote-thread']),
    states: Object.freeze(['composer-send', 'composer-stop']),
    source: 'pending-runtime-discovery',
  }),
  Object.freeze({
    id: 'plugins',
    selector: null,
    routes: Object.freeze(['plugins']),
    states: Object.freeze([]),
    source: 'pending-runtime-discovery',
  }),
]);

const DOUBAO_RUNTIME_QA_REQUIREMENTS = Object.freeze({
  routes: Object.freeze([
    'side-panel',
    'chat',
    'history-navigation',
  ]),
  states: Object.freeze([
    'composer-idle',
    'composer-send',
    'composer-stop',
  ]),
});

const DOUBAO_SELECTOR_PROOF_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: 'root',
    selector: '#root',
    routes: Object.freeze(['side-panel', 'chat']),
    states: Object.freeze([]),
    source: 'candidate-static',
  }),
  Object.freeze({
    id: 'side-panel-skeleton',
    selector: '#sidepanel_skeleton',
    routes: Object.freeze(['side-panel']),
    states: Object.freeze([]),
    source: 'candidate-static',
  }),
  Object.freeze({
    id: 'chat-input',
    selector: '[data-testid="chat_input"]',
    routes: Object.freeze(['chat']),
    states: Object.freeze(['composer-idle', 'composer-send', 'composer-stop']),
    source: 'candidate-static',
  }),
  Object.freeze({
    id: 'chat-input-input',
    selector: '[data-testid="chat_input_input"]',
    routes: Object.freeze(['chat']),
    states: Object.freeze(['composer-idle']),
    source: 'candidate-static',
  }),
  Object.freeze({
    id: 'message-text-content',
    selector: '[data-testid="message_text_content"]',
    routes: Object.freeze(['chat']),
    states: Object.freeze([]),
    source: 'candidate-static',
  }),
  Object.freeze({
    id: 'history-navigation',
    selector: null,
    routes: Object.freeze(['history-navigation']),
    states: Object.freeze([]),
    source: 'pending-runtime-discovery',
  }),
  Object.freeze({
    id: 'send-stop',
    selector: null,
    routes: Object.freeze(['chat']),
    states: Object.freeze(['composer-send', 'composer-stop']),
    source: 'pending-runtime-discovery',
  }),
]);

const RUNTIME_QA_REQUIREMENTS = Object.freeze({
  codex: Object.freeze({
    targetAllowlist: Object.freeze([...CODEX_TARGET_ALLOWLIST]),
    routes: CODEX_RUNTIME_EVIDENCE_REQUIREMENTS.routes,
    states: CODEX_RUNTIME_EVIDENCE_REQUIREMENTS.states,
    selectorProof: CODEX_SELECTOR_PROOF_REQUIREMENTS,
    evidence: Object.freeze({
      schemaVersion: CODEX_QA_EVIDENCE_SCHEMA_VERSION,
      candidateKind: 'lingglow.codex-isolated-qa-evidence',
      candidateStatus: CODEX_QA_CANDIDATE_STATUS,
      promotionStatus: EXACT_PROMOTION_STATUS,
      isolationBoundary: 'separate-macos-user-or-disposable-vm',
    }),
    cleanup: Object.freeze([
      'cleanupVerified',
      'stockRestoreVerified',
      'testCssRemoved',
      'installedArtifactUnchanged',
    ]),
  }),
  doubao: Object.freeze({
    targetAllowlist: Object.freeze([...DOUBAO_TARGET_ALLOWLIST]),
    routes: DOUBAO_RUNTIME_QA_REQUIREMENTS.routes,
    states: DOUBAO_RUNTIME_QA_REQUIREMENTS.states,
    selectorProof: DOUBAO_SELECTOR_PROOF_REQUIREMENTS,
    evidence: Object.freeze({
      schemaVersion: DOUBAO_QA_EVIDENCE_SCHEMA_VERSION,
      candidateKind: DOUBAO_QA_EVIDENCE_KIND,
      candidateStatus: DOUBAO_QA_CANDIDATE_STATUS,
      promotionStatus: EXACT_PROMOTION_STATUS,
      isolationBoundary: DOUBAO_QA_ISOLATION_SCOPE,
      domProbeScope: DOUBAO_QA_DOM_PROBE_SCOPE,
    }),
    cleanup: Object.freeze([
      'cleanupVerified',
      'stockRestoreVerified',
      'noAutomaticPromotion',
      'isolatedProfileRemoved',
      'noResidualDebugProcess',
    ]),
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameStringSet(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false;
  const firstSet = new Set(first);
  const secondSet = new Set(second);
  return firstSet.size === first.length && secondSet.size === second.length &&
    [...firstSet].every((item) => secondSet.has(item));
}

function stringSet(values) {
  if (!Array.isArray(values)) return new Set();
  return new Set(values.filter((value) => typeof value === 'string' && value));
}

function verifiedSelectorIds(records) {
  if (!Array.isArray(records)) return new Set();
  return new Set(records
    .filter((record) => record && typeof record === 'object' && record.method === 'count-only')
    .map((record) => record.id)
    .filter((id) => typeof id === 'string' && id));
}

/**
 * Canonical review requirements.  The returned data is frozen and may be
 * used to render a UI or create a saved review document, but is never an
 * adapter capability grant.
 */
export function runtimeQaCoverageRequirementsFor(clientId) {
  return RUNTIME_QA_REQUIREMENTS[clientId] ?? null;
}

/**
 * Return a fresh, editable, machine-readable review checklist.  It starts in
 * `planning-only`; filling it never changes application compatibility.
 */
export function runtimeQaCoverageChecklistFor(clientId) {
  const requirements = runtimeQaCoverageRequirementsFor(clientId);
  if (!requirements) return null;
  return {
    schemaVersion: RUNTIME_QA_COVERAGE_SCHEMA_VERSION,
    kind: RUNTIME_QA_COVERAGE_KIND,
    status: 'planning-only',
    clientId,
    promotionAuthority: 'none',
    evidence: clone(requirements.evidence),
    targetInventory: {
      pageTargetInventoryComplete: false,
      expectedAllowlist: [...requirements.targetAllowlist],
      observedTargets: [],
    },
    routes: {
      required: [...requirements.routes],
      verified: [],
    },
    states: {
      required: [...requirements.states],
      verified: [],
    },
    selectorProof: {
      // Each verified item must use `method: "count-only"` and retain no
      // page text, input value, cookie, storage or arbitrary script output.
      required: clone(requirements.selectorProof),
      verified: [],
    },
    cleanup: Object.fromEntries(requirements.cleanup.map((field) => [field, false])),
  };
}

/**
 * Return missing coverage items for a filled review checklist.  A result of
 * `[]` only says the checklist is complete; callers must still use the
 * existing digest-pinned Adapter review gates to promote any capability.
 */
export function runtimeQaCoverageChecklistGaps(checklist) {
  const requirements = runtimeQaCoverageRequirementsFor(checklist?.clientId);
  if (!requirements) return Object.freeze([{section: 'client', id: 'unsupported-client'}]);
  const gaps = [];
  if (checklist?.schemaVersion !== RUNTIME_QA_COVERAGE_SCHEMA_VERSION ||
      checklist?.kind !== RUNTIME_QA_COVERAGE_KIND) {
    gaps.push({section: 'document', id: 'schema'});
  }
  if (!RUNTIME_QA_COVERAGE_STATUSES.includes(checklist?.status)) {
    gaps.push({section: 'document', id: 'status'});
  }
  if (checklist?.promotionAuthority !== 'none') {
    gaps.push({section: 'document', id: 'promotion-authority'});
  }
  const inventory = checklist?.targetInventory;
  if (inventory?.pageTargetInventoryComplete !== true ||
      !sameStringSet(inventory?.observedTargets, requirements.targetAllowlist)) {
    gaps.push({section: 'target-inventory', id: 'complete-allowlisted-pages'});
  }
  const routes = stringSet(checklist?.routes?.verified);
  for (const route of requirements.routes) {
    if (!routes.has(route)) gaps.push({section: 'routes', id: route});
  }
  const states = stringSet(checklist?.states?.verified);
  for (const state of requirements.states) {
    if (!states.has(state)) gaps.push({section: 'states', id: state});
  }
  const selectors = verifiedSelectorIds(checklist?.selectorProof?.verified);
  for (const {id} of requirements.selectorProof) {
    if (!selectors.has(id)) gaps.push({section: 'selector-proof', id});
  }
  for (const field of requirements.cleanup) {
    if (checklist?.cleanup?.[field] !== true) gaps.push({section: 'cleanup', id: field});
  }
  return Object.freeze(gaps.map((gap) => Object.freeze(gap)));
}
