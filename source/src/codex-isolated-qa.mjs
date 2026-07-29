import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export const CODEX_QA_ACK = 'I_ACCEPT_A_SECOND_CODEX_IN_A_SEPARATE_TEST_ACCOUNT';
export const CODEX_QA_BOUNDARY = 'separate-macos-user-or-disposable-vm';
// Keep the acknowledgement token stable for the operator, but make the actual
// authorization copy unambiguous: this harness installs a *test* stylesheet
// only in the fresh, isolated renderer and removes it before that renderer is
// allowed to exit.  It is never a permission to touch the invoking Codex.
export const CODEX_QA_AUTHORIZATION_COPY =
  '我确认仅在独立 macOS 用户或一次性 VM 的隔离 Codex 目标中安装并移除测试 CSS；不会触碰当前 Codex 会话。';
export const CODEX_QA_TEMP_PREFIX = 'lingglow-codex-isolated-';
export const CODEX_QA_MAX_PROCESS_ROWS = 2048;
export const CODEX_QA_CLEANUP_TIMEOUT_MS = 10000;
// `ps` output grows with every Chromium/Electron helper on the host; the 1MiB
// default would raise ENOBUFS instead of returning the full snapshot.
const CODEX_QA_PROCESS_SNAPSHOT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

const FORWARDED_ENVIRONMENT_KEYS = Object.freeze([
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'PATH',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  '__CF_USER_TEXT_ENCODING',
]);

// HOME/USER are required by the packaged app, but they are deliberately not
// a security boundary. The harness is only safe when launched from a separate
// macOS test account or a disposable VM, where those values already belong to
// the isolated environment. It forwards no auth, proxy, SSH, or
// project-specific environment variables from the invoking shell.

function qaError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safePid(value) {
  return Number.isInteger(value) && value > 1;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function absoluteDirectory(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new Error(`${label} 必须是绝对目录`);
  }
  const resolved = path.resolve(value);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} 必须是权限 0700 的真实目录`);
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`${label} 必须属于当前隔离测试用户`);
  }
  return resolved;
}

/**
 * Create the one private root used by a Codex isolated QA attempt.  Every
 * child directory and every process tracked by the harness remains below
 * this root, which gives cleanup a narrow, inspectable boundary.
 */
export function createIsolatedCodexQaRoot({temporaryDirectory = os.tmpdir()} = {}) {
  if (typeof temporaryDirectory !== 'string' || !path.isAbsolute(temporaryDirectory) ||
      temporaryDirectory.includes('\0')) {
    throw qaError('Codex QA 临时目录必须是绝对路径', 'CODEX_QA_INVALID_DIRECTORY');
  }
  const root = fs.mkdtempSync(path.join(temporaryDirectory, CODEX_QA_TEMP_PREFIX));
  // Do not rely on the caller's umask.  This happens before a child can be
  // launched or test configuration can be written into the directory.
  fs.chmodSync(root, 0o700);
  return absoluteDirectory(root, 'Codex QA 临时根目录');
}

/**
 * Delete only a root created by createIsolatedCodexQaRoot.  The caller must
 * first prove that no tracked or root-referencing process remains alive.
 */
export function removeIsolatedCodexQaRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0') ||
      !path.basename(root).startsWith(CODEX_QA_TEMP_PREFIX)) {
    throw qaError('拒绝删除非 Codex QA 创建的临时根目录', 'CODEX_QA_CLEANUP_FAILED');
  }
  if (!fs.existsSync(root)) return true;
  const safeRoot = absoluteDirectory(root, 'Codex QA 临时根目录');
  fs.rmSync(safeRoot, {recursive: true, force: true});
  if (fs.existsSync(safeRoot)) {
    throw qaError('Codex QA 临时根目录删除失败', 'CODEX_QA_CLEANUP_FAILED');
  }
  return true;
}

export function assertCodexQaAuthorization(env = process.env) {
  if (env.LINGGLOW_CODEX_QA_ACK !== CODEX_QA_ACK ||
      env.LINGGLOW_CODEX_QA_BOUNDARY !== CODEX_QA_BOUNDARY) {
    const error = new Error(
      `Codex 隔离 QA 未获显式授权；必须在单独 macOS 用户或一次性 VM 中确认风险边界。${CODEX_QA_AUTHORIZATION_COPY}`,
    );
    error.code = 'CODEX_QA_AUTHORIZATION_REQUIRED';
    throw error;
  }
  return true;
}

function parseProcessRows(psOutput) {
  if (typeof psOutput !== 'string') {
    throw qaError('Codex QA 进程快照格式无效', 'CODEX_QA_PROCESS_SNAPSHOT_INVALID');
  }
  const rows = [];
  for (const line of psOutput.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/u);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!safePid(pid) || !Number.isInteger(ppid) || !match[3]) continue;
    rows.push(Object.freeze({pid, ppid, command: match[3]}));
  }
  if (!rows.length || rows.length > CODEX_QA_MAX_PROCESS_ROWS) {
    throw qaError('Codex QA 进程快照为空或超出有界上限', 'CODEX_QA_PROCESS_SNAPSHOT_INVALID');
  }
  return Object.freeze(rows);
}

/**
 * Match app-bundle executables and an explicit `codex`/`chatgpt` executable,
 * but deliberately do not treat an ordinary workspace path containing the
 * word “Codex” as an app ancestry match.
 */
export function commandBelongsToCodexOrChatGpt(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  if (/(?:ChatGPT|Codex)\.app\/Contents\//iu.test(command) ||
      /(?:^|\s)--app(?:=|\s+)[^\s]*(?:ChatGPT|Codex)\.app(?:\s|$)/iu.test(command)) {
    return true;
  }
  const firstToken = command.trim().match(/^(?:["']([^"']+)["']|([^\s]+))/u);
  const executable = firstToken?.[1] ?? firstToken?.[2] ?? '';
  return /(?:^|\/)(?:codex|chatgpt)$/iu.test(executable);
}

/** Return only the invoking process's parent chain; no command text escapes. */
export function codexQaAncestry(psOutput, {currentPid = process.pid} = {}) {
  if (!safePid(currentPid)) {
    throw qaError('Codex QA 当前 PID 无效', 'CODEX_QA_PROCESS_SNAPSHOT_INVALID');
  }
  const byPid = new Map(parseProcessRows(psOutput).map((row) => [row.pid, row]));
  const ancestry = [];
  const seen = new Set();
  let pid = currentPid;
  while (safePid(pid)) {
    if (seen.has(pid)) {
      throw qaError('Codex QA 进程链出现循环', 'CODEX_QA_PROCESS_SNAPSHOT_INVALID');
    }
    const row = byPid.get(pid);
    if (!row) {
      throw qaError('Codex QA 无法验证完整进程祖先链', 'CODEX_QA_PROCESS_SNAPSHOT_INVALID');
    }
    ancestry.push(row);
    seen.add(pid);
    if (row.ppid <= 1) break;
    pid = row.ppid;
  }
  return Object.freeze(ancestry);
}

export function currentCodexQaProcessSnapshot() {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      maxBuffer: CODEX_QA_PROCESS_SNAPSHOT_MAX_BUFFER_BYTES,
    });
  } catch (error) {
    throw qaError(
      `无法读取 Codex QA 进程祖先链；拒绝启动隔离实例：${error.message}`,
      'CODEX_QA_ANCESTRY_UNAVAILABLE',
    );
  }
}

/**
 * A second Codex is useful only outside the current Codex/ChatGPT app tree.
 * This is intentionally a technical fail-closed guard, independent of the
 * human acknowledgement variables above.
 */
export function assertCodexQaOutsideInteractiveAncestry({
  psOutput = currentCodexQaProcessSnapshot(),
  currentPid = process.pid,
} = {}) {
  const ancestry = codexQaAncestry(psOutput, {currentPid});
  const associated = ancestry.find((row) => commandBelongsToCodexOrChatGpt(row.command));
  if (associated) {
    throw qaError(
      '拒绝在当前 ChatGPT/Codex 进程链内运行隔离 QA；请改在单独 macOS 用户或一次性 VM 中执行。',
      'CODEX_QA_INTERACTIVE_ANCESTRY_FORBIDDEN',
    );
  }
  return Object.freeze({
    currentPid,
    checkedPids: Object.freeze(ancestry.map(({pid}) => pid)),
  });
}

/**
 * Build a bounded PID/PPID tree beginning with the ChildProcess PID.  The
 * tree intentionally ignores unrelated processes even if their command text
 * happens to mention the temporary root.
 */
function childProcessTreeRows(rows, childPid) {
  const known = new Set([childPid]);
  const depths = new Map([[childPid, 0]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!known.has(row.pid) && known.has(row.ppid)) {
        known.add(row.pid);
        depths.set(row.pid, (depths.get(row.ppid) ?? 0) + 1);
        changed = true;
      }
    }
  }
  return Object.freeze(rows
    .filter(({pid}) => known.has(pid))
    .map((row) => Object.freeze({...row, depth: depths.get(row.pid) ?? 0})));
}

export function codexQaChildProcessTree(psOutput, {childPid} = {}) {
  if (!safePid(childPid)) {
    throw qaError('Codex QA 子进程 PID 无效', 'CODEX_QA_PROCESS_SNAPSHOT_INVALID');
  }
  return childProcessTreeRows(parseProcessRows(psOutput), childPid);
}

function rootReferencingRows(rows, root) {
  return rows.filter(({command}) => command.includes(root));
}

function rememberChildTree(tracked, rows) {
  for (const row of rows) {
    const known = tracked.get(row.pid);
    if (known && known.command !== row.command) {
      throw qaError('隔离 Codex 进程 PID 在清理期间发生复用；拒绝继续信号清理', 'CODEX_QA_CLEANUP_FAILED');
    }
    if (!known) {
      tracked.set(row.pid, Object.freeze({
        pid: row.pid,
        command: row.command,
        depth: row.depth ?? 0,
      }));
    }
  }
}

function currentlyTrackedRows(rows, tracked) {
  const current = [];
  for (const row of rows) {
    const known = tracked.get(row.pid);
    if (!known) continue;
    if (known.command !== row.command) {
      throw qaError('隔离 Codex 进程 PID 在清理期间发生复用；拒绝继续信号清理', 'CODEX_QA_CLEANUP_FAILED');
    }
    current.push(Object.freeze({...row, depth: known.depth}));
  }
  return current;
}

function signalRows(rows, signal, killProcess = process.kill) {
  for (const row of [...rows].sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0))) {
    if (!safePid(row.pid) || row.pid === process.pid) continue;
    try {
      killProcess(row.pid, signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

function snapshotRows(snapshot) {
  return parseProcessRows(snapshot());
}

/**
 * Stop only the spawned child and descendants that were observed below it.
 * It waits after TERM, escalates only those same tracked descendants to KILL,
 * then proves both the tracked set and root references are gone before a
 * caller may remove the temporary root.
 */
export async function terminateIsolatedCodexProcess(child, {
  root,
  processSnapshot = currentCodexQaProcessSnapshot,
  timeoutMs = CODEX_QA_CLEANUP_TIMEOUT_MS,
  intervalMs = 150,
  wait = sleep,
  killProcess = process.kill,
} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) {
    throw qaError('Codex QA 临时根目录无效', 'CODEX_QA_CLEANUP_FAILED');
  }
  const childPid = child?.pid;
  if (childPid != null && !safePid(childPid)) {
    throw qaError('Codex QA 子进程 PID 无效', 'CODEX_QA_CLEANUP_FAILED');
  }
  const tracked = new Map();
  const updateTracked = (rows) => {
    if (safePid(childPid)) {
      rememberChildTree(tracked, childProcessTreeRows(rows, childPid));
    }
  };

  // A snapshot is mandatory even when spawn failed: it prevents deletion if a
  // partially started renderer still references the newly-created root.
  let rows = snapshotRows(processSnapshot);
  updateTracked(rows);
  let live = currentlyTrackedRows(rows, tracked);
  if (live.length) signalRows(live, 'SIGTERM', killProcess);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await wait(intervalMs);
    rows = snapshotRows(processSnapshot);
    updateTracked(rows);
    live = currentlyTrackedRows(rows, tracked);
    if (!live.length) break;
  }

  if (live.length) {
    // Only pids previously observed under the child are eligible here.  No
    // broad app-name or root-string process kill is ever used.
    signalRows(live, 'SIGKILL', killProcess);
    await wait(Math.min(intervalMs * 2, 500));
    rows = snapshotRows(processSnapshot);
    updateTracked(rows);
    live = currentlyTrackedRows(rows, tracked);
  }

  const rooted = rootReferencingRows(rows, root);
  if (live.length || rooted.length) {
    throw qaError('隔离 Codex 调试进程尚未完全退出；拒绝删除临时根目录', 'CODEX_QA_CLEANUP_FAILED');
  }
  return Object.freeze({
    trackedPids: Object.freeze([...tracked.keys()].sort((a, b) => a - b)),
    residualPids: Object.freeze([]),
  });
}

export function isolatedCodexEnvironment(baseEnvironment, {userData, codexHome}) {
  const source = baseEnvironment && typeof baseEnvironment === 'object' ? baseEnvironment : {};
  const result = {};
  for (const key of FORWARDED_ENVIRONMENT_KEYS) {
    if (typeof source[key] === 'string' && source[key]) result[key] = source[key];
  }
  result.CODEX_ELECTRON_USER_DATA_PATH = absoluteDirectory(userData, 'Codex userData');
  result.CODEX_HOME = absoluteDirectory(codexHome, 'CODEX_HOME');
  result.NODE_ENV = 'production';
  return Object.freeze(result);
}

export function assertCodexStaticBaseline(app, snapshot) {
  if (!app?.safeToLaunch || !snapshot?.app || !snapshot?.integrity) {
    throw new Error('Codex 应用或静态基线无效');
  }
  const expected = snapshot.app;
  const checks = [
    ['bundleId', app.bundleId, expected.bundleId],
    ['teamId', app.teamId, expected.teamId],
    ['version', app.version, expected.version],
    ['build', app.build, expected.build],
    ['chromium', app.chromium, expected.chromium],
    ['asarSha256', app.asarSha256, snapshot.integrity.asarRawSha256],
  ];
  for (const [label, actual, wanted] of checks) {
    if (typeof wanted !== 'string' || actual !== wanted) {
      const error = new Error(`Codex ${label} 与静态 QA 基线不一致`);
      error.code = 'CODEX_QA_BASELINE_DRIFT';
      throw error;
    }
  }
  return Object.freeze(Object.fromEntries(checks.map(([label, actual]) => [label, actual])));
}

export function codexQaLaunchArguments() {
  return Object.freeze([
    '--remote-debugging-pipe',
    '--disable-background-networking',
    '--no-first-run',
  ]);
}

export const codexQaInternals = Object.freeze({
  FORWARDED_ENVIRONMENT_KEYS,
  parseProcessRows,
  childProcessTreeRows,
  rootReferencingRows,
  rememberChildTree,
  currentlyTrackedRows,
  signalRows,
});
