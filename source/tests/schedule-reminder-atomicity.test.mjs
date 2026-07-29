import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import test from 'node:test';
import {PERMISSION_MATRIX} from '../src/entitlements.mjs';
import {
  defaultWeeklySchedule,
  loadScheduleState,
  saveWeeklySchedule,
} from '../src/schedule.mjs';
import {StudioServer} from '../src/server.mjs';

async function invokeApi(studio, pathname, {method = 'GET', body = null} = {}) {
  studio.port ??= 32145;
  const bytes = body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const request = Readable.from(bytes.length ? [bytes] : []);
  request.method = method;
  request.headers = {
    host: `${studio.host}:${studio.port}`,
    authorization: `Bearer ${studio.token}`,
    ...(body === null ? {} : {'content-type': 'application/json', 'content-length': String(bytes.length)}),
  };
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: null,
      writeHead(statusCode) { this.statusCode = statusCode; },
      setHeader() {},
      end(value = '') {
        try { resolve({status: this.statusCode, body: JSON.parse(String(value))}); }
        catch (error) { reject(error); }
      },
    };
    studio.api(request, response, new URL(pathname, `http://${studio.host}:${studio.port}`)).catch(reject);
  });
}

function todayInUTC() {
  return new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', weekday: 'long'})
    .format(new Date())
    .toLowerCase();
}

function vipEntitlement() {
  return {
    tier: 'vip',
    source: 'test',
    status: 'valid',
    license: null,
    permissions: {...PERMISSION_MATRIX.vip},
    activeGrants: [],
    skinIds: [],
    customProfileIds: [],
  };
}

function exactCodexRecord() {
  return {
    app: {
      safeToLaunch: true,
      fingerprint: {bundleId: 'com.openai.codex', version: 'test', build: 'schedule-atomicity'},
      codeThemeIds: ['codex'],
      path: '/Applications/Codex.app',
    },
    compatibility: {
      clientId: 'codex',
      level: 'exact',
      advancedAllowed: true,
      reason: 'fixture adapter',
      adapter: {capabilities: ['background', 'palette', 'glass']},
      capabilities: ['background', 'palette', 'glass'],
    },
  };
}

test('schedule apply is prepared without claim, then claimed only after successful confirmed launch', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-schedule-confirm-'));
  const schedule = structuredClone(defaultWeeklySchedule({timeZone: 'UTC'}));
  schedule.enabled = true;
  schedule.clients.codex[todayInUTC()] = 'graphite-focus';
  saveWeeklySchedule(schedule, dataDir);

  const studio = new StudioServer({dataDir, entitlementOverride: vipEntitlement()});
  studio.clients.set('codex', exactCodexRecord());
  studio.refreshDoctor = () => ({ok: true});

  // No target process is launched in this test. These fixtures only model the
  // server's post-confirm success/failure boundary.
  studio.managers.set('codex', {
    launch: async () => { throw new Error('simulated target launch failure'); },
  });

  const prepared = await invokeApi(studio, '/api/reminders/decision', {
    method: 'POST', body: {clientId: 'codex', action: 'apply'},
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.action, 'apply');
  assert.equal(prepared.body.skinId, 'graphite-focus');
  assert.equal(typeof prepared.body.intent?.id, 'string');
  assert.equal(loadScheduleState(dataDir).lastReminderDateByClient.codex, null,
    'preparing or cancelling the second confirmation never consumes today');

  // Older menu-bar builds issue a second create-intent request. The server
  // gives them the already prepared intent, rather than silently making a
  // detached manual intent that would miss the post-success claim.
  const legacyFollowUp = await invokeApi(studio, '/api/apply-intents', {
    method: 'POST', body: {clientId: 'codex', skinId: 'graphite-focus', operation: 'apply'},
  });
  assert.equal(legacyFollowUp.status, 200);
  assert.equal(legacyFollowUp.body.intent.id, prepared.body.intent.id);
  assert.equal(loadScheduleState(dataDir).lastReminderDateByClient.codex, null);

  const originalRecord = exactCodexRecord();
  studio.clients.set('codex', {
    ...originalRecord,
    app: {...originalRecord.app, fingerprint: {...originalRecord.app.fingerprint, build: 'changed'}},
  });
  const fingerprintFailure = await invokeApi(
    studio,
    `/api/apply-intents/${encodeURIComponent(prepared.body.intent.id)}/confirm`,
    {method: 'POST', body: {clientId: 'codex'}},
  );
  assert.equal(fingerprintFailure.status, 400);
  assert.match(fingerprintFailure.body.error, /版本已变化/u);
  assert.equal(loadScheduleState(dataDir).lastReminderDateByClient.codex, null);

  // An invalidated prepared ticket must not trap the reminder until its TTL.
  studio.clients.set('codex', originalRecord);
  const afterFingerprintFailure = await invokeApi(studio, '/api/reminders/decision', {
    method: 'POST', body: {clientId: 'codex', action: 'apply'},
  });
  assert.equal(afterFingerprintFailure.status, 200);
  assert.notEqual(afterFingerprintFailure.body.intent.id, prepared.body.intent.id);

  const failedConfirmation = await invokeApi(
    studio,
    `/api/apply-intents/${encodeURIComponent(afterFingerprintFailure.body.intent.id)}/confirm`,
    {method: 'POST', body: {clientId: 'codex'}},
  );
  assert.equal(failedConfirmation.status, 400);
  assert.match(failedConfirmation.body.error, /simulated target launch failure/u);
  assert.equal(loadScheduleState(dataDir).lastReminderDateByClient.codex, null,
    'failed apply keeps the reminder eligible for a later confirmed retry');

  studio.managers.set('codex', {
    launch: async () => ({mode: 'pipe', status: 'applied-fixture'}),
  });
  const retry = await invokeApi(studio, '/api/reminders/decision', {
    method: 'POST', body: {clientId: 'codex', action: 'apply'},
  });
  assert.equal(retry.status, 200);
  assert.notEqual(retry.body.intent.id, afterFingerprintFailure.body.intent.id);
  assert.equal(loadScheduleState(dataDir).lastReminderDateByClient.codex, null);

  const succeededConfirmation = await invokeApi(
    studio,
    `/api/apply-intents/${encodeURIComponent(retry.body.intent.id)}/confirm`,
    {method: 'POST', body: {clientId: 'codex'}},
  );
  assert.equal(succeededConfirmation.status, 200);
  assert.equal(succeededConfirmation.body.operation, 'apply');
  assert.match(loadScheduleState(dataDir).lastReminderDateByClient.codex, /^\d{4}-\d{2}-\d{2}$/u,
    'only a completed confirmed launch durably claims the daily reminder');
});

test('server persists a reminder snooze instead of retaining it only in process memory', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-schedule-snooze-'));
  const schedule = structuredClone(defaultWeeklySchedule({timeZone: 'UTC'}));
  schedule.enabled = true;
  schedule.clients.codex[todayInUTC()] = 'graphite-focus';
  saveWeeklySchedule(schedule, dataDir);
  const studio = new StudioServer({dataDir, entitlementOverride: vipEntitlement()});

  const result = await invokeApi(studio, '/api/reminders/decision', {
    method: 'POST', body: {clientId: 'codex', action: 'snooze', minutes: 30},
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.action, 'snooze');
  assert.equal(result.body.minutes, 30);
  assert.ok(loadScheduleState(dataDir).snoozeUntilByClient.codex > Date.now());

  // A new server instance reads the same private state; no ephemeral Map is
  // needed to keep the user's explicit snooze after a restart or update.
  const restarted = new StudioServer({dataDir, entitlementOverride: vipEntitlement()});
  assert.ok(loadScheduleState(restarted.dataDir).snoozeUntilByClient.codex > Date.now());
});
