import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApplyIntentError,
  ApplyIntentService,
  MAX_APPLY_INTENTS,
} from '../src/apply-intents.mjs';

const fingerprint = {
  bundleId: 'com.openai.codex',
  version: '26.716.1',
  asarSha256: 'a'.repeat(64),
};

function errorCode(code) {
  return (error) => error instanceof ApplyIntentError && error.code === code;
}

test('creates a high-entropy public summary without retaining public profile data', () => {
  const service = new ApplyIntentService();
  const result = service.create({
    clientId: 'codex',
    skinId: 'aurora',
    appFingerprint: fingerprint,
    profile: {
      token: 'never-retain-me',
      advanced: {background: {image: 'data:image/webp;base64,SECRET_IMAGE'}},
    },
    impact: {requiresRestart: true, targetRunning: true, message: '需要重启 Codex'},
  });

  assert.match(result.id, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(Buffer.from(result.id, 'base64url').length, 32);
  assert.equal(result.summary.customProfile, true);
  assert.equal(result.summary.impact.requiresRestart, true);
  assert.equal('profile' in result, false);
  assert.equal('appFingerprint' in result, false);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_IMAGE|never-retain-me/u);

  const confirmation = service.confirm(result.id, {clientId: 'codex', appFingerprint: {...fingerprint}});
  assert.equal(confirmation.summary.skinId, 'aurora');
  assert.equal('profile' in confirmation, false);
  assert.doesNotMatch(JSON.stringify(confirmation), /SECRET_IMAGE|never-retain-me/u);
});

test('successful confirmation consumes an intent exactly once', () => {
  const service = new ApplyIntentService();
  const intent = service.create({clientId: 'workbuddy', skinId: 'mist', appFingerprint: 'build-1'});
  assert.equal(service.size, 1);
  assert.equal(service.confirm(intent.id, {clientId: 'workbuddy', appFingerprint: 'build-1'}).id, intent.id);
  assert.equal(service.size, 0);
  assert.throws(
    () => service.confirm(intent.id, {clientId: 'workbuddy', appFingerprint: 'build-1'}),
    errorCode('INTENT_NOT_FOUND'),
  );
});

test('binds confirmation to client and canonical app fingerprint', () => {
  const service = new ApplyIntentService();
  const intent = service.create({
    clientId: 'codex',
    skinId: 'night',
    appFingerprint: {version: '1', bundleId: 'com.openai.codex'},
  });

  assert.throws(
    () => service.confirm(intent.id, {clientId: 'workbuddy', appFingerprint: fingerprint}),
    errorCode('INTENT_CLIENT_MISMATCH'),
  );
  assert.throws(
    () => service.confirm(intent.id, {clientId: 'codex', appFingerprint: {version: '2'}}),
    errorCode('INTENT_FINGERPRINT_MISMATCH'),
  );
  assert.equal(service.size, 1);
  assert.equal(service.confirm(intent.id, {
    clientId: 'codex',
    appFingerprint: {bundleId: 'com.openai.codex', version: '1'},
  }).summary.operation, 'apply');
});

test('expires, cancels, and cleans up intents', () => {
  let now = 1_000;
  const service = new ApplyIntentService({ttlMs: 100, now: () => now});
  const expired = service.create({clientId: 'codex', skinId: 'one', appFingerprint: 'v1'});
  now = 1_100;
  assert.throws(
    () => service.confirm(expired.id, {clientId: 'codex', appFingerprint: 'v1'}),
    errorCode('INTENT_EXPIRED'),
  );
  const cancelled = service.create({clientId: 'codex', skinId: 'two', appFingerprint: 'v1'});
  assert.equal(service.cancel(cancelled.id), true);
  assert.equal(service.cancel(cancelled.id), false);
  assert.throws(
    () => service.confirm(cancelled.id, {clientId: 'codex', appFingerprint: 'v1'}),
    errorCode('INTENT_NOT_FOUND'),
  );
  service.create({clientId: 'codex', skinId: 'three', appFingerprint: 'v1'});
  now = 1_200;
  assert.equal(service.cleanup(), 1);
  assert.equal(service.size, 0);
});

test('enforces the 128-entry hard limit without evicting live confirmations', () => {
  const service = new ApplyIntentService({maxEntries: MAX_APPLY_INTENTS});
  for (let index = 0; index < MAX_APPLY_INTENTS; index += 1) {
    service.create({clientId: 'codex', skinId: `skin-${index}`, appFingerprint: 'v1'});
  }
  assert.equal(service.size, MAX_APPLY_INTENTS);
  assert.throws(
    () => service.create({clientId: 'codex', skinId: 'overflow', appFingerprint: 'v1'}),
    errorCode('INTENT_CAPACITY'),
  );
  assert.equal(service.size, MAX_APPLY_INTENTS);
});

test('validates operation, impact, and constructor limits', () => {
  const service = new ApplyIntentService();
  assert.throws(
    () => service.create({clientId: 'codex', skinId: 'x', appFingerprint: 'v1', operation: 'delete'}),
    errorCode('INVALID_INTENT_INPUT'),
  );
  assert.throws(
    () => service.create({
      clientId: 'codex',
      skinId: 'x',
      appFingerprint: 'v1',
      impact: {requiresRestart: 'yes'},
    }),
    errorCode('INVALID_INTENT_INPUT'),
  );
  assert.throws(() => new ApplyIntentService({maxEntries: MAX_APPLY_INTENTS + 1}), TypeError);
  assert.throws(() => new ApplyIntentService({ttlMs: 0}), TypeError);
});
