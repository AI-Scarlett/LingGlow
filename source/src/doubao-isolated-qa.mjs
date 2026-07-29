import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawn} from 'node:child_process';
import {findClientApp, launchStock, quitClientGracefully, sameAppFingerprint} from './client-app.mjs';
import {PipeTransport} from './cdp.mjs';
import {DOUBAO_TARGET_ALLOWLIST, targetUrlMatchesAllowlist} from './transport-strategy.mjs';
import {
  DOUBAO_QA_AUTHORIZATION_COPY,
  DOUBAO_QA_CANDIDATE_STATUS,
  DOUBAO_QA_DOM_PROBE_SCOPE,
  DOUBAO_QA_EVIDENCE_KIND,
  DOUBAO_QA_EVIDENCE_SCHEMA_VERSION,
  DOUBAO_QA_ISOLATION_SCOPE,
} from './doubao-qa-policy.mjs';
import {
  DOUBAO_ISOLATION_FORWARDED_ENVIRONMENT_KEYS,
  DOUBAO_ISOLATION_TEMP_PREFIX,
  assertPrivateOwnedDoubaoDirectory,
  createIsolatedDoubaoUserDataDirectory,
  doubaoIsolatedLaunchArguments,
  isolatedDoubaoEnvironment,
  isolatedDoubaoProfileHandlePids,
} from './doubao-isolation.mjs';

// This module deliberately has no import-time side effects.  The only caller
// that can start or quit Doubao is the opt-in integration entry point, after
// both acknowledgements have been supplied by the operator.
export const DOUBAO_QA_ACK = 'I_AUTHORIZE_ONE_ISOLATED_DOUBAO_RESTART';
export const DOUBAO_QA_BOUNDARY = 'I_ACCEPT_FIXED_DOM_COUNTS_NO_CONTENT_ACCESS';
export const DOUBAO_QA_TEMP_PREFIX = DOUBAO_ISOLATION_TEMP_PREFIX;
export const DOUBAO_QA_MAX_PROCESS_RECORDS = 64;
export const DOUBAO_QA_MAX_TARGETS = 64;
// `ps` output grows with every Chromium helper on the host; the 1MiB default
// would raise ENOBUFS mid-cleanup instead of returning the full snapshot.
const DOUBAO_QA_PROCESS_SNAPSHOT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
// The only concrete, navigable allowlist entry.  The glob patterns in
// DOUBAO_TARGET_ALLOWLIST are matchers, not URLs: handing one to
// Target.createTarget would open a page whose URL literally contains `*`.
const DOUBAO_QA_SIDE_PANEL_URL =
  'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html';
export {
  DOUBAO_QA_AUTHORIZATION_COPY,
  DOUBAO_QA_CANDIDATE_STATUS,
  DOUBAO_QA_DOM_PROBE_SCOPE,
  DOUBAO_QA_EVIDENCE_KIND,
  DOUBAO_QA_EVIDENCE_SCHEMA_VERSION,
  DOUBAO_QA_ISOLATION_SCOPE,
};

// Do not pass the parent process wholesale to the isolated browser.  In
// particular this keeps API credentials, checkout configuration, proxy setup,
// agent sockets, and developer tooling out of the temporary test process.
// These are the inert shell/session variables a direct macOS app launch may
// need for locale, temporary files, and ordinary executable discovery.
export const DOUBAO_QA_FORWARDED_ENVIRONMENT_KEYS = DOUBAO_ISOLATION_FORWARDED_ENVIRONMENT_KEYS;
export {
  createIsolatedDoubaoUserDataDirectory,
  isolatedDoubaoEnvironment,
};

// Preserve the QA-facing historical name while both QA and future production
// sessions consume the exact same nested-browser Pipe launch primitive.
export function doubaoQaLaunchArguments(userDataDirectory, options = {}) {
  return doubaoIsolatedLaunchArguments(userDataDirectory, options);
}

export const DOUBAO_DOM_COUNT_EXPRESSION = `(() => ({
  body: document.querySelectorAll('body').length,
  root: document.querySelectorAll('#root').length,
  chatInput: document.querySelectorAll('[data-testid="chat_input"]').length,
  chatInputInput: document.querySelectorAll('[data-testid="chat_input_input"]').length,
  messageTextContent: document.querySelectorAll('[data-testid="message_text_content"]').length
}))()`;

function qaError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeInteger(value) {
  return Number.isInteger(value) && value > 1;
}

function privateOwnedDirectory(directory, label) {
  try {
    return assertPrivateOwnedDoubaoDirectory(directory, label);
  } catch (error) {
    throw qaError(error.message, 'DOUBAO_QA_INVALID_DIRECTORY');
  }
}

function sameValue(actual, expected, label) {
  if (typeof expected !== 'string' || !expected || actual !== expected) {
    throw qaError(`豆包 ${label} 与静态 QA 基线不一致`, 'DOUBAO_QA_BASELINE_DRIFT');
  }
}

function exactArtifactHashes(actual, expected) {
  if (!actual || typeof actual !== 'object' || !expected || typeof expected !== 'object') {
    throw qaError('豆包完整性基线缺失', 'DOUBAO_QA_BASELINE_DRIFT');
  }
  const keys = Object.keys(expected);
  if (!keys.length || keys.some((key) => actual[key] !== expected[key])) {
    throw qaError('豆包资源哈希与静态 QA 基线不一致', 'DOUBAO_QA_BASELINE_DRIFT');
  }
}

export function assertDoubaoQaAuthorization(env = process.env) {
  if (env.LINGGLOW_DOUBAO_QA_ACK !== DOUBAO_QA_ACK ||
      env.LINGGLOW_DOUBAO_QA_BOUNDARY !== DOUBAO_QA_BOUNDARY) {
    throw qaError(
      `豆包隔离 QA 未获显式授权；必须同时确认一次隔离重启与只读取固定 DOM 计数的边界。${DOUBAO_QA_AUTHORIZATION_COPY}`,
      'DOUBAO_QA_AUTHORIZATION_REQUIRED',
    );
  }
  return true;
}

// The static snapshot is the gate that makes this a version-specific test.
// A signed-but-updated Doubao application is still refused until it has a new
// static review and a deliberately updated snapshot.
export function assertDoubaoQaBaseline(app, snapshot) {
  if (!app?.safeToLaunch || app.clientId !== 'doubao' || !snapshot?.app || !snapshot?.integrity) {
    throw qaError('豆包应用未通过签名信任链或静态 QA 基线无效', 'DOUBAO_QA_BASELINE_DRIFT');
  }
  const expected = snapshot.app;
  sameValue(app.bundleId, expected.bundleId, 'bundleId');
  sameValue(app.teamId, expected.teamId, 'teamId');
  sameValue(app.version, expected.version, 'version');
  sameValue(app.build, expected.build, 'build');
  sameValue(app.cdHash, expected.cdHash, 'main CDHash');
  sameValue(app.chromium, expected.chromiumFrameworkVersion, 'Chromium 版本');
  sameValue(app.nestedBrowser?.bundleId, expected.nestedBrowser?.bundleId, '嵌套 Browser bundleId');
  sameValue(app.nestedBrowser?.teamId, expected.nestedBrowser?.teamId, '嵌套 Browser teamId');
  sameValue(app.nestedBrowser?.cdHash, expected.nestedBrowser?.cdHash, '嵌套 Browser CDHash');
  sameValue(app.manifestCommit, expected.manifestCommit, 'manifest commit');
  sameValue(app.localExtension?.id, snapshot.localExtension?.id, '本地 Extension ID');
  sameValue(app.localExtension?.version, snapshot.localExtension?.version, '本地 Extension version');
  exactArtifactHashes(app.artifactSha256, snapshot.integrity.artifactSha256);
  if (!app.executable || !app.nestedBrowser?.executable || !app.fingerprint) {
    throw qaError('豆包可执行文件、嵌套 Browser 或指纹缺失', 'DOUBAO_QA_BASELINE_DRIFT');
  }
  return Object.freeze({
    bundleId: app.bundleId,
    teamId: app.teamId,
    version: app.version,
    build: app.build,
    chromium: app.chromium,
    mainCdHash: app.cdHash,
    nestedCdHash: app.nestedBrowser.cdHash,
    fingerprint: app.fingerprint,
  });
}

function isDebugPipeCommand(command) {
  return /(?:^|\s)--remote-debugging-pipe(?:\s|$)/u.test(command);
}

function hasUnexpectedDebugPort(command) {
  return /(?:^|\s)--remote-debugging-port(?:=|\s|$)/u.test(command);
}

function hasExactUserDataDirectory(command, userDataDirectory) {
  return command.includes(`--user-data-dir=${userDataDirectory}`);
}

function anyUserDataDirectory(command) {
  return /(?:^|\s)--user-data-dir=/u.test(command);
}

function samanFromChatPid(command) {
  const match = command.match(/(?:^|\s)--saman-from-chat=(\d+)(?:\s|$)/u);
  return match ? Number(match[1]) : null;
}

function parsePsRows(output) {
  if (typeof output !== 'string') throw qaError('进程快照格式无效', 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  const rows = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/u);
    if (!match) continue;
    rows.push({pid: Number(match[1]), ppid: Number(match[2]), command: match[3]});
  }
  return rows;
}

// `lstart` is requested under the C locale below.  It gives a stable enough
// lifetime marker to distinguish a tracked child from a later process that
// happened to reuse its PID.  Commands are used only transiently to classify
// a process; they are never retained in the candidate evidence.
function parsePsIdentityRows(output) {
  if (typeof output !== 'string') throw qaError('进程身份快照格式无效', 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  const rows = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/u);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      startedAt: match[3].replace(/\s+/gu, ' '),
      command: match[4],
    });
  }
  return rows;
}

function processIdentity(row) {
  return Object.freeze({pid: row.pid, ppid: row.ppid, startedAt: row.startedAt});
}

function identityKey(identity) {
  return `${identity.pid}:${identity.startedAt}`;
}

function validProcessIdentity(value) {
  return Boolean(value && safeInteger(value.pid) && Number.isInteger(value.ppid) && value.ppid >= 0 &&
    typeof value.startedAt === 'string' && value.startedAt.length > 0);
}

function descendantRows(rows, mainPid) {
  const known = new Set([mainPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!known.has(row.pid) && known.has(row.ppid)) {
        known.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter(({pid}) => known.has(pid));
}

function classifyProcess(row, {mainPid, mainExecutable, nestedExecutable, userDataDirectory}) {
  const isSpawnedChild = row.pid === mainPid;
  const mentionsNested = row.command.includes(nestedExecutable);
  const isNestedBrowser = mentionsNested && !row.command.includes('--type=');
  const isNestedChild = mentionsNested && row.command.includes('--type=');
  const isMainWrapper = isSpawnedChild && !isNestedBrowser && row.command.includes(mainExecutable);
  const userDataExact = hasExactUserDataDirectory(row.command, userDataDirectory);
  const role = isNestedBrowser
    ? 'nested-browser'
    : isMainWrapper
      ? 'main-wrapper'
      : isNestedChild
        ? 'nested-browser-child'
        : 'descendant';
  const expectedNestedArgs =
    `--remote-debugging-pipe --user-data-dir=${userDataDirectory} --saman-from-chat=`;
  return Object.freeze({
    pid: row.pid,
    ppid: row.ppid,
    role,
    remoteDebuggingPipe: isDebugPipeCommand(row.command),
    remoteDebuggingPort: hasUnexpectedDebugPort(row.command),
    userDataDirectory: userDataExact ? 'expected' : anyUserDataDirectory(row.command) ? 'other' : 'absent',
    samanFromChatPid: samanFromChatPid(row.command),
    exactMainLaunchArguments: isMainWrapper &&
      row.command === `${mainExecutable} --remote-debugging-pipe --user-data-dir=${userDataDirectory}`,
    exactNestedLaunchArguments: isNestedBrowser && isSpawnedChild &&
      row.command.includes(expectedNestedArgs),
  });
}

// Input is the raw ps output, but the returned record intentionally contains
// classifications only: no commands, target URLs, titles, page text, or user
// data are retained in the QA evidence.
export function classifyDoubaoProcessChain(psOutput, {
  mainPid,
  mainExecutable,
  nestedExecutable,
  userDataDirectory,
} = {}) {
  if (!safeInteger(mainPid) || typeof mainExecutable !== 'string' || !mainExecutable ||
      typeof nestedExecutable !== 'string' || !nestedExecutable ||
      typeof userDataDirectory !== 'string' || !path.isAbsolute(userDataDirectory)) {
    throw qaError('豆包进程分类参数无效', 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
  const records = descendantRows(parsePsRows(psOutput), mainPid)
    .map((row) => classifyProcess(row, {mainPid, mainExecutable, nestedExecutable, userDataDirectory}));
  if (records.length > DOUBAO_QA_MAX_PROCESS_RECORDS) {
    throw qaError('豆包隔离进程链超出有界审计上限', 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
  return Object.freeze(records);
}

// The ledger contains only PID/PPID/start-time tuples.  It is deliberately
// separate from the renderer/process evidence so a cleanup routine can safely
// recognize descendants that drop --user-data-dir from their command line,
// without retaining command strings or user-facing data.
export function captureDoubaoIsolatedProcessLedger(psOutput, {
  mainPid,
  userDataDirectory,
} = {}) {
  if (!safeInteger(mainPid) || typeof userDataDirectory !== 'string' || !path.isAbsolute(userDataDirectory)) {
    throw qaError('豆包隔离进程账本参数无效', 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
  const rows = parsePsIdentityRows(psOutput);
  const relevant = [
    ...descendantRows(rows, mainPid),
    ...rows.filter(({command}) => hasExactUserDataDirectory(command, userDataDirectory)),
  ];
  const seen = new Set();
  const identities = relevant.flatMap((row) => {
    const identity = processIdentity(row);
    const key = identityKey(identity);
    if (seen.has(key)) return [];
    seen.add(key);
    return [identity];
  });
  if (!identities.length || !identities.some(({pid}) => pid === mainPid) ||
      identities.length > DOUBAO_QA_MAX_PROCESS_RECORDS) {
    throw qaError('豆包隔离进程账本不完整或超出有界审计上限', 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
  return Object.freeze({
    mainPid,
    identities: Object.freeze(identities),
  });
}

function validProcessLedger(value) {
  return Boolean(value && safeInteger(value.mainPid) && Array.isArray(value.identities) &&
    value.identities.length > 0 && value.identities.length <= DOUBAO_QA_MAX_PROCESS_RECORDS &&
    value.identities.every(validProcessIdentity) && value.identities.some(({pid}) => pid === value.mainPid));
}

function normalizedPidList(value, label) {
  if (!Array.isArray(value) || value.length > DOUBAO_QA_MAX_PROCESS_RECORDS ||
      value.some((pid) => !safeInteger(pid))) {
    throw qaError(`${label} 无效`, 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
  return [...new Set(value)];
}

// This selector never retains command lines.  It combines four bounded
// sources: the tracked PID/PPID tree, current descendants of the original
// main process (only while that main PID still has the recorded lifetime),
// the unique temporary profile argument, and processes holding open files in
// that temporary directory.  A mismatched lifetime is treated as a cleanup
// failure rather than risking a signal to a reused PID.
export function collectLiveDoubaoIsolatedProcesses(psOutput, {
  processLedger,
  userDataDirectory,
  profileHandlePids = [],
} = {}) {
  if (!validProcessLedger(processLedger) || typeof userDataDirectory !== 'string' ||
      !path.isAbsolute(userDataDirectory)) {
    throw qaError('豆包隔离进程清理参数无效', 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
  const handles = normalizedPidList(profileHandlePids, '隔离 profile 文件句柄 PID 清单');
  const rows = parsePsIdentityRows(psOutput);
  const rowsByPid = new Map(rows.map((row) => [row.pid, row]));
  const mainIdentity = processLedger.identities.find(({pid}) => pid === processLedger.mainPid);
  const currentMain = rowsByPid.get(processLedger.mainPid) ?? null;
  const mainStillTracked = Boolean(currentMain && mainIdentity && currentMain.startedAt === mainIdentity.startedAt);
  const descendant = mainStillTracked ? descendantRows(rows, processLedger.mainPid) : [];
  const profileArgument = rows.filter(({command}) => hasExactUserDataDirectory(command, userDataDirectory));
  const tracked = [];
  const reusedPids = [];
  for (const identity of processLedger.identities) {
    const row = rowsByPid.get(identity.pid);
    if (!row) continue;
    if (row.startedAt === identity.startedAt) tracked.push(row);
    else reusedPids.push(identity.pid);
  }
  const unresolvedHandlePids = handles.filter((pid) => !rowsByPid.has(pid));
  const selected = new Set([
    ...tracked.map(({pid}) => pid),
    ...descendant.map(({pid}) => pid),
    ...profileArgument.map(({pid}) => pid),
    ...handles.filter((pid) => rowsByPid.has(pid)),
  ]);
  return Object.freeze({
    pids: Object.freeze([...selected].sort((a, b) => a - b)),
    trackedPids: Object.freeze([...new Set(tracked.map(({pid}) => pid))].sort((a, b) => a - b)),
    descendantPids: Object.freeze([...new Set(descendant.map(({pid}) => pid))].sort((a, b) => a - b)),
    profileArgumentPids: Object.freeze([...new Set(profileArgument.map(({pid}) => pid))].sort((a, b) => a - b)),
    profileHandlePids: Object.freeze(handles),
    reusedPids: Object.freeze([...new Set(reusedPids)].sort((a, b) => a - b)),
    unresolvedHandlePids: Object.freeze(unresolvedHandlePids),
  });
}

export function assertDoubaoPipeProcessChain(records, {mainPid} = {}) {
  if (!Array.isArray(records) || !safeInteger(mainPid)) {
    throw qaError('豆包进程链证据无效', 'DOUBAO_QA_PROCESS_CHAIN_INVALID');
  }
  // Production attach uses the nested Chromium browser as the direct Pipe
  // child.  The native main wrapper does not forward debugging FDs, so the
  // harness no longer requires a main-wrapper process with pipe args.
  const nested = records.find(({pid, role}) => pid === mainPid && role === 'nested-browser') ||
    records.find(({role}) => role === 'nested-browser');
  if (!nested || nested.pid !== mainPid) {
    throw qaError('未能确认豆包嵌套 Browser 作为 Pipe 子进程', 'DOUBAO_QA_PROCESS_CHAIN_INVALID');
  }
  if (!nested.remoteDebuggingPipe || nested.remoteDebuggingPort ||
      nested.userDataDirectory !== 'expected' || !safeInteger(nested.samanFromChatPid)) {
    throw qaError('嵌套 Browser 没有保留 Pipe、隔离 user-data-dir 与 --saman-from-chat 链路', 'DOUBAO_QA_PROCESS_CHAIN_INVALID');
  }
  return Object.freeze({
    mainPid: nested.samanFromChatPid,
    nestedBrowserPid: nested.pid,
    samanFromChatPid: nested.samanFromChatPid,
    // Historical field name: true when the process we control holds the pipe.
    wrapperForwardedDebugArgument: nested.remoteDebuggingPipe,
    nestedBrowserDebugArgument: nested.remoteDebuggingPipe,
    isolatedUserDataDirForwarded: nested.userDataDirectory === 'expected',
    records,
  });
}

function redactAllowedTarget(url) {
  const parsed = new URL(url);
  if (parsed.protocol === 'doubao:' && parsed.hostname === 'doubao-chat') {
    return 'doubao://doubao-chat/chat';
  }
  if (parsed.protocol === 'chrome-extension:') {
    return 'chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html';
  }
  return 'https://www.doubao.com/chat/<non-empty-path>';
}

export function collectAllowlistedPageTargets(targetInfos, {allowlist = DOUBAO_TARGET_ALLOWLIST} = {}) {
  if (!Array.isArray(targetInfos) || targetInfos.length > DOUBAO_QA_MAX_TARGETS) {
    throw qaError('CDP target 清单无效或超出有界上限', 'DOUBAO_QA_TARGET_INVENTORY_INVALID');
  }
  const pageTargets = targetInfos.filter(({type}) => type === 'page');
  const allowedPages = pageTargets.filter((target) => targetUrlMatchesAllowlist(target?.url, allowlist));
  // Nested Chromium may open internal doubao:// pages.  Those are ignored for
  // injection, but the inventory must still prove at least one allowlisted page.
  if (!allowedPages.length) {
    throw qaError('完整 CDP page target 清单没有白名单页面', 'DOUBAO_QA_TARGET_INVENTORY_INVALID');
  }
  const targetTypeCounts = {};
  for (const target of targetInfos) {
    const type = typeof target?.type === 'string' && target.type ? target.type : 'unknown';
    targetTypeCounts[type] = (targetTypeCounts[type] ?? 0) + 1;
  }
  return Object.freeze({
    totalTargets: targetInfos.length,
    targetTypeCounts: Object.freeze({...targetTypeCounts}),
    rejectedPageCount: pageTargets.length - allowedPages.length,
    // URL query/hash and the opaque chat route are redacted before evidence is
    // retained.  Allowlist validation was performed against the original URL.
    pageTargets: Object.freeze(allowedPages.map((target) => Object.freeze({
      type: 'page',
      url: redactAllowedTarget(target.url),
    }))),
  });
}

export function normalizeDoubaoDomCounts(value) {
  const keys = ['body', 'root', 'chatInput', 'chatInputInput', 'messageTextContent'];
  if (!value || typeof value !== 'object' || keys.some((key) =>
    !Number.isInteger(value[key]) || value[key] < 0 || value[key] > 10000)) {
    throw qaError('豆包固定 DOM 计数探针返回无效结果', 'DOUBAO_QA_DOM_PROBE_INVALID');
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])));
}

export function noDevToolsActivePort(userDataDirectory) {
  const userData = privateOwnedDirectory(userDataDirectory, '豆包隔离 user-data-dir');
  return !fs.existsSync(path.join(userData, 'DevToolsActivePort'));
}

export function currentProcessSnapshot() {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      maxBuffer: DOUBAO_QA_PROCESS_SNAPSHOT_MAX_BUFFER_BYTES,
    });
  } catch (error) {
    throw qaError(`无法读取隔离进程快照：${error.message}`, 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
}

export function currentProcessIdentitySnapshot() {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,command='], {
      encoding: 'utf8',
      maxBuffer: DOUBAO_QA_PROCESS_SNAPSHOT_MAX_BUFFER_BYTES,
      // parsePsIdentityRows intentionally expects the stable English `lstart`
      // layout, regardless of the user's desktop locale.
      env: {PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C'},
    });
  } catch (error) {
    throw qaError(`无法读取隔离进程身份快照：${error.message}`, 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
}

export function allDoubaoProcessPids(psOutput, {mainExecutable, nestedExecutable} = {}) {
  if (typeof mainExecutable !== 'string' || !mainExecutable ||
      typeof nestedExecutable !== 'string' || !nestedExecutable) {
    throw qaError('豆包进程清理参数无效', 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
  return Object.freeze(parsePsRows(psOutput)
    .filter(({command}) => command === mainExecutable || command.startsWith(`${mainExecutable} `) ||
      command.includes(nestedExecutable))
    .map(({pid}) => pid));
}

export function isolatedProfileProcessPids(psOutput, userDataDirectory) {
  if (typeof userDataDirectory !== 'string' || !path.isAbsolute(userDataDirectory)) {
    throw qaError('隔离 user-data-dir 无效', 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
  return Object.freeze(parsePsRows(psOutput)
    .filter(({command}) => hasExactUserDataDirectory(command, userDataDirectory))
    .map(({pid}) => pid));
}

function parsePidOnlyOutput(output, label) {
  if (typeof output !== 'string') throw qaError(`${label} 输出格式无效`, 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  const pids = [];
  for (const line of output.split('\n')) {
    const value = line.trim();
    if (!value) continue;
    if (!/^\d+$/u.test(value) || !safeInteger(Number(value))) {
      throw qaError(`${label} 输出包含无效 PID`, 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
    }
    pids.push(Number(value));
  }
  return normalizedPidList(pids, label);
}

// A process can be detached or omit --user-data-dir from a later helper
// command line.  `lsof +D` gives us a second, bounded proof that no process
// still holds the fresh temporary profile before it is removed.  A missing or
// failing lsof is a cleanup failure, not permission to guess that handles are
// gone.
export function isolatedProfileHandlePids(userDataDirectory) {
  try {
    return isolatedDoubaoProfileHandlePids(userDataDirectory);
  } catch (error) {
    throw qaError(error.message, 'DOUBAO_QA_PROCESS_SNAPSHOT_INVALID');
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, {timeoutMs = 15000, intervalMs = 150, label = '条件'} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw qaError(`${label} 超时${lastError ? `：${lastError.message}` : ''}`, 'DOUBAO_QA_TIMEOUT');
}

async function waitForChildSpawn(child) {
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onSpawn = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const onExit = (code, signal) => {
      cleanup();
      reject(qaError(`豆包隔离进程在连接 CDP 前退出 (${code ?? signal ?? 'unknown'})`, 'DOUBAO_QA_CHILD_EXITED'));
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function waitForExit(child, timeoutMs = 10000) {
  if (!child || child.exitCode != null || child.signalCode != null) return true;
  return await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    sleep(timeoutMs).then(() => false),
  ]);
}

function killPids(pids, signal) {
  for (const pid of pids) {
    if (!safeInteger(pid) || pid === process.pid) continue;
    try { process.kill(pid, signal); } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

function cleanupObservation(processLedger, userDataDirectory) {
  const profileHandlePids = isolatedProfileHandlePids(userDataDirectory);
  return collectLiveDoubaoIsolatedProcesses(currentProcessIdentitySnapshot(), {
    processLedger,
    userDataDirectory,
    profileHandlePids,
  });
}

function cleanupObservationFailed(observation) {
  return observation.pids.length > 0 || observation.reusedPids.length > 0 ||
    observation.unresolvedHandlePids.length > 0;
}

function untrackedProfilePids(userDataDirectory) {
  // This function is used only by the no-ledger emergency path.  A failed
  // observation must not prevent us from terminating the direct child handle
  // that the harness owns.  Each signal candidate still needs an independent
  // proof (exact profile argument or a handle under the fresh profile).
  let byArgument = [];
  let byHandle = [];
  try {
    byArgument = isolatedProfileProcessPids(currentProcessSnapshot(), userDataDirectory);
  } catch {}
  try {
    byHandle = isolatedProfileHandlePids(userDataDirectory);
  } catch {}
  return [...new Set([...byArgument, ...byHandle])].sort((a, b) => a - b);
}

// A failed identity-ledger capture must not leave the directly spawned child
// running.  This fallback still only signals the child handle we created and
// PIDs proven to use the fresh, harness-owned profile.  It intentionally
// remains *unverified*: the caller keeps the 0700 directory and refuses stock
// restoration because it could not prove the complete descendant tree.
async function bestEffortTerminateWithoutLedger(child, userDataDirectory) {
  if (child?.exitCode == null && child?.signalCode == null) {
    try { child.kill('SIGTERM'); } catch {}
  }
  let pids = untrackedProfilePids(userDataDirectory);
  killPids(pids, 'SIGTERM');
  await waitForExit(child, 10000);
  await sleep(250);
  pids = untrackedProfilePids(userDataDirectory);
  if (pids.length) {
    killPids(pids, 'SIGKILL');
    await sleep(250);
  }
  // Do not use an empty result as a proof of complete cleanup: untracked
  // detached descendants may no longer expose the profile argument/handle.
  untrackedProfilePids(userDataDirectory);
  throw qaError('隔离进程账本缺失；已终止已知临时进程，但拒绝删除 profile 或恢复原版', 'DOUBAO_QA_CLEANUP_FAILED');
}

async function terminateIsolatedProfile(child, userDataDirectory, processLedger) {
  if (!validProcessLedger(processLedger)) {
    return await bestEffortTerminateWithoutLedger(child, userDataDirectory);
  }
  if (child?.exitCode == null && child?.signalCode == null) {
    try { child.kill('SIGTERM'); } catch {}
  }
  let observation = cleanupObservation(processLedger, userDataDirectory);
  // Only current tracked descendants, processes with the unique profile path,
  // or processes holding that profile directory are eligible for signals.
  killPids(observation.pids, 'SIGTERM');
  await waitForExit(child, 10000);
  await sleep(250);
  observation = cleanupObservation(processLedger, userDataDirectory);
  if (observation.pids.length) {
    // SIGKILL remains narrowly scoped to the tracked tree or the fresh,
    // harness-owned profile/handle set.  A general Doubao process is never
    // selected by executable name alone.
    killPids(observation.pids, 'SIGKILL');
    await sleep(250);
  }
  observation = cleanupObservation(processLedger, userDataDirectory);
  if (cleanupObservationFailed(observation)) {
    throw qaError('隔离豆包调试进程、文件句柄或 PID 生命周期未能完全核验；拒绝恢复普通启动', 'DOUBAO_QA_CLEANUP_FAILED');
  }
  return Object.freeze({verified: true, trackedProcessCount: processLedger.identities.length});
}

function removeIsolatedProfile(userDataDirectory) {
  const userData = privateOwnedDirectory(userDataDirectory, '豆包隔离 user-data-dir');
  const base = path.basename(userData);
  if (!base.startsWith(DOUBAO_QA_TEMP_PREFIX)) {
    throw qaError('拒绝删除非本 harness 创建的 user-data-dir', 'DOUBAO_QA_CLEANUP_FAILED');
  }
  fs.rmSync(userData, {recursive: true, force: true});
  if (fs.existsSync(userData)) {
    throw qaError('隔离 user-data-dir 删除失败', 'DOUBAO_QA_CLEANUP_FAILED');
  }
}

async function waitForQualifiedProcessChain(app, childPid, userDataDirectory) {
  return await waitFor(() => {
    const records = classifyDoubaoProcessChain(currentProcessSnapshot(), {
      mainPid: childPid,
      mainExecutable: app.executable,
      nestedExecutable: app.nestedBrowser.executable,
      userDataDirectory,
    });
    return assertDoubaoPipeProcessChain(records, {mainPid: childPid});
  }, {timeoutMs: 20000, label: '豆包嵌套 Browser Pipe 进程链'});
}

async function waitForProcessLedger(childPid, userDataDirectory) {
  return await waitFor(() => captureDoubaoIsolatedProcessLedger(currentProcessIdentitySnapshot(), {
    mainPid: childPid,
    userDataDirectory,
  }), {timeoutMs: 5000, label: '豆包隔离进程身份账本'});
}

function isBenignNonAllowlistedPage(url) {
  const value = String(url || '');
  return value.startsWith('doubao://') ||
    value.startsWith('about:') ||
    value.startsWith('chrome://') ||
    value.startsWith('devtools://') ||
    value === '' ||
    value === 'about:blank';
}

async function waitForAllowlistedPageInventory(transport) {
  const deadline = Date.now() + 20000;
  let openedSidePanel = false;
  while (Date.now() < deadline) {
    const {targetInfos = []} = await transport.call('Target.getTargets');
    if (!Array.isArray(targetInfos) || targetInfos.length > DOUBAO_QA_MAX_TARGETS) {
      throw qaError('CDP target 清单无效或超出有界上限', 'DOUBAO_QA_TARGET_INVENTORY_INVALID');
    }
    const pageTargets = targetInfos.filter(({type}) => type === 'page');
    const allowed = pageTargets.filter((target) =>
      targetUrlMatchesAllowlist(target?.url, DOUBAO_TARGET_ALLOWLIST));
    const dangerous = pageTargets.filter((target) =>
      !targetUrlMatchesAllowlist(target?.url, DOUBAO_TARGET_ALLOWLIST) &&
      !isBenignNonAllowlistedPage(target?.url));
    if (dangerous.length) {
      throw qaError('完整 CDP page target 清单包含未白名单页面', 'DOUBAO_QA_TARGET_INVENTORY_INVALID');
    }
    if (!allowed.length) {
      if (!openedSidePanel) {
        openedSidePanel = true;
        try {
          await transport.call('Target.createTarget', {
            url: DOUBAO_QA_SIDE_PANEL_URL,
          });
        } catch {
          // Retry until timeout; createTarget may race early browser boot.
        }
      }
      await sleep(150);
      continue;
    }
    return Object.freeze({
      targetInfos: Object.freeze([...targetInfos]),
      inventory: collectAllowlistedPageTargets(targetInfos),
    });
  }
  throw qaError('等待豆包 allowlisted page target 超时', 'DOUBAO_QA_TIMEOUT');
}

async function collectDomCounts(transport, pageTargets) {
  const probes = [];
  for (const target of pageTargets) {
    const {sessionId} = await transport.call('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    try {
      const result = await transport.call('Runtime.evaluate', {
        expression: DOUBAO_DOM_COUNT_EXPRESSION,
        returnByValue: true,
      }, sessionId);
      if (result.exceptionDetails) {
        throw qaError('豆包固定 DOM 计数探针执行失败', 'DOUBAO_QA_DOM_PROBE_INVALID');
      }
      probes.push(normalizeDoubaoDomCounts(result.result?.value));
    } finally {
      try { await transport.call('Target.detachFromTarget', {sessionId}); } catch {}
    }
  }
  return Object.freeze(probes);
}

function aggregateErrors(errors) {
  const meaningful = errors.filter(Boolean);
  if (meaningful.length === 1) throw meaningful[0];
  if (meaningful.length > 1) throw new AggregateError(meaningful, '豆包隔离 QA 未能安全完成');
}

function assertStockRestoreResult(value) {
  if (!value?.ok || !Array.isArray(value.pids) || !value.pids.length ||
      value.pids.some((pid) => !safeInteger(pid))) {
    throw qaError('豆包原版恢复未提供经过核验的无调试进程结果', 'DOUBAO_QA_STOCK_RESTORE_FAILED');
  }
  return true;
}

// This is intentionally an explicit function rather than a test imported by
// npm test.  It starts only when the standalone script is invoked with both
// acknowledgement values.  It never injects CSS/JS and never changes adapter
// capabilities; its output is evidence for human review only.
export async function runDoubaoIsolatedQa({
  env = process.env,
  staticSnapshot,
  findApp = (options) => findClientApp('doubao', options),
  quitApp = quitClientGracefully,
  launchNormal = launchStock,
  spawnProcess = spawn,
} = {}) {
  assertDoubaoQaAuthorization(env);
  if (!staticSnapshot || typeof staticSnapshot !== 'object') {
    throw qaError('豆包静态 QA 快照缺失', 'DOUBAO_QA_BASELINE_DRIFT');
  }

  let app = findApp({fresh: true});
  const baseline = assertDoubaoQaBaseline(app, staticSnapshot);
  let userDataDirectory = null;
  let child = null;
  let transport = null;
  let primaryError = null;
  const cleanupErrors = [];
  let shouldRestoreStock = false;
  let processLedger = null;
  let cleanupVerification = null;
  let stockRestoreVerified = false;
  let evidence = null;

  try {
    // This is the first side effect involving Doubao.  Authorization and the
    // full signature/static baseline gates have already succeeded above.
    const quit = await quitApp(app);
    if (!quit?.ok) throw qaError(quit?.error || '豆包拒绝正常退出', 'DOUBAO_QA_STOCK_QUIT_FAILED');
    // The native wrapper can exit a fraction earlier than its Browser helper.
    // Wait for the signed app's own process tree to drain instead of treating
    // that normal shutdown tail as an immediate verification failure.
    await waitFor(() => allDoubaoProcessPids(currentProcessSnapshot(), {
      mainExecutable: app.executable,
      nestedExecutable: app.nestedBrowser.executable,
    }).length === 0, {timeoutMs: 5000, label: '豆包普通进程退出'});
    shouldRestoreStock = true;

    const freshApp = findApp({fresh: true});
    assertDoubaoQaBaseline(freshApp, staticSnapshot);
    if (!sameAppFingerprint(app, freshApp)) {
      throw qaError('豆包在隔离 QA 前发生身份漂移', 'DOUBAO_QA_BASELINE_DRIFT');
    }
    app = freshApp;
    userDataDirectory = createIsolatedDoubaoUserDataDirectory();
    const launchArguments = doubaoQaLaunchArguments(userDataDirectory, {
      samanFromChatPid: process.pid,
    });
    child = spawnProcess(app.nestedBrowser.executable, launchArguments, {
      env: isolatedDoubaoEnvironment(env, {userDataDirectory}),
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    });
    await waitForChildSpawn(child);
    // Start tracking before the first CDP request, then refresh the ledger
    // after the Browser child appears.  Either snapshot contains only
    // PID/PPID/start-time identities, never retained command strings.
    processLedger = await waitForProcessLedger(child.pid, userDataDirectory);
    transport = new PipeTransport(child);
    const version = await transport.call('Browser.getVersion');
    if (version.product !== `Chrome/${baseline.chromium}`) {
      throw qaError('Browser.getVersion 与固定 Chromium 基线不一致', 'DOUBAO_QA_BROWSER_VERSION_MISMATCH');
    }
    const processChain = await waitForQualifiedProcessChain(app, child.pid, userDataDirectory);
    processLedger = await waitForProcessLedger(child.pid, userDataDirectory);
    if (!noDevToolsActivePort(userDataDirectory)) {
      throw qaError('隔离 Pipe profile 出现 DevToolsActivePort；拒绝继续', 'DOUBAO_QA_PIPE_VIOLATION');
    }
    const targetSnapshot = await waitForAllowlistedPageInventory(transport);
    const {targetInfos, inventory} = targetSnapshot;
    // Probing is restricted to the same allowlisted pages the inventory
    // retained, so every retained count maps back to one evidence page and
    // benign internal pages are never evaluated.
    const livePages = targetInfos.filter(({type, url}) =>
      type === 'page' && targetUrlMatchesAllowlist(url, DOUBAO_TARGET_ALLOWLIST));
    const domCounts = await collectDomCounts(transport, livePages);
    // No raw target URL, title, DOM text, form value, cookie, storage key, or
    // arbitrary Runtime.evaluate result is persisted in this object.
    evidence = Object.freeze({
      schemaVersion: DOUBAO_QA_EVIDENCE_SCHEMA_VERSION,
      kind: DOUBAO_QA_EVIDENCE_KIND,
      status: DOUBAO_QA_CANDIDATE_STATUS,
      exactAdapterEnabled: false,
      capabilitiesElevated: false,
      noAutomaticPromotion: true,
      userAuthorized: true,
      isolatedProfile: true,
      isolationScope: DOUBAO_QA_ISOLATION_SCOPE,
      domProbeScope: DOUBAO_QA_DOM_PROBE_SCOPE,
      isolatedUserDataDirForwarded: processChain.isolatedUserDataDirForwarded,
      strategyId: 'wrapper-forwarded-pipe',
      appFingerprint: app.fingerprint,
      app: baseline,
      browserProduct: version.product,
      pipeConnected: true,
      wrapperForwardedDebugArgument: processChain.wrapperForwardedDebugArgument,
      nestedBrowserDebugArgument: processChain.nestedBrowserDebugArgument,
      mainPid: processChain.mainPid,
      nestedBrowserPid: processChain.nestedBrowserPid,
      samanFromChatPid: processChain.samanFromChatPid,
      devToolsActivePortPresent: false,
      pageTargetInventoryComplete: true,
      pageTargets: inventory.pageTargets,
      targetInventory: inventory,
      fixedDomCounts: domCounts,
      processChain: processChain.records,
      // Filled only after the finally block has independently verified both
      // cleanup and a normal, non-debug stock relaunch.
      cleanupVerified: false,
      stockRestoreVerified: false,
    });
  } catch (error) {
    primaryError = error;
  } finally {
    if (transport) {
      try { transport.close(); } catch (error) { cleanupErrors.push(error); }
    }
    if (userDataDirectory) {
      let isolatedProcessTerminated = false;
      try {
        cleanupVerification = await terminateIsolatedProfile(child, userDataDirectory, processLedger);
        isolatedProcessTerminated = true;
      } catch (error) {
        cleanupErrors.push(error);
      }
      // Never delete a profile that still has a process using it.  Keeping an
      // inaccessible 0700 temp directory is safer than deleting live files;
      // the cleanup failure also suppresses the stock relaunch below.
      if (isolatedProcessTerminated) {
        try { removeIsolatedProfile(userDataDirectory); } catch (error) { cleanupErrors.push(error); }
      }
    } else if (child && child.exitCode == null && child.signalCode == null) {
      try { child.kill('SIGTERM'); } catch (error) { cleanupErrors.push(error); }
    }
    if (shouldRestoreStock && !cleanupErrors.length) {
      try {
        const finalApp = findApp({fresh: true});
        assertDoubaoQaBaseline(finalApp, staticSnapshot);
        const launchResult = await launchNormal(finalApp);
        stockRestoreVerified = assertStockRestoreResult(launchResult);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  aggregateErrors([primaryError, ...cleanupErrors]);
  if (!evidence) throw qaError('豆包隔离 QA 没有生成证据', 'DOUBAO_QA_EVIDENCE_MISSING');
  if (cleanupVerification?.verified !== true || stockRestoreVerified !== true) {
    throw qaError('豆包隔离 QA 未能确认清理和原版恢复', 'DOUBAO_QA_EVIDENCE_MISSING');
  }
  return Object.freeze({...evidence, cleanupVerified: true, stockRestoreVerified: true});
}

export const doubaoQaTestInternals = Object.freeze({
  anyUserDataDirectory,
  classifyProcess,
  collectLiveDoubaoIsolatedProcesses,
  descendantRows,
  hasExactUserDataDirectory,
  isDebugPipeCommand,
  parsePidOnlyOutput,
  parsePsIdentityRows,
  parsePsRows,
  redactAllowedTarget,
  terminateIsolatedProfile,
  waitForAllowlistedPageInventory,
});
