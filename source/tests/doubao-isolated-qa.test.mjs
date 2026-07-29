import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DOUBAO_DOM_COUNT_EXPRESSION,
  DOUBAO_QA_ACK,
  DOUBAO_QA_BOUNDARY,
  assertDoubaoPipeProcessChain,
  assertDoubaoQaAuthorization,
  assertDoubaoQaBaseline,
  captureDoubaoIsolatedProcessLedger,
  classifyDoubaoProcessChain,
  collectLiveDoubaoIsolatedProcesses,
  collectAllowlistedPageTargets,
  createIsolatedDoubaoUserDataDirectory,
  doubaoQaLaunchArguments,
  isolatedDoubaoEnvironment,
  normalizeDoubaoDomCounts,
  runDoubaoIsolatedQa,
  doubaoQaTestInternals,
} from '../src/doubao-isolated-qa.mjs';

const mainExecutable = '/Applications/Doubao.app/Contents/MacOS/Doubao';
const nestedExecutable = '/Applications/Doubao.app/Contents/Helpers/Doubao Browser.app/Contents/MacOS/Doubao Browser';

function snapshot() {
  return {
    app: {
      bundleId: 'com.bot.pc.doubao',
      teamId: '96L78H6LMH',
      version: '2.19.9',
      build: '2.19.9',
      cdHash: 'main-cdhash',
      chromiumFrameworkVersion: '135.0.7049.72',
      manifestCommit: 'manifest-commit',
      nestedBrowser: {
        bundleId: 'com.bot.pc.doubao.browser',
        teamId: '96L78H6LMH',
        cdHash: 'nested-cdhash',
      },
    },
    integrity: {artifactSha256: {mainExecutable: 'a'.repeat(64), sidePanelHtml: 'b'.repeat(64)}},
    localExtension: {id: 'obkcimipmjdkghadnfcjojepocldeggd', version: '1.0.0.6640'},
  };
}

function app() {
  return {
    safeToLaunch: true,
    clientId: 'doubao',
    bundleId: 'com.bot.pc.doubao',
    teamId: '96L78H6LMH',
    version: '2.19.9',
    build: '2.19.9',
    cdHash: 'main-cdhash',
    chromium: '135.0.7049.72',
    manifestCommit: 'manifest-commit',
    executable: mainExecutable,
    fingerprint: 'fixed-fingerprint',
    nestedBrowser: {
      bundleId: 'com.bot.pc.doubao.browser',
      teamId: '96L78H6LMH',
      cdHash: 'nested-cdhash',
      executable: nestedExecutable,
    },
    localExtension: {id: 'obkcimipmjdkghadnfcjojepocldeggd', version: '1.0.0.6640'},
    artifactSha256: {mainExecutable: 'a'.repeat(64), sidePanelHtml: 'b'.repeat(64)},
  };
}

test('Doubao isolated QA requires two explicit acknowledgements before any action', async () => {
  assert.throws(() => assertDoubaoQaAuthorization({}), {
    code: 'DOUBAO_QA_AUTHORIZATION_REQUIRED',
    message: /临时 Chromium user-data-dir/u,
  });
  assert.throws(() => assertDoubaoQaAuthorization({LINGGLOW_DOUBAO_QA_ACK: DOUBAO_QA_ACK}), {
    code: 'DOUBAO_QA_AUTHORIZATION_REQUIRED',
  });
  assert.equal(assertDoubaoQaAuthorization({
    LINGGLOW_DOUBAO_QA_ACK: DOUBAO_QA_ACK,
    LINGGLOW_DOUBAO_QA_BOUNDARY: DOUBAO_QA_BOUNDARY,
  }), true);

  let touched = false;
  await assert.rejects(() => runDoubaoIsolatedQa({
    env: {},
    staticSnapshot: snapshot(),
    findApp: () => { touched = true; return app(); },
  }), {code: 'DOUBAO_QA_AUTHORIZATION_REQUIRED'});
  assert.equal(touched, false);
});

test('QA creates a fresh owned 0700 profile and starts with the nested Pipe argv set', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-doubao-qa-unit-parent-'));
  try {
    const userData = createIsolatedDoubaoUserDataDirectory({temporaryDirectory});
    const stat = fs.lstatSync(userData);
    assert.equal(stat.isDirectory(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o777, 0o700);
    const args = doubaoQaLaunchArguments(userData, {samanFromChatPid: 4242});
    assert.deepEqual(args, [
      '--remote-debugging-pipe',
      `--user-data-dir=${userData}`,
      '--saman-from-chat=4242',
    ]);
    assert.equal(args.some((item) => item.includes('remote-debugging-port')), false);
    assert.equal(args.length, 3);
    fs.rmSync(userData, {recursive: true, force: true});
  } finally {
    fs.rmSync(temporaryDirectory, {recursive: true, force: true});
  }
});

test('isolated profile helpers reject a terminal symlink before realpath can hide it', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-doubao-qa-symlink-parent-'));
  try {
    const userData = createIsolatedDoubaoUserDataDirectory({temporaryDirectory});
    const alias = path.join(temporaryDirectory, 'profile-link');
    fs.symlinkSync(userData, alias);
    assert.throws(() => doubaoQaLaunchArguments(alias), {
      code: 'DOUBAO_ISOLATION_INVALID_DIRECTORY',
    });
    assert.throws(() => isolatedDoubaoEnvironment({PATH: '/usr/bin:/bin'}, {
      userDataDirectory: alias,
    }), {
      code: 'DOUBAO_ISOLATION_INVALID_DIRECTORY',
    });
  } finally {
    fs.rmSync(temporaryDirectory, {recursive: true, force: true});
  }
});

test('isolated Doubao child receives an explicit inert OS/session environment allowlist only', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-doubao-qa-env-parent-'));
  try {
    const userData = createIsolatedDoubaoUserDataDirectory({temporaryDirectory});
    const childEnvironment = isolatedDoubaoEnvironment({
      HOME: os.homedir(),
      USER: 'qa-user',
      LOGNAME: 'qa-user',
      TMPDIR: temporaryDirectory,
      PATH: '/usr/bin:/bin',
      LANG: 'zh_CN.UTF-8',
      OPENAI_API_KEY: 'must-not-cross',
      API_KEY: 'must-not-cross',
      DODO_API_KEY: 'must-not-cross',
      DODO_PAYMENTS_API_KEY: 'must-not-cross',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      SSH_AUTH_SOCK: '/private/agent.sock',
      CODEX_HOME: '/real/codex/home',
      NODE_OPTIONS: '--inspect',
    }, {userDataDirectory: userData});
    assert.deepEqual(childEnvironment, {
      HOME: os.homedir(),
      USER: 'qa-user',
      LOGNAME: 'qa-user',
      TMPDIR: temporaryDirectory,
      PATH: '/usr/bin:/bin',
      LANG: 'zh_CN.UTF-8',
    });
    for (const secret of [
      'OPENAI_API_KEY', 'API_KEY', 'DODO_API_KEY', 'DODO_PAYMENTS_API_KEY', 'HTTPS_PROXY',
      'SSH_AUTH_SOCK', 'CODEX_HOME', 'NODE_OPTIONS',
    ]) {
      assert.equal(childEnvironment[secret], undefined, secret);
    }
    assert.equal(Object.isFrozen(childEnvironment), true);
    fs.rmSync(userData, {recursive: true, force: true});
  } finally {
    fs.rmSync(temporaryDirectory, {recursive: true, force: true});
  }
});

test('QA baseline requires a current signed exact static Doubao identity', () => {
  const baseline = assertDoubaoQaBaseline(app(), snapshot());
  assert.equal(baseline.chromium, '135.0.7049.72');
  assert.throws(() => assertDoubaoQaBaseline({...app(), version: '2.20.0'}, snapshot()), {
    code: 'DOUBAO_QA_BASELINE_DRIFT',
  });
  assert.throws(() => assertDoubaoQaBaseline({...app(), safeToLaunch: false}, snapshot()), {
    code: 'DOUBAO_QA_BASELINE_DRIFT',
  });
  assert.throws(() => assertDoubaoQaBaseline({...app(), artifactSha256: {mainExecutable: 'x'}}, snapshot()), {
    code: 'DOUBAO_QA_BASELINE_DRIFT',
  });
});

test('process evidence preserves only a bounded classification and requires a forwarded Pipe chain', () => {
  const userData = '/private/tmp/lingglow-doubao-isolated-test';
  const ps = [
    `502 1 ${nestedExecutable} --remote-debugging-pipe --user-data-dir=${userData} --saman-from-chat=4242`,
    `503 502 ${nestedExecutable} --type=renderer --user-data-dir=${userData}`,
  ].join('\n');
  const records = classifyDoubaoProcessChain(ps, {
    mainPid: 502, mainExecutable, nestedExecutable, userDataDirectory: userData,
  });
  assert.deepEqual(records.map(({pid, role}) => ({pid, role})), [
    {pid: 502, role: 'nested-browser'},
    {pid: 503, role: 'nested-browser-child'},
  ]);
  assert.equal(records.some((record) => 'command' in record), false);
  const chain = assertDoubaoPipeProcessChain(records, {mainPid: 502});
  assert.deepEqual({
    mainPid: chain.mainPid,
    nestedBrowserPid: chain.nestedBrowserPid,
    samanFromChatPid: chain.samanFromChatPid,
  }, {mainPid: 4242, nestedBrowserPid: 502, samanFromChatPid: 4242});

  const noPipe = ps.replace('--remote-debugging-pipe ', '');
  assert.throws(() => assertDoubaoPipeProcessChain(classifyDoubaoProcessChain(noPipe, {
    mainPid: 502, mainExecutable, nestedExecutable, userDataDirectory: userData,
  }), {mainPid: 502}), {code: 'DOUBAO_QA_PROCESS_CHAIN_INVALID'});
  const wrongChain = ps.replace('--saman-from-chat=4242', '--saman-from-chat=');
  assert.throws(() => assertDoubaoPipeProcessChain(classifyDoubaoProcessChain(wrongChain, {
    mainPid: 502, mainExecutable, nestedExecutable, userDataDirectory: userData,
  }), {mainPid: 502}), {code: 'DOUBAO_QA_PROCESS_CHAIN_INVALID'});
});

test('cleanup ledger follows detached descendants, profile handles, and refuses PID reuse', () => {
  const userData = '/private/tmp/lingglow-doubao-isolated-test';
  const original = [
    `501 1 Wed Jul 17 10:00:00 2026 ${mainExecutable} --remote-debugging-pipe --user-data-dir=${userData}`,
    `502 501 Wed Jul 17 10:00:01 2026 ${nestedExecutable} --remote-debugging-pipe --user-data-dir=${userData} --saman-from-chat=501`,
    `503 502 Wed Jul 17 10:00:02 2026 ${nestedExecutable} --type=renderer --user-data-dir=${userData}`,
  ].join('\n');
  const ledger = captureDoubaoIsolatedProcessLedger(original, {mainPid: 501, userDataDirectory: userData});
  assert.deepEqual(ledger.identities, [
    {pid: 501, ppid: 1, startedAt: 'Wed Jul 17 10:00:00 2026'},
    {pid: 502, ppid: 501, startedAt: 'Wed Jul 17 10:00:01 2026'},
    {pid: 503, ppid: 502, startedAt: 'Wed Jul 17 10:00:02 2026'},
  ]);

  // Renderer 503 was re-parented and no longer includes the profile argument;
  // its tracked PID/start-time identity still keeps it inside cleanup scope.
  const detached = [
    `501 1 Wed Jul 17 10:00:00 2026 ${mainExecutable} --remote-debugging-pipe --user-data-dir=${userData}`,
    `502 501 Wed Jul 17 10:00:01 2026 ${nestedExecutable} --remote-debugging-pipe --user-data-dir=${userData} --saman-from-chat=501`,
    `503 1 Wed Jul 17 10:00:02 2026 ${nestedExecutable} --type=renderer`,
  ].join('\n');
  const tracked = collectLiveDoubaoIsolatedProcesses(detached, {
    processLedger: ledger,
    userDataDirectory: userData,
    profileHandlePids: [503],
  });
  assert.deepEqual(tracked.pids, [501, 502, 503]);
  assert.deepEqual(tracked.profileArgumentPids, [501, 502]);
  assert.deepEqual(tracked.profileHandlePids, [503]);
  assert.deepEqual(tracked.reusedPids, []);
  assert.deepEqual(tracked.unresolvedHandlePids, []);

  const reused = collectLiveDoubaoIsolatedProcesses(detached.replace(
    'Wed Jul 17 10:00:02 2026', 'Wed Jul 17 11:00:02 2026',
  ), {
    processLedger: ledger,
    userDataDirectory: userData,
  });
  assert.deepEqual(reused.reusedPids, [503]);

  const missingHandle = collectLiveDoubaoIsolatedProcesses(detached, {
    processLedger: ledger,
    userDataDirectory: userData,
    profileHandlePids: [999],
  });
  assert.deepEqual(missingHandle.unresolvedHandlePids, [999]);
});

test('missing cleanup ledger still terminates the direct isolated child but refuses deletion or stock restore proof', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-doubao-qa-ledger-fallback-'));
  try {
    const userData = createIsolatedDoubaoUserDataDirectory({temporaryDirectory});
    const child = {
      exitCode: null,
      signalCode: null,
      signals: [],
      kill(signal) {
        this.signals.push(signal);
        this.signalCode = signal;
        this.exitCode = 0;
        return true;
      },
    };
    await assert.rejects(
      () => doubaoQaTestInternals.terminateIsolatedProfile(child, userData, null),
      {code: 'DOUBAO_QA_CLEANUP_FAILED'},
    );
    assert.deepEqual(child.signals, ['SIGTERM']);
    assert.equal(fs.existsSync(userData), true);
  } finally {
    fs.rmSync(temporaryDirectory, {recursive: true, force: true});
  }
});

test('full target inventory rejects every nonallowlisted page and redacts retained paths', () => {
  const result = collectAllowlistedPageTargets([
    {type: 'service_worker', url: 'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/worker.js'},
    {type: 'page', url: 'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html?debug=no'},
    {type: 'page', url: 'https://www.doubao.com/chat/private-route?token=never-retained#fragment'},
  ]);
  assert.deepEqual(result.pageTargets, [
    {type: 'page', url: 'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html'},
    {type: 'page', url: 'https://www.doubao.com/chat/<non-empty-path>'},
  ]);
  assert.deepEqual(result.targetTypeCounts, {service_worker: 1, page: 2});
  assert.throws(() => collectAllowlistedPageTargets([
    {type: 'page', url: 'https://www.doubao.com/flow-account/client-login'},
  ]), {code: 'DOUBAO_QA_TARGET_INVENTORY_INVALID'});
});

test('target inventory waits only for an initially empty page set and fails closed for every other page', async () => {
  let getTargetsCalls = 0;
  const result = await doubaoQaTestInternals.waitForAllowlistedPageInventory({
    call: async (method) => {
      if (method === 'Target.createTarget') return {targetId: 't1'};
      assert.equal(method, 'Target.getTargets');
      getTargetsCalls += 1;
      return getTargetsCalls === 1
        ? {targetInfos: [{type: 'service_worker', url: 'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/worker.js'}]}
        : {targetInfos: [
          {type: 'page', url: 'doubao://doubao-chat/chat'},
          {type: 'page', url: 'https://www.doubao.com/chat/isolated'},
        ]};
    },
  });
  assert.ok(getTargetsCalls >= 2);
  assert.deepEqual(result.inventory.pageTargets, [
    {type: 'page', url: 'doubao://doubao-chat/chat'},
    {type: 'page', url: 'https://www.doubao.com/chat/<non-empty-path>'},
  ]);

  await assert.rejects(() => doubaoQaTestInternals.waitForAllowlistedPageInventory({
    call: async () => ({targetInfos: [{type: 'page', url: 'https://www.doubao.com/login'}]}),
  }), {code: 'DOUBAO_QA_TARGET_INVENTORY_INVALID'});
});

test('DOM probe is fixed count-only and rejects any non-count result', () => {
  assert.match(DOUBAO_DOM_COUNT_EXPRESSION, /querySelectorAll/u);
  assert.doesNotMatch(DOUBAO_DOM_COUNT_EXPRESSION, /textContent|innerText|\.value\b|cookie|Storage|fetch\(/u);
  assert.deepEqual(normalizeDoubaoDomCounts({
    body: 1, root: 1, chatInput: 0, chatInputInput: 0, messageTextContent: 0,
  }), {body: 1, root: 1, chatInput: 0, chatInputInput: 0, messageTextContent: 0});
  assert.throws(() => normalizeDoubaoDomCounts({body: 1, root: 1}), {
    code: 'DOUBAO_QA_DOM_PROBE_INVALID',
  });
});

test('isolated harness is opt-in only and contains no skin injection or capability elevation', () => {
  const source = fs.readFileSync(new URL('../src/doubao-isolated-qa.mjs', import.meta.url), 'utf8');
  const entry = fs.readFileSync(new URL('./integration-doubao-isolated.mjs', import.meta.url), 'utf8');
  assert.match(source, /assertDoubaoQaAuthorization\(env\)/u);
  assert.match(source, /stdio: \['ignore', 'ignore', 'ignore', 'pipe', 'pipe'\]/u);
  assert.match(source, /env: isolatedDoubaoEnvironment\(env, \{userDataDirectory\}\)/u);
  assert.doesNotMatch(source, /env: \{\.\.\.env\}/u);
  assert.match(source, /exactAdapterEnabled: false/u);
  assert.match(source, /capabilitiesElevated: false/u);
  assert.doesNotMatch(source, /Page\.addScriptToEvaluateOnNewDocument|compileSkin|injectionSource|skinRuntimeIds/u);
  assert.match(entry, /runDoubaoIsolatedQa/u);
  assert.doesNotMatch(entry, /node:test/u);
});
