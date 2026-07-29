import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launchers = [
  path.join(projectRoot, 'start.command'),
  path.join(projectRoot, '恢复Codex原版.command'),
];

test('runtime launchers are valid shell and never use WorkBuddy Electron as Node', () => {
  for (const launcher of launchers) {
    const source = fs.readFileSync(launcher, 'utf8');
    const syntax = spawnSync('/bin/bash', ['-n', launcher], {encoding: 'utf8'});
    assert.equal(syntax.status, 0, `${path.basename(launcher)}: ${syntax.stderr}`);
    assert.doesNotMatch(source, /WorkBuddy\.app|ELECTRON_RUN_AS_NODE|select_trusted_electron_node/u);
    assert.match(source, /Contents\/Resources\/cua_node\/bin\/node/u);
    assert.match(source, /process\.versions\.node/u);
  }
});

test('start launcher prefers signed ChatGPT and Codex embedded Node before local system Node', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'start.command'), 'utf8');
  const chatGPT = source.indexOf('select_trusted_embedded_node "/Applications/ChatGPT.app"');
  const codex = source.indexOf('select_trusted_embedded_node "/Applications/Codex.app"');
  const configured = source.indexOf('select_compatible_node "${CODEX_SKIN_STUDIO_NODE:-}"');
  const pathNode = source.indexOf('select_compatible_node "$(command -v node || true)"');
  const homebrew = source.indexOf('select_compatible_node "/opt/homebrew/bin/node"');
  assert.ok(chatGPT >= 0 && codex > chatGPT);
  assert.ok(configured > codex);
  assert.ok(pathNode > configured);
  assert.ok(homebrew > pathNode);
});

test('README documents candidate validation and the non-launching embedded runtime behavior', () => {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  assert.match(readme, /每个候选都必须实际通过 Node\.js 22\+ 检查/u);
  assert.match(readme, /不会把 WorkBuddy 的 Electron 当成 Node/u);
  assert.match(readme, /不等于启动对应应用/u);
});
