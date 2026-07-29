import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const LOGIN_AGENT_LABEL = 'local.skin-studio.reminder';

const modulePackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultAgentPath = path.join(
  os.homedir(),
  'Library',
  'LaunchAgents',
  `${LOGIN_AGENT_LABEL}.plist`,
);
const MAX_PLIST_BYTES = 16 * 1024;

function isRegularExecutable(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function discoverBundledNode(packageRoot) {
  const arch = os.arch();
  const candidateRoots = [
    packageRoot,
    path.join(packageRoot, '..'),
  ];
  const candidates = candidateRoots.flatMap((candidateRoot) => [
    path.join(candidateRoot, '灵妆.app', 'Contents', 'Resources', 'LingGlowNodeRuntime', arch, 'node'),
    path.join(candidateRoot, 'LingGlowNodeRuntime', arch, 'node'),
  ]);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (isRegularExecutable(resolved)) return resolved;
  }

  return null;
}

function cliEntryForPackageRoot(packageRoot) {
  return path.resolve(path.join(packageRoot, 'src', 'cli.mjs'));
}

function effectiveUid(injectedUid) {
  const uid = injectedUid ?? (typeof process.getuid === 'function' ? process.getuid() : null);
  if (uid !== null && (!Number.isSafeInteger(uid) || uid < 0)) {
    throw new TypeError('uid 必须是非负整数');
  }
  return uid;
}

function resolvedOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('登录启动选项必须是对象');
  }
  return {
    agentPath: path.resolve(options.agentPath ?? defaultAgentPath),
    packageRoot: path.resolve(options.packageRoot ?? modulePackageRoot),
    uid: effectiveUid(options.uid),
  };
}

function ownerMatches(stat, uid) {
  return uid === null || stat.uid === uid;
}

function packageOwnerMatches(stat, uid) {
  // A per-user copy is owned by the current user. An app installed through an
  // administrator may be root-owned; it is still safe only while immutable to
  // group/other users. LaunchAgents themselves remain strictly user-owned.
  return ownerMatches(stat, uid) || stat.uid === 0;
}

function secureDirectoryStat(directory, uid, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label}必须是非符号链接目录：${directory}`);
  }
  if (!ownerMatches(stat, uid)) throw new Error(`${label}不属于当前用户：${directory}`);
  if ((stat.mode & 0o700) !== 0o700 || (stat.mode & 0o022) !== 0) {
    throw new Error(`${label}权限不安全：${directory}`);
  }
  return stat;
}

function validatePackageRoot(packageRoot, uid) {
  let rootStat;
  try {
    rootStat = fs.lstatSync(packageRoot);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`应用目录不存在：${packageRoot}`);
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`应用目录必须是非符号链接目录：${packageRoot}`);
  }
  if (!packageOwnerMatches(rootStat, uid)) {
    throw new Error(`应用目录不属于当前用户或系统管理员：${packageRoot}`);
  }
  if ((rootStat.mode & 0o700) !== 0o700 || (rootStat.mode & 0o022) !== 0) {
    throw new Error(`应用目录权限不安全：${packageRoot}`);
  }
  if (rootStat.nlink < 1) throw new Error(`应用目录链接状态异常：${packageRoot}`);

  const startPath = path.join(packageRoot, 'start.command');
  let stat;
  try {
    stat = fs.lstatSync(startPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`缺少启动脚本：${startPath}`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`启动脚本必须是普通非符号链接文件：${startPath}`);
  }
  if (!packageOwnerMatches(stat, uid)) {
    throw new Error(`启动脚本不属于当前用户或系统管理员：${startPath}`);
  }
  if ((stat.mode & 0o400) === 0 || (stat.mode & 0o022) !== 0) {
    throw new Error(`启动脚本权限不安全：${startPath}`);
  }
  return startPath;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function renderLoginAgentPlist(packageRoot = modulePackageRoot, nodeCommand = null) {
  const root = path.resolve(packageRoot);
  const command = nodeCommand ?? (discoverBundledNode(root) || process.execPath);
  const cliEntry = cliEntryForPackageRoot(root);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LOGIN_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(command)}</string>
    <string>${xmlEscape(cliEntry)}</string>
    <string>dashboard</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/lingglow-login-agent.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/lingglow-login-agent.err.log</string>
</dict>
</plist>
`;
}

function xmlUnescape(value) {
  return String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

// The Node interpreter is resolved at render time and legitimately moves when
// the bundled runtime appears or the user's Node installation is upgraded.  A
// file that is byte-identical to the current template except for that one
// absolute path is still ours, so it stays removable and replaceable instead
// of becoming a conflict the user can no longer clear from the UI.
function managedCommandDrift(contents, packageRoot) {
  const encoded = contents.match(
    /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/u,
  )?.[1];
  if (encoded === undefined) return false;
  const command = xmlUnescape(encoded);
  return path.isAbsolute(command) && contents === renderLoginAgentPlist(packageRoot, command);
}

function lstatOptional(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function inspectAgentFile(agentPath, expected, uid, packageRoot) {
  const firstStat = lstatOptional(agentPath);
  if (!firstStat) return {installed: false, managed: false, state: 'not-installed', reason: null};
  if (!firstStat.isFile() || firstStat.isSymbolicLink()) {
    return {installed: true, managed: false, state: 'unsafe', reason: 'agent-not-regular-file'};
  }
  if (!ownerMatches(firstStat, uid)) {
    return {installed: true, managed: false, state: 'unsafe', reason: 'agent-owner-mismatch'};
  }
  if (firstStat.nlink !== 1 || (firstStat.mode & 0o777) !== 0o600 ||
      firstStat.size <= 0 || firstStat.size > MAX_PLIST_BYTES) {
    return {installed: true, managed: false, state: 'unsafe', reason: 'agent-permissions-or-size'};
  }

  let descriptor;
  try {
    descriptor = fs.openSync(agentPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile() || openedStat.dev !== firstStat.dev || openedStat.ino !== firstStat.ino ||
        openedStat.nlink !== 1 || !ownerMatches(openedStat, uid) ||
        (openedStat.mode & 0o777) !== 0o600 || openedStat.size !== firstStat.size) {
      return {installed: true, managed: false, state: 'unsafe', reason: 'agent-changed-during-check'};
    }
    const contents = fs.readFileSync(descriptor, 'utf8');
    const drifted = contents !== expected;
    if (drifted && !managedCommandDrift(contents, packageRoot)) {
      return {installed: true, managed: false, state: 'unmanaged', reason: 'content-mismatch'};
    }
    return {
      installed: true,
      managed: true,
      state: 'managed',
      reason: drifted ? 'command-drift' : null,
      dev: openedStat.dev,
      ino: openedStat.ino,
    };
  } catch (error) {
    return {
      installed: true,
      managed: false,
      state: 'unsafe',
      reason: error.code === 'ELOOP' ? 'agent-symlink' : 'agent-read-failed',
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function inspectAgentDirectory(agentPath, uid) {
  const directory = path.dirname(agentPath);
  const stat = lstatOptional(directory);
  if (!stat) return {exists: false, safe: false, directory, reason: 'directory-missing'};
  try {
    secureDirectoryStat(directory, uid, 'LaunchAgents 目录');
    return {exists: true, safe: true, directory, reason: null};
  } catch {
    return {exists: true, safe: false, directory, reason: 'directory-unsafe'};
  }
}

function publicStatus(context, directoryStatus, fileStatus) {
  return Object.freeze({
    label: LOGIN_AGENT_LABEL,
    agentPath: context.agentPath,
    packageRoot: context.packageRoot,
    installed: fileStatus.installed,
    managed: directoryStatus.safe && fileStatus.managed,
    state: directoryStatus.safe ? fileStatus.state : 'unsafe',
    reason: directoryStatus.safe ? fileStatus.reason : directoryStatus.reason,
  });
}

export function getLoginAgentStatus(options = {}) {
  const context = resolvedOptions(options);
  validatePackageRoot(context.packageRoot, context.uid);
  const expected = renderLoginAgentPlist(context.packageRoot);
  const directoryStatus = inspectAgentDirectory(context.agentPath, context.uid);
  if (!directoryStatus.safe) {
    const targetStat = lstatOptional(context.agentPath);
    if (!directoryStatus.exists && targetStat === null) {
      return Object.freeze({
        label: LOGIN_AGENT_LABEL,
        agentPath: context.agentPath,
        packageRoot: context.packageRoot,
        installed: false,
        managed: false,
        state: 'not-installed',
        reason: 'directory-missing',
      });
    }
    return publicStatus(context, directoryStatus, {
      installed: targetStat !== null,
      managed: false,
      state: 'unsafe',
      reason: directoryStatus.reason,
    });
  }
  return publicStatus(
    context,
    directoryStatus,
    inspectAgentFile(context.agentPath, expected, context.uid, context.packageRoot),
  );
}

function ensureAgentDirectory(agentPath, uid) {
  const directory = path.dirname(agentPath);
  if (lstatOptional(directory)) {
    secureDirectoryStat(directory, uid, 'LaunchAgents 目录');
    return directory;
  }
  const parent = path.dirname(directory);
  secureDirectoryStat(parent, uid, 'LaunchAgents 父目录');
  try {
    fs.mkdirSync(directory, {mode: 0o700});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  secureDirectoryStat(directory, uid, 'LaunchAgents 目录');
  return directory;
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    // The file operation remains atomic on filesystems that reject directory fsync.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeExclusiveAtomic(agentPath, contents) {
  if (Buffer.byteLength(contents) > MAX_PLIST_BYTES) throw new Error('LaunchAgent plist 过大');
  const directory = path.dirname(agentPath);
  const temporary = path.join(
    directory,
    `.${path.basename(agentPath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor;
  let temporaryExists = false;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    temporaryExists = true;
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    // Hard-link publication is atomic and, unlike rename, cannot overwrite a
    // file that appears between the safety check and publication.
    fs.linkSync(temporary, agentPath);
    fs.unlinkSync(temporary);
    temporaryExists = false;
    fsyncDirectory(directory);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (temporaryExists) {
      try { fs.unlinkSync(temporary); } catch {}
    }
    if (error.code === 'EEXIST') throw new Error('登录启动文件已存在，拒绝覆盖');
    throw error;
  }
}

export function installLoginAgent(options = {}) {
  const context = resolvedOptions(options);
  validatePackageRoot(context.packageRoot, context.uid);
  ensureAgentDirectory(context.agentPath, context.uid);

  const before = getLoginAgentStatus(context);
  if (before.installed) {
    if (!before.managed) throw new Error('已有非本工具管理的登录启动文件，拒绝覆盖');
    if (before.reason !== 'command-drift') return before;
    // Our own file, but it names an interpreter that has since moved. Replace
    // it instead of leaving launchd retrying a path that may no longer exist.
    removeLoginAgent(context);
  }

  writeExclusiveAtomic(context.agentPath, renderLoginAgentPlist(context.packageRoot));
  const after = getLoginAgentStatus(context);
  if (!after.managed) throw new Error('登录启动文件写入后校验失败');
  return after;
}

export function removeLoginAgent(options = {}) {
  const context = resolvedOptions(options);
  validatePackageRoot(context.packageRoot, context.uid);
  const before = getLoginAgentStatus(context);
  if (!before.installed) return before;
  if (!before.managed) throw new Error('登录启动文件不属于本工具，拒绝删除');

  const expected = renderLoginAgentPlist(context.packageRoot);
  const rechecked = inspectAgentFile(context.agentPath, expected, context.uid, context.packageRoot);
  const finalStat = lstatOptional(context.agentPath);
  if (!rechecked.managed || !finalStat || finalStat.isSymbolicLink() ||
      rechecked.dev !== finalStat.dev || rechecked.ino !== finalStat.ino) {
    throw new Error('登录启动文件在删除前发生变化，拒绝删除');
  }
  fs.unlinkSync(context.agentPath);
  fsyncDirectory(path.dirname(context.agentPath));
  return getLoginAgentStatus(context);
}
