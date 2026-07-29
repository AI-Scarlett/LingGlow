import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RUNTIME_IDENTITY_FILE = 'runtime-identity.txt';
export const RUNTIME_IDENTITY_HEADER = 'lingglow-runtime-identity-v1';

const IDENTITY = /^[a-f0-9]{64}$/u;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_MANIFEST_ENTRIES = 2_048;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4_096 ||
      value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) {
    return false;
  }
  const segments = value.split('/');
  return segments.length > 0 && segments.every((segment) =>
    segment.length > 0 && segment !== '.' && segment !== '..'
  );
}

function manifestError(message) {
  const error = new Error(`运行时身份清单无效：${message}`);
  error.code = 'RUNTIME_IDENTITY_INVALID';
  return error;
}

/**
 * Parse the small, deterministic identity manifest built into a release app.
 * The identity covers every shipped local-backend file except this manifest
 * itself. It is intentionally a text format so Swift can independently verify
 * the exact same canonical byte sequence before it launches Node.
 */
export function parseRuntimeIdentityManifest(text) {
  if (typeof text !== 'string' || !text.endsWith('\n')) {
    throw manifestError('格式不完整');
  }
  const lines = text.split('\n');
  // `split` leaves one empty item for the required trailing newline.
  if (lines.pop() !== '') throw manifestError('缺少结尾换行');
  if (lines.length < 3 || lines[0] !== RUNTIME_IDENTITY_HEADER || !IDENTITY.test(lines[1])) {
    throw manifestError('头信息或哈希格式错误');
  }

  const entries = [];
  const seenPaths = new Set();
  for (const line of lines.slice(2)) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match || !safeRelativePath(match[2]) || seenPaths.has(match[2])) {
      throw manifestError('文件条目不安全');
    }
    seenPaths.add(match[2]);
    entries.push({sha256: match[1], path: match[2]});
  }
  if (!entries.length || entries.length > MAX_MANIFEST_ENTRIES) {
    throw manifestError('文件条目数量异常');
  }

  const canonicalBody = `${entries.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n')}\n`;
  const identity = sha256(canonicalBody);
  if (identity !== lines[1]) throw manifestError('摘要不匹配');
  return {identity, entries, canonicalBody};
}

function regularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1) {
    throw manifestError(`${label} 不是安全的普通文件`);
  }
  return stat;
}

/**
 * Resolve and verify a packaged runtime identity. Source-tree invocations have
 * no manifest by design, so callers may opt out of the requirement for local
 * developer commands while release bundles fail closed.
 */
export function loadRuntimeIdentity(packageRoot, {
  required = false,
  verifyFiles = false,
} = {}) {
  const root = path.resolve(packageRoot);
  const manifestPath = path.join(root, RUNTIME_IDENTITY_FILE);
  if (!fs.existsSync(manifestPath)) {
    if (required) throw manifestError('发行包缺少 runtime-identity.txt');
    return null;
  }
  const stat = regularFile(manifestPath, RUNTIME_IDENTITY_FILE);
  if (stat.size > MAX_MANIFEST_BYTES) throw manifestError('清单文件过大');
  const manifest = parseRuntimeIdentityManifest(fs.readFileSync(manifestPath, 'utf8'));

  if (verifyFiles) {
    for (const entry of manifest.entries) {
      const filePath = path.resolve(root, entry.path);
      if (!filePath.startsWith(`${root}${path.sep}`)) throw manifestError('文件路径越界');
      regularFile(filePath, entry.path);
      if (sha256(fs.readFileSync(filePath)) !== entry.sha256) {
        throw manifestError(`${entry.path} 摘要不匹配`);
      }
    }
  }
  return manifest.identity;
}

export function validRuntimeIdentity(value) {
  return value === null || value === undefined || (typeof value === 'string' && IDENTITY.test(value));
}
