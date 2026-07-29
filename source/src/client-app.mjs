import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile, execFileSync, spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {withAsar} from './asar.mjs';
import {TARGET_CLIENT_IDS} from './client-registry.mjs';
import {
  CODEX_TARGET_ALLOWLIST,
  DOUBAO_TARGET_ALLOWLIST,
  candidateLaunchStrategies,
  unverifiedTransportStatus,
} from './transport-strategy.mjs';

const execFileAsync = promisify(execFile);
// Cache resolved client apps so repeated compatibility checks avoid re-running
// codesign/seal verification.  The key embeds file identities (hash/mtime/size),
// so an app update naturally produces a cache miss.  Without a cap, though,
// every version bump leaves an orphan entry and the map grows unbounded over
// long-running sessions.  Evict the oldest entries when the cap is hit.
const CLIENT_APP_CACHE_MAX = 32;
const cache = new Map();
const CHROMIUM_SCAN_CHUNK_BYTES = 1024 * 1024;
const CHROMIUM_SCAN_LIMIT_BYTES = 256 * 1024 * 1024;
const DOUBAO_BINARY_MARKER_SCAN_LIMIT_BYTES = 256 * 1024 * 1024;
// A deep seal verification of Doubao's ~1GB bundle takes a few seconds on a
// warm cache.  The bound only exists so a wedged helper cannot block discovery
// forever; a killed verification stays fail-closed (invalid signature).
const CODESIGN_TIMEOUT_MS = 60000;
const PROCESS_SNAPSHOT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const DOUBAO_DEBUG_MARKERS = Object.freeze([
  'remote-debugging-pipe',
  'remote-debugging-port',
  'DevToolsActivePort',
  'saman-from-chat',
]);
const WORKBUDDY_RUNTIME_MUTABLE_RESOURCES = Object.freeze([
  'Contents/Resources/app.asar.unpacked/node_modules/@tencent/tencent-docs-ai-engine/bin/darwin-arm64/editor_sdk.log',
  'Contents/Resources/app.asar.unpacked/node_modules/@tencent/tencent-docs-ai-engine/bin/darwin-x64/editor_sdk.log',
]);
const WORKBUDDY_RUNTIME_MUTABLE_RESOURCE_MAX_BYTES = 64 * 1024;
const ALLOW_UNVERIFIED_CLIENTS = process.env.LINGGLOW_ALLOW_UNVERIFIED_CLIENTS === '1';
export const UNVERIFIED_CLIENTS_ENV = 'LINGGLOW_ALLOW_UNVERIFIED_CLIENTS';

function isSignatureBypassSafe(policy, app) {
  return ALLOW_UNVERIFIED_CLIENTS && app?.executable && fs.existsSync(app.executable) &&
    app.bundleId === policy.bundleId && app.teamId === policy.teamId;
}

export const CLIENT_TRUST_POLICIES = Object.freeze({
  codex: Object.freeze({
    clientId: 'codex',
    displayName: 'Codex',
    bundleId: 'com.openai.codex',
    teamId: '2DC432GLL2',
    appNames: Object.freeze(['ChatGPT.app', 'Codex.app']),
    explicitEnvironmentVariable: 'CODEX_SKIN_STUDIO_APP',
    rendererEntryPath: 'webview/index.html',
    defaultTargetUrl: 'app://-/index.html',
    targetAllowlist: CODEX_TARGET_ALLOWLIST,
    defaultProbeKind: 'codex-v1',
  }),
  workbuddy: Object.freeze({
    clientId: 'workbuddy',
    displayName: 'WorkBuddy',
    bundleId: 'com.workbuddy.workbuddy',
    teamId: 'FN2V63AD2J',
    appNames: Object.freeze(['WorkBuddy.app']),
    explicitEnvironmentVariable: 'CODEX_SKIN_STUDIO_WORKBUDDY_APP',
    rendererEntryPath: 'renderer/index.html',
    defaultTargetUrl: null,
    defaultProbeKind: 'workbuddy-v1',
  }),
  doubao: Object.freeze({
    clientId: 'doubao',
    displayName: '豆包',
    bundleId: 'com.bot.pc.doubao',
    teamId: '96L78H6LMH',
    appNames: Object.freeze(['Doubao.app']),
    explicitEnvironmentVariable: 'CODEX_SKIN_STUDIO_DOUBAO_APP',
    rendererEntryPath: null,
    defaultTargetUrl: null,
    defaultProbeKind: 'doubao-v1',
    nestedBrowserRelativePath: 'Contents/Helpers/Doubao Browser.app',
    nestedBundleId: 'com.bot.pc.doubao.browser',
    nestedExecutableRelativePath: 'Contents/MacOS/Doubao Browser',
    frameworkName: 'Doubao Browser Framework',
    extensionRelativePath: 'Resources/local_webcontents/extensions/ai-views',
    extensionId: 'obkcimipmjdkghadnfcjojepocldeggd',
    targetAllowlist: DOUBAO_TARGET_ALLOWLIST,
  }),
});

const TRUST_POLICY_IDS = Object.keys(CLIENT_TRUST_POLICIES);
if (TRUST_POLICY_IDS.length !== TARGET_CLIENT_IDS.length ||
    TARGET_CLIENT_IDS.some((clientId) => !Object.hasOwn(CLIENT_TRUST_POLICIES, clientId))) {
  throw new Error('客户端信任策略必须覆盖完整客户端注册表');
}

// Discovery, Doctor and runtime managers use the same canonical Agent list as
// the union schema/entitlement/schedule layers.  A registry addition fails
// loudly until a corresponding trust policy is supplied.
export const SUPPORTED_CLIENT_IDS = TARGET_CLIENT_IDS;

export function clientPolicy(clientId) {
  return CLIENT_TRUST_POLICIES[clientId] ?? null;
}

export function clientIdForBundleId(bundleId) {
  return SUPPORTED_CLIENT_IDS.find((clientId) =>
    CLIENT_TRUST_POLICIES[clientId].bundleId === bundleId) ?? null;
}

function fileIdentity(filePath) {
  const realPath = fs.realpathSync(filePath);
  const stat = fs.statSync(realPath, {bigint: true});
  return {
    realPath,
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    size: stat.size.toString(),
    modifiedNs: stat.mtimeNs.toString(),
  };
}

function signatureMutableResourceSafetyStates(clientId, appPath) {
  if (clientId !== 'workbuddy') return null;
  return Object.fromEntries(WORKBUDDY_RUNTIME_MUTABLE_RESOURCES.map((relativePath) => {
    const candidate = path.join(appPath, relativePath);
    return [relativePath, fs.existsSync(candidate)
      ? {present: true, safe: safeWorkBuddyGeneratedLog(appPath, candidate)}
      : {present: false, safe: true}];
  }));
}

function fingerprintFor(app) {
  const payload = {
    clientId: app.clientId,
    path: app.path,
    realPath: app.realPath,
    bundleId: app.bundleId,
    teamId: app.teamId,
    version: app.version,
    build: app.build,
    chromium: app.chromium,
    asarSha256: app.asarSha256,
    cdHash: app.cdHash,
    nestedBundleId: app.nestedBrowser?.bundleId,
    nestedTeamId: app.nestedBrowser?.teamId,
    nestedCDHash: app.nestedBrowser?.cdHash,
    chromiumFrameworkVersion: app.chromiumFrameworkVersion,
    manifestCommit: app.manifestCommit,
    extensionId: app.localExtension?.id,
    extensionVersion: app.localExtension?.version,
    artifactSha256: app.artifactSha256,
    signatureValidationMode: app.signatureValidationMode,
    ignoredSignatureResources: app.ignoredSignatureResources,
    plistIdentity: app.plistIdentity,
    executableIdentity: app.executableIdentity,
    asarIdentity: app.asarIdentity,
    artifactIdentities: app.artifactIdentities,
    // The Tencent Editor SDK log is continuously appended while WorkBuddy is
    // running and can be recreated during a normal restart. Its exact inode,
    // size and mtime are therefore not part of the immutable app fingerprint.
    // Both discovery passes still re-run the bounded path/owner/link/type check
    // and code-only deep signature verification before any launch.
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function plistValue(plist, key) {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function candidateApps(policy) {
  const explicit = process.env[policy.explicitEnvironmentVariable];
  const candidates = [
    explicit,
    ...policy.appNames.flatMap((name) => [
      path.join('/Applications', name),
      path.join(os.homedir(), 'Applications', name),
    ]),
  ].filter(Boolean);
  try {
    const found = execFileSync('/usr/bin/mdfind', [
      `kMDItemCFBundleIdentifier == '${policy.bundleId}'`,
    ], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000})
      .split('\n')
      .map((item) => item.trim())
      .filter((item) => item.endsWith('.app'));
    candidates.push(...found);
  } catch {
    // Spotlight is an optional discovery aid.
  }
  return [...new Set(candidates)];
}

function appSignature(appPath) {
  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: CODESIGN_TIMEOUT_MS,
  });
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function signatureMetadata(signature) {
  return {
    bundleId: signature.match(/Identifier=([^\n]+)/u)?.[1]?.trim() ?? null,
    teamId: signature.match(/TeamIdentifier=([^\n]+)/u)?.[1]?.trim() ?? null,
    cdHash: signature.match(/CDHash=([a-fA-F0-9]+)/u)?.[1]?.trim().toLowerCase() ?? null,
  };
}

function safeWorkBuddyGeneratedLog(appPath, absolutePath) {
  try {
    const root = fs.realpathSync(appPath);
    const allowed = WORKBUDDY_RUNTIME_MUTABLE_RESOURCES.map((relativePath) =>
      path.join(root, relativePath));
    const realResource = fs.realpathSync(absolutePath);
    if (!allowed.includes(realResource)) return false;
    const stat = fs.lstatSync(absolutePath);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
      stat.size >= 0 && stat.size <= WORKBUDDY_RUNTIME_MUTABLE_RESOURCE_MAX_BYTES &&
      currentUid != null && stat.uid === currentUid;
  } catch {
    return false;
  }
}

function scopedWorkBuddySignatureException(appPath, diagnostic) {
  const lines = String(diagnostic ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const added = lines.filter((line) => line.startsWith('file added: '))
    .map((line) => line.slice('file added: '.length));
  const resourceFailure = lines.filter((line) =>
    line === `${appPath}: a sealed resource is missing or invalid`);
  if (added.length !== 1 || resourceFailure.length !== 1 || lines.length !== 2 ||
      !safeWorkBuddyGeneratedLog(appPath, added[0])) return null;
  const ignoredRelativePath = path.relative(fs.realpathSync(appPath), fs.realpathSync(added[0]));
  return WORKBUDDY_RUNTIME_MUTABLE_RESOURCES.includes(ignoredRelativePath)
    ? ignoredRelativePath : null;
}

function verifySeal(appPath, clientId = null) {
  const strict = spawnSync('/usr/bin/codesign', [
    '--verify', '--deep', '--strict', '--verbose=1', appPath,
  ], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CODESIGN_TIMEOUT_MS});
  if (strict.status === 0 && !strict.error) {
    return Object.freeze({valid: true, strict: true, mode: 'strict', ignoredResources: []});
  }
  const diagnostic = `${strict.stdout ?? ''}\n${strict.stderr ?? ''}`.trim();
  const ignored = clientId === 'workbuddy'
    ? scopedWorkBuddySignatureException(appPath, diagnostic)
    : null;
  if (ignored) {
    // The first pass proved that the only resource-envelope drift is one
    // bounded, non-executable SDK log at an exact vendor path. This second
    // pass still verifies every nested code signature and designated
    // requirement; it does not turn arbitrary resource drift into trust.
    const codeOnly = spawnSync('/usr/bin/codesign', [
      '--verify', '--deep', '--strict', '--ignore-resources', appPath,
    ], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CODESIGN_TIMEOUT_MS});
    if (codeOnly.status === 0 && !codeOnly.error) {
      return Object.freeze({
        valid: true,
        strict: false,
        mode: 'scoped-workbuddy-generated-log',
        ignoredResources: Object.freeze([ignored]),
      });
    }
  }
  return Object.freeze({valid: false, strict: false, mode: 'failed', ignoredResources: []});
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function emptySignals() {
  return {
    themeShareV1: false,
    appUrlEntry: false,
    semanticSelectors: false,
    designTokens: false,
    productMarker: false,
    nestedSignature: false,
    frameworkIdentity: false,
    resourceHashes: false,
    targetAllowlist: false,
    transportVerified: false,
  };
}

function inspectCodexAsar(asarPath) {
  const signals = emptySignals();
  const seen = {composer: false, sidebar: false, mainSurface: false, accent: false};
  let codeThemeIds = ['codex'];
  withAsar(asarPath, (asar) => {
    const files = asar.list();
    signals.appUrlEntry = files.includes('webview/index.html');
    const candidates = files.filter((name) => {
      if (!name.endsWith('.js') && !name.endsWith('.css')) return false;
      const size = asar.stat(name)?.size ?? Number.MAX_SAFE_INTEGER;
      return size <= 5 * 1024 * 1024 && (
        (name.startsWith('webview/assets/app-initial~') && name.includes('app-main')) ||
        /^webview\/assets\/app-[a-zA-Z0-9_-]+\.css$/u.test(name) ||
        name.includes('appearance-settings') ||
        name.includes('general-settings') ||
        name.includes('register-app-actions') ||
        name.includes('composer-utility-bar') ||
        name.includes('codex-micro-bridge') ||
        name.endsWith('/src-HagpvBpE.js') ||
        name.endsWith('/app-CnsXMFE2.css')
      );
    });
    let scannedBytes = 0;
    for (const name of candidates.slice(0, 160)) {
      const size = asar.stat(name)?.size ?? 0;
      if (scannedBytes + size > 96 * 1024 * 1024) break;
      scannedBytes += size;
      const text = asar.readFile(name, 5 * 1024 * 1024).toString('utf8');
      if (text.includes('codex-theme-v1:')) signals.themeShareV1 = true;
      if (text.includes('data-codex-composer')) seen.composer = true;
      if (text.includes('data-app-action-sidebar') || text.includes('app-shell-left-panel')) {
        seen.sidebar = true;
      }
      if (text.includes('--color-token-main-surface-primary')) seen.mainSurface = true;
      if (text.includes('--codex-base-accent')) seen.accent = true;
      const match = text.match(/CODEX:`codex`(?:,[A-Z0-9_]+:`[^`]+`){5,}/u);
      if (match) {
        const ids = [...match[0].matchAll(/:`([^`]+)`/gu)].map((item) => item[1]);
        if (ids.includes('codex')) codeThemeIds = [...new Set(ids)];
      }
    }
    signals.semanticSelectors = seen.composer && seen.sidebar;
    signals.designTokens = seen.mainSurface && seen.accent;
    signals.productMarker = signals.themeShareV1;
  });
  return {signals, codeThemeIds, error: null};
}

function inspectWorkBuddyAsar(asarPath) {
  const signals = emptySignals();
  withAsar(asarPath, (asar) => {
    const files = new Set(asar.list());
    signals.appUrlEntry = files.has('renderer/index.html');
    if (!signals.appUrlEntry || !files.has('package.json')) return;
    const html = asar.readFile('renderer/index.html', 2 * 1024 * 1024).toString('utf8');
    const packageText = asar.readFile('package.json', 2 * 1024 * 1024).toString('utf8');
    let packageJson = null;
    try {
      packageJson = JSON.parse(packageText);
    } catch {
      // The remaining signals stay false when package metadata is malformed.
    }
    const packageMarker = packageJson?.name === '@genie/workbuddy-desktop' &&
      packageJson?.main === 'main/index.js';
    const htmlMarker = /<title>\s*WorkBuddy\s*<\/title>/iu.test(html);
    signals.productMarker = packageMarker && htmlMarker;
    signals.semanticSelectors = signals.productMarker && /id=["']root["']/u.test(html);
    signals.designTokens = html.includes('--vscode-editor-background') &&
      html.includes('--vscode-editor-foreground') && html.includes('data-vscode-theme-name');
  });
  return {signals, codeThemeIds: [], error: null};
}

function readSmallFile(filePath, limit = 4 * 1024 * 1024) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > limit) throw new Error(`文件超出只读审计上限：${path.basename(filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readSmallJson(filePath, limit = 2 * 1024 * 1024) {
  return JSON.parse(readSmallFile(filePath, limit));
}

// Static string presence is intentionally only a compatibility hint. A switch
// literal in an embedded Chromium binary does not prove that Doubao's native
// wrapper forwards argv or inherited Pipe file descriptors at runtime.
function binaryMarkerPresence(filePath, markers, limit = DOUBAO_BINARY_MARKER_SCAN_LIMIT_BYTES) {
  const result = Object.fromEntries(markers.map((marker) => [marker, false]));
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > limit) {
    return {fileFullyScanned: false, allMarkersFound: false, bytesScanned: 0, markers: result};
  }
  const needles = markers.map((marker) => ({marker, bytes: Buffer.from(marker, 'ascii')}));
  const overlapBytes = Math.max(0, ...needles.map(({bytes}) => bytes.length - 1));
  const fd = fs.openSync(filePath, 'r');
  const chunk = Buffer.alloc(CHROMIUM_SCAN_CHUNK_BYTES);
  let carry = Buffer.alloc(0);
  let position = 0;
  try {
    while (position < stat.size && Object.values(result).some((found) => !found)) {
      const length = Math.min(chunk.length, stat.size - position);
      const bytesRead = fs.readSync(fd, chunk, 0, length, position);
      if (!bytesRead) break;
      const body = chunk.subarray(0, bytesRead);
      const haystack = carry.length ? Buffer.concat([carry, body]) : body;
      for (const {marker, bytes} of needles) {
        if (!result[marker] && haystack.indexOf(bytes) !== -1) result[marker] = true;
      }
      carry = overlapBytes ? Buffer.from(haystack.subarray(-overlapBytes)) : Buffer.alloc(0);
      position += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }
  return {
    fileFullyScanned: position === stat.size,
    allMarkersFound: Object.values(result).every(Boolean),
    bytesScanned: position,
    markers: result,
  };
}

function frozenMarkerPresence(result) {
  return Object.freeze({
    fileFullyScanned: result.fileFullyScanned,
    allMarkersFound: result.allMarkersFound,
    bytesScanned: result.bytesScanned,
    markers: Object.freeze({...result.markers}),
  });
}

function extensionIdForManifestKey(key) {
  if (typeof key !== 'string' || key.length > 16 * 1024) return null;
  let bytes;
  try {
    bytes = Buffer.from(key, 'base64');
  } catch {
    return null;
  }
  if (!bytes.length) return null;
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/gu, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)));
}

function doubaoBundlePaths(appPath, policy) {
  const nestedApp = path.join(appPath, policy.nestedBrowserRelativePath);
  const nestedPlist = path.join(nestedApp, 'Contents/Info.plist');
  const nestedExecutable = path.join(nestedApp, policy.nestedExecutableRelativePath);
  const versionsRoot = path.join(
    nestedApp,
    `Contents/Frameworks/${policy.frameworkName}.framework/Versions`,
  );
  const versionsRealPath = fs.realpathSync(versionsRoot);
  const frameworkVersionDir = fs.realpathSync(path.join(versionsRoot, 'Current'));
  if (!frameworkVersionDir.startsWith(`${versionsRealPath}${path.sep}`)) {
    throw new Error('豆包 Chromium Framework Current 越出 Versions 目录');
  }
  const chromiumFrameworkVersion = path.basename(frameworkVersionDir);
  if (!/^\d+\.\d+\.\d+\.\d+$/u.test(chromiumFrameworkVersion)) {
    throw new Error('豆包 Chromium Framework 版本格式异常');
  }
  const frameworkBinary = path.join(frameworkVersionDir, policy.frameworkName);
  const frameworkResources = path.join(frameworkVersionDir, policy.extensionRelativePath.split('/')[0]);
  const extensionRoot = path.join(frameworkVersionDir, policy.extensionRelativePath);
  const sidePanelHtml = path.join(extensionRoot, 'side_panel.html');
  const html = readSmallFile(sidePanelHtml, 2 * 1024 * 1024);
  const linkedCss = [...html.matchAll(/href=["']\/(static\/css\/[a-zA-Z0-9_-]+\.css)["']/gu)]
    .map((match) => match[1]);
  const designTokensRelativePath = linkedCss.find((name) => !name.endsWith('/side_panel.css')) ?? null;
  if (!designTokensRelativePath) throw new Error('豆包 Side Panel 没有固定设计令牌样式表');
  return {
    nestedApp,
    nestedPlist,
    nestedExecutable,
    versionsRoot,
    frameworkVersionDir,
    chromiumFrameworkVersion,
    frameworkBinary,
    frameworkResources,
    extensionRoot,
    mainManifest: path.join(appPath, 'Contents/Resources/manifest.json'),
    extensionManifest: path.join(extensionRoot, 'manifest.json'),
    sidePanelHtml,
    sidePanelJavaScript: path.join(extensionRoot, 'static/js/side_panel.js'),
    homepageJavaScript: path.join(extensionRoot, 'static/js/homepage_scripts.js'),
    sidePanelStylesheet: path.join(extensionRoot, 'static/css/side_panel.css'),
    designTokensStylesheet: path.join(extensionRoot, designTokensRelativePath),
    designTokensRelativePath,
  };
}

function doubaoArtifactPaths(executable, paths) {
  return {
    mainExecutable: executable,
    mainManifest: paths.mainManifest,
    nestedExecutable: paths.nestedExecutable,
    chromiumFramework: paths.frameworkBinary,
    extensionManifest: paths.extensionManifest,
    sidePanelHtml: paths.sidePanelHtml,
    sidePanelJavaScript: paths.sidePanelJavaScript,
    sidePanelStylesheet: paths.sidePanelStylesheet,
    designTokensStylesheet: paths.designTokensStylesheet,
  };
}

function inspectDoubaoBundle({appPath, executable, version, build, policy, paths, nestedSignatureValid}) {
  const signals = emptySignals();
  const mainManifest = readSmallJson(paths.mainManifest);
  const extensionManifest = readSmallJson(paths.extensionManifest);
  const html = readSmallFile(paths.sidePanelHtml, 2 * 1024 * 1024);
  const sidePanelJs = readSmallFile(paths.sidePanelJavaScript, 4 * 1024 * 1024);
  const homepageJs = readSmallFile(paths.homepageJavaScript, 1024 * 1024);
  const sidePanelCss = readSmallFile(paths.sidePanelStylesheet, 4 * 1024 * 1024);
  const designTokensCss = readSmallFile(paths.designTokensStylesheet, 4 * 1024 * 1024);
  const extensionId = extensionIdForManifestKey(extensionManifest.key);
  const doubaoHomepageScript = extensionManifest.content_scripts?.some((script) =>
    script.run_at === 'document_start' && script.matches?.includes('https://www.doubao.com/chat/**') &&
      script.js?.includes('static/js/homepage_scripts.js'));

  signals.appUrlEntry = /<div\s+id=["']root["']/u.test(html) &&
    html.includes('/static/js/side_panel.js') && html.includes('/static/css/side_panel.css');
  signals.productMarker = mainManifest.productName === 'Doubao' && mainManifest.version === version &&
    build === version && extensionId === policy.extensionId &&
    /^1\.0\.0\.\d+$/u.test(extensionManifest.version ?? '') && doubaoHomepageScript === true;
  // These are static renderer anchors only. They are deliberately stricter
  // than loose telemetry strings such as "send_message" or "message-list",
  // which do not prove that an element exists in the live DOM.
  signals.semanticSelectors = [
    '[data-testid=chat_input]',
    '[data-testid=chat_input_input]',
    '[data-testid=message_text_content]',
  ].every((marker) => sidePanelJs.includes(marker)) && [
    'id="root"',
    'id="sidepanel_skeleton"',
    'skeleton-input',
    'skeleton-circle-send-btn',
  ].every((marker) => html.includes(marker));
  const css = `${sidePanelCss}\n${designTokensCss}`;
  signals.designTokens = [
    '--s-color-brand-primary-default',
    '--s-color-text-primary',
    '--s-color-bg-primary',
    '--s-color-border-primary',
    '--dbx-text-primary',
    '--chat-bg-color',
    '--bg-layer-base',
    '--bg-input',
    '--chat-input-skill-border-radius',
  ].every((marker) => css.includes(marker));
  signals.nestedSignature = nestedSignatureValid;
  signals.frameworkIdentity = fs.existsSync(paths.frameworkBinary) &&
    /^\d+\.\d+\.\d+\.\d+$/u.test(paths.chromiumFrameworkVersion);
  signals.resourceHashes = true;
  signals.targetAllowlist = Array.isArray(policy.targetAllowlist) &&
    policy.targetAllowlist.includes('doubao://doubao-chat/*') &&
    policy.targetAllowlist.includes(`chrome-extension://${policy.extensionId}/side_panel.html`) &&
    policy.targetAllowlist.includes('https://www.doubao.com/chat/*');
  // Discovery is intentionally incapable of setting this signal. Only a
  // user-authorized isolated transport evidence run may do so later.
  signals.transportVerified = false;
  const mainWrapperMarkers = binaryMarkerPresence(executable, DOUBAO_DEBUG_MARKERS);
  const nestedLauncherMarkers = binaryMarkerPresence(paths.nestedExecutable, DOUBAO_DEBUG_MARKERS);
  const chromiumFrameworkMarkers = binaryMarkerPresence(paths.frameworkBinary, DOUBAO_DEBUG_MARKERS);
  const staticRuntimeHints = Object.freeze({
    evidenceClass: 'static-only',
    runtimeDomVerified: false,
    wrapperArgumentForwardingVerified: false,
    mainWrapper: frozenMarkerPresence(mainWrapperMarkers),
    nestedLauncher: frozenMarkerPresence(nestedLauncherMarkers),
    chromiumFramework: frozenMarkerPresence(chromiumFrameworkMarkers),
    localExtension: Object.freeze({
      manifestVersion: extensionManifest.manifest_version ?? null,
      sidePanelDefaultPath: extensionManifest.side_panel?.default_path ?? null,
      homepageDocumentStart: doubaoHomepageScript === true,
      homepageBridgeMarkers: Object.freeze({
        loadedAttribute: homepageJs.includes('setAttribute("samantha-ext-loaded","1")'),
        extensionReadyMessage: homepageJs.includes('name:"extension-ready"'),
      }),
    }),
  });
  return {
    signals,
    codeThemeIds: [],
    error: null,
    manifestCommit: mainManifest.commitId ?? null,
    localExtension: {
      id: extensionId,
      version: extensionManifest.version ?? null,
      root: paths.extensionRoot,
      entryUrl: `chrome-extension://${extensionId}/side_panel.html`,
      designTokensRelativePath: paths.designTokensRelativePath,
    },
    targetAllowlist: [...policy.targetAllowlist],
    staticRuntimeHints,
    rendererEntryPath: null,
    appPath,
  };
}

function inspectAsar(clientId, asarPath) {
  try {
    return clientId === 'workbuddy'
      ? inspectWorkBuddyAsar(asarPath)
      : inspectCodexAsar(asarPath);
  } catch (error) {
    return {signals: emptySignals(), codeThemeIds: clientId === 'codex' ? ['codex'] : [], error: error.message};
  }
}

function executableFor(appPath, plist) {
  const name = plistValue(plist, 'CFBundleExecutable');
  return name ? path.join(appPath, 'Contents/MacOS', name) : null;
}

function chromiumVersionInBinary(binaryPath) {
  if (!fs.existsSync(binaryPath)) return null;
  const fd = fs.openSync(binaryPath, 'r');
  const buffer = Buffer.alloc(CHROMIUM_SCAN_CHUNK_BYTES);
  let carry = '';
  let position = 0;
  try {
    const size = Math.min(fs.fstatSync(fd).size, CHROMIUM_SCAN_LIMIT_BYTES);
    while (position < size) {
      const length = Math.min(buffer.length, size - position);
      const bytes = fs.readSync(fd, buffer, 0, length, position);
      if (!bytes) break;
      const text = carry + buffer.subarray(0, bytes).toString('latin1');
      const match = text.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/u);
      if (match) return match[1];
      carry = text.slice(-64);
      position += bytes;
    }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}

function chromiumVersion(clientId, appPath, plist) {
  const plistVersion = plistValue(plist, 'ChromiumBaseVersion');
  if (plistVersion || clientId !== 'workbuddy') return plistVersion;
  return chromiumVersionInBinary(path.join(
    appPath,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
  ));
}

export function findClientApp(clientId, {fresh = false} = {}) {
  const policy = clientPolicy(clientId);
  if (!policy) throw new Error(`Unsupported client: ${clientId}`);
  // A stale copy under ~/Applications must not shadow a fully verified install
  // elsewhere.  Candidates keep their declared order, but the first launchable
  // one wins; an unlaunchable match is only reported when nothing better
  // exists, so Doctor can still explain why it was rejected.
  let firstRejected = null;
  for (const appPath of candidateApps(policy)) {
    const plist = path.join(appPath, 'Contents/Info.plist');
    if (!fs.existsSync(plist)) continue;
    const bundleId = plistValue(plist, 'CFBundleIdentifier');
    if (bundleId !== policy.bundleId) continue;
    const executable = executableFor(appPath, plist);
    const version = plistValue(plist, 'CFBundleShortVersionString');
    const build = plistValue(plist, 'CFBundleVersion');
    const candidateAsarPath = path.join(appPath, 'Contents/Resources/app.asar');
    const asarPath = clientId === 'doubao' ? null : candidateAsarPath;
    let doubaoPaths = null;
    let doubaoPathsError = null;
    if (clientId === 'doubao') {
      try {
        doubaoPaths = doubaoBundlePaths(appPath, policy);
      } catch (error) {
        doubaoPathsError = error.message;
      }
    }
    let identities;
    try {
      const artifacts = doubaoPaths
        ? Object.fromEntries(Object.entries(doubaoArtifactPaths(executable, doubaoPaths))
          .map(([name, filePath]) => [name, fileIdentity(filePath)]))
        : null;
      identities = {
        plist: fileIdentity(plist),
        executable: executable ? fileIdentity(executable) : null,
        asar: asarPath && fs.existsSync(asarPath) ? fileIdentity(asarPath) : null,
        nestedPlist: doubaoPaths ? fileIdentity(doubaoPaths.nestedPlist) : null,
        artifacts,
        signatureMutableResources: signatureMutableResourceSafetyStates(clientId, appPath),
      };
    } catch {
      continue;
    }
    const cacheKey = JSON.stringify([clientId, appPath, identities]);
    if (!fresh && cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (cached.strictSafeToLaunch) return cached;
      firstRejected ??= cached;
      continue;
    }
    const signature = appSignature(appPath);
    const signatureInfo = signatureMetadata(signature);
    const teamId = signatureInfo.teamId;
    const cdHash = signatureInfo.cdHash;
    const signatureVerification = verifySeal(appPath, clientId);
    const signatureValid = signatureVerification.valid;
    const trustedPublisher = teamId === policy.teamId && signatureInfo.bundleId === policy.bundleId;
    const canInspectBundle = (signatureValid || ALLOW_UNVERIFIED_CLIENTS) && trustedPublisher;
    let nestedBrowser = null;
    let artifactSha256 = null;
    let inspected;
    if (clientId === 'doubao') {
      if (doubaoPaths) {
        const nestedSignature = appSignature(doubaoPaths.nestedApp);
        const nestedInfo = signatureMetadata(nestedSignature);
        const nestedBundleId = plistValue(doubaoPaths.nestedPlist, 'CFBundleIdentifier');
        const nestedTeamId = nestedInfo.teamId;
        const nestedSignatureValid = verifySeal(doubaoPaths.nestedApp, 'doubao').valid;
        const nestedTrustedPublisher = nestedInfo.bundleId === policy.nestedBundleId &&
          nestedBundleId === policy.nestedBundleId && nestedTeamId === policy.teamId;
        nestedBrowser = {
          path: doubaoPaths.nestedApp,
          plist: doubaoPaths.nestedPlist,
          executable: doubaoPaths.nestedExecutable,
          bundleId: nestedBundleId,
          teamId: nestedTeamId,
          cdHash: nestedInfo.cdHash,
          signatureValid: nestedSignatureValid,
          trustedPublisher: nestedTrustedPublisher,
        };
        const canInspectDoubao = canInspectBundle && (nestedSignatureValid || ALLOW_UNVERIFIED_CLIENTS) && nestedTrustedPublisher;
        if (canInspectDoubao) {
          try {
            artifactSha256 = Object.fromEntries(Object.entries(doubaoArtifactPaths(executable, doubaoPaths))
              .map(([name, filePath]) => [name, sha256File(filePath)]));
            inspected = inspectDoubaoBundle({
              appPath,
              executable,
              version,
              build,
              policy,
              paths: doubaoPaths,
              // The bypass only decides whether resources may be parsed at
              // all; the reported signal must stay the observed fact.
              nestedSignatureValid,
            });
          } catch (error) {
            inspected = {signals: emptySignals(), codeThemeIds: [], error: error.message};
          }
        } else {
          inspected = {
            signals: emptySignals(),
            codeThemeIds: [],
            error: '豆包主应用或嵌套浏览器签名链校验失败，未解析前端资源',
          };
        }
      } else {
        inspected = {signals: emptySignals(), codeThemeIds: [], error: doubaoPathsError ?? '豆包资源路径不完整'};
      }
    } else {
      inspected = canInspectBundle && identities.asar
        ? inspectAsar(clientId, asarPath)
        : {
            signals: emptySignals(),
            codeThemeIds: clientId === 'codex' ? ['codex'] : [],
            error: canInspectBundle ? 'app.asar 不存在' : '签名或发布者校验失败，未解析 app.asar',
          };
    }
    const app = {
      clientId,
      path: appPath,
      realPath: fs.realpathSync(appPath),
      plist,
      plistIdentity: identities.plist,
      executable,
      executableIdentity: identities.executable,
      bundleId,
      displayName: plistValue(plist, 'CFBundleDisplayName') ?? policy.displayName,
      version,
      build,
      chromium: clientId === 'doubao'
        ? doubaoPaths?.chromiumFrameworkVersion ?? null
        : chromiumVersion(clientId, appPath, plist),
      chromiumFrameworkVersion: doubaoPaths?.chromiumFrameworkVersion ?? null,
      teamId,
      cdHash,
      signatureValid,
      strictSignatureValid: signatureVerification.strict,
      signatureValidationMode: signatureVerification.mode,
      ignoredSignatureResources: [...signatureVerification.ignoredResources],
      trustedPublisher,
      asarPath,
      asarIdentity: identities.asar,
      asarSha256: canInspectBundle && identities.asar ? sha256File(asarPath) : null,
      artifactIdentities: identities.artifacts,
      signatureMutableResourceSafetyStates: identities.signatureMutableResources,
      artifactSha256,
      nestedBrowser,
      rendererEntryPath: policy.rendererEntryPath,
      targetAllowlist: policy.targetAllowlist ? [...policy.targetAllowlist] : [],
      ...inspected,
    };
    const nestedTrustSatisfied = clientId !== 'doubao' || Boolean(
      app.nestedBrowser?.signatureValid && app.nestedBrowser?.trustedPublisher &&
      app.nestedBrowser?.bundleId === policy.nestedBundleId && app.nestedBrowser?.teamId === policy.teamId
    );
    const strictSafeToLaunch = Boolean(
      app.executable && fs.existsSync(app.executable) &&
      app.signatureValid && app.trustedPublisher &&
      app.bundleId === policy.bundleId && app.teamId === policy.teamId && nestedTrustSatisfied
    );
    const signatureBypassed = Boolean(!strictSafeToLaunch && isSignatureBypassSafe(policy, app));
    app.strictSafeToLaunch = strictSafeToLaunch;
    app.signatureBypassed = signatureBypassed;
    app.safeToLaunch = strictSafeToLaunch || signatureBypassed;
    app.fingerprint = fingerprintFor(app);
    app.transportVerification = unverifiedTransportStatus(app);
    app.launchStrategies = candidateLaunchStrategies(app);
    app.signals.transportVerified = app.transportVerification.verified;
    if (cache.size >= CLIENT_APP_CACHE_MAX) {
      // Map iterates in insertion order; drop the oldest entry.
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(cacheKey, app);
    if (app.strictSafeToLaunch) return app;
    firstRejected ??= app;
  }
  return firstRejected;
}

export function findCodexApp(options = {}) {
  return findClientApp('codex', options);
}

export function findWorkBuddyApp(options = {}) {
  return findClientApp('workbuddy', options);
}

export function findDoubaoApp(options = {}) {
  return findClientApp('doubao', options);
}

function classifyMainProcessCommand(executable, command) {
  if (command === executable) return 'stock';
  if (command === `${executable} --remote-debugging-pipe`) return 'pipe';
  return null;
}

export function runningMainProcesses(app) {
  if (!app?.executable) return [];
  try {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8',
      // Chromium/Electron helper command lines are long; the 1MiB default
      // raises ENOBUFS instead of truncating on a busy host.
      maxBuffer: PROCESS_SNAPSHOT_MAX_BUFFER_BYTES,
    });
    return output.split('\n').flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/u);
      if (!match) return [];
      const debugTransport = classifyMainProcessCommand(app.executable, match[2]);
      if (!debugTransport) return [];
      return [{pid: Number(match[1]), debugTransport}];
    });
  } catch (error) {
    const allowUnverifiedMode = process.env.LINGGLOW_ALLOW_UNVERIFIED_CLIENTS === '1';
    if ((process.env.LINGGLOW_RELAX_PROCESS_VERIFICATION === '1' || allowUnverifiedMode) &&
        error.code === 'EPERM') {
      return [];
    }
    throw new Error(`无法核验 ${app.displayName || '客户端'} 进程状态：${error.message}`);
  }
}

export async function quitClientGracefully(app, timeoutMs = 15000) {
  const policy = clientPolicy(app?.clientId) ?? clientPolicy(clientIdForBundleId(app?.bundleId));
  if (!policy || app?.bundleId !== policy.bundleId || app?.teamId !== policy.teamId) {
    return {ok: false, error: '拒绝退出未通过内置信任锚校验的客户端。'};
  }
  if (!runningMainProcesses(app).length) return {ok: true, alreadyStopped: true};
  try {
    await execFileAsync('/usr/bin/osascript', [
      '-e',
      `tell application id "${policy.bundleId}" to quit`,
    ], {timeout: 5000});
  } catch (error) {
    return {ok: false, error: `${policy.displayName} 拒绝正常退出：${error.message}`};
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!runningMainProcesses(app).length) return {ok: true, alreadyStopped: false};
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {ok: false, error: `${policy.displayName} 在 15 秒内没有退出；未强制结束进程。`};
}

export async function quitCodexGracefully(app, timeoutMs = 15000) {
  return quitClientGracefully(app, timeoutMs);
}

export async function launchStock(app, timeoutMs = 15000) {
  const policy = clientPolicy(app?.clientId) ?? clientPolicy(clientIdForBundleId(app?.bundleId));
  if (!policy || !app?.safeToLaunch || app.bundleId !== policy.bundleId || app.teamId !== policy.teamId) {
    throw new Error('Refusing to launch an unverified client app');
  }
  await execFileAsync('/usr/bin/open', ['-a', app.path], {timeout: 5000});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const processes = runningMainProcesses(app);
    if (processes.length && processes.every(({debugTransport}) => debugTransport === 'stock')) {
      return {ok: true, pids: processes.map(({pid}) => pid)};
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${policy.displayName} 未在 15 秒内以无调试参数启动`);
}

export function sameAppFingerprint(first, second) {
  return Boolean(first?.fingerprint && second?.fingerprint && first.fingerprint === second.fingerprint);
}

export const clientAppTestInternals = Object.freeze({
  binaryMarkerPresence,
  classifyMainProcessCommand,
  DOUBAO_DEBUG_MARKERS,
  emptySignals,
  scopedWorkBuddySignatureException,
  signatureMutableResourceSafetyStates,
  WORKBUDDY_RUNTIME_MUTABLE_RESOURCES,
});
