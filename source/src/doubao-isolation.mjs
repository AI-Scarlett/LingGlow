import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// This module contains the narrow, reusable pieces of the Doubao isolated
// profile boundary.  It deliberately does not know how to discover, launch,
// inspect, or inject a target.  Callers must establish their own review and
// process-identity gates before they are permitted to consume these helpers.
export const DOUBAO_ISOLATION_TEMP_PREFIX = 'lingglow-doubao-isolated-';

// Do not inherit the parent process wholesale.  In particular, credentials,
// checkout settings, proxies, agent sockets, Node flags, and developer tools
// must never cross into an isolated Chromium profile by accident.
export const DOUBAO_ISOLATION_FORWARDED_ENVIRONMENT_KEYS = Object.freeze([
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

function isolationError(message, code = 'DOUBAO_ISOLATION_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validPid(value) {
  return Number.isInteger(value) && value > 1;
}

function parsePidOnlyOutput(output, label) {
  if (typeof output !== 'string') {
    throw isolationError(`${label} 输出格式无效`, 'DOUBAO_ISOLATION_HANDLE_PROOF_FAILED');
  }
  const values = [];
  for (const line of output.split('\n')) {
    const value = line.trim();
    if (!value) continue;
    if (!/^\d+$/u.test(value) || !validPid(Number(value))) {
      throw isolationError(`${label} 输出包含无效 PID`, 'DOUBAO_ISOLATION_HANDLE_PROOF_FAILED');
    }
    values.push(Number(value));
  }
  return Object.freeze([...new Set(values)].sort((first, second) => first - second));
}

// Verify this directory at every boundary.  A cleanup path is allowed to
// touch only a freshly-created, real, current-user-owned 0700 directory.
export function assertPrivateOwnedDoubaoDirectory(directory, label = '豆包隔离 user-data-dir') {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) {
    throw isolationError(`${label} 必须是绝对目录`, 'DOUBAO_ISOLATION_INVALID_DIRECTORY');
  }
  // Inspect the caller-provided path *before* resolving it.  Otherwise a
  // terminal symlink would disappear through realpath and could make an
  // arbitrary directory appear to be one of our private profiles.
  const original = fs.lstatSync(directory);
  if (!original.isDirectory() || original.isSymbolicLink()) {
    throw isolationError(`${label} 必须是权限 0700 的真实目录`, 'DOUBAO_ISOLATION_INVALID_DIRECTORY');
  }
  const resolved = fs.realpathSync(directory);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw isolationError(`${label} 必须是权限 0700 的真实目录`, 'DOUBAO_ISOLATION_INVALID_DIRECTORY');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw isolationError(`${label} 必须属于当前用户`, 'DOUBAO_ISOLATION_INVALID_DIRECTORY');
  }
  return resolved;
}

export function createIsolatedDoubaoUserDataDirectory({temporaryDirectory = os.tmpdir()} = {}) {
  if (typeof temporaryDirectory !== 'string' || !path.isAbsolute(temporaryDirectory)) {
    throw isolationError('临时目录必须是绝对路径', 'DOUBAO_ISOLATION_INVALID_DIRECTORY');
  }
  const root = fs.mkdtempSync(path.join(temporaryDirectory, DOUBAO_ISOLATION_TEMP_PREFIX));
  // `mkdtemp` normally uses 0700, but make the invariant explicit before a
  // child can ever receive this location.
  fs.chmodSync(root, 0o700);
  return assertPrivateOwnedDoubaoDirectory(root);
}

// Production Doubao debugging attaches to the nested Chromium browser, not
// the native main wrapper (which does not forward --remote-debugging-pipe).
// The argv set is fixed: pipe + isolated profile + saman parent association.
export function doubaoIsolatedLaunchArguments(userDataDirectory, {
  samanFromChatPid = process.pid,
  allowStockProfile = false,
} = {}) {
  const userData = allowStockProfile
    ? (() => {
      if (typeof userDataDirectory !== 'string' || !path.isAbsolute(userDataDirectory)) {
        throw isolationError('豆包 user-data-dir 必须是绝对路径', 'DOUBAO_ISOLATION_INVALID_DIRECTORY');
      }
      return userDataDirectory;
    })()
    : assertPrivateOwnedDoubaoDirectory(userDataDirectory);
  const pid = Number(samanFromChatPid);
  if (!Number.isInteger(pid) || pid <= 1) {
    throw isolationError('saman-from-chat 父进程 PID 无效', 'DOUBAO_ISOLATION_INVALID_PID');
  }
  return Object.freeze([
    '--remote-debugging-pipe',
    `--user-data-dir=${userData}`,
    `--saman-from-chat=${pid}`,
  ]);
}

export function doubaoIsolatedEnvironmentSnapshot(baseEnvironment) {
  const source = baseEnvironment && typeof baseEnvironment === 'object' ? baseEnvironment : {};
  const result = {};
  for (const key of DOUBAO_ISOLATION_FORWARDED_ENVIRONMENT_KEYS) {
    if (typeof source[key] === 'string' && source[key]) result[key] = source[key];
  }
  return Object.freeze(result);
}

export function isolatedDoubaoEnvironment(baseEnvironment, {
  userDataDirectory,
  allowStockProfile = false,
} = {}) {
  // Tie the environment construction to the same directory check as argv.
  if (!allowStockProfile) {
    assertPrivateOwnedDoubaoDirectory(userDataDirectory);
  } else if (typeof userDataDirectory !== 'string' || !path.isAbsolute(userDataDirectory)) {
    throw isolationError('豆包 user-data-dir 必须是绝对路径', 'DOUBAO_ISOLATION_INVALID_DIRECTORY');
  }
  return doubaoIsolatedEnvironmentSnapshot(baseEnvironment);
}

// A process may lose its original command-line argument as it forks.  `lsof
// +D` is therefore required as an independent proof before removing the
// profile.  `lsof` status 1 means no matching handles; every other failure is
// fail-closed.
export function isolatedDoubaoProfileHandlePids(userDataDirectory, {
  execFile = execFileSync,
} = {}) {
  const userData = assertPrivateOwnedDoubaoDirectory(userDataDirectory);
  try {
    const output = execFile('/usr/sbin/lsof', ['-t', '+D', userData], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // `+D` walks the whole tree; a wedged lsof would otherwise block the
      // single-threaded process indefinitely.  A killed probe is unproven,
      // which the catch below already treats as a cleanup failure.
      timeout: 5000,
      killSignal: 'SIGKILL',
    });
    return parsePidOnlyOutput(output, '隔离 profile 文件句柄');
  } catch (error) {
    if (error?.status === 1) return Object.freeze([]);
    throw isolationError(
      `无法核验隔离 profile 文件句柄：${error?.message ?? String(error)}`,
      'DOUBAO_ISOLATION_HANDLE_PROOF_FAILED',
    );
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForNoOpenDoubaoProfileHandles(userDataDirectory, {
  timeoutMs = 5000,
  intervalMs = 100,
  inspectHandles = isolatedDoubaoProfileHandlePids,
  sleepFor = sleep,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 ||
      !Number.isInteger(intervalMs) || intervalMs <= 0 ||
      typeof inspectHandles !== 'function' || typeof sleepFor !== 'function') {
    throw isolationError('隔离 profile 清理参数无效', 'DOUBAO_ISOLATION_HANDLE_PROOF_FAILED');
  }
  const userData = assertPrivateOwnedDoubaoDirectory(userDataDirectory);
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  for (;;) {
    latest = inspectHandles(userData);
    if (!Array.isArray(latest) || latest.some((pid) => !validPid(pid))) {
      throw isolationError('隔离 profile 文件句柄证明无效', 'DOUBAO_ISOLATION_HANDLE_PROOF_FAILED');
    }
    if (!latest.length) return Object.freeze([]);
    if (Date.now() >= deadline) {
      throw isolationError(
        `隔离 profile 仍被进程 ${latest.join(', ')} 持有；拒绝删除`,
        'DOUBAO_ISOLATION_HANDLE_PROOF_FAILED',
      );
    }
    await sleepFor(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
  }
}

function childExited(child) {
  return Boolean(child && (child.exitCode != null || child.signalCode != null));
}

// Delete only after the caller can prove two facts: its direct ChildProcess
// handle has exited (if one was created), and no remaining process holds the
// fresh profile.  If spawn failed before returning a child, an empty lsof
// result is still required before removal.  On doubt, keep the private 0700
// directory rather than deleting a live profile.
export async function removeIsolatedDoubaoProfileAfterProof({
  userDataDirectory,
  child = null,
  transport = null,
  waitForNoHandles = waitForNoOpenDoubaoProfileHandles,
} = {}) {
  const userData = assertPrivateOwnedDoubaoDirectory(userDataDirectory);
  if (child && !childExited(child)) {
    throw isolationError('隔离豆包子进程仍在运行；拒绝删除 profile', 'DOUBAO_ISOLATION_CLEANUP_UNPROVEN');
  }
  if (transport && transport.closed !== true) {
    throw isolationError('CDP Pipe 仍处于打开状态；拒绝删除 profile', 'DOUBAO_ISOLATION_CLEANUP_UNPROVEN');
  }
  if (typeof waitForNoHandles !== 'function') {
    throw isolationError('隔离 profile 文件句柄证明器无效', 'DOUBAO_ISOLATION_CLEANUP_UNPROVEN');
  }
  const base = path.basename(userData);
  if (!base.startsWith(DOUBAO_ISOLATION_TEMP_PREFIX)) {
    throw isolationError('拒绝删除非灵妆创建的隔离 user-data-dir', 'DOUBAO_ISOLATION_CLEANUP_UNPROVEN');
  }
  await waitForNoHandles(userData);
  fs.rmSync(userData, {recursive: true, force: true});
  if (fs.existsSync(userData)) {
    throw isolationError('隔离 user-data-dir 删除失败', 'DOUBAO_ISOLATION_CLEANUP_UNPROVEN');
  }
  return Object.freeze({removed: true, userDataDirectory: userData});
}

export const doubaoIsolationTestInternals = Object.freeze({
  childExited,
  isolationError,
  parsePidOnlyOutput,
  validPid,
});
