import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {loadRuntimeIdentity, parseRuntimeIdentityManifest} from '../src/runtime-identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build_native.sh');
const RELEASE_PACKAGE_SCRIPT = path.join(ROOT, 'scripts', 'package_macos_release.sh');
const NATIVE_REGISTRY_GENERATOR = path.join(ROOT, 'scripts', 'generate_native_client_registry.mjs');
const GENERATED_NATIVE_REGISTRY = path.join(ROOT, 'native', 'Sources', 'GeneratedClientRegistry.swift');
const NODE_RUNTIME_MANIFEST = path.join(ROOT, 'native', 'Resources', 'NodeRuntime', 'manifest.json');
const NODE_RUNTIME_FETCHER = path.join(ROOT, 'scripts', 'fetch_node_runtime.mjs');
const START_COMMAND = path.join(ROOT, 'start.command');
const BACKEND_SWIFT = path.join(ROOT, 'native', 'Sources', 'Backend.swift');
const APP = path.join(ROOT, '灵妆.app');
const PACKAGED_BACKEND = path.join(APP, 'Contents', 'Resources', 'LingGlowBackend');
const PACKAGED_NODE_RUNTIME = path.join(APP, 'Contents', 'Resources', 'LingGlowNodeRuntime');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function regularFiles(root, prefix = '') {
  return fs.readdirSync(root, {withFileTypes: true}).flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return regularFiles(target, relative);
    return entry.isFile() ? [relative] : [];
  });
}

test('native build embeds the complete local runtime before signing', () => {
  const build = fs.readFileSync(BUILD_SCRIPT, 'utf8');
  assert.match(build, /runtime_dir in src adapters catalog public/);
  assert.match(build, /QA_SOURCE_DIR="\$PROJECT_ROOT\/qa"/);
  assert.match(build, /-name '\*\.json'/);
  assert.match(build, /qa_relative=/);
  assert.match(build, /qa_segments/);
  assert.match(build, /dirname "\$qa_destination"/);
  assert.doesNotMatch(build, /QA_SOURCE_DIR" -maxdepth 1 -type f -name '\*\.json'/);
  assert.match(build, /never copy visual QA screenshots/);
  assert.match(build, /catalog\/source-art/);
  assert.match(build, /catalog\/theme-packs\/fixtures/);
  assert.match(build, /LingGlowBackend/);
  assert.match(build, /THIRD_PARTY_NOTICES_SOURCE="\$PROJECT_ROOT\/THIRD_PARTY_NOTICES\.md"/);
  assert.match(build, /! -f "\$THIRD_PARTY_NOTICES_SOURCE" \|\| -L "\$THIRD_PARTY_NOTICES_SOURCE"/);
  assert.match(build, /install -m 0444 "\$THIRD_PARTY_NOTICES_SOURCE"/);
  assert.match(build, /"\$BACKEND_RESOURCES_DIR\/THIRD_PARTY_NOTICES\.md"/);
  assert.match(build, /chmod 0444 "\$BACKEND_RESOURCES_DIR\/THIRD_PARTY_NOTICES\.md"/);
  const noticeInstallAt = build.indexOf('/usr/bin/install -m 0444 "$THIRD_PARTY_NOTICES_SOURCE"');
  const runtimeIdentityAt = build.indexOf('\nbuild_runtime_identity\n');
  const normalizedFileModesAt = build.indexOf('/usr/bin/find "$BACKEND_RESOURCES_DIR" -type f -exec /bin/chmod 0644 {} +');
  const finalReadOnlyAt = build.lastIndexOf('/bin/chmod 0444 "$BACKEND_RESOURCES_DIR/THIRD_PARTY_NOTICES.md"');
  assert.ok(noticeInstallAt >= 0 && noticeInstallAt < runtimeIdentityAt,
    '第三方声明必须在生成运行时身份清单前复制');
  assert.ok(finalReadOnlyAt > normalizedFileModesAt,
    '第三方声明必须在统一权限处理后恢复只读模式');
  assert.match(build, /RUNTIME_IDENTITY_FILE="runtime-identity\.txt"/);
  assert.match(build, /build_runtime_identity/);
  assert.match(build, /find "\$BACKEND_RESOURCES_DIR" -type l/);
  assert.match(build, /release\/commerce-public\.json/);
  assert.match(build, /RELEASE_COMMERCE_MAX_BYTES=65536/);
  assert.match(build, /-L "\$RELEASE_COMMERCE_CONFIG"/);
  assert.match(build, /codesign --verify --deep --strict "\$STAGED_APP"/);
  assert.match(build, /generate_native_client_registry\.mjs/);
  assert.equal(fs.existsSync(NATIVE_REGISTRY_GENERATOR), true);
  assert.equal(fs.existsSync(GENERATED_NATIVE_REGISTRY), true);
  assert.match(build, /REQUIRE_BUNDLED_NODE_RUNTIME/);
  assert.match(build, /copy_bundled_node_runtime/);
  assert.match(build, /fetch_node_runtime\.mjs --install/);
  assert.match(build, /NODE_VERSION="\$\(\$NODE_BIN --version/u);
  assert.match(build, /Node\.js 22 或更高版本/u);
});

test('notarized C-end release defaults to a single Universal 2 package', () => {
  const release = fs.readFileSync(RELEASE_PACKAGE_SCRIPT, 'utf8');
  assert.match(release, /CODESIGN_IDENTITY 必须是 Developer ID Application 证书/u);
  assert.match(release, /正式发行必须设置 NOTARYTOOL_PROFILE/u);
  assert.match(release, /export ARCHS="\$\{ARCHS:-arm64 x86_64\}"/u);
  assert.match(release, /notarytool submit/u);
  assert.match(release, /--no-s3-acceleration/u);
  assert.match(release, /stapler staple/u);
  assert.match(release, /spctl --assess --type execute/u);
  assert.match(release, /export REQUIRE_BUNDLED_NODE_RUNTIME=1/u);
  assert.match(release, /LINGGLOW_DEVELOPER_TEAM_ID/u);
  assert.match(release, /签名 Team ID 与 LINGGLOW_DEVELOPER_TEAM_ID 不匹配/u);
});

test('notarized distribution requires a pinned official Node runtime instead of a host installation', () => {
  const manifest = JSON.parse(fs.readFileSync(NODE_RUNTIME_MANIFEST, 'utf8'));
  const fetcher = fs.readFileSync(NODE_RUNTIME_FETCHER, 'utf8');
  const start = fs.readFileSync(START_COMMAND, 'utf8');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.nodeVersion, '24.18.0');
  assert.equal(manifest.minimumMajor, 22);
  assert.equal(manifest.sourceBaseURL, 'https://nodejs.org/dist/v24.18.0/');
  assert.deepEqual(Object.keys(manifest.architectures).sort(), ['arm64', 'x86_64']);
  for (const entry of Object.values(manifest.architectures)) {
    assert.match(entry.archive, /^node-v24\.18\.0-darwin-(?:arm64|x64)\.tar\.gz$/u);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  }
  assert.match(fetcher, /redirect: 'error'/u);
  assert.match(fetcher, /official archive SHA-256 mismatch/u);
  assert.match(fetcher, /runtime lock does not match the reviewed manifest/u);
  assert.match(fetcher, /lipo inspection/u);
  assert.match(fetcher, /verifyRuntimeAt\(manifest, targetRuntime\)/u);
  assert.match(fetcher, /rollback was incomplete/u);
  assert.match(start, /select_lingglow_bundled_node/u);
  assert.match(start, /LingGlowNodeRuntime/u);
  assert.ok(start.indexOf('select_lingglow_bundled_node') < start.indexOf('select_trusted_embedded_node "\/Applications\/ChatGPT.app"'),
    'a signed bundled Node runtime must win over a target Agent runtime');
});

test('native bootstrapper resolves only the signed in-bundle backend', () => {
  const source = fs.readFileSync(BACKEND_SWIFT, 'utf8');
  assert.match(source, /Bundle\.main\.resourceURL/);
  assert.match(source, /LingGlowBackend/);
  assert.match(source, /validateBundleSignature\(bundle\)/);
  assert.match(source, /PackagedRuntimeIdentity/);
  assert.match(source, /LINGGLOW_RUNTIME_IDENTITY/);
  assert.match(source, /foreignRuntimeConflict/);
  assert.match(source, /recoverForeignRuntime/);
  assert.match(source, /suspendReminderLoginAgentForTakeover/);
  assert.match(source, /"bootout"/);
  assert.match(source, /gui\/\\\(geteuid\(\)\)\/local\.skin-studio\.reminder/u);
  assert.match(source, /for _ in 0\.\.<150[\s\S]*foreignRuntimeConflict[\s\S]*recoverForeignRuntime/u);
  assert.doesNotMatch(source, /return bundle\.deletingLastPathComponent\(\)/);
  assert.match(source, /LoopbackRedirectBlocker/);
  assert.match(source, /connectionProxyDictionary = \[:\]/);
  assert.match(source, /本地服务响应离开了受锁定的回环地址/u);
  assert.match(source, /"PATH": "\/usr\/bin:\/bin:\/usr\/sbin:\/sbin"/u);
  assert.doesNotMatch(source, /var environment = ProcessInfo\.processInfo\.environment/u);
  assert.match(source, /LingGlowDeveloperTeamID/);
  assert.match(source, /releasePublisherPinned/u);
  assert.match(source, /\(forceStrict \|\| releasePublisherPinned\) \? "0" : "1"/u);
  assert.match(source, /codesignTeamIdentifier/);
});

test('built app contains a signed, non-symlink packaged runtime', {
  skip: !fs.existsSync(PACKAGED_BACKEND) ? '先运行 scripts/build_native.sh' : false,
}, () => {
  for (const relative of [
    'start.command',
    'runtime-identity.txt',
    'package.json',
    'src/cli.mjs',
    'src/runtime-identity.mjs',
    'adapters/macos-26.707.72221.json',
    'adapters/codex-macos-26.707.91948-build-5440-static-candidate.json',
    'catalog/index.json',
    'public/index.html',
    'qa/codex-static-26.707.91948.json',
    'qa/doubao-static-2.19.9.json',
  ]) {
    const target = path.join(PACKAGED_BACKEND, relative);
    const stat = fs.lstatSync(target);
    assert.equal(stat.isSymbolicLink(), false, `${relative} 不得为符号链接`);
  }
  const entries = fs.readdirSync(PACKAGED_BACKEND, {recursive: true});
  for (const relative of entries) {
    const stat = fs.lstatSync(path.join(PACKAGED_BACKEND, relative));
    assert.equal(stat.isSymbolicLink(), false, `${relative} 不得为符号链接`);
    assert.equal(stat.mode & 0o022, 0, `${relative} 不得允许组或其他用户写入`);
  }

  assert.equal(
    fs.existsSync(path.join(PACKAGED_BACKEND, 'release', 'commerce-public.json.example')),
    false,
    '发行包不得包含示例商业配置',
  );

  const runtimeIdentity = loadRuntimeIdentity(PACKAGED_BACKEND, {
    required: true,
    verifyFiles: true,
  });
  assert.match(runtimeIdentity, /^[a-f0-9]{64}$/u);
  const manifest = parseRuntimeIdentityManifest(
    fs.readFileSync(path.join(PACKAGED_BACKEND, 'runtime-identity.txt'), 'utf8'),
  );
  const listed = new Set(manifest.entries.map((entry) => entry.path));
  const packagedFiles = new Set(
    regularFiles(PACKAGED_BACKEND).filter((relative) => relative !== 'runtime-identity.txt'),
  );
  assert.deepEqual(listed, packagedFiles, '运行时身份必须覆盖包内全部后端文件');
  assert.equal(
    fs.existsSync(path.join(PACKAGED_BACKEND, 'qa', 'workbuddy-dream-portal.jpeg')),
    false,
    '发行包不得包含视觉 QA 截图',
  );
  assert.equal(
    fs.existsSync(path.join(PACKAGED_BACKEND, 'catalog', 'source-art')),
    false,
    '发行包不得包含 Theme Pack 制作源图',
  );
  assert.equal(
    fs.existsSync(path.join(PACKAGED_BACKEND, 'catalog', 'theme-packs', 'fixtures')),
    false,
    '发行包不得包含 Theme Pack 测试 fixture',
  );

  const adapterDirectory = path.join(PACKAGED_BACKEND, 'adapters');
  for (const name of fs.readdirSync(adapterDirectory).filter((entry) => entry.endsWith('.json'))) {
    const adapter = JSON.parse(fs.readFileSync(path.join(adapterDirectory, name), 'utf8'));
    for (const [evidencePath, digest] of [
      [adapter.validation?.staticBaseline, adapter.validation?.staticBaselineSha256],
      [adapter.validation?.runtimeEvidence, adapter.validation?.runtimeEvidenceSha256],
    ]) {
      if (!evidencePath) continue;
      const packagedEvidence = path.resolve(PACKAGED_BACKEND, evidencePath);
      assert.equal(
        packagedEvidence.startsWith(`${PACKAGED_BACKEND}${path.sep}`),
        true,
        `${name} 的证据路径必须留在运行时包内`,
      );
      assert.equal(fs.lstatSync(packagedEvidence).isFile(), true, `${evidencePath} 必须随包分发`);
      assert.equal(sha256File(packagedEvidence), digest, `${evidencePath} 摘要必须匹配 adapter`);
    }
  }

  const result = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', APP]);
  assert.equal(result.status, 0, result.stderr?.toString() || '应用签名校验失败');
});

test('built app uses the pinned self-contained Node runtime when present', {
  skip: !fs.existsSync(PACKAGED_NODE_RUNTIME) ? '先安装并构建内置 Node runtime' : false,
}, () => {
  const runtimeLock = JSON.parse(fs.readFileSync(
    path.join(PACKAGED_NODE_RUNTIME, 'runtime-lock.json'),
    'utf8',
  ));
  assert.equal(runtimeLock.nodeVersion, '24.18.0');
  for (const [architecture, expected] of [['arm64', 'arm64'], ['x86_64', 'x86_64']]) {
    const node = path.join(PACKAGED_NODE_RUNTIME, architecture, 'node');
    const stat = fs.lstatSync(node);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o022, 0);
    const lipo = spawnSync('/usr/bin/lipo', ['-archs', node], {encoding: 'utf8'});
    assert.equal(lipo.status, 0, lipo.stderr || `无法检查 ${architecture} Node`);
    assert.equal(lipo.stdout.trim().split(/\s+/u).includes(expected), true);
    assert.equal(sha256File(node), runtimeLock.architectures[architecture].nodeSha256);
  }
  const hostArchitecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : null;
  if (hostArchitecture) {
    const runtimeNode = path.join(PACKAGED_NODE_RUNTIME, hostArchitecture, 'node');
    const version = spawnSync(runtimeNode, ['--version'], {encoding: 'utf8'});
    assert.equal(version.status, 0, version.stderr || '内置 Node 无法启动');
    assert.equal(version.stdout.trim(), 'v24.18.0');
  }
});
