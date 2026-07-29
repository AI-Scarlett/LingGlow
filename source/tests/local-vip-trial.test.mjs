import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LOCAL_VIP_TRIAL_DURATION_MS,
  LOCAL_VIP_TRIAL_FILE,
  LocalVipTrialStore,
  publicLocalVipTrial,
} from '../src/local-vip-trial.mjs';

function trialStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-local-vip-trial-'));
  const filePath = path.join(directory, LOCAL_VIP_TRIAL_FILE);
  return {directory, filePath, store: new LocalVipTrialStore({filePath})};
}

test('local VIP trial starts exactly once on first resolution and keeps a private fixed seven-day window', () => {
  const {filePath, store} = trialStore();
  const first = store.resolve({now: '2026-07-17T09:30:00.000Z'});
  assert.equal(first.active, true);
  assert.equal(first.state, 'active');
  assert.equal(first.startedAt, '2026-07-17T09:30:00.000Z');
  assert.equal(first.expiresAt, '2026-07-24T09:30:00.000Z');
  assert.equal(first.remainingSeconds, 7 * 24 * 60 * 60);
  assert.equal(first.durationDays, 7);
  assert.equal(fs.lstatSync(filePath).mode & 0o777, 0o600);

  const reopened = new LocalVipTrialStore({filePath});
  const second = reopened.resolve({now: '2026-07-18T09:30:00.000Z'});
  assert.equal(second.startedAt, first.startedAt);
  assert.equal(second.expiresAt, first.expiresAt);
  assert.equal(second.remainingSeconds, 6 * 24 * 60 * 60);
});

test('persisted maximum observed time prevents local clock rollback from extending a trial', () => {
  const {store} = trialStore();
  const first = store.resolve({now: '2026-07-17T00:00:00.000Z'});
  const forward = store.resolve({now: '2026-07-23T12:00:00.000Z'});
  assert.equal(forward.remainingSeconds, 12 * 60 * 60);

  const rolledBack = store.resolve({now: '2026-07-18T00:00:00.000Z'});
  assert.equal(rolledBack.observedAt, forward.observedAt);
  assert.equal(rolledBack.remainingSeconds, forward.remainingSeconds);

  const expired = store.resolve({now: new Date(Date.parse(first.startedAt) + LOCAL_VIP_TRIAL_DURATION_MS)});
  assert.equal(expired.active, false);
  assert.equal(expired.state, 'expired');
  assert.equal(expired.remainingSeconds, 0);

  const staleClockAfterExpiry = store.resolve({now: '2026-07-18T00:00:00.000Z'});
  assert.equal(staleClockAfterExpiry.state, 'expired');
  assert.equal(staleClockAfterExpiry.remainingSeconds, 0);
});

test('unsafe or malformed local records fail closed rather than minting a replacement trial', () => {
  const {filePath, store} = trialStore();
  store.resolve({now: '2026-07-17T00:00:00.000Z'});
  fs.chmodSync(filePath, 0o644);
  assert.throws(() => store.resolve({now: '2026-07-18T00:00:00.000Z'}), /权限或所有者不安全/u);

  fs.chmodSync(filePath, 0o600);
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  record.expiresAt = '2036-07-24T00:00:00.000Z';
  fs.writeFileSync(filePath, `${JSON.stringify(record)}\n`, {mode: 0o600});
  assert.throws(() => store.resolve({now: '2026-07-18T00:00:00.000Z'}), /时间无效/u);
  assert.equal(fs.existsSync(filePath), true);
});

test('the public trial snapshot never exposes a Dodo lease or mutable clock anchor', () => {
  const {store} = trialStore();
  const trial = store.resolve({now: '2026-07-17T00:00:00.000Z'});
  const snapshot = publicLocalVipTrial(trial);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'durationDays', 'expiresAt', 'kind', 'remainingSeconds', 'startedAt', 'state',
  ]);
  assert.equal(Object.hasOwn(snapshot, 'licenseId'), false);
  assert.equal(Object.hasOwn(snapshot, 'maxObservedAt'), false);
});
