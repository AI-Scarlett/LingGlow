#!/usr/bin/env node

/**
 * Fetch and verify the Node.js runtime bundled in an official LingGlow macOS
 * release.  The manifest is intentionally source-controlled and pins archive
 * names and SHA-256 values.  This tool never accepts a URL/version from argv.
 */

import {createHash, randomBytes} from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const root = path.resolve(import.meta.dirname, '..');
const resourceRoot = path.join(root, 'native', 'Resources', 'NodeRuntime');
const manifestPath = path.join(resourceRoot, 'manifest.json');
const runtimeRoot = path.join(resourceRoot, 'runtime');
const allowedModes = new Set(['--install', '--verify']);
const mode = process.argv.slice(2).find((argument) => allowedModes.has(argument)) ?? '--verify';
const unexpected = process.argv.slice(2).filter((argument) => !allowedModes.has(argument));
const sha256 = /^[a-f0-9]{64}$/u;
const safeFile = /^[A-Za-z0-9._-]+$/u;

if (unexpected.length > 0) {
  throw new Error(`unsupported arguments: ${unexpected.join(', ')}`);
}

function fail(message) {
  throw new Error(`bundled Node runtime: ${message}`);
}

function checkManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schemaVersion !== 1 || typeof value.nodeVersion !== 'string' ||
      !/^\d+\.\d+\.\d+$/u.test(value.nodeVersion) ||
      !Number.isInteger(value.minimumMajor) || value.minimumMajor < 22 ||
      typeof value.sourceBaseURL !== 'string') {
    fail('manifest has an invalid top-level shape');
  }
  const source = new URL(value.sourceBaseURL);
  if (source.protocol !== 'https:' || source.hostname !== 'nodejs.org' ||
      source.username || source.password || source.search || source.hash ||
      !source.pathname.endsWith(`/v${value.nodeVersion}/`)) {
    fail('manifest source must be the exact official nodejs.org release directory');
  }
  const expected = new Set(['arm64', 'x86_64']);
  if (!value.architectures || typeof value.architectures !== 'object' ||
      Array.isArray(value.architectures) ||
      Object.keys(value.architectures).length !== expected.size ||
      Object.keys(value.architectures).some((name) => !expected.has(name))) {
    fail('manifest must declare exactly arm64 and x86_64');
  }
  for (const [architecture, entry] of Object.entries(value.architectures)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !safeFile.test(entry.archive ?? '') || !entry.archive.endsWith('.tar.gz') ||
        !sha256.test(entry.sha256 ?? '') ||
        typeof entry.nodePath !== 'string' || typeof entry.licensePath !== 'string' ||
        !entry.nodePath.endsWith('/bin/node') || !entry.licensePath.endsWith('/LICENSE') ||
        entry.nodePath.includes('..') || entry.licensePath.includes('..') ||
        !entry.nodePath.startsWith(`node-v${value.nodeVersion}-darwin-${architecture === 'x86_64' ? 'x64' : architecture}/`) ||
        !entry.licensePath.startsWith(`node-v${value.nodeVersion}-darwin-${architecture === 'x86_64' ? 'x64' : architecture}/`)) {
      fail(`manifest entry is invalid for ${architecture}`);
    }
  }
  return value;
}

async function loadManifest() {
  let raw;
  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    fail(`cannot read manifest: ${error.message}`);
  }
  return checkManifest(raw);
}

async function hashFile(filePath) {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

async function regularFile(filePath, {executable = false, maxBytes = 256 * 1024 * 1024} = {}) {
  const information = await lstat(filePath);
  if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1 ||
      information.size < 1 || information.size > maxBytes ||
      (information.mode & 0o022) !== 0 || (executable && (information.mode & 0o111) === 0)) {
    fail(`unsafe runtime file: ${filePath}`);
  }
  return information;
}

function command(commandPath, commandArguments, label) {
  const result = spawnSync(commandPath, commandArguments, {encoding: 'utf8', maxBuffer: 1024 * 1024});
  if (result.status !== 0) {
    fail(`${label} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout;
}

function expectedNodeVersion(manifest) {
  return `v${manifest.nodeVersion}`;
}

async function architectureOf(nodePath) {
  const output = command('/usr/bin/lipo', ['-archs', nodePath], 'lipo inspection').trim().split(/\s+/u);
  return new Set(output);
}

async function verifyRuntimeAt(manifest, runtimeDirectory) {
  const lock = JSON.parse(await readFile(path.join(runtimeDirectory, 'runtime-lock.json'), 'utf8'));
  if (!lock || lock.schemaVersion !== 1 || lock.nodeVersion !== manifest.nodeVersion ||
      !lock.architectures || typeof lock.architectures !== 'object') {
    fail('runtime lock has an invalid shape');
  }
  for (const architecture of ['arm64', 'x86_64']) {
    const entry = manifest.architectures[architecture];
    const locked = lock.architectures[architecture];
    if (!locked || locked.archiveSha256 !== entry.sha256 || !sha256.test(locked.nodeSha256 ?? '')) {
      fail(`runtime lock does not match the reviewed manifest for ${architecture}`);
    }
    const nodePath = path.join(runtimeDirectory, architecture, 'node');
    await regularFile(nodePath, {executable: true});
    const architectures = await architectureOf(nodePath);
    if (!architectures.has(architecture)) fail(`${architecture} Node binary has the wrong Mach-O architecture`);
    if (await hashFile(nodePath) !== locked.nodeSha256) fail(`${architecture} Node binary hash mismatch`);
  }
  const licensePath = path.join(runtimeDirectory, 'LICENSE');
  await regularFile(licensePath, {maxBytes: 1024 * 1024});
  if (!sha256.test(lock.licenseSha256 ?? '')) fail('runtime lock has no valid Node license hash');
  if (await hashFile(licensePath) !== lock.licenseSha256) fail('Node license hash mismatch');
  const currentArchitecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : null;
  if (currentArchitecture) {
    const nodePath = path.join(runtimeDirectory, currentArchitecture, 'node');
    const version = command(nodePath, ['--version'], 'Node version check').trim();
    if (version !== expectedNodeVersion(manifest)) fail(`Node version mismatch: expected ${expectedNodeVersion(manifest)}, got ${version}`);
  }
  return lock;
}

async function verifyInstalled(manifest) {
  return await verifyRuntimeAt(manifest, runtimeRoot);
}

async function download(url, destination) {
  const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(120_000)});
  if (!response.ok || response.type === 'opaqueredirect' || !response.body) {
    fail(`official download failed for ${url.pathname}: HTTP ${response.status}`);
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (!Number.isFinite(length) || length < 1 || length > 256 * 1024 * 1024) {
    fail(`official download has an invalid content length for ${url.pathname}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, {flags: 'wx', mode: 0o600}));
  const information = await stat(destination);
  if (information.size !== length) fail(`official download length changed for ${url.pathname}`);
}

async function extractReviewedFiles(archive, entry, architecture, destination) {
  await mkdir(destination, {recursive: true, mode: 0o700});
  command('/usr/bin/tar', ['-xzf', archive, '-C', destination, entry.nodePath, entry.licensePath], `extract ${architecture} Node runtime`);
  const stagedNode = path.join(destination, entry.nodePath);
  const stagedLicense = path.join(destination, entry.licensePath);
  await regularFile(stagedNode, {executable: true});
  await regularFile(stagedLicense, {maxBytes: 1024 * 1024});
  return {stagedNode, stagedLicense};
}

async function install(manifest) {
  const downloadRoot = await mkdtemp(path.join(os.tmpdir(), 'lingglow-node-download-'));
  const stagingRoot = await mkdtemp(path.join(resourceRoot, '.runtime-staging-'));
  try {
    const nodeHashes = {};
    let copiedLicense = null;
    for (const architecture of ['arm64', 'x86_64']) {
      const entry = manifest.architectures[architecture];
      const archive = path.join(downloadRoot, entry.archive);
      const url = new URL(entry.archive, manifest.sourceBaseURL);
      await download(url, archive);
      if (await hashFile(archive) !== entry.sha256) fail(`official archive SHA-256 mismatch for ${architecture}`);
      const extracted = await extractReviewedFiles(archive, entry, architecture, stagingRoot);
      const targetDirectory = path.join(stagingRoot, 'runtime', architecture);
      await mkdir(targetDirectory, {recursive: true, mode: 0o755});
      await copyFile(extracted.stagedNode, path.join(targetDirectory, 'node'));
      await chmod(path.join(targetDirectory, 'node'), 0o755);
      nodeHashes[architecture] = await hashFile(path.join(targetDirectory, 'node'));
      if (!copiedLicense) copiedLicense = extracted.stagedLicense;
    }
    const targetRuntime = path.join(stagingRoot, 'runtime');
    await copyFile(copiedLicense, path.join(targetRuntime, 'LICENSE'));
    await chmod(path.join(targetRuntime, 'LICENSE'), 0o644);
    const licenseSha256 = await hashFile(path.join(targetRuntime, 'LICENSE'));
    const runtimeLock = {
      schemaVersion: 1,
      nodeVersion: manifest.nodeVersion,
      sourceBaseURL: manifest.sourceBaseURL,
      architectures: Object.fromEntries(['arm64', 'x86_64'].map((architecture) => [architecture, {
        archiveSha256: manifest.architectures[architecture].sha256,
        nodeSha256: nodeHashes[architecture],
      }])),
      licenseSha256,
    };
    await writeFile(path.join(targetRuntime, 'runtime-lock.json'), `${JSON.stringify(runtimeLock, null, 2)}\n`, {encoding: 'utf8', mode: 0o644});

    // Fully verify the staged tree before touching a previously working
    // runtime. This makes a failed archive or wrong architecture harmless to
    // an existing developer setup.
    await verifyRuntimeAt(manifest, targetRuntime);
    const candidate = path.join(resourceRoot, `.runtime-${process.pid}-${randomBytes(6).toString('hex')}`);
    const backup = `${runtimeRoot}.previous-${process.pid}-${randomBytes(6).toString('hex')}`;
    let candidateCreated = false;
    let backupCreated = false;
    let promoted = false;
    try {
      await rename(targetRuntime, candidate);
      candidateCreated = true;
      try {
        await rename(runtimeRoot, backup);
        backupCreated = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await rename(candidate, runtimeRoot);
      candidateCreated = false;
      promoted = true;
      await verifyInstalled(manifest);
      if (backupCreated) await rm(backup, {recursive: true, force: true});
      process.stdout.write(`Installed and verified official Node ${manifest.nodeVersion} for arm64 and x86_64.\n`);
    } catch (error) {
      const rollbackErrors = [];
      if (promoted) {
        try { await rm(runtimeRoot, {recursive: true, force: true}); } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (backupCreated) {
        try { await rename(backup, runtimeRoot); } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (candidateCreated) {
        try { await rm(candidate, {recursive: true, force: true}); } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) {
        throw new AggregateError([error, ...rollbackErrors], 'bundled Node runtime install failed and rollback was incomplete');
      }
      throw error;
    }
  } finally {
    await rm(downloadRoot, {recursive: true, force: true});
    await rm(stagingRoot, {recursive: true, force: true});
  }
}

const manifest = await loadManifest();
if (mode === '--install') {
  await install(manifest);
} else {
  await verifyInstalled(manifest);
  process.stdout.write(`Verified bundled Node ${manifest.nodeVersion}.\n`);
}
