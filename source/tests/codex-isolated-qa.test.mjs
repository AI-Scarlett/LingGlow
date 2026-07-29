import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CODEX_QA_ACK,
  CODEX_QA_AUTHORIZATION_COPY,
  CODEX_QA_BOUNDARY,
  assertCodexQaAuthorization,
  assertCodexQaOutsideInteractiveAncestry,
  assertCodexStaticBaseline,
  codexQaLaunchArguments,
  codexQaChildProcessTree,
  commandBelongsToCodexOrChatGpt,
  createIsolatedCodexQaRoot,
  isolatedCodexEnvironment,
  removeIsolatedCodexQaRoot,
  terminateIsolatedCodexProcess,
} from '../src/codex-isolated-qa.mjs';

test('Codex isolated QA requires two explicit risk acknowledgements', () => {
  assert.throws(() => assertCodexQaAuthorization({}), {code: 'CODEX_QA_AUTHORIZATION_REQUIRED'});
  assert.throws(() => assertCodexQaAuthorization({LINGGLOW_CODEX_QA_ACK: CODEX_QA_ACK}), {
    code: 'CODEX_QA_AUTHORIZATION_REQUIRED',
  });
  assert.equal(assertCodexQaAuthorization({
    LINGGLOW_CODEX_QA_ACK: CODEX_QA_ACK,
    LINGGLOW_CODEX_QA_BOUNDARY: CODEX_QA_BOUNDARY,
  }), true);
  assert.match(CODEX_QA_AUTHORIZATION_COPY, /测试 CSS/u);
  assert.match(CODEX_QA_AUTHORIZATION_COPY, /隔离 Codex/u);
});

test('Codex isolated QA refuses a ChatGPT/Codex app ancestry but not a workspace name', () => {
  assert.equal(commandBelongsToCodexOrChatGpt(
    '/usr/local/bin/node /tmp/lingglow-codex-isolated/tests/integration-isolated.mjs',
  ), false);
  assert.equal(commandBelongsToCodexOrChatGpt(
    '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --type=renderer',
  ), true);
  assert.equal(commandBelongsToCodexOrChatGpt(
    '/Applications/Codex.app/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper',
  ), true);
  assert.equal(commandBelongsToCodexOrChatGpt('/usr/local/bin/codex qa'), true);

  const forbidden = [
    '120 42 /usr/local/bin/node tests/integration-isolated.mjs',
    '42 1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
  ].join('\n');
  assert.throws(() => assertCodexQaOutsideInteractiveAncestry({
    psOutput: forbidden,
    currentPid: 120,
  }), {code: 'CODEX_QA_INTERACTIVE_ANCESTRY_FORBIDDEN'});

  const external = [
    '120 42 /usr/local/bin/node tests/integration-isolated.mjs',
    '42 1 /bin/zsh -l',
  ].join('\n');
  assert.deepEqual(assertCodexQaOutsideInteractiveAncestry({
    psOutput: external,
    currentPid: 120,
  }), {currentPid: 120, checkedPids: [120, 42]});
});

test('isolated environment forwards only minimal OS/session values and fixed private roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-codex-qa-unit-'));
  const userData = path.join(root, 'electron');
  const codexHome = path.join(root, 'codex-home');
  fs.mkdirSync(userData, {mode: 0o700});
  fs.mkdirSync(codexHome, {mode: 0o700});
  try {
    const result = isolatedCodexEnvironment({
      HOME: os.homedir(),
      PATH: '/usr/bin:/bin',
      OPENAI_API_KEY: 'must-not-cross',
      CODEX_HOME: '/real/codex/home',
      CODEX_ELECTRON_USER_DATA_PATH: '/real/user/data',
      SSH_AUTH_SOCK: '/secret/socket',
      HTTPS_PROXY: 'http://proxy.invalid:8080',
    }, {userData, codexHome});
    assert.equal(result.CODEX_HOME, codexHome);
    assert.equal(result.CODEX_ELECTRON_USER_DATA_PATH, userData);
    assert.equal(result.OPENAI_API_KEY, undefined);
    assert.equal(result.SSH_AUTH_SOCK, undefined);
    assert.equal(result.HTTPS_PROXY, undefined);
    assert.equal(Object.isFrozen(result), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('Codex QA arguments expose only inherited Pipe and no TCP or generic user-data flag', () => {
  const argumentsList = codexQaLaunchArguments();
  assert.deepEqual(argumentsList, [
    '--remote-debugging-pipe',
    '--disable-background-networking',
    '--no-first-run',
  ]);
  assert.equal(argumentsList.some((value) => value.includes('remote-debugging-port')), false);
  assert.equal(argumentsList.some((value) => value.startsWith('--user-data-dir')), false);
});

test('temporary QA root is private and deletion is limited to the harness prefix', () => {
  const root = createIsolatedCodexQaRoot();
  try {
    const stat = fs.statSync(root);
    assert.equal(stat.isDirectory(), true);
    assert.equal(stat.mode & 0o077, 0);
    assert.throws(() => removeIsolatedCodexQaRoot(path.dirname(root)), {
      code: 'CODEX_QA_CLEANUP_FAILED',
    });
  } finally {
    removeIsolatedCodexQaRoot(root);
  }
  assert.equal(fs.existsSync(root), false);
});

test('process cleanup tracks only PID/PPID descendants of the spawned child', async () => {
  const root = '/private/tmp/lingglow-codex-isolated-unit';
  const initial = [
    '100 1 /bin/launchd',
    `200 100 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --userData ${root}`,
    `201 200 /Applications/ChatGPT.app/Contents/Frameworks/Helper --userData ${root}`,
    `202 201 /Applications/ChatGPT.app/Contents/Frameworks/Renderer --userData ${root}`,
    // This deliberately mentions the temporary root, but is not below PID 200
    // and must never become eligible for a cleanup signal.
    `999 1 /usr/bin/other --note=${root}`,
  ].join('\n');
  const tree = codexQaChildProcessTree(initial, {childPid: 200});
  assert.deepEqual(tree.map(({pid}) => pid), [200, 201, 202]);

  const snapshots = [initial, '100 1 /bin/launchd'];
  const signals = [];
  const result = await terminateIsolatedCodexProcess({pid: 200}, {
    root,
    processSnapshot: () => snapshots.shift() ?? '100 1 /bin/launchd',
    wait: async () => {},
    timeoutMs: 20,
    intervalMs: 1,
    killProcess: (pid, signal) => signals.push([pid, signal]),
  });
  assert.deepEqual(signals, [
    [202, 'SIGTERM'],
    [201, 'SIGTERM'],
    [200, 'SIGTERM'],
  ]);
  assert.deepEqual(result.trackedPids, [200, 201, 202]);
});

test('static baseline rejects any identity, version, browser, or ASAR drift', () => {
  const snapshot = {
    app: {
      bundleId: 'com.openai.codex', teamId: 'TEAM', version: '1', build: '2', chromium: '3.4.5.6',
    },
    integrity: {asarRawSha256: 'a'.repeat(64)},
  };
  const app = {
    safeToLaunch: true,
    bundleId: 'com.openai.codex', teamId: 'TEAM', version: '1', build: '2', chromium: '3.4.5.6',
    asarSha256: 'a'.repeat(64),
  };
  assert.equal(assertCodexStaticBaseline(app, snapshot).build, '2');
  assert.throws(() => assertCodexStaticBaseline({...app, build: '3'}, snapshot), {
    code: 'CODEX_QA_BASELINE_DRIFT',
  });
});

test('integration harness cannot run without authorization and uses the product isolation variable', () => {
  const source = fs.readFileSync(new URL('./integration-isolated.mjs', import.meta.url), 'utf8');
  const helper = fs.readFileSync(new URL('../src/codex-isolated-qa.mjs', import.meta.url), 'utf8');
  assert.match(source, /assertCodexQaAuthorization\(process\.env\)/u);
  assert.match(source, /assertCodexQaOutsideInteractiveAncestry\(\)/u);
  assert.ok(source.indexOf('assertCodexQaOutsideInteractiveAncestry()') < source.indexOf('const app = findCodexApp'));
  assert.match(helper, /CODEX_ELECTRON_USER_DATA_PATH/u);
  assert.doesNotMatch(source, /--user-data-dir=/u);
  assert.match(source, /exactAdapterEnabled: false/u);
  assert.match(source, /testCssScope: 'isolated-target-only'/u);
  assert.match(source, /candidateCapabilities/u);
  assert.match(source, /motion: 'none'/u);
  assert.match(source, /capabilities: candidateCapabilities/u);
  assert.match(source, /assert\.doesNotMatch\(compiled\.css, \/body::after\|@keyframes\|button:hover/u);
  assert.match(source, /terminateIsolatedCodexProcess\(child, \{root\}\)/u);
});
