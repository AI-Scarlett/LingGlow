import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {SkinSessionManager} from '../src/cdp.mjs';

test('Runtime.evaluate exceptionDetails are failures', async () => {
  const manager = new SkinSessionManager();
  manager.transport = {
    call: async () => ({exceptionDetails: {text: 'boom'}}),
  };
  await assert.rejects(() => manager.evaluateValue('1', 'session'), /boom/u);
});

test('target synchronization is serialized', async () => {
  const manager = new SkinSessionManager();
  let calls = 0;
  let release;
  manager.syncTargetsOnce = async () => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
  };
  const first = manager.syncTargets();
  const second = manager.syncTargets();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
});

test('WorkBuddy reapplies the active skin when its renderer target is reopened', async () => {
  const background =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9wAAAAABJRU5ErkJggg==';
  const manager = new SkinSessionManager();
  manager.injectionEnabled = true;
  manager.clientId = 'workbuddy';
  manager.clientLabel = 'WorkBuddy';
  manager.probeKind = 'workbuddy-v1';
  manager.targetUrl = 'app://-/index.html';
  manager.capabilityLevel = 'exact';
  manager.capabilities = ['background', 'palette', 'glass', 'composer-avatar'];
  manager.profile = {
    id: 'workbuddy-reopen-regression',
    official: {
      variant: 'dark',
      accent: '#53D6A4',
      surface: '#0E1714',
      ink: '#F3FFF9',
    },
    advanced: {
      enabled: true,
      background: {image: background},
      glass: {enabled: true, blur: 18},
    },
  };
  manager.compatibility = {
    targetAllowlist: ['app://-/index.html'],
    adapter: {versions: ['5.3.5']},
  };

  const firstTarget = {targetId: 'workbuddy-first', type: 'page', url: 'app://-/index.html'};
  const reopenedTarget = {targetId: 'workbuddy-reopened', type: 'page', url: 'app://-/index.html'};
  const targetsById = new Map([
    [firstTarget.targetId, firstTarget],
    [reopenedTarget.targetId, reopenedTarget],
  ]);
  let visibleTargets = [firstTarget];
  const installed = [];
  const evaluated = [];
  manager.transport = {
    closed: false,
    call: async (method, params = {}, sessionId = undefined) => {
      if (method === 'Target.getTargets') return {targetInfos: visibleTargets};
      if (method === 'Target.attachToTarget') {
        return {sessionId: `${params.targetId}-session`};
      }
      if (method === 'Target.getTargetInfo') {
        return {targetInfo: targetsById.get(params.targetId)};
      }
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        installed.push({params, sessionId});
        return {identifier: `${sessionId}-script`};
      }
      throw new Error(`unexpected CDP method: ${method}`);
    },
  };
  manager.runtimeProbe = async (sessionId) => ({
    sessionId,
    url: 'app://-/index.html',
    root: 1,
    applicationName: 'workbuddy',
    electronDesktop: 'true',
    platform: 'mac',
    productVersion: '5.3.5',
    designToken: true,
  });
  manager.evaluateOk = async (expression, sessionId, label) => {
    evaluated.push({expression, sessionId, label});
    return {ok: true};
  };

  await manager.syncTargetsOnce();
  assert.deepEqual([...manager.targets.keys()], [firstTarget.targetId]);

  visibleTargets = [reopenedTarget];
  await manager.syncTargetsOnce();

  assert.deepEqual([...manager.targets.keys()], [reopenedTarget.targetId]);
  assert.equal(installed.length, 2);
  assert.deepEqual(installed.map(({sessionId}) => sessionId), [
    'workbuddy-first-session',
    'workbuddy-reopened-session',
  ]);
  assert.ok(installed.every(({params}) => params.runImmediately === true));
  assert.equal(installed[0].params.source, installed[1].params.source);
  assert.match(installed[1].params.source, /body::before/u);
  assert.match(installed[1].params.source, /data:image\/png;base64/u);
  assert.match(installed[1].params.source, /data-lingglow-workbuddy-composer/u);
  assert.deepEqual(
    evaluated.filter(({label}) => label === '皮肤注入').map(({sessionId}) => sessionId),
    ['workbuddy-first-session', 'workbuddy-reopened-session'],
  );
  assert.deepEqual(
    evaluated.filter(({label}) => label === '皮肤注入校验').map(({sessionId}) => sessionId),
    ['workbuddy-first-session', 'workbuddy-reopened-session'],
  );
});

test('repeated renderer sync failures stop only skin polling and preserve the Agent process', async (t) => {
  const manager = new SkinSessionManager();
  let killed = false;
  const child = {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    kill() { killed = true; },
  };
  manager.child = child;
  manager.clientId = 'workbuddy';
  manager.clientLabel = 'WorkBuddy';
  manager.profile = {id: 'sync-failure-regression'};
  manager.state = 'active';
  manager.injectionEnabled = true;
  manager.transport = {closed: false};
  manager.pollTimer = setInterval(() => {}, 60_000);
  manager.pollTimer.unref?.();
  t.after(() => {
    if (manager.pollTimer) clearInterval(manager.pollTimer);
  });
  manager.syncTargets = async () => {
    throw new Error('renderer reload in progress');
  };

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await manager.pollTargets();
    assert.equal(manager.state, 'recovering');
    assert.equal(manager.injectionEnabled, true);
    assert.equal(manager.consecutiveSyncFailures, attempt);
    assert.match(manager.lastError, new RegExp(`${attempt}/8`, 'u'));
  }
  await manager.pollTargets();

  assert.equal(manager.state, 'error');
  assert.equal(manager.injectionEnabled, false);
  assert.equal(manager.pollTimer, null);
  assert.equal(manager.child, child);
  assert.equal(killed, false);
  assert.match(manager.lastError, /保留 WorkBuddy 进程/u);
});

test('unexpected WorkBuddy Pipe close enters bounded recovery instead of reporting idle', async () => {
  class FakeTransport extends EventEmitter {
    constructor() {
      super();
      this.closed = false;
    }

    async call(method) {
      if (method === 'Target.setDiscoverTargets') return {};
      throw new Error(`unexpected CDP method: ${method}`);
    }

    close() {
      this.closed = true;
      this.emit('close');
    }
  }

  const app = {
    clientId: 'workbuddy',
    displayName: 'WorkBuddy',
    safeToLaunch: true,
    fingerprint: 'workbuddy-managed-close',
  };
  const profile = {
    id: 'workbuddy-managed-close',
    official: {accent: '#53D6A4', surface: '#0E1714', ink: '#F3FFF9'},
    advanced: {enabled: true},
  };
  const capabilities = ['background', 'palette', 'glass', 'composer-avatar'];
  const compatibility = {
    advancedAllowed: true,
    level: 'exact',
    capabilities,
    adapter: {capabilities},
    targetUrl: 'app://-/index.html',
    probeKind: 'workbuddy-v1',
  };
  const transport = new FakeTransport();
  const manager = new SkinSessionManager({
    findClient: () => ({...app}),
    listMainProcesses: () => [],
  });
  manager.spawnPipeWithSingleInstanceRetry = async () => ({
    child: {pid: 5252, exitCode: null, signalCode: null},
    transport,
    version: {product: 'Chrome/test'},
    mode: 'pipe',
  });
  manager.waitForFirstTarget = async () => {
    manager.targets.set('workbuddy-page', {sessionId: 'workbuddy-session'});
  };
  const scheduled = [];
  manager.scheduleManagedRecovery = (context) => scheduled.push(context);

  await manager.launch({app, profile, compatibility});
  assert.equal(manager.managedRecovery.recoveryDeadline, null);

  transport.closed = true;
  transport.emit('close', {code: 0});

  const remainingWindow = manager.managedRecovery.recoveryDeadline - Date.now();
  assert.ok(remainingWindow > 29_000 && remainingWindow <= 30_000);
  assert.equal(manager.state, 'recovering');
  assert.notEqual(manager.state, 'idle');
  assert.equal(manager.injectionEnabled, false);
  assert.equal(manager.transport, null);
  assert.equal(manager.targets.size, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0], manager.managedRecovery);
  assert.match(manager.lastError, /意外断开.*正在执行一次受管恢复/u);
});

test('WorkBuddy Pipe protocol failure keeps the live child and never schedules recovery', async () => {
  class FakeTransport extends EventEmitter {
    constructor() {
      super();
      this.closed = false;
    }

    async call(method) {
      if (method === 'Target.setDiscoverTargets') return {};
      throw new Error(`unexpected CDP method: ${method}`);
    }

    close() {
      this.closed = true;
      this.emit('close');
    }
  }

  const app = {
    clientId: 'workbuddy',
    displayName: 'WorkBuddy',
    safeToLaunch: true,
    fingerprint: 'workbuddy-pipe-failure',
  };
  const profile = {
    id: 'workbuddy-pipe-failure',
    official: {accent: '#53D6A4', surface: '#0E1714', ink: '#F3FFF9'},
    advanced: {enabled: true},
  };
  const capabilities = ['background', 'palette', 'glass', 'composer-avatar'];
  const compatibility = {
    advancedAllowed: true,
    level: 'exact',
    capabilities,
    adapter: {capabilities},
    targetUrl: 'app://-/index.html',
    probeKind: 'workbuddy-v1',
  };
  const transport = new FakeTransport();
  const child = {pid: 5353, exitCode: null, signalCode: null};
  const manager = new SkinSessionManager({
    findClient: () => ({...app}),
    listMainProcesses: () => [],
  });
  manager.spawnPipeWithSingleInstanceRetry = async () => ({
    child,
    transport,
    version: {product: 'Chrome/test'},
    mode: 'pipe',
  });
  manager.waitForFirstTarget = async () => {
    manager.targets.set('workbuddy-page', {sessionId: 'workbuddy-session'});
  };
  let scheduled = 0;
  manager.scheduleManagedRecovery = () => { scheduled += 1; };

  await manager.launch({app, profile, compatibility});
  transport.closed = true;
  transport.emit('close', {error: 'pipe protocol broke'});

  assert.equal(manager.state, 'error');
  assert.notEqual(manager.state, 'idle');
  assert.equal(manager.transport, null);
  assert.equal(manager.child, child);
  assert.equal(manager.managedRecovery, null);
  assert.equal(scheduled, 0);
  assert.match(manager.lastError, /pipe protocol broke/u);
});

test('managed WorkBuddy recovery launches once and only after residual processes disappear', async () => {
  const app = {
    clientId: 'workbuddy',
    displayName: 'WorkBuddy',
    safeToLaunch: true,
    fingerprint: 'workbuddy-recovery-once',
  };
  let processChecks = 0;
  const sleeps = [];
  const launches = [];
  const manager = new SkinSessionManager({
    findClient: () => ({...app}),
    listMainProcesses: () => {
      processChecks += 1;
      return processChecks === 1 ? [{pid: 6161, debugTransport: 'pipe'}] : [];
    },
    retrySleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  const context = {
    epoch: 7,
    app,
    profile: {id: 'managed-recovery-profile'},
    compatibility: {advancedAllowed: true},
    attempts: 0,
    recoveryDeadline: Date.now() + 30_000,
  };
  manager.sessionEpoch = context.epoch;
  manager.managedRecovery = context;
  manager.state = 'recovering';
  manager.launch = async (options) => {
    launches.push(options);
    return {state: 'active'};
  };

  manager.scheduleManagedRecovery(context);
  const firstTask = manager.managedRecoveryTask;
  manager.scheduleManagedRecovery(context);
  assert.equal(manager.managedRecoveryTask, firstTask);
  await firstTask;
  await Promise.resolve();

  assert.equal(context.attempts, 1);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].confirmRestart, false);
  assert.equal(launches[0].managedRecoveryEpoch, context.epoch);
  assert.equal(processChecks, 12);
  assert.deepEqual(sleeps, [500, ...Array(10).fill(200)]);

  manager.scheduleManagedRecovery(context);
  await Promise.resolve();
  assert.equal(launches.length, 1);
  assert.equal(context.attempts, 1);
});

test('runtime visual audit is fixed, read-only, and omits page content', async () => {
  const manager = new SkinSessionManager();
  manager.state = 'active';
  manager.profile = {id: 'dream-portal'};
  manager.targets.set('target', {sessionId: 'session'});
  let expression = '';
  manager.transport = {
    closed: false,
    call: async (method, params) => {
      assert.equal(method, 'Runtime.evaluate');
      expression = params.expression;
      return {result: {value: {ok: true, rootProfile: 'dream-portal'}}};
    },
  };
  const result = await manager.visualAudit();
  assert.equal(result.rootProfile, 'dream-portal');
  assert.match(expression, /elementsFromPoint|getComputedStyle/u);
  assert.match(expression, /header\.landing-header > img\.landing-hero/u);
  assert.match(expression, /data-lingglow-workbuddy-composer/u);
  assert.match(expression, /data-codex-composer-root/u);
  assert.match(expression, /data-testid="chat_input"/u);
  assert.match(expression, /animationDuration[\s\S]*?right[\s\S]*?transform/u);
  assert.match(expression, /borderTopWidth[\s\S]*?borderRadius[\s\S]*?editor/u);
  assert.doesNotMatch(expression, /innerText|textContent|\.value\b|localStorage|sessionStorage|cookie/u);
});

test('teardown fails closed when a live target cannot remove its script', async () => {
  const manager = new SkinSessionManager();
  manager.profile = {id: 'test'};
  manager.transport = {
    closed: false,
    call: async (method) => {
      if (method === 'Target.getTargets') return {targetInfos: [{targetId: 'target'}]};
      if (method === 'Page.removeScriptToEvaluateOnNewDocument') throw new Error('remove failed');
      return {};
    },
  };
  manager.targets.set('target', {sessionId: 'session', identifier: 'script'});
  await assert.rejects(() => manager.teardown(), /未能确认全部皮肤已清理/u);
  assert.equal(manager.state, 'error');
});

test('production loopback transport is random, local-only, and exact-gated', () => {
  const sourcePath = fileURLToPath(new URL('../src/cdp.mjs', import.meta.url));
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /WebSocketTransport|pickEphemeralLoopbackPort/u);
  assert.match(source, /remote-debugging-address=127\.0\.0\.1/u);
  assert.doesNotMatch(source, /remote-debugging-address=0\.0\.0\.0/u);
  assert.doesNotMatch(source, /remote-debugging-port=\d{4,5}/u);
  assert.match(source, /remote-debugging-pipe/u);
});

test('Doubao launch fails before any spawn when transport is unverified', async () => {
  const manager = new SkinSessionManager();
  let spawned = false;
  manager.spawnPipe = async () => {
    spawned = true;
    throw new Error('must not spawn');
  };
  const fingerprint = 'doubao-static-fingerprint';
  await assert.rejects(() => manager.launch({
    app: {
      clientId: 'doubao',
      displayName: '豆包',
      fingerprint,
      transportVerification: {
        verified: false,
        appFingerprint: fingerprint,
        reason: '豆包传输未验证',
      },
    },
    profile: {advanced: {enabled: true}},
    compatibility: {advancedAllowed: true},
  }), /豆包传输未验证/u);
  assert.equal(spawned, false);
  assert.equal(manager.state, 'idle');
});

test('Doubao Pipe refuses a caller-supplied session plan before any child process can spawn', async () => {
  let spawned = false;
  const manager = new SkinSessionManager({
    spawnProcess: () => {
      spawned = true;
      throw new Error('must not spawn');
    },
  });
  manager.compatibility = {
    transportVerification: {
      clientId: 'doubao',
      verified: true,
      appFingerprint: 'f'.repeat(64),
      reviewedExactAdapterId: 'doubao-macos-forged',
      strategyId: 'launchservices-loopback',
      transport: 'loopback-cdp',
    },
  };
  await assert.rejects(() => manager.spawnPipe({
    clientId: 'doubao',
    displayName: '豆包',
    executable: '/Applications/Doubao.app/Contents/MacOS/Doubao',
    fingerprint: 'f'.repeat(64),
  }, {
    strategyId: 'launchservices-loopback',
    transport: 'loopback-cdp',
  }, {
    clientId: 'doubao',
    appFingerprint: 'f'.repeat(64),
    reviewedExactAdapterId: 'doubao-macos-forged',
  }), /隔离会话计划无效/u);
  assert.equal(spawned, false);
});

function earlyExit(exitCode = 0, signal = null) {
  return Object.assign(new Error(`目标应用已退出 (${exitCode ?? signal})`), {
    code: 'TARGET_EXITED_BEFORE_CDP',
    exitCode,
    signal,
  });
}

function pageNotReady() {
  return Object.assign(new Error('页面尚未就绪'), {
    code: 'TARGET_PAGE_NOT_READY',
  });
}

test('clean pre-CDP exit retries once only after identity and zero-process stability checks', async () => {
  const app = {clientId: 'workbuddy', displayName: 'WorkBuddy', safeToLaunch: true, fingerprint: 'same'};
  let attempts = 0;
  let identityChecks = 0;
  let processChecks = 0;
  let sleeps = 0;
  const manager = new SkinSessionManager({
    findClient: () => {
      identityChecks += 1;
      return {...app};
    },
    listMainProcesses: () => {
      processChecks += 1;
      return [];
    },
    retrySleep: async (milliseconds) => {
      assert.equal(milliseconds, 200);
      sleeps += 1;
    },
  });
  manager.spawnPipe = async (current) => {
    attempts += 1;
    assert.equal(current.fingerprint, 'same');
    if (attempts === 1) throw earlyExit(0, null);
    return {ok: true};
  };
  const result = await manager.spawnPipeWithSingleInstanceRetry(app, {
    strategyId: 'direct-pipe',
    transport: 'pipe',
  });
  assert.deepEqual(result, {ok: true});
  assert.equal(attempts, 2);
  assert.equal(identityChecks, 2);
  assert.equal(processChecks, 11);
  assert.equal(sleeps, 9);
});

test('a connected Pipe without a renderer page retries once after the same safety checks', async () => {
  const app = {clientId: 'codex', displayName: 'Codex', safeToLaunch: true, fingerprint: 'same'};
  let attempts = 0;
  const events = [];
  const manager = new SkinSessionManager({
    findClient: () => ({...app}),
    listMainProcesses: () => [],
    retrySleep: async () => {},
    log: (level, message) => events.push({level, message}),
  });
  manager.spawnPipe = async () => {
    attempts += 1;
    if (attempts === 1) throw pageNotReady();
    return {ok: true};
  };

  const result = await manager.spawnPipeWithSingleInstanceRetry(app, {
    strategyId: 'direct-pipe',
    transport: 'pipe',
  });

  assert.deepEqual(result, {ok: true});
  assert.equal(attempts, 2);
  assert.match(events.at(-1).message, /页面未就绪.*重试一次/u);
});

test('single-instance retry refuses nonzero exits, fingerprint drift, and residual processes', async () => {
  const app = {clientId: 'workbuddy', displayName: 'WorkBuddy', safeToLaunch: true, fingerprint: 'before'};
  const strategy = {strategyId: 'direct-pipe', transport: 'pipe'};

  const nonzero = new SkinSessionManager({
    findClient: () => { throw new Error('must not inspect'); },
  });
  let nonzeroAttempts = 0;
  nonzero.spawnPipe = async () => {
    nonzeroAttempts += 1;
    throw earlyExit(1, null);
  };
  await assert.rejects(() => nonzero.spawnPipeWithSingleInstanceRetry(app, strategy), /\(1\)/u);
  assert.equal(nonzeroAttempts, 1);

  const drifted = new SkinSessionManager({
    findClient: () => ({...app, fingerprint: 'after'}),
    listMainProcesses: () => [],
    retrySleep: async () => {},
  });
  drifted.spawnPipe = async () => { throw earlyExit(0, null); };
  await assert.rejects(
    () => drifted.spawnPipeWithSingleInstanceRetry(app, strategy),
    /应用身份.*发生变化/u,
  );

  const residual = new SkinSessionManager({
    findClient: () => ({...app}),
    listMainProcesses: () => [{pid: 42, debugTransport: 'stock'}],
    retrySleep: async () => {},
  });
  residual.spawnPipe = async () => { throw earlyExit(0, null); };
  await assert.rejects(
    () => residual.spawnPipeWithSingleInstanceRetry(app, strategy),
    /仍有主进程/u,
  );
});
