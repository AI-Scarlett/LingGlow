import assert from 'node:assert/strict';
import test from 'node:test';
import {createPostgresRepository, postgresRepositoryInternals} from '../src/postgres-repository.mjs';

class MockClient {
  constructor(handler) { this.handler = handler; this.calls = []; this.released = false; }
  async query(text, values = []) {
    this.calls.push([text.trim().replace(/\s+/gu, ' '), structuredClone(values)]);
    return this.handler(text, values);
  }
  release() { this.released = true; }
}

test('PostgreSQL license lock uses one transaction and a transaction-scoped advisory lock', async () => {
  const client = new MockClient((text) => ({rowCount: 1, rows: /SELECT 1 AS ok/u.test(text) ? [{ok: 1}] : []}));
  const pool = {query() { throw new Error('pool query escaped transaction'); }, async connect() { return client; }};
  const repository = createPostgresRepository({pool});
  const value = await repository.withLicenseLock('license-key-hash:abc', async () => {
    await repository.ping();
    return 42;
  });
  assert.equal(value, 42);
  assert.match(client.calls[0][0], /^BEGIN$/u);
  assert.match(client.calls[1][0], /pg_advisory_xact_lock\(hashtextextended/u);
  assert.deepEqual(client.calls[1][1], ['license-key-hash:abc']);
  assert.match(client.calls[2][0], /^SELECT 1 AS ok$/u);
  assert.match(client.calls[3][0], /^COMMIT$/u);
  assert.equal(client.released, true);
});

test('PostgreSQL webhook replay claim is durable and never invokes callback for a duplicate id', async () => {
  let callbackCalled = false;
  const client = new MockClient((text) => {
    if (/INSERT INTO processed_webhook_events/u.test(text)) return {rowCount: 0, rows: []};
    return {rowCount: 0, rows: []};
  });
  const repository = createPostgresRepository({
    pool: {query() { throw new Error('pool query escaped transaction'); }, async connect() { return client; }},
  });
  const outcome = await repository.withWebhookEvent({webhookId: 'wh_1', eventType: 'payment.processing',
    occurredAt: '2026-07-16T12:00:00.000Z', payloadSha256: 'a'.repeat(64)}, async () => {
    callbackCalled = true;
  });
  assert.deepEqual(outcome, {duplicate: true, result: null});
  assert.equal(callbackCalled, false);
  assert.match(client.calls.at(-1)[0], /^COMMIT$/u);
});

test('repository exposes every domain Port and row mappers preserve immutable binding identity', () => {
  const repository = createPostgresRepository({
    pool: {async query() { return {rowCount: 1, rows: [{ok: 1}]}; }, async connect() { throw new Error('unused'); }},
  });
  for (const method of [
    'createOrGetCheckoutOrder', 'completeCheckoutOrder', 'markOrderPaid', 'findPaidOrder',
    'withLicenseLock', 'findLicenseIdentityByKeyHash', 'findLicenseIdentityByPurchaseReference',
    'createLicenseIdentity',
    'findGrantByLicenseKeyId', 'createGrant', 'updateGrant', 'findBindingByLicenseKeyId', 'createBinding',
    'findActiveDevice', 'activateDevice', 'deactivateDevice', 'listGrantsByCustomer',
    'withWebhookEvent', 'revokeGrantByLicenseKeyId', 'ping', 'close',
  ]) assert.equal(typeof repository[method], 'function', method);
  const record = postgresRepositoryInternals.grantRecord({
    dodo_license_key_id: 'lic_1', customer_id: 'cus_1', grant_id: 'grant_1', offer_type: 'skin_once',
    status: 'active', product_id: 'pdt_1', bound_resource_id: 'violet-nebula',
    bound_at: '2026-07-16T12:00:00.000Z', valid_until: null, revoked_at: null,
  });
  assert.deepEqual(record.grant.binding, {skinId: 'violet-nebula'});
});

test('purchase reference lookup accepts exactly one unique payment or subscription identity', async () => {
  const calls = [];
  const row = {id: 'identity-1', license_key_hash: 'a'.repeat(64), dodo_license_key_id: 'lic_1',
    customer_id: 'cus_1', product_id: 'product-1', source: 'auto', payment_id: 'pay_1',
    subscription_id: null, first_seen_at: '2026-07-16T12:00:00.000Z'};
  const repository = createPostgresRepository({pool: {
    async query(text, values) { calls.push([text, values]); return {rowCount: 1, rows: [row]}; },
    async connect() { throw new Error('unused'); },
  }});
  assert.equal((await repository.findLicenseIdentityByPurchaseReference({paymentId: 'pay_1'})).licenseKeyId,
    'lic_1');
  assert.match(calls[0][0], /WHERE payment_id = \$1/u);
  assert.deepEqual(calls[0][1], ['pay_1']);
  await assert.rejects(() => repository.findLicenseIdentityByPurchaseReference({}),
    (error) => error.code === 'PURCHASE_REFERENCE_INVALID');
  await assert.rejects(() => repository.findLicenseIdentityByPurchaseReference({
    paymentId: 'pay_1', subscriptionId: 'sub_1',
  }), (error) => error.code === 'PURCHASE_REFERENCE_INVALID');
});
