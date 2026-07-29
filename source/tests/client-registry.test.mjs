import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_LABELS,
  CLIENT_REGISTRY,
  LEGACY_CATALOG_CLIENT_IDS,
  SCHEDULE_CLIENT_IDS,
  TARGET_CLIENT_IDS,
  clientRegistryEntry,
  isRegisteredClientId,
} from '../src/client-registry.mjs';
import {CLIENT_CAPABILITY_MAPS, UNION_CLIENT_IDS} from '../src/capability-schema.mjs';
import {SUPPORTED_CLIENT_IDS} from '../src/client-app.mjs';

test('the canonical Agent registry is the single source for schema and discovery targets', () => {
  assert.deepEqual(TARGET_CLIENT_IDS, CLIENT_REGISTRY.map((entry) => entry.id));
  assert.deepEqual(UNION_CLIENT_IDS, TARGET_CLIENT_IDS);
  assert.deepEqual(SUPPORTED_CLIENT_IDS, TARGET_CLIENT_IDS);
  assert.deepEqual(Object.keys(CLIENT_CAPABILITY_MAPS), TARGET_CLIENT_IDS);
  assert.deepEqual(
    LEGACY_CATALOG_CLIENT_IDS,
    CLIENT_REGISTRY.filter((entry) => entry.legacyCatalog).map((entry) => entry.id),
  );
  assert.deepEqual(
    SCHEDULE_CLIENT_IDS,
    CLIENT_REGISTRY.filter((entry) => entry.scheduleEligible).map((entry) => entry.id),
  );
  for (const clientId of TARGET_CLIENT_IDS) {
    assert.equal(isRegisteredClientId(clientId), true);
    assert.equal(clientRegistryEntry(clientId)?.displayName, CLIENT_LABELS[clientId]);
  }
  assert.equal(isRegisteredClientId('future-agent'), false);
  assert.equal(clientRegistryEntry('future-agent'), null);
});
