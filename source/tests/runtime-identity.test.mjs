import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RUNTIME_IDENTITY_HEADER,
  loadRuntimeIdentity,
  parseRuntimeIdentityManifest,
} from '../src/runtime-identity.mjs';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeRuntimeIdentity(root, files) {
  const entries = Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relative, contents]) => {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, contents, 'utf8');
      return `${sha256(contents)}  ${relative}`;
    });
  const body = `${entries.join('\n')}\n`;
  const identity = sha256(body);
  fs.writeFileSync(
    path.join(root, 'runtime-identity.txt'),
    `${RUNTIME_IDENTITY_HEADER}\n${identity}\n${body}`,
    {mode: 0o600},
  );
  return identity;
}

test('runtime identity is deterministic and verifies every shipped backend file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingglow-runtime-identity-'));
  const identity = writeRuntimeIdentity(root, {
    'catalog/index.json': '{"schemaVersion":1}\n',
    'src/entry.mjs': 'export const ok = true;\n',
  });

  assert.equal(loadRuntimeIdentity(root, {required: true, verifyFiles: true}), identity);
  const parsed = parseRuntimeIdentityManifest(fs.readFileSync(path.join(root, 'runtime-identity.txt'), 'utf8'));
  assert.equal(parsed.identity, identity);
  assert.deepEqual(parsed.entries.map((entry) => entry.path), ['catalog/index.json', 'src/entry.mjs']);

  fs.writeFileSync(path.join(root, 'src/entry.mjs'), 'export const ok = false;\n');
  assert.throws(
    () => loadRuntimeIdentity(root, {required: true, verifyFiles: true}),
    /摘要不匹配/u,
  );
});

test('runtime identity rejects unsafe paths and malformed canonical bodies', () => {
  const hash = 'a'.repeat(64);
  const unsafeBody = `${hash}  ../outside.mjs\n`;
  const identity = sha256(unsafeBody);
  assert.throws(
    () => parseRuntimeIdentityManifest(`${RUNTIME_IDENTITY_HEADER}\n${identity}\n${unsafeBody}`),
    /文件条目不安全/u,
  );
  assert.throws(
    () => parseRuntimeIdentityManifest(`${RUNTIME_IDENTITY_HEADER}\n${hash}\n${hash}  src/main.mjs`),
    /格式不完整/u,
  );
});
