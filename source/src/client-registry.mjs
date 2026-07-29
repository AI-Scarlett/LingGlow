/**
 * Canonical target-Agent registry.
 *
 * A skin profile is a union document and can mention every target Agent.  The
 * legacy v1 catalog intentionally remains narrower while a target is still
 * blocked, but entitlement leases, schedules, the server and capability
 * schema must not silently forget that target.  Keep those two concepts
 * separate here so adding a fourth Agent is a registry/adapter task rather
 * than a scattered collection of string-list edits.
 */

export const CLIENT_REGISTRY_SCHEMA_VERSION = 1;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

const CLIENT_ID = /^[a-z][a-z0-9-]{1,47}$/u;

function validateRegistry(entries) {
  if (!Array.isArray(entries) || entries.length < 1) throw new Error('客户端注册表不能为空');
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !CLIENT_ID.test(entry.id) || ids.has(entry.id) ||
        typeof entry.displayName !== 'string' || !entry.displayName.trim() || entry.displayName.length > 80 ||
        typeof entry.legacyCatalog !== 'boolean' || typeof entry.scheduleEligible !== 'boolean') {
      throw new Error('客户端注册表条目不合法');
    }
    ids.add(entry.id);
  }
  return entries;
}

/**
 * `scheduleEligible` means the product model has a slot for the Agent.  The
 * runtime still gates actual reminders/apply through its verified adapter;
 * therefore a blocked Agent never receives a reminder merely because it is
 * listed here.
 */
export const CLIENT_REGISTRY = deepFreeze(validateRegistry([
  {
    id: 'workbuddy',
    displayName: 'WorkBuddy',
    legacyCatalog: true,
    scheduleEligible: true,
  },
  {
    id: 'doubao',
    displayName: '豆包',
    legacyCatalog: false,
    scheduleEligible: true,
  },
  {
    id: 'codex',
    displayName: 'Codex',
    legacyCatalog: true,
    scheduleEligible: true,
  },
]));

export const TARGET_CLIENT_IDS = Object.freeze(CLIENT_REGISTRY.map(({id}) => id));
export const LEGACY_CATALOG_CLIENT_IDS = Object.freeze(
  CLIENT_REGISTRY.filter(({legacyCatalog}) => legacyCatalog).map(({id}) => id),
);
export const SCHEDULE_CLIENT_IDS = Object.freeze(
  CLIENT_REGISTRY.filter(({scheduleEligible}) => scheduleEligible).map(({id}) => id),
);
export const CLIENT_LABELS = deepFreeze(Object.fromEntries(
  CLIENT_REGISTRY.map(({id, displayName}) => [id, displayName]),
));

const CLIENT_BY_ID = new Map(CLIENT_REGISTRY.map((entry) => [entry.id, entry]));

export function clientRegistryEntry(clientId) {
  return CLIENT_BY_ID.get(clientId) ?? null;
}

export function isRegisteredClientId(clientId) {
  return CLIENT_BY_ID.has(clientId);
}
