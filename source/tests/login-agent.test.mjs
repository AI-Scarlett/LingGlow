import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LOGIN_AGENT_LABEL,
  getLoginAgentStatus,
  installLoginAgent,
  removeLoginAgent,
  renderLoginAgentPlist,
} from '../src/login-agent.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-login-agent-'));
  const packageRoot = path.join(root, 'Codex Skin Studio & Test');
  const launchAgents = path.join(root, 'LaunchAgents');
  fs.mkdirSync(packageRoot, {mode: 0o700});
  fs.mkdirSync(launchAgents, {mode: 0o700});
  fs.writeFileSync(path.join(packageRoot, 'start.command'), '#!/bin/bash\nexit 0\n', {mode: 0o755});
  const agentPath = path.join(launchAgents, `${LOGIN_AGENT_LABEL}.plist`);
  return {
    root,
    packageRoot,
    agentPath,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
  };
}

test('installs one canonical private LaunchAgent without invoking launchctl', () => {
  const options = fixture();
  const before = getLoginAgentStatus(options);
  assert.equal(before.installed, false);
  assert.equal(before.managed, false);
  assert.equal(before.state, 'not-installed');

  const installed = installLoginAgent(options);
  assert.equal(installed.installed, true);
  assert.equal(installed.managed, true);
  assert.equal(installed.state, 'managed');
  assert.equal(fs.statSync(options.agentPath).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(options.agentPath, 'utf8'), renderLoginAgentPlist(options.packageRoot));
  assert.equal(fs.readdirSync(path.dirname(options.agentPath)).some((name) => name.endsWith('.tmp')), false);

  const plist = fs.readFileSync(options.agentPath, 'utf8');
  assert.match(plist, /<string>local\.skin-studio\.reminder<\/string>/u);
  assert.match(plist, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  const escapedCliPath = path.join(options.packageRoot, 'src', 'cli.mjs')
    .replaceAll('&', '&amp;')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(plist, new RegExp(`<string>${escapedCliPath}<\\/string>`, 'u'));
  assert.match(plist, /<string>dashboard<\/string>/u);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/u);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/u);
  assert.match(plist, /<key>StandardOutPath<\/key>\s*<string>\/tmp\/lingglow-login-agent\.out\.log<\/string>/u);
  assert.match(plist, /<key>StandardErrorPath<\/key>\s*<string>\/tmp\/lingglow-login-agent\.err\.log<\/string>/u);

  assert.equal(installLoginAgent(options).managed, true, 'install should be idempotent for its exact file');
});

test('removes only the exact managed plist and is idempotent when absent', () => {
  const options = fixture();
  installLoginAgent(options);
  const removed = removeLoginAgent(options);
  assert.equal(removed.installed, false);
  assert.equal(removed.managed, false);
  assert.equal(removed.state, 'not-installed');
  assert.equal(fs.existsSync(options.agentPath), false);
  assert.equal(removeLoginAgent(options).installed, false);
});

test('refuses to overwrite or delete an existing non-tool file', () => {
  const options = fixture();
  fs.writeFileSync(options.agentPath, '<plist>someone else</plist>\n', {mode: 0o600});
  const original = fs.readFileSync(options.agentPath, 'utf8');
  const status = getLoginAgentStatus(options);
  assert.equal(status.installed, true);
  assert.equal(status.managed, false);
  assert.equal(status.state, 'unmanaged');
  assert.throws(() => installLoginAgent(options), /拒绝覆盖/u);
  assert.throws(() => removeLoginAgent(options), /拒绝删除/u);
  assert.equal(fs.readFileSync(options.agentPath, 'utf8'), original);
});

test('refuses symlink start.command and symlink agent targets', () => {
  const badStart = fixture();
  const startPath = path.join(badStart.packageRoot, 'start.command');
  const realStart = path.join(badStart.root, 'real-start.command');
  fs.writeFileSync(realStart, '#!/bin/bash\n', {mode: 0o755});
  fs.unlinkSync(startPath);
  fs.symlinkSync(realStart, startPath);
  assert.throws(() => getLoginAgentStatus(badStart), /普通非符号链接文件/u);
  assert.throws(() => installLoginAgent(badStart), /普通非符号链接文件/u);

  const badTarget = fixture();
  const outside = path.join(badTarget.root, 'outside.plist');
  fs.writeFileSync(outside, 'outside\n', {mode: 0o600});
  fs.symlinkSync(outside, badTarget.agentPath);
  const status = getLoginAgentStatus(badTarget);
  assert.equal(status.installed, true);
  assert.equal(status.managed, false);
  assert.equal(status.state, 'unsafe');
  assert.throws(() => installLoginAgent(badTarget), /拒绝覆盖/u);
  assert.throws(() => removeLoginAgent(badTarget), /拒绝删除/u);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside\n');
});

test('creates a missing final LaunchAgents directory but rejects an unsafe one', () => {
  const missing = fixture();
  fs.rmdirSync(path.dirname(missing.agentPath));
  assert.equal(getLoginAgentStatus(missing).state, 'not-installed');
  assert.equal(installLoginAgent(missing).managed, true);
  assert.equal(fs.statSync(path.dirname(missing.agentPath)).mode & 0o777, 0o700);

  const unsafe = fixture();
  fs.chmodSync(path.dirname(unsafe.agentPath), 0o777);
  const status = getLoginAgentStatus(unsafe);
  assert.equal(status.state, 'unsafe');
  assert.equal(status.reason, 'directory-unsafe');
  assert.throws(() => installLoginAgent(unsafe), /权限不安全/u);
});
