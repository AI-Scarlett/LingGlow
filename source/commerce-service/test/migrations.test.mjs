import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {DODO_PRODUCT_IDS} from '../../src/products.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function allFiles(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    if (entry.isDirectory() && ['node_modules', '.git', 'coverage'].includes(entry.name)) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(target) : [target];
  });
}

test('PostgreSQL migrations contain every required durable boundary and immutable trigger', () => {
  const schema = read('migrations/001_core_schema.sql');
  const guards = read('migrations/002_immutable_guards.sql');
  const deviceInstances = read('migrations/003_dodo_license_instance.sql');
  const requireDeviceInstances = read('migrations/004_require_dodo_license_instance.sql');
  const firstRedemption = read('migrations/005_first_redemption_and_license_identity.sql');
  for (const table of [
    'checkout_orders', 'idempotency_records', 'processed_webhook_events',
    'redemption_bindings', 'entitlement_grants', 'device_activations', 'audit_events',
  ]) assert.match(schema, new RegExp(`CREATE TABLE ${table}\\b`, 'u'));
  assert.match(schema, /UNIQUE \(customer_id, idempotency_key_hash\)/u);
  assert.match(schema, /webhook_id text PRIMARY KEY/u);
  assert.match(schema, /dodo_license_key_instance_id text NOT NULL/u);
  assert.match(schema, /device_activations_dodo_instance_unique_idx/u);
  assert.match(schema, /WHERE deactivated_at IS NULL/u);
  assert.match(guards, /CREATE FUNCTION reject_binding_rewrite/u);
  assert.match(guards, /CREATE TRIGGER redemption_binding_is_immutable/u);
  assert.match(guards, /CREATE TRIGGER entitlement_grant_identity_is_immutable/u);
  assert.match(guards, /IMMUTABLE_ROW_DELETE_FORBIDDEN/u);
  assert.match(guards, /AUDIT_APPEND_ONLY/u);
  assert.match(deviceInstances, /reject_device_activation_identity_rewrite/u);
  assert.match(deviceInstances, /OLD\.dodo_license_key_instance_id IS NOT NULL/u);
  assert.match(deviceInstances, /device_activation_identity_is_immutable/u);
  assert.match(requireDeviceInstances, /DODO_LICENSE_INSTANCE_BACKFILL_REQUIRED/u);
  assert.match(requireDeviceInstances, /ALTER COLUMN dodo_license_key_instance_id SET NOT NULL/u);
  assert.match(firstRedemption, /CREATE TABLE dodo_license_identities/u);
  assert.match(firstRedemption, /CHECK \(locked_skin_id IS NULL\)/u);
  assert.match(firstRedemption, /dodo_license_identities_payment_id_unique_idx/u);
  assert.match(firstRedemption, /dodo_license_identities_subscription_id_unique_idx/u);
  assert.match(firstRedemption, /LICENSE_IDENTITY_IMMUTABLE/u);
});

test('commerce runtime contains no copied real Dodo Product ID outside the canonical directory', () => {
  const text = allFiles(ROOT)
    .filter((file) => !file.endsWith('package-lock.json'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  for (const productId of Object.values(DODO_PRODUCT_IDS)) {
    assert.equal(text.includes(productId), false, productId);
  }
});
