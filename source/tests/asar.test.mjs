import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {AsarReader} from '../src/asar.mjs';

test('unpacked ASAR entries stay inside a real non-symlink root', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skin-asar-'));
  const archive = path.join(workspace, 'app.asar');
  const unpackedRoot = `${archive}.unpacked`;
  fs.mkdirSync(path.join(unpackedRoot, 'assets'), {recursive: true});
  fs.writeFileSync(path.join(unpackedRoot, 'assets', 'safe.bin'), Buffer.from('safe'));

  const reader = new AsarReader(archive);
  reader.fd = -1;
  reader.files = new Map([['assets/safe.bin', {size: 4, unpacked: true}]]);
  assert.equal(reader.readFile('assets/safe.bin').toString(), 'safe');

  const outside = path.join(workspace, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.bin'), Buffer.from('secret'));
  fs.symlinkSync(outside, path.join(unpackedRoot, 'linked'));
  reader.files.set('linked/secret.bin', {size: 6, unpacked: true});
  assert.throws(() => reader.readFile('linked/secret.bin'), /symlink|unsafe/u);
});
