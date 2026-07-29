import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {
  capabilitiesForCompatibility,
  compatibilityFor,
  loadAdapters,
  resolveSkinCapabilityProfile,
} from './adapter.mjs';
import {ApplyIntentService} from './apply-intents.mjs';
import {
  UNION_CLIENT_IDS,
  UNION_FIELDS,
  UNION_SCHEMA_VERSION,
  CODEX_OFFICIAL_THEME_FIELD_IDS,
  getClientCapabilityMap,
  getEditorFieldsForClient,
} from './capability-schema.mjs';
import {CLIENT_LABELS, SCHEDULE_CLIENT_IDS, TARGET_CLIENT_IDS} from './client-registry.mjs';
import {
  getBuiltInSkin,
  listBuiltInSkins,
  materializeCatalogProfile,
} from './catalog.mjs';
import {
  DEFAULT_THEME_PACK_CATALOG_DIR,
  THEME_PACK_INDEX_PATH,
  getRegisteredThemePack,
  listRegisteredThemePacks,
  materializeThemePack,
  themePackCatalogCard,
} from './catalog/theme-pack.mjs';
import {
  getInstalledRemoteSkin,
  installRemoteThemeSkin,
  listRemoteThemeCatalogCards,
  resolveInstalledRemoteSkin,
} from './remote-theme-catalog.mjs';
import {findClientApp, runningMainProcesses} from './client-app.mjs';
import {SkinSessionManager} from './cdp.mjs';
import {createDirectDodoCommerceBridge} from './direct-dodo-commerce.mjs';
import {
  PERMISSION_MATRIX,
  canPersistUnionProfile,
  canUseFeature,
  canUseSkin,
  resolveEntitlement,
} from './entitlements.mjs';
import {LOCAL_VIP_TRIAL_FILE, LocalVipTrialStore, publicLocalVipTrial} from './local-vip-trial.mjs';
import {VIP_SKIN_TRIAL_FILE, VipSkinTrialStore} from './vip-skin-trials.mjs';
import {
  getLoginAgentStatus,
  installLoginAgent,
  removeLoginAgent,
} from './login-agent.mjs';
import {
  defaultDataDir,
  ensureDataDir,
  getProfile,
  listProfiles,
  loadFreeBrand,
  mergeFreeBrandOverride,
  normalizeProfile,
  saveFreeBrand,
  saveProfile,
} from './profile.mjs';
import {publicProductCatalog} from './products.mjs';
import {
  claimSuccessfulScheduleApply,
  claimLaunchReminder,
  evaluateLaunchReminder,
  loadScheduleState,
  loadWeeklySchedule,
  saveWeeklySchedule,
  snoozeLaunchReminder,
} from './schedule.mjs';
import {compileSkin} from './skin.mjs';
import {
  getUnionProfileDraft,
  getUnionProfile,
  listUnionProfileDrafts,
  listUnionProfiles,
  normalizeUnionProfileRecord,
  promoteUnionProfileDraft,
  saveUnionProfileDraft,
  saveUnionProfile,
  unionProfileToLegacyV1,
} from './union-profile.mjs';
import {loadRuntimeIdentity, validRuntimeIdentity} from './runtime-identity.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedRuntime = process.env.LINGGLOW_PACKAGED_RUNTIME === '1';
const packagedRuntimeIdentity = loadRuntimeIdentity(packageRoot, {
  required: packagedRuntime,
  // The native launcher verifies the same manifest before it spawns Node. The
  // second verification means direct start.command use remains fail-closed too.
  verifyFiles: packagedRuntime,
});
const inheritedRuntimeIdentity = process.env.LINGGLOW_RUNTIME_IDENTITY ?? null;
if (inheritedRuntimeIdentity !== null && !validRuntimeIdentity(inheritedRuntimeIdentity)) {
  throw new Error('LINGGLOW_RUNTIME_IDENTITY 格式无效');
}
const allowRuntimeIdentityBypass = process.env.LINGGLOW_SKIP_SERVICE_IDENTITY_CHECK === '1' &&
  process.env.LINGGLOW_FORCE_STRICT !== '1';
if (packagedRuntime && inheritedRuntimeIdentity !== null &&
    !allowRuntimeIdentityBypass &&
    inheritedRuntimeIdentity !== packagedRuntimeIdentity) {
  throw new Error('内置运行时身份与已签名包不一致，拒绝启动');
}
const CURRENT_RUNTIME_IDENTITY = packagedRuntimeIdentity ?? null;
const publicRoot = path.join(packageRoot, 'public');
const BODY_LIMIT = 20 * 1024 * 1024;
const CLIENT_IDS = TARGET_CLIENT_IDS;
const ENTITLEMENT_LEASE_FILE = 'entitlement-lease.txt';
const LEGACY_LICENSE_FILE = 'vip-license.txt';
const THEME_PACK_INDEX_FILE = path.join(DEFAULT_THEME_PACK_CATALOG_DIR, THEME_PACK_INDEX_PATH);
const CODEX_OFFICIAL_THEME_FIELD_ID_SET = new Set(CODEX_OFFICIAL_THEME_FIELD_IDS);
// 授权续验此前只在进程启动与用户手动点击时发生，而菜单栏后端会连续运行数天：
// 付费记录迟早会越过本地离线窗口而被判定为需要重新联网（见 direct-dodo-commerce.mjs）。
// 12 小时一次远小于订阅 72 小时的离线宽限，抖动则避免大量设备在同一时刻打向授权服务。
const LICENSE_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const LICENSE_REFRESH_JITTER_MS = 60 * 60 * 1000;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function securityHeaders(response) {
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  response.setHeader('Cache-Control', 'no-store');
}

function sendJson(response, status, payload) {
  securityHeaders(response);
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  response.end(`${JSON.stringify(payload)}\n`);
}

function catalogCardsForResponse(skins, artworkMode) {
  if (!['full', 'summary'].includes(artworkMode)) {
    throw new Error('目录图片响应模式不合法');
  }
  if (artworkMode === 'full') return skins;
  return skins.map((skin) => ({
    ...skin,
    // Native cards use the separately cached official preview URL. Keeping the
    // field present preserves a stable response schema for older decoders.
    previewArtwork: null,
  }));
}

async function readJson(request) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new Error('请求内容超过 20 MB');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('请求内容超过 20 MB');
    chunks.push(chunk);
  }
  if (!size) return {};
  const type = request.headers['content-type'] || '';
  if (type.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('只接受 application/json');
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sanitizeLog(message) {
  return String(message)
    .replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/gu, '<embedded-image>')
    .slice(0, 800);
}

function readPrivateJson(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
      (stat.mode & 0o077) !== 0) {
    throw new Error('锁文件权限或所有者不安全');
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readPrivateText(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16 * 1024 ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
      (stat.mode & 0o077) !== 0) {
    throw new Error('授权文件权限或所有者不安全');
  }
  return fs.readFileSync(filePath, 'utf8').trim() || null;
}

function localVipTrialEntitlement(trial, paidFallback = null) {
  const snapshot = publicLocalVipTrial(trial);
  if (snapshot.state !== 'active') throw new Error('本机 VIP 试用未处于有效期');
  // The trial itself has no synthetic license or grant. If the person also
  // owns a valid permanent skin/custom-slot lease, preserve that *real* lease
  // and its immutable bindings while the temporary VIP permission snapshot is
  // active. A paid VIP subscription is handled before this function and wins.
  return Object.freeze({
    tier: 'vip',
    source: 'local-trial',
    status: 'trial-active',
    license: paidFallback?.license ?? null,
    permissions: PERMISSION_MATRIX.vip,
    activeGrants: paidFallback?.activeGrants ?? Object.freeze([]),
    skinIds: paidFallback?.skinIds ?? Object.freeze([]),
    customProfileIds: paidFallback?.customProfileIds ?? Object.freeze([]),
    trial: snapshot,
  });
}

function withLocalVipTrialMetadata(entitlement, trial) {
  return Object.freeze({...entitlement, trial: publicLocalVipTrial(trial)});
}

function hasVerifiedLicenseAfterCommerceSync(entitlement) {
  // `trial-active` is accepted only when it is the composed view of a real,
  // freshly verified permanent lease. A pure local trial has `license: null`
  // and can never make redeem/refresh look successful.
  return Boolean(
    entitlement?.license &&
    ['valid', 'trial-active'].includes(entitlement.status)
  );
}

function validClientId(value) {
  if (!CLIENT_IDS.includes(value)) throw new Error('未知目标应用');
  return value;
}

function vipRequired(message) {
  const error = new Error(message);
  error.code = 'VIP_REQUIRED';
  return error;
}

function themePackIndexIdentity() {
  // Every bundled pack file is pinned by SHA-256 in this index, and every pack
  // asset by SHA-256 inside its own pack file.  The index's identity is
  // therefore a complete signature of the bundled Theme Pack catalog.
  try {
    const stat = fs.lstatSync(THEME_PACK_INDEX_FILE);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

function observedProcesses(app) {
  if (!app) return {processes: [], error: null};
  try {
    return {processes: runningMainProcesses(app), error: null};
  } catch (error) {
    return {processes: [], error: error.message};
  }
}

// Shared by the reminder path and tests: custom profiles are eligible only
// when their own exact profileId appears in the verified entitlement.  A
// custom slot must never accidentally broaden into all VIP skins.
export function canUseScheduledSkin(entitlement, resolved) {
  return Boolean(
    resolved && canUseSkin(entitlement, resolved.skin, {custom: resolved.custom === true})
  );
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  const relaxProcessVerification = process.env.LINGGLOW_RELAX_PROCESS_VERIFICATION === '1';
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return relaxProcessVerification ? false : true;
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function openUrlWithoutArgv(url) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-'], {stdio: ['pipe', 'ignore', 'ignore']});
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('无法打开本地工作台')));
    child.stdin.end(`open location ${JSON.stringify(url)}\n`);
  });
}

function openMenuBarApp() {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', [path.join(packageRoot, 'start.command'), '--menubar'], {
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error('无法打开灵妆菜单栏应用')));
  });
}

function nativeSchedulePrompt(reminder) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/osascript', ['-'], {stdio: ['pipe', 'pipe', 'ignore']});
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (output.length < 512) output += chunk;
    });
    child.once('error', () => resolve(null));
    child.once('exit', (code) => {
      if (code !== 0) return resolve(null);
      const choice = output.trim();
      if (choice === '今天跳过') return resolve('skip');
      if (choice === '稍后提醒') return resolve('snooze');
      if (choice === '打开菜单栏') return resolve('open');
      return resolve(null);
    });
    const message = `${reminder.clientName} 今天安排了「${reminder.skinName}」。是否打开灵妆菜单栏，确认重启并切换？`;
    child.stdin.end([
      `set resultDialog to display dialog ${JSON.stringify(message)} with title "灵妆自动换肤" buttons {"今天跳过", "稍后提醒", "打开菜单栏"} default button "打开菜单栏"`,
      'return button returned of resultDialog',
      '',
    ].join('\n'));
  });
}

function releaseOwnerLock(ownerLock) {
  if (!ownerLock) return;
  try { fs.closeSync(ownerLock.fd); } catch {}
  try {
    const current = readPrivateJson(ownerLock.path);
    if (current.instanceId === ownerLock.instanceId && current.pid === process.pid) fs.unlinkSync(ownerLock.path);
  } catch {}
}

function acquireOwnerLock(dataDir) {
  const lockPath = path.join(ensureDataDir(dataDir), 'studio-owner.lock');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const instanceId = crypto.randomBytes(16).toString('hex');
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify({schemaVersion: 1, pid: process.pid, instanceId})}\n`);
      fs.fsyncSync(fd);
      return {fd, path: lockPath, instanceId};
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = readPrivateJson(lockPath); } catch { return null; }
      if (processAlive(owner.pid)) return null;
      try {
        const before = fs.lstatSync(lockPath);
        const check = readPrivateJson(lockPath);
        const after = fs.lstatSync(lockPath);
        if (before.ino !== after.ino || check.instanceId !== owner.instanceId) return null;
        fs.unlinkSync(lockPath);
      } catch (staleError) {
        // Another starter may have removed the same stale lock in between.
        // The next `wx` attempt decides the owner instead of failing startup.
        if (staleError.code !== 'ENOENT') throw staleError;
      }
    }
  }
  return null;
}

export class StudioServer {
  constructor({
    dataDir = defaultDataDir(),
    openBrowser = false,
    ownerLock = null,
    licensePublicKey = null,
    entitlementOverride = null,
    loginAgentOptions = null,
    commerceBridge = null,
    commerceConfigPath = undefined,
    commerceConfigPublicKey = undefined,
    commerceTransport = undefined,
    commerceSecretStore = undefined,
    allowTestCommerce = false,
    runtimeIdentity = CURRENT_RUNTIME_IDENTITY,
    trialStore = null,
    skinTrialStore = null,
    clock = () => new Date(),
  } = {}) {
    if (!validRuntimeIdentity(runtimeIdentity)) throw new Error('运行时身份格式无效');
    if (typeof clock !== 'function') throw new Error('本机时间源无效');
    if (trialStore !== null && (typeof trialStore !== 'object' || typeof trialStore.resolve !== 'function')) {
      throw new Error('本机 VIP 试用存储无效');
    }
    if (skinTrialStore !== null &&
        (typeof skinTrialStore.status !== 'function' || typeof skinTrialStore.consume !== 'function')) {
      throw new Error('VIP 皮肤一次性试用存储无效');
    }
    this.dataDir = ensureDataDir(dataDir);
    this.clock = clock;
    this.openBrowser = openBrowser;
    this.token = crypto.randomBytes(32).toString('base64url');
    this.ownerLock = ownerLock;
    this.instanceId = ownerLock?.instanceId ?? crypto.randomBytes(16).toString('hex');
    this.runtimeIdentity = runtimeIdentity ?? null;
    this.logs = [];
    this.server = null;
    this.host = '127.0.0.1';
    this.port = null;
    this.clients = new Map();
    this.entitlementOverride = entitlementOverride;
    this.loginAgentOptions = loginAgentOptions;
    this.licensePath = path.join(this.dataDir, ENTITLEMENT_LEASE_FILE);
    this.legacyLicensePath = path.join(this.dataDir, LEGACY_LICENSE_FILE);
    this.trialStore = trialStore ?? new LocalVipTrialStore({
      filePath: path.join(this.dataDir, LOCAL_VIP_TRIAL_FILE),
      clock: this.clock,
    });
    this.skinTrialStore = skinTrialStore ?? new VipSkinTrialStore({
      filePath: path.join(this.dataDir, VIP_SKIN_TRIAL_FILE),
      clock: this.clock,
    });
    this.commerceBridge = commerceBridge ?? createDirectDodoCommerceBridge({
      dataDir: this.dataDir,
      ...(commerceTransport === undefined ? {} : {fetchImpl: commerceTransport}),
      ...(commerceSecretStore === undefined ? {} : {secretStore: commerceSecretStore}),
      clock: this.clock,
    });
    this.commerceInitializationError = null;
    this.licensePublicKey = licensePublicKey ?? this.commerceBridge.leaseSigningPublicKey;
    // The desktop uses Dodo static checkout links and public License APIs.
    // No merchant API key, webhook secret, database, or remote LingGlow
    // entitlement service is accepted by this local process.
    const commerce = this.commerceBridge.publicConfiguration();
    const baseProducts = publicProductCatalog();
    const redemptionSkins = [...new Map([
      ...listBuiltInSkins({tier: 'vip'}),
      ...listRegisteredThemePacks({clientId: 'codex'}).filter((pack) => pack.tier === 'vip'),
    ].map((skin) => [skin.id, {id: skin.id, name: skin.name, tier: skin.tier}])).values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    this.products = Object.freeze({
      ...baseProducts,
      commerce,
      redemptionSkins: Object.freeze(redemptionSkins.map((skin) => Object.freeze(skin))),
      products: Object.freeze(baseProducts.products.map((product) => Object.freeze({
        ...product,
        checkoutUrl: null,
        purchaseUrl: commerce.productPortalUrls[product.id] ?? null,
      }))),
    });
    // Product cards are local release metadata and must render immediately.
    // Refresh the remote list of individually redeemable VIP skins in the
    // background instead of making every /api/products request wait on
    // GitHub. Activation still opts into the awaited refresh below.
    this.productRedemptionSkins = this.products.redemptionSkins;
    this.productRedemptionSkinsRefresh = null;
    // Bundled Theme Pack cards carry several megabytes of verified preview
    // artwork.  Only the most recently listed Agent is kept so one dashboard
    // session stops re-materializing them on every catalog/product request.
    this.themePackCardCache = null;
    this.applyIntents = new ApplyIntentService();
    // A scheduled apply is deliberately bound to the one-time Apply Intent,
    // rather than to the first “apply” button press.  This is in-memory only:
    // it never contains a profile or target-App data, and a durable schedule
    // claim is written only after the injection manager returns success.
    this.scheduleApplyIntents = new Map();
    this.scheduleApplyIntentByReminder = new Map();
    this.dashboardLastSeenAt = 0;
    this.nativeReminderInFlight = false;
    this.backgroundTimer = null;
    this.licenseRefreshTimer = null;
    this.licenseRefreshStopped = false;
    this.lockPath = path.join(this.dataDir, 'studio-session.json');
    this.managers = new Map(CLIENT_IDS.map((clientId) => [clientId, new SkinSessionManager({
      log: (level, message) => this.addLog(level, `${CLIENT_LABELS[clientId]} · ${message}`),
    })]));
    // Kept for backward-compatible tests and older local scripts.
    this.manager = this.managers.get('codex');
    this.app = null;
    this.compatibility = null;
  }

  addLog(level, message) {
    this.logs.push({time: new Date().toISOString(), level, message: sanitizeLog(message)});
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
  }

  refreshDoctor({fresh = false, clientId = null} = {}) {
    const ids = clientId ? [validClientId(clientId)] : CLIENT_IDS;
    // compatibilityFor 的默认参数会重扫适配器目录并重新哈希全部证据文件，全部同步。
    // 一次刷新里的适配器集合是同一份，扫一次传给每个客户端即可；这也保留了
    // loadAdapters 打在返回对象上的审核标记（compatibilityFor 不修改传入数组）。
    const adapters = loadAdapters();
    for (const id of ids) {
      const app = findClientApp(id, {fresh});
      this.clients.set(id, {app, compatibility: compatibilityFor(app, adapters)});
    }
    this.app = this.clients.get('codex')?.app ?? null;
    this.compatibility = this.clients.get('codex')?.compatibility ?? compatibilityFor(null, adapters);
    return this.statusPayload();
  }

  clientRecord(clientId) {
    validClientId(clientId);
    return this.clients.get(clientId) ?? {app: null, compatibility: compatibilityFor(null)};
  }

  compileFor(profile, {clientId = 'codex', forceGenericSafe = false} = {}) {
    const {compatibility} = this.clientRecord(clientId);
    const {capabilityLevel, capabilities} = resolveSkinCapabilityProfile(compatibility, {forceGenericSafe});
    const compileCapabilities = clientId === 'codex'
      ? capabilities.filter((capability) => capability !== 'banner')
      : capabilities;
    const compiled = compileSkin(profile, {
      capabilityLevel,
      capabilities: compileCapabilities,
      clientId,
    });

    // Codex's current generic-safe profile intentionally disables the legacy
    // CSS banner capability.  The Dream Skin runtime still needs the selected
    // home artwork, so carry it as runtime-only data instead of re-enabling an
    // unsupported CSS feature.
    const codexHomeImage = clientId === 'codex' ? profile?.advanced?.banner?.image : null;
    if (typeof codexHomeImage === 'string' && codexHomeImage.startsWith('data:image/')) {
      return {
        ...compiled,
        runtimeVisual: {
          ...compiled.runtimeVisual,
          codexHomeImage,
        },
      };
    }
    return compiled;
  }

  /**
   * Build a public Codex theme string from an already persisted union profile.
   *
   * This deliberately does not call `refreshDoctor`, `clientRecord`, or a
   * session manager.  The caller receives text to import in Codex themselves;
   * no target application is discovered, launched, attached, restarted, or
   * modified while exporting it.
   */
  exportCodexOfficialTheme(profileId) {
    const unionProfile = getUnionProfile(profileId, this.dataDir);
    if (!unionProfile) {
      const error = new Error('找不到已保存的 Codex 自定义皮肤；请先仅保存方案再导出');
      error.code = 'CODEX_THEME_PROFILE_NOT_FOUND';
      error.httpStatus = 404;
      throw error;
    }
    if (unionProfile.targetClientId !== 'codex') {
      const error = new Error('只能从已保存的 Codex 自定义皮肤导出官方主题');
      error.code = 'CODEX_THEME_CLIENT_MISMATCH';
      throw error;
    }

    // `unionProfileToLegacyV1` validates the persisted full-union document
    // and projects only Codex fields whose mapping is supported.  Passing an
    // empty capability list keeps the compiler's CSS output inert; we consume
    // only its existing officialThemeString formatter below.
    const legacyProfile = unionProfileToLegacyV1(unionProfile, 'codex');
    const compiled = compileSkin(legacyProfile, {
      clientId: 'codex',
      capabilityLevel: 'generic-safe',
      capabilities: [],
    });
    const deferredFieldIds = Object.keys(unionProfile.values)
      .filter((fieldId) => {
        const descriptor = UNION_FIELDS.find((field) => field.id === fieldId);
        return descriptor?.clients.includes('codex') && !CODEX_OFFICIAL_THEME_FIELD_ID_SET.has(fieldId);
      })
      .sort();

    return {
      ok: true,
      profileId: unionProfile.id,
      profileName: unionProfile.name,
      targetClientId: 'codex',
      format: 'codex-theme-v1',
      themeString: compiled.officialThemeString,
      manualImport: true,
      includedFieldIds: CODEX_OFFICIAL_THEME_FIELD_IDS,
      deferredFieldIds,
      instructions: [
        '已生成本地 Codex 官方主题字符串。复制后，请在 Codex 的设置 → 外观 → Theme 中手动导入。',
        '此操作不会启动、连接、重启、注入或修改 Codex。',
        '官方主题字符串只包含配色、字体、语义色、窗口不透明选项和代码主题 ID；背景图、Banner、布局与其他候选视觉字段不会写入其中。',
      ],
    };
  }

  inlineProfile(body, clientId) {
    if (Object.hasOwn(body, 'unionProfile')) {
      const legacy = unionProfileToLegacyV1(body.unionProfile, clientId);
      return mergeFreeBrandOverride(legacy, loadFreeBrand(this.dataDir), {clientId});
    }
    return normalizeProfile(body.profile ?? body);
  }

  licenseToken() {
    return readPrivateText(this.licensePath) ?? readPrivateText(this.legacyLicensePath);
  }

  discardLegacyLicenseFile() {
    // Runs only after a commerce operation already succeeded and persisted.
    // A legacy file with unsafe ownership/permissions must not turn that into
    // a failed response the user would answer by redeeming again.
    try {
      if (!fs.existsSync(this.legacyLicensePath)) return;
      readPrivateText(this.legacyLicensePath);
      fs.unlinkSync(this.legacyLicensePath);
    } catch (error) {
      this.addLog('warning', `旧版授权文件未能清理：${error.message}`);
    }
  }

  entitlement() {
    if (this.entitlementOverride) return this.entitlementOverride;
    const now = this.clock();
    const paid = typeof this.commerceBridge.currentEntitlement === 'function'
      ? this.commerceBridge.currentEntitlement()
      : resolveEntitlement({licenseToken: this.licenseToken(), publicKey: this.licensePublicKey, now});
    // Resolve/persist on the first entitlement read, not after a purchase UI
    // action. A signed paid VIP subscription always wins. A valid permanent
    // skin/custom-slot lease is retained, but it must not suppress the
    // first-install VIP window or lose its immutable bindings.
    const trial = this.trialStore.resolve({now});
    if (paid.status === 'valid' && paid.tier === 'vip') return withLocalVipTrialMetadata(paid, trial);
    if (trial.active) return localVipTrialEntitlement(trial, paid.status === 'valid' ? paid : null);
    return withLocalVipTrialMetadata(paid, trial);
  }

  publicEntitlement() {
    const entitlement = this.entitlement();
    return {
      tier: entitlement.tier,
      source: entitlement.source,
      status: entitlement.status,
      reason: entitlement.reason ?? null,
      permissions: entitlement.permissions,
      skinIds: entitlement.skinIds ?? [],
      customProfileIds: entitlement.customProfileIds ?? [],
      trial: entitlement.trial ?? null,
      license: entitlement.license ? {
        schemaVersion: entitlement.license.schemaVersion,
        licenseId: entitlement.license.licenseId,
        subject: entitlement.license.subject,
        expiresAt: entitlement.license.expiresAt,
        clientIds: entitlement.license.clientIds,
        grants: entitlement.license.schemaVersion === 2
          ? entitlement.license.grants.map((grant) => ({
            grantId: grant.grantId,
            offerType: grant.offerType,
            status: grant.status,
            productId: grant.productId,
            binding: grant.binding,
            boundAt: grant.boundAt,
            validUntil: grant.validUntil,
            revokedAt: grant.revokedAt,
          }))
          : [],
      } : null,
      issuerConfigured: Boolean(this.licensePublicKey) || this.products.commerce.redemptionEnabled === true,
      activationConfigured: this.products.commerce.redemptionEnabled === true,
      refreshConfigured: this.products.commerce.refreshEnabled === true,
      deactivationConfigured: this.products.commerce.deactivationEnabled === true,
      rawLicenseStorage: this.products.commerce.secretStorage,
    };
  }

  loginAgentStatus() {
    try {
      return getLoginAgentStatus(this.loginAgentOptions ?? {});
    } catch (error) {
      return {
        label: 'local.skin-studio.reminder',
        installed: false,
        managed: false,
        state: 'unavailable',
        reason: error.message,
      };
    }
  }

  skinAccess(skin, {custom = false, entitlement = null} = {}) {
    // Callers that grade a whole catalog page resolve the entitlement once;
    // resolving it per card also rewrites the local trial file per card.
    const resolved = entitlement ?? this.entitlement();
    if (canUseSkin(resolved, skin, {custom})) return Object.freeze({allowed: true, mode: 'owned'});
    return Object.freeze({allowed: false, mode: 'denied'});
  }

  catalogAccessCard(card, entitlement = null) {
    if (card.tier !== 'vip') return {...card, vipTrialState: null};
    const access = this.skinAccess(card, {entitlement});
    return {...card, vipTrialState: access.mode};
  }

  rememberProductRedemptionSkins(catalog) {
    const redemptionSkins = [...new Map(catalog
      .filter((skin) => skin.tier === 'vip')
      .map((skin) => [skin.id, {id: skin.id, name: skin.name, tier: skin.tier}])).values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .map((skin) => Object.freeze(skin));
    if (redemptionSkins.length) {
      this.productRedemptionSkins = Object.freeze(redemptionSkins);
    }
    return this.productRedemptionSkins;
  }

  refreshProductRedemptionSkins() {
    if (this.productRedemptionSkinsRefresh) return this.productRedemptionSkinsRefresh;
    // `catalogSkins()` performs bounded but non-trivial synchronous card
    // materialization before its first await. Start it on the next event-loop
    // turn so /api/products can flush its immutable local cards first.
    const refresh = new Promise((resolve) => setImmediate(resolve))
      .then(() => this.catalogSkins('codex'))
      .then((catalog) => this.rememberProductRedemptionSkins(catalog))
      .catch((error) => {
        this.addLog('warning', `兑换目录暂时使用本地缓存：${error.message}`);
        return this.productRedemptionSkins;
      })
      .finally(() => {
        if (this.productRedemptionSkinsRefresh === refresh) {
          this.productRedemptionSkinsRefresh = null;
        }
      });
    this.productRedemptionSkinsRefresh = refresh;
    return refresh;
  }

  async productCatalogPayload({waitForRedemptionRefresh = false} = {}) {
    if (waitForRedemptionRefresh) {
      await this.refreshProductRedemptionSkins();
    } else {
      // Deliberately detached from the response path. Product cards and their
      // signed checkout URLs are already immutable local release metadata.
      void this.refreshProductRedemptionSkins();
    }
    return {...this.products, redemptionSkins: this.productRedemptionSkins};
  }

  async catalogSkins(clientId, {refresh = 'automatic'} = {}) {
    const normalizedClientId = validClientId(clientId);
    if (!['automatic', 'manual'].includes(refresh)) throw new Error('模板同步模式不合法');
    const legacy = normalizedClientId === 'doubao' ? [] : listBuiltInSkins({clientId: normalizedClientId});
    const legacyCards = legacy.map((skin) => {
      // Reuse the exact materializer used at apply time.  This both verifies
      // the bundled artwork digest and avoids presenting a preview that could
      // diverge from the skin actually launched into the target Agent.
      const previewProfile = skin.asset
        ? materializeCatalogProfile(skin, {clientId: normalizedClientId})
        : null;
      return {
        schemaVersion: skin.schemaVersion,
        kind: 'legacy-v1',
        id: skin.id,
        name: skin.name,
        description: skin.description,
        tier: skin.tier,
        clientIds: skin.clientIds,
        preview: skin.preview,
        previewArtwork: previewProfile?.advanced.background.image ?? null,
        hasArtwork: Boolean(skin.asset),
        hasProjectHero: Boolean(skin.projectHeroAsset),
        hasComposerAvatar: Boolean(skin.composerAvatarAsset),
        hasBrand: Boolean(skin.profile.advanced.brand?.enabled),
        // Legacy catalog validation forbids a Banner payload. Keep the
        // response shape identical to Theme Pack cards so the native UI never
        // needs to infer a missing feature as an effective one.
        hasBanner: false,
        colors: {
          accent: skin.profile.official.accent,
          surface: skin.profile.official.surface,
          ink: skin.profile.official.ink,
        },
        runtimeStatus: 'available',
        applySupported: true,
        designPreview: false,
      };
    });
    const bundledCards = [...legacyCards, ...this.themePackCards(normalizedClientId)];
    let cards;
    try {
      const remoteCards = await listRemoteThemeCatalogCards(normalizedClientId, {
        dataDir: this.dataDir,
        refresh,
      });
      const remoteIds = new Set(remoteCards.map(({id}) => id));
      cards = [...bundledCards.filter(({id}) => !remoteIds.has(id)), ...remoteCards];
    } catch (error) {
      this.addLog('warning', `GitHub 皮肤目录暂不可用，已回退本地目录：${error.message}`);
      cards = bundledCards.map((card) => ({
        ...card,
        installed: true,
        updateAvailable: false,
        distribution: 'bundled-fallback',
      }));
    }
    const entitlement = this.entitlement();
    return cards.map((card) => this.catalogAccessCard(card, entitlement));
  }

  themePackCards(clientId) {
    const identity = themePackIndexIdentity();
    const cached = this.themePackCardCache;
    if (identity !== null && cached?.identity === identity && cached.clientId === clientId) {
      return cached.cards;
    }
    const cards = Object.freeze(listRegisteredThemePacks({clientId})
      .map((pack) => themePackCatalogCard(pack, clientId)));
    this.themePackCardCache = identity === null ? null : {clientId, identity, cards};
    return cards;
  }

  resolveSkin(skinId, clientId) {
    const remote = resolveInstalledRemoteSkin(skinId, clientId, {dataDir: this.dataDir});
    if (remote) {
      return {
        ...remote,
        profile: mergeFreeBrandOverride(remote.profile, loadFreeBrand(this.dataDir), {clientId}),
      };
    }
    const builtIn = getBuiltInSkin(skinId, {clientId});
    if (builtIn) {
      const profile = materializeCatalogProfile(builtIn, {clientId});
      return {
        profile: mergeFreeBrandOverride(profile, loadFreeBrand(this.dataDir), {clientId}),
        skin: builtIn,
        custom: false,
      };
    }
    const themePack = getRegisteredThemePack(skinId, {clientId});
    if (themePack) {
      const profile = materializeThemePack(themePack, clientId);
      return {
        profile: mergeFreeBrandOverride(profile, loadFreeBrand(this.dataDir), {clientId}),
        skin: themePack,
        custom: false,
        profileKind: 'theme-pack',
        themePack,
      };
    }
    const unionProfile = getUnionProfile(skinId, this.dataDir);
    if (unionProfile) {
      if (unionProfile.targetClientId !== clientId) return null;
      const legacy = unionProfileToLegacyV1(unionProfile, clientId);
      return {
        profile: mergeFreeBrandOverride(legacy, loadFreeBrand(this.dataDir), {clientId}),
        skin: {id: unionProfile.id, name: unionProfile.name, tier: 'vip'},
        custom: true,
        profileKind: 'union',
        unionProfile,
      };
    }
    const profile = getProfile(skinId, this.dataDir);
    if (!profile) return null;
    return {
      profile: mergeFreeBrandOverride(profile, loadFreeBrand(this.dataDir), {clientId}),
      skin: {id: profile.id, name: profile.name, tier: 'vip'},
      custom: true,
    };
  }

  scheduleApplyIntentKey({clientId, skinId, dateKey}) {
    return `${clientId}\u0000${dateKey}\u0000${skinId}`;
  }

  cleanupScheduleApplyIntents(now = Date.now()) {
    for (const [intentId, prepared] of this.scheduleApplyIntents) {
      if (prepared.expiresAtMs <= now) this.clearScheduleApplyIntent(intentId);
    }
  }

  clearScheduleApplyIntent(intentId) {
    const prepared = this.scheduleApplyIntents.get(intentId) ?? null;
    if (!prepared) return null;
    this.scheduleApplyIntents.delete(intentId);
    if (this.scheduleApplyIntentByReminder.get(prepared.key) === intentId) {
      this.scheduleApplyIntentByReminder.delete(prepared.key);
    }
    return prepared;
  }

  existingScheduleApplyIntent(reminder) {
    this.cleanupScheduleApplyIntents();
    const key = this.scheduleApplyIntentKey(reminder);
    const intentId = this.scheduleApplyIntentByReminder.get(key);
    if (!intentId) return null;
    return this.scheduleApplyIntents.get(intentId)?.intent ?? null;
  }

  cancelScheduleApplyIntent(reminder) {
    const intent = this.existingScheduleApplyIntent(reminder);
    if (!intent) return false;
    this.applyIntents.cancel(intent.id);
    this.clearScheduleApplyIntent(intent.id);
    return true;
  }

  rememberScheduleApplyIntent(intent, reminder) {
    const expiresAtMs = Date.parse(intent.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      throw new Error('排程确认票据过期时间无效');
    }
    const key = this.scheduleApplyIntentKey(reminder);
    const prepared = Object.freeze({
      key,
      clientId: reminder.clientId,
      skinId: reminder.skinId,
      dateKey: reminder.dateKey,
      expiresAtMs,
      intent,
    });
    this.scheduleApplyIntents.set(intent.id, prepared);
    this.scheduleApplyIntentByReminder.set(key, intent.id);
    return intent;
  }

  currentReminderForSkin(clientId, skinId) {
    const result = evaluateLaunchReminder(
      loadWeeklySchedule(this.dataDir),
      loadScheduleState(this.dataDir),
      {clientId},
    );
    if (!result.shouldRemind || result.skinId !== skinId) return null;
    return Object.freeze({clientId, skinId, dateKey: result.dateKey});
  }

  createApplyIntent({
    clientId,
    skinId = null,
    operation,
    scheduleReminder = null,
    reuseScheduleReminder = false,
  } = {}) {
    const normalizedClientId = validClientId(clientId);
    if (!['apply', 'restore'].includes(operation)) throw new Error('未知的皮肤操作');
    this.refreshDoctor({fresh: true, clientId: normalizedClientId});
    const {app, compatibility} = this.clientRecord(normalizedClientId);
    if (!app?.safeToLaunch) throw new Error(`未找到经过官方签名验证的 ${CLIENT_LABELS[normalizedClientId]}`);

    let resolved = null;
    let normalizedSkinId = 'official-stock';
    let custom = false;
    if (operation === 'apply') {
      normalizedSkinId = String(skinId ?? '');
      resolved = this.resolveSkin(normalizedSkinId, normalizedClientId);
      if (!resolved) throw new Error('找不到皮肤');
      const access = this.skinAccess(resolved.skin, {custom: resolved.custom});
      if (!access.allowed) {
        throw vipRequired('这套皮肤需要有效 VIP、该皮肤的购买/兑换授权，或匹配的自定义位授权');
      }
      if (!compatibility.advancedAllowed) throw new Error(compatibility.reason);
      if (normalizedClientId === 'codex' && !app.codeThemeIds?.includes(resolved.profile.official.codeThemeId)) {
        throw new Error(`当前 Codex 不支持代码主题：${resolved.profile.official.codeThemeId}`);
      }
      custom = resolved.custom;
    }

    let boundReminder = scheduleReminder;
    if (boundReminder !== null) {
      if (operation !== 'apply' || boundReminder.clientId !== normalizedClientId ||
          boundReminder.skinId !== normalizedSkinId || typeof boundReminder.dateKey !== 'string') {
        throw new Error('排程确认票据与待应用皮肤不匹配');
      }
      const existing = this.existingScheduleApplyIntent(boundReminder);
      if (existing) return existing;
    } else if (reuseScheduleReminder && operation === 'apply') {
      // Backward compatibility only: an older native menu bar asks for a
      // second intent after it has already made the schedule decision. Never
      // turn an unrelated manual apply into a scheduled reminder claim.
      const currentReminder = this.currentReminderForSkin(normalizedClientId, normalizedSkinId);
      if (currentReminder) {
        const existing = this.existingScheduleApplyIntent(currentReminder);
        if (existing) return existing;
      }
    }

    const observed = observedProcesses(app);
    const intent = this.applyIntents.create({
      clientId: normalizedClientId,
      skinId: normalizedSkinId,
      profile: custom ? {} : undefined,
      appFingerprint: app.fingerprint,
      operation,
      impact: {
        requiresRestart: true,
        targetRunning: observed.error ? true : observed.processes.length > 0,
        message: operation === 'apply'
          ? `${CLIENT_LABELS[normalizedClientId]} 将正常退出并重新打开；此皮肤已锁定为${resolved.profile.official.variant === 'light' ? '浅色' : '深色'}模式，皮肤生效期间请勿在 Agent 内切换浅色/深色外观。`
          : `${CLIENT_LABELS[normalizedClientId]} 将正常退出并重新打开，并恢复 Agent 官方外观。`,
      },
    });
    return boundReminder === null ? intent : this.rememberScheduleApplyIntent(intent, boundReminder);
  }

  persistReminderSnooze(reminder, minutes) {
    const schedule = loadWeeklySchedule(this.dataDir);
    const result = snoozeLaunchReminder(schedule, {
      clientId: reminder.clientId,
      expectedSkinId: reminder.skinId,
      expectedDateKey: reminder.dateKey,
      until: Date.now() + minutes * 60 * 1000,
      dataDir: this.dataDir,
    });
    return result.snoozed;
  }

  completeScheduledApply(prepared) {
    try {
      const result = claimSuccessfulScheduleApply(loadWeeklySchedule(this.dataDir), {
        clientId: prepared.clientId,
        skinId: prepared.skinId,
        dateKey: prepared.dateKey,
        dataDir: this.dataDir,
      });
      if (!result.claimed) {
        this.addLog('info', `${CLIENT_LABELS[prepared.clientId]} 已应用排程皮肤；当天提醒未认领（排程已变更或已处理）`);
      }
      return result;
    } catch (error) {
      // Launch already succeeded.  Keeping the reminder is safer than turning
      // a durable-state write failure into a false “not applied” response.
      this.addLog('error', `${CLIENT_LABELS[prepared.clientId]} 已应用排程皮肤，但提醒状态未写入：${error.message}`);
      return null;
    }
  }

  reminderPayloads({observedByClient = null} = {}) {
    const entitlement = this.entitlement();
    if (!canUseFeature(entitlement, 'weeklySchedule')) return [];
    const schedule = loadWeeklySchedule(this.dataDir);
    const state = loadScheduleState(this.dataDir);
    const now = new Date();
    return SCHEDULE_CLIENT_IDS.flatMap((clientId) => {
      const record = this.clientRecord(clientId);
      if (!record.app || record.compatibility.advancedAllowed !== true) return [];
      const observed = observedByClient?.get(clientId) ?? observedProcesses(record.app);
      if (!observed.processes.length) return [];
      const result = evaluateLaunchReminder(schedule, state, {clientId, now});
      if (!result.shouldRemind) return [];
      const resolved = this.resolveSkin(result.skinId, clientId);
      // A paid custom slot is a real skin, not a second-class preview.  Its
      // exact profileId still goes through the same entitlement gate as a
      // manual apply, so it can participate in the user's weekly rotation.
      if (!canUseScheduledSkin(entitlement, resolved)) return [];
      return [{
        clientId,
        clientName: CLIENT_LABELS[clientId],
        skinId: resolved.skin.id,
        skinName: resolved.skin.name,
        dateKey: result.dateKey,
      }];
    });
  }

  async backgroundReminderTick() {
    if (this.nativeReminderInFlight || Date.now() - this.dashboardLastSeenAt < 30000) return;
    const reminder = this.reminderPayloads()[0];
    if (!reminder) return;
    this.nativeReminderInFlight = true;
    try {
      const action = await nativeSchedulePrompt(reminder);
      if (action === 'snooze') {
        if (this.persistReminderSnooze(reminder, 60)) {
          this.addLog('info', `${reminder.clientName} 自动换肤提醒已延后 1 小时`);
        }
      } else if (action === 'skip') {
        claimLaunchReminder(loadWeeklySchedule(this.dataDir), {
          clientId: reminder.clientId,
          expectedSkinId: reminder.skinId,
          expectedDateKey: reminder.dateKey,
          dataDir: this.dataDir,
        });
        this.addLog('info', `${reminder.clientName} 今日自动换肤已跳过`);
      } else if (action === 'open') {
        await openMenuBarApp();
      } else {
        this.persistReminderSnooze(reminder, 15);
      }
    } finally {
      this.nativeReminderInFlight = false;
    }
  }

  async backgroundLicenseRefreshTick() {
    if (typeof this.commerceBridge.refresh !== 'function') return;
    try {
      await this.commerceBridge.refresh();
    } catch (error) {
      // 未存授权码、钥匙串不可用都是常态，不写日志噪声；其余失败记一行即可，
      // 本机权益的最终判定仍由授权记录自身的离线窗口负责。
      if (['LICENSE_KEY_NOT_STORED', 'KEYCHAIN_UNAVAILABLE'].includes(error?.code)) return;
      this.addLog('warning', `后台授权续验失败：${error.message}`);
    }
  }

  scheduleLicenseRefresh() {
    // 在途的一次续验完成得比 shutdown 晚时，这个标志保证它不会再排下一次。
    if (this.licenseRefreshStopped) return;
    if (this.licenseRefreshTimer) clearTimeout(this.licenseRefreshTimer);
    const delay = LICENSE_REFRESH_INTERVAL_MS + Math.floor(Math.random() * LICENSE_REFRESH_JITTER_MS);
    this.licenseRefreshTimer = setTimeout(() => {
      this.licenseRefreshTimer = null;
      // 成败都排下一次：网络故障不该让后台续验就此停摆。
      this.backgroundLicenseRefreshTick()
        .finally(() => this.scheduleLicenseRefresh())
        .catch(() => {});
    }, delay);
    // 与换肤提醒定时器一致：unref 让它既不吊住进程，也不拖住测试退出。
    this.licenseRefreshTimer.unref?.();
  }

  statusPayload() {
    // One `ps` scan per client per payload: the reminder projection below
    // reuses these observations instead of scanning the process table again.
    const observedByClient = new Map();
    const clients = Object.fromEntries(CLIENT_IDS.map((clientId) => {
      const {app, compatibility} = this.clientRecord(clientId);
      const observed = observedProcesses(app);
      observedByClient.set(clientId, observed);
      const processes = observed.processes;
      return [clientId, {
        clientId,
        displayName: CLIENT_LABELS[clientId],
        installed: Boolean(app),
        path: app?.path ?? null,
        bundleId: app?.bundleId ?? null,
        version: app?.version ?? null,
        build: app?.build ?? null,
        chromium: app?.chromium ?? null,
        teamId: app?.teamId ?? null,
        signatureValid: app?.signatureValid ?? false,
        trustedPublisher: app?.trustedPublisher ?? false,
        cdHash: app?.cdHash ?? null,
        asarSha256: app?.asarSha256 ?? null,
        manifestCommit: app?.manifestCommit ?? null,
        chromiumFrameworkVersion: app?.chromiumFrameworkVersion ?? null,
        nestedBrowser: app?.nestedBrowser ? {
          path: app.nestedBrowser.path,
          bundleId: app.nestedBrowser.bundleId,
          teamId: app.nestedBrowser.teamId,
          cdHash: app.nestedBrowser.cdHash,
          signatureValid: app.nestedBrowser.signatureValid,
          trustedPublisher: app.nestedBrowser.trustedPublisher,
        } : null,
        localExtension: app?.localExtension ? {
          id: app.localExtension.id,
          version: app.localExtension.version,
          entryUrl: app.localExtension.entryUrl,
          designTokensRelativePath: app.localExtension.designTokensRelativePath,
        } : null,
        artifactSha256: app?.artifactSha256 ?? null,
        targetAllowlist: app?.targetAllowlist ?? [],
        transportVerification: app?.transportVerification ?? null,
        launchStrategies: app?.launchStrategies ?? [],
        signals: app?.signals ?? null,
        scanError: app?.error ?? null,
        running: processes.length > 0,
        debugTransport: processes[0]?.debugTransport ?? null,
        processScanError: observed.error,
        compatibility,
        capabilities: capabilitiesForCompatibility(compatibility),
        session: this.managers.get(clientId).status(),
      }];
    }));
    const codex = clients.codex;
    return {
      ok: true,
      studio: {
        version: '2.3.18',
        transportPreference: 'pipe-or-exact-loopback',
        instanceId: this.instanceId,
        runtimeIdentity: this.runtimeIdentity,
      },
      clients,
      entitlement: this.publicEntitlement(),
      loginAgent: this.loginAgentStatus(),
      reminders: this.reminderPayloads({observedByClient}),
      app: codex.installed ? codex : null,
      compatibility: codex.compatibility,
      session: codex.session,
      safety: {
        dashboardHost: this.host,
        authenticatedApi: true,
        arbitraryJavaScriptAccepted: false,
        remoteAssetsAccepted: false,
        tcpFallbackAccepted: false,
        doubaoInternalPort49853Accepted: false,
        doubaoLoopbackFallbackImplemented: true,
        doubaoLoopbackPolicy: 'random-high-port-127.0.0.1-exact-adapter-only',
        appPackageModified: false,
        launchesOnDashboardOpen: false,
        silentRestartAccepted: false,
      },
    };
  }

  authenticated(request) {
    const header = request.headers.authorization;
    const alternate = request.headers['x-codex-skin-token'];
    const supplied = header?.startsWith('Bearer ') ? header.slice(7) : alternate;
    if (!supplied) return false;
    const suppliedBuffer = Buffer.from(supplied);
    const tokenBuffer = Buffer.from(this.token);
    if (suppliedBuffer.length !== tokenBuffer.length) return false;
    return crypto.timingSafeEqual(suppliedBuffer, tokenBuffer);
  }

  validOrigin(request) {
    const host = request.headers.host;
    if (host !== `${this.host}:${this.port}`) return false;
    const origin = request.headers.origin;
    return !origin || origin === `http://${this.host}:${this.port}`;
  }

  async api(request, response, url) {
    if (!this.validOrigin(request)) return sendJson(response, 403, {ok: false, error: 'Host 或 Origin 校验失败'});
    if (!this.authenticated(request)) return sendJson(response, 401, {ok: false, error: '本地会话令牌无效'});
    try {
      if (request.method === 'GET' && url.pathname === '/api/status') {
        this.dashboardLastSeenAt = Date.now();
        return sendJson(response, 200, this.statusPayload());
      }
      if (request.method === 'POST' && url.pathname === '/api/doctor/refresh') {
        const body = await readJson(request);
        return sendJson(response, 200, this.refreshDoctor({fresh: true, clientId: body.clientId ?? null}));
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog') {
        const clientId = validClientId(url.searchParams.get('clientId') || 'codex');
        const refresh = url.searchParams.get('refresh') || 'automatic';
        const skins = await this.catalogSkins(clientId, {refresh});
        if (clientId === 'codex') this.rememberProductRedemptionSkins(skins);
        const responseSkins = catalogCardsForResponse(
          skins,
          url.searchParams.get('artwork') || 'full',
        );
        return sendJson(response, 200, {ok: true, clientId, skins: responseSkins});
      }
      if (request.method === 'POST' && url.pathname === '/api/catalog/install') {
        const body = await readJson(request);
        const clientId = validClientId(body.clientId || 'codex');
        // Installing over a local ID would permanently shadow the user's own
        // saved skin, including a paid custom slot bound to that exact ID.
        if (getUnionProfile(body.skinId, this.dataDir) || getProfile(body.skinId, this.dataDir)) {
          throw new Error('该 ID 已被本机自定义皮肤占用；请先改名或删除后再安装 GitHub 皮肤');
        }
        const receipt = await installRemoteThemeSkin(body.skinId, {dataDir: this.dataDir});
        this.addLog('success', `已从 GitHub 安装皮肤：${receipt.id} ${receipt.version}`);
        const skins = await this.catalogSkins(clientId);
        const responseSkins = catalogCardsForResponse(
          skins,
          url.searchParams.get('artwork') || 'full',
        );
        return sendJson(response, 200, {ok: true, clientId, receipt, skins: responseSkins});
      }
      if (request.method === 'GET' && url.pathname === '/api/capability-schema') {
        const clientId = validClientId(url.searchParams.get('clientId'));
        const profileId = url.searchParams.get('profileId');
        const profile = profileId ? getUnionProfile(profileId, this.dataDir) : null;
        if (profileId && !profile) return sendJson(response, 404, {ok: false, error: '找不到并集方案'});
        if (profile && profile.targetClientId !== clientId) {
          throw new Error('并集方案与请求的客户端不匹配');
        }
        const editorFields = getEditorFieldsForClient(clientId, {profile: profile ?? {}});
        return sendJson(response, 200, {
          ok: true,
          schemaVersion: UNION_SCHEMA_VERSION,
          clientIds: UNION_CLIENT_IDS,
          clientId,
          fields: UNION_FIELDS,
          capabilityMap: getClientCapabilityMap(clientId),
          editorProjection: {
            profileId: profile?.id ?? null,
            targetClientId: clientId,
            fields: editorFields,
          },
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/union-profiles') {
        const filterClientId = url.searchParams.has('clientId')
          ? validClientId(url.searchParams.get('clientId'))
          : null;
        const profiles = listUnionProfiles(this.dataDir)
          .filter((profile) => !filterClientId || profile.targetClientId === filterClientId);
        return sendJson(response, 200, {ok: true, clientId: filterClientId, profiles});
      }
      const codexOfficialThemeMatch = url.pathname.match(
        /^\/api\/union-profiles\/([a-z0-9][a-z0-9-]{0,47})\/codex-official-theme$/u,
      );
      if (request.method === 'GET' && codexOfficialThemeMatch) {
        // Authentication and Origin checks above apply to this local-only
        // export route just as they do to every other /api endpoint.
        return sendJson(response, 200, this.exportCodexOfficialTheme(codexOfficialThemeMatch[1]));
      }
      if (request.method === 'POST' && url.pathname === '/api/union-profiles') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('并集方案请求必须是对象');
        let input = body;
        if (Object.hasOwn(body, 'profile')) {
          const unknown = Object.keys(body).filter((key) => key !== 'profile');
          if (unknown.length) throw new Error(`并集方案请求包含未允许字段：${unknown.join(', ')}`);
          input = body.profile;
        }
        const requestedId = typeof input?.id === 'string' ? input.id : '';
        const entitlement = this.entitlement();
        if (!canPersistUnionProfile(entitlement, requestedId)) {
          throw vipRequired('保存并集方案需要有效 VIP，或与该固定 profileId 绑定的自定义位授权');
        }
        const profile = normalizeUnionProfileRecord(input);
        const capabilityMap = getClientCapabilityMap(profile.targetClientId);
        if (capabilityMap.runtimeStatus !== 'available') {
          throw new Error(`${CLIENT_LABELS[profile.targetClientId]} 尚未完成运行时适配；可在编辑器中本地预览，但不能占用永久自定义位保存`);
        }
        if (getBuiltInSkin(profile.id) || getRegisteredThemePack(profile.id)) {
          throw new Error('并集方案 ID 不能与内置皮肤重复');
        }
        // Skin resolution prefers an installed remote skin, so an overlapping
        // ID would silently apply GitHub content in place of this profile.
        if (getInstalledRemoteSkin(profile.id, {dataDir: this.dataDir})) {
          throw new Error('并集方案 ID 不能与已安装的 GitHub 皮肤重复');
        }
        if (getProfile(profile.id, this.dataDir)) throw new Error('并集方案 ID 不能与旧版自定义皮肤重复');
        if (getUnionProfileDraft(profile.id, this.dataDir)) {
          throw new Error('并集方案 ID 已被仅设计草稿占用；请在完成运行时适配后使用草稿提升流程');
        }
        const existing = getUnionProfile(profile.id, this.dataDir);
        if (existing && existing.targetClientId !== profile.targetClientId) {
          throw new Error('已保存的自定义皮肤已绑定目标 Agent，不能用同一 profileId 改作另一套皮肤');
        }
        const existed = Boolean(existing);
        const saved = saveUnionProfile(profile, this.dataDir);
        this.addLog('success', `${existed ? '已更新' : '已创建'}并集方案：${saved.name}`);
        return sendJson(response, 200, {ok: true, created: !existed, profile: saved});
      }
      if (request.method === 'GET' && url.pathname === '/api/union-profile-drafts') {
        const filterClientId = url.searchParams.has('clientId')
          ? validClientId(url.searchParams.get('clientId'))
          : null;
        const profiles = listUnionProfileDrafts(this.dataDir)
          .filter((profile) => !filterClientId || profile.targetClientId === filterClientId);
        return sendJson(response, 200, {
          ok: true,
          clientId: filterClientId,
          draftOnly: true,
          profiles,
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/union-profile-drafts') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('并集草稿请求必须是对象');
        let input = body;
        if (Object.hasOwn(body, 'profile')) {
          const unknown = Object.keys(body).filter((key) => key !== 'profile');
          if (unknown.length) throw new Error(`并集草稿请求包含未允许字段：${unknown.join(', ')}`);
          input = body.profile;
        }
        const requestedId = typeof input?.id === 'string' ? input.id : '';
        const entitlement = this.entitlement();
        if (!canPersistUnionProfile(entitlement, requestedId)) {
          throw vipRequired('保存设计草稿需要有效 VIP，或与该固定 profileId 绑定的自定义位授权');
        }
        const profile = normalizeUnionProfileRecord(input);
        const capabilityMap = getClientCapabilityMap(profile.targetClientId);
        if (capabilityMap.runtimeStatus !== 'blocked') {
          if (capabilityMap.runtimeStatus === 'available') {
            throw new Error(`${CLIENT_LABELS[profile.targetClientId]} 已可安全应用；请保存为可执行自定义皮肤`);
          }
          throw new Error(`${CLIENT_LABELS[profile.targetClientId]} 当前能力状态不允许保存设计草稿`);
        }
        if (getBuiltInSkin(profile.id) || getRegisteredThemePack(profile.id)) {
          throw new Error('并集草稿 ID 不能与内置皮肤重复');
        }
        if (getProfile(profile.id, this.dataDir)) throw new Error('并集草稿 ID 不能与旧版自定义皮肤重复');
        if (getUnionProfile(profile.id, this.dataDir)) {
          throw new Error('并集草稿 ID 不能与可执行并集方案重复');
        }
        const existing = getUnionProfileDraft(profile.id, this.dataDir);
        if (existing && existing.targetClientId !== profile.targetClientId) {
          throw new Error('已保存的设计草稿已绑定目标 Agent，不能用同一 profileId 改作另一套皮肤');
        }
        const existed = Boolean(existing);
        const saved = saveUnionProfileDraft(profile, this.dataDir);
        this.addLog('success', `${existed ? '已更新' : '已保存'} ${CLIENT_LABELS[profile.targetClientId]} 仅设计草稿：${saved.name}`);
        return sendJson(response, 200, {ok: true, created: !existed, draftOnly: true, profile: saved});
      }
      const draftPromotionMatch = url.pathname.match(/^\/api\/union-profile-drafts\/([a-z0-9][a-z0-9-]{0,47})\/promote$/u);
      if (request.method === 'POST' && draftPromotionMatch) {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).length !== 1 || body.confirm !== true) {
          throw new Error('提升设计草稿必须显式确认');
        }
        const draft = getUnionProfileDraft(draftPromotionMatch[1], this.dataDir);
        if (!draft) return sendJson(response, 404, {ok: false, error: '找不到仅设计草稿'});
        if (!canPersistUnionProfile(this.entitlement(), draft.id)) {
          throw vipRequired('提升设计草稿需要有效 VIP，或与该固定 profileId 绑定的自定义位授权');
        }
        const capabilityMap = getClientCapabilityMap(draft.targetClientId);
        if (capabilityMap.runtimeStatus !== 'available') {
          const error = new Error(`${CLIENT_LABELS[draft.targetClientId]} 尚未完成运行时适配；草稿不能提升为可执行皮肤`);
          error.code = 'DRAFT_PROMOTION_UNAVAILABLE';
          throw error;
        }
        if (getBuiltInSkin(draft.id) || getRegisteredThemePack(draft.id) ||
            getProfile(draft.id, this.dataDir) || getUnionProfile(draft.id, this.dataDir) ||
            getInstalledRemoteSkin(draft.id, {dataDir: this.dataDir})) {
          throw new Error('设计草稿 ID 已与现有皮肤冲突，不能提升');
        }
        const saved = promoteUnionProfileDraft(draft.id, this.dataDir);
        if (!saved) throw new Error('设计草稿在提升期间已被移除');
        this.addLog('success', `已将 ${CLIENT_LABELS[draft.targetClientId]} 设计草稿提升为可执行皮肤：${saved.name}`);
        return sendJson(response, 200, {ok: true, promoted: true, draftOnly: false, profile: saved});
      }
      if (request.method === 'GET' && url.pathname === '/api/products') {
        return sendJson(response, 200, {ok: true, ...await this.productCatalogPayload()});
      }
      if (request.method === 'GET' && url.pathname === '/api/free-brand') {
        const clientId = url.searchParams.get('clientId') || 'workbuddy';
        if (clientId !== 'workbuddy') throw new Error('免费品牌覆盖目前仅支持 WorkBuddy');
        return sendJson(response, 200, {ok: true, clientId, freeBrand: loadFreeBrand(this.dataDir)});
      }
      if (request.method === 'POST' && url.pathname === '/api/free-brand') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('免费品牌请求必须是对象');
        let input = body;
        if (Object.hasOwn(body, 'freeBrand')) {
          const unknown = Object.keys(body).filter((key) => !['clientId', 'freeBrand'].includes(key));
          if (unknown.length) throw new Error(`免费品牌请求包含未允许字段：${unknown.join(', ')}`);
          input = body.freeBrand;
        }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('免费品牌配置必须是对象');
        const clientId = body.clientId ?? input.clientId ?? 'workbuddy';
        if (clientId !== 'workbuddy') throw new Error('免费品牌覆盖目前仅支持 WorkBuddy');
        const brandInput = {...input};
        delete brandInput.clientId;
        const freeBrand = saveFreeBrand(brandInput, this.dataDir);
        this.addLog('success', freeBrand.displayName || freeBrand.tagline || freeBrand.iconImage ||
          freeBrand.composerAvatarImage || freeBrand.composerAvatarMotion ||
          freeBrand.codexHomeTitle || freeBrand.doubaoHomeTitle ||
          freeBrand.workbuddyHomeTitle
          ? '已保存免费图标、机器人与首页文案覆盖；重新应用对应客户端皮肤后生效'
          : '已清除免费外观覆盖');
        return sendJson(response, 200, {ok: true, clientId, freeBrand});
      }
      if (request.method === 'GET' && url.pathname === '/api/entitlement') {
        return sendJson(response, 200, {ok: true, entitlement: this.publicEntitlement()});
      }
      if (request.method === 'GET' && url.pathname === '/api/login-agent') {
        return sendJson(response, 200, {ok: true, loginAgent: this.loginAgentStatus()});
      }
      if (request.method === 'POST' && url.pathname === '/api/login-agent') {
        const body = await readJson(request);
        if (!['install', 'remove'].includes(body.action)) throw new Error('未知的登录提醒操作');
        if (body.action === 'install' && !canUseFeature(this.entitlement(), 'loginReminder')) {
          const error = new Error('随登录启动提醒服务需要有效 VIP');
          error.code = 'VIP_REQUIRED';
          throw error;
        }
        const loginAgent = body.action === 'install'
          ? installLoginAgent(this.loginAgentOptions ?? {})
          : removeLoginAgent(this.loginAgentOptions ?? {});
        this.addLog('success', body.action === 'install'
          ? '已开启随登录启动菜单栏应用；将在下次登录时生效'
          : '已关闭随登录启动菜单栏应用；下次登录不再启动');
        return sendJson(response, 200, {ok: true, loginAgent});
      }
      if (request.method === 'POST' && [
        '/api/license/activate',
        '/api/entitlements/activate',
        '/api/entitlements/redeem',
      ].includes(url.pathname)) {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('授权请求必须是对象');
        const unknown = Object.keys(body).filter((key) => !['code', 'skinId'].includes(key));
        if (unknown.length) throw new Error('授权请求包含未允许字段');
        const skinId = body.skinId === undefined || body.skinId === null || body.skinId === ''
          ? null
          : body.skinId;
        const productCatalog = await this.productCatalogPayload({waitForRedemptionRefresh: true});
        if (skinId !== null && !productCatalog.redemptionSkins.some((skin) => skin.id === skinId)) {
          const error = new Error('所选皮肤不在正式可单卖付费皮肤目录中');
          error.code = 'SKIN_SELECTION_INVALID';
          throw error;
        }
        await this.commerceBridge.redeem({licenseKey: body.code, skinId});
        this.commerceInitializationError = null;
        this.discardLegacyLicenseFile();
        const entitlement = this.entitlement();
        if (!hasVerifiedLicenseAfterCommerceSync(entitlement)) {
          throw new Error('已验签租约未能加载；未授予权益');
        }
        this.addLog('success', `可信授权已同步：${entitlement.license.licenseId}`);
        return sendJson(response, 200, {ok: true, entitlement: this.publicEntitlement()});
      }
      if (request.method === 'POST' && ['/api/license/refresh', '/api/entitlements/refresh'].includes(url.pathname)) {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
          throw new Error('刷新租约不接受参数');
        }
        await this.commerceBridge.refresh();
        const entitlement = this.entitlement();
        if (!hasVerifiedLicenseAfterCommerceSync(entitlement)) {
          throw new Error('刷新后的租约未能加载；未授予权益');
        }
        this.addLog('success', `权益租约已刷新：${entitlement.license.licenseId}`);
        return sendJson(response, 200, {ok: true, entitlement: this.publicEntitlement()});
      }
      if (request.method === 'POST' && ['/api/license/deactivate', '/api/entitlements/deactivate'].includes(url.pathname)) {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
          throw new Error('停用设备不接受参数');
        }
        const result = await this.commerceBridge.deactivate();
        this.discardLegacyLicenseFile();
        this.addLog('info', `已通过可信服务停用本机授权（${result.deactivated} 项）`);
        return sendJson(response, 200, {
          ok: true,
          deactivated: result.deactivated,
          entitlement: this.publicEntitlement(),
        });
      }
      if (request.method === 'POST' && ['/api/license/remove', '/api/entitlements/remove'].includes(url.pathname)) {
        await readJson(request);
        await this.commerceBridge.purgeLocal();
        this.discardLegacyLicenseFile();
        this.addLog('info', '已清除本机授权缓存；未改变服务端永久绑定');
        return sendJson(response, 200, {ok: true, entitlement: this.publicEntitlement()});
      }
      if (request.method === 'GET' && url.pathname === '/api/schedule') {
        return sendJson(response, 200, {ok: true, schedule: loadWeeklySchedule(this.dataDir)});
      }
      if (request.method === 'POST' && url.pathname === '/api/schedule') {
        const entitlement = this.entitlement();
        if (!canUseFeature(entitlement, 'weeklySchedule')) throw vipRequired('保存七日排程需要有效 VIP');
        const body = await readJson(request);
        for (const clientId of SCHEDULE_CLIENT_IDS) {
          for (const skinId of Object.values(body.schedule?.clients?.[clientId] ?? {})) {
            if (!skinId) continue;
            const record = this.clientRecord(clientId);
            if (record.compatibility.advancedAllowed !== true) {
              throw new Error(`${CLIENT_LABELS[clientId]} 当前尚未通过安全换肤验证，不能安排自动切换`);
            }
            const resolved = this.resolveSkin(skinId, clientId);
            if (!resolved || !canUseSkin(entitlement, resolved.skin, {custom: resolved.custom})) {
              throw new Error(`排程包含不可用皮肤：${skinId}`);
            }
          }
        }
        const schedule = saveWeeklySchedule(body.schedule, this.dataDir);
        this.addLog('success', `已保存 ${SCHEDULE_CLIENT_IDS.map((id) => CLIENT_LABELS[id]).join(' / ')} 七日排程`);
        return sendJson(response, 200, {ok: true, schedule});
      }
      if (request.method === 'POST' && url.pathname === '/api/reminders/decision') {
        const entitlement = this.entitlement();
        if (!canUseFeature(entitlement, 'weeklySchedule')) throw vipRequired('自动换肤提醒需要有效 VIP');
        const body = await readJson(request);
        const clientId = validClientId(body.clientId);
        if (!['apply', 'skip', 'snooze'].includes(body.action)) throw new Error('未知提醒操作');
        const schedule = loadWeeklySchedule(this.dataDir);
        const result = evaluateLaunchReminder(schedule, loadScheduleState(this.dataDir), {clientId});
        if (!result.shouldRemind) throw new Error('今天没有待处理的换肤提醒');
        if (body.action === 'snooze') {
          const minutes = [30, 60, 120].includes(Number(body.minutes)) ? Number(body.minutes) : 60;
          const snoozed = snoozeLaunchReminder(schedule, {
            clientId,
            expectedSkinId: result.skinId,
            expectedDateKey: result.dateKey,
            until: Date.now() + minutes * 60 * 1000,
            dataDir: this.dataDir,
          });
          if (!snoozed.snoozed) throw new Error('提醒状态已变化，请刷新后重试');
          this.cancelScheduleApplyIntent({clientId, skinId: result.skinId, dateKey: result.dateKey});
          return sendJson(response, 200, {ok: true, action: 'snooze', minutes, skinId: result.skinId});
        }
        if (body.action === 'skip') {
          claimLaunchReminder(schedule, {
            clientId,
            expectedSkinId: result.skinId,
            expectedDateKey: result.dateKey,
            dataDir: this.dataDir,
          });
          this.cancelScheduleApplyIntent({clientId, skinId: result.skinId, dateKey: result.dateKey});
          this.addLog('info', `${CLIENT_LABELS[clientId]} 今日排程：用户选择跳过`);
          return sendJson(response, 200, {ok: true, action: 'skip', skinId: result.skinId});
        }
        // Choosing “apply” is intentionally preparation only.  Claiming here
        // would lose the day's reminder when the user cancels the restart
        // confirmation or the target launch fails.
        const intent = this.createApplyIntent({
          clientId,
          skinId: result.skinId,
          operation: 'apply',
          scheduleReminder: {clientId, skinId: result.skinId, dateKey: result.dateKey},
          reuseScheduleReminder: true,
        });
        this.addLog('info', `${CLIENT_LABELS[clientId]} 今日排程：等待用户确认切换`);
        return sendJson(response, 200, {ok: true, action: 'apply', skinId: result.skinId, intent});
      }
      if (request.method === 'GET' && url.pathname === '/api/profiles') {
        return sendJson(response, 200, {ok: true, profiles: listProfiles(this.dataDir)});
      }
      if (request.method === 'POST' && url.pathname === '/api/profiles') {
        const input = await readJson(request);
        if (getBuiltInSkin(input.id) || getRegisteredThemePack(input.id)) {
          throw new Error('自定义皮肤 ID 不能与内置皮肤重复');
        }
        if (getInstalledRemoteSkin(input.id, {dataDir: this.dataDir})) {
          throw new Error('旧版自定义皮肤 ID 不能与已安装的 GitHub 皮肤重复');
        }
        if (getUnionProfile(input.id, this.dataDir)) throw new Error('旧版自定义皮肤 ID 不能与并集方案重复');
        if (getUnionProfileDraft(input.id, this.dataDir)) {
          throw new Error('旧版自定义皮肤 ID 不能与仅设计草稿重复');
        }
        if (!canUseSkin(this.entitlement(), {id: input.id, tier: 'vip'}, {
          custom: true,
          customProfileId: input.id,
        })) {
          throw vipRequired('保存此自定义皮肤需要 VIP 或与该 profileId 绑定的自定义位授权');
        }
        const profile = saveProfile(input, this.dataDir);
        this.addLog('success', `已保存皮肤：${profile.name}`);
        return sendJson(response, 200, {ok: true, profile});
      }
      if (request.method === 'POST' && url.pathname === '/api/preview') {
        const body = await readJson(request);
        const clientId = validClientId(body.clientId ?? 'codex');
        const resolved = body.skinId ? this.resolveSkin(body.skinId, clientId) : null;
        const profile = resolved?.profile ?? this.inlineProfile(body, clientId);
        const {app, compatibility} = this.clientRecord(clientId);
        if (clientId === 'codex' && app && !app.codeThemeIds?.includes(profile.official.codeThemeId)) {
          throw new Error(`当前 Codex 不支持代码主题：${profile.official.codeThemeId}`);
        }
        const compiled = this.compileFor(profile, {
          clientId,
          forceGenericSafe: body.capabilityLevel === 'generic-safe' || !compatibility.advancedAllowed,
        });
        const redactedCss = compiled.css.replace(
          /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/gu,
          '<本地图片已内嵌，预览中省略>',
        );
        return sendJson(response, 200, {
          ok: true,
          profile: compiled.profile,
          audit: compiled.audit,
          css: redactedCss,
          officialThemeString: clientId === 'codex' && app?.signals?.themeShareV1
            ? compiled.officialThemeString
            : null,
          capabilityLevel: compiled.capabilityLevel,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/audit') {
        const clientId = validClientId(url.searchParams.get('clientId') || 'codex');
        this.refreshDoctor({fresh: true, clientId});
        const profile = getProfile(url.searchParams.get('profileId'), this.dataDir);
        if (!profile) return sendJson(response, 404, {ok: false, error: '找不到皮肤'});
        const compiled = this.compileFor(profile, {clientId});
        return sendJson(response, 200, {
          ok: true, audit: compiled.audit, compatibility: this.clientRecord(clientId).compatibility,
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/audit') {
        const body = await readJson(request);
        const clientId = validClientId(body.clientId ?? 'codex');
        this.refreshDoctor({fresh: true, clientId});
        const resolved = body.skinId ? this.resolveSkin(body.skinId, clientId) : null;
        const profile = resolved?.profile ?? this.inlineProfile(body, clientId);
        const compiled = this.compileFor(profile, {clientId});
        const {app, compatibility} = this.clientRecord(clientId);
        const runtimeSignals = ['appUrlEntry', 'semanticSelectors', 'designTokens'];
        const status = this.statusPayload();
        const checks = {
          signature: Boolean(app?.signatureValid && app?.trustedPublisher),
          adapter: Boolean(compatibility?.advancedAllowed),
          target: runtimeSignals.every((name) => app?.signals?.[name] === true),
          transport: Boolean(
            app?.transportVerification?.verified &&
            status.safety.tcpFallbackAccepted === false
          ),
          assets: !compiled.audit.remoteUrls && !compiled.audit.arbitraryJavaScript,
        };
        return sendJson(response, 200, {
          ok: true,
          checks,
          audit: compiled.audit,
          compatibility,
          status,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/runtime-audit') {
        const clientId = validClientId(url.searchParams.get('clientId') || 'codex');
        const manager = this.managers.get(clientId);
        return sendJson(response, 200, {
          ok: true,
          clientId,
          audit: await manager.visualAudit(),
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/apply-intents') {
        const body = await readJson(request);
        const intent = this.createApplyIntent({
          clientId: body.clientId,
          skinId: body.skinId,
          operation: body.operation,
          // Older native builds call this endpoint immediately after the
          // reminder decision. Reuse the server-prepared intent so they get
          // the same post-success claim behavior during the migration.
          reuseScheduleReminder: true,
        });
        return sendJson(response, 200, {ok: true, intent});
      }
      const confirmMatch = url.pathname.match(/^\/api\/apply-intents\/([A-Za-z0-9_-]{32,64})\/confirm$/u);
      if (request.method === 'POST' && confirmMatch) {
        const body = await readJson(request);
        const clientId = validClientId(body.clientId);
        this.refreshDoctor({fresh: true, clientId});
        const {app, compatibility} = this.clientRecord(clientId);
        if (!app?.safeToLaunch) throw new Error(`未找到经过官方签名验证的 ${CLIENT_LABELS[clientId]}`);
        let confirmed;
        try {
          confirmed = this.applyIntents.confirm(confirmMatch[1], {
            clientId,
            appFingerprint: app.fingerprint,
          });
        } catch (error) {
          // A pre-launch fingerprint drift makes this prepared intent unusable.
          // Drop only stale/missing schedule bindings so a fresh reminder
          // decision can create a new ticket immediately; a wrong-client
          // request must not cancel the legitimate user's pending ticket.
          if (['INTENT_NOT_FOUND', 'INTENT_EXPIRED', 'INTENT_FINGERPRINT_MISMATCH'].includes(error.code)) {
            this.applyIntents.cancel(confirmMatch[1]);
            this.clearScheduleApplyIntent(confirmMatch[1]);
          }
          throw error;
        }
        const prepared = this.scheduleApplyIntents.get(confirmed.id) ?? null;
        const manager = this.managers.get(clientId);
        try {
          if (confirmed.summary.operation === 'restore') {
            await manager.restoreStock(app, {confirmRestart: true});
            return sendJson(response, 200, {ok: true, operation: 'restore', session: manager.status()});
          }
          const resolved = this.resolveSkin(confirmed.summary.skinId, clientId);
          if (!resolved) throw new Error('皮肤在确认期间已被移除');
          const access = this.skinAccess(resolved.skin, {custom: resolved.custom});
          if (!access.allowed) {
            throw new Error('皮肤权益在确认期间已失效：需要有效 VIP 或该皮肤的购买/兑换授权');
          }
          const status = await manager.launch({
            app,
            profile: resolved.profile,
            compatibility,
            confirmRestart: true,
          });
          if (prepared) {
            this.clearScheduleApplyIntent(confirmed.id);
            this.completeScheduledApply(prepared);
          }
          this.addLog('success', `${CLIENT_LABELS[clientId]} 已应用「${resolved.profile.name}」`);
          return sendJson(response, 200, {ok: true, operation: 'apply', session: status});
        } catch (error) {
          // The intent has been consumed, but the reminder remains eligible.
          // This covers cancellation-equivalent failures after confirmation,
          // profile/entitlement races, and target launch/injection failures.
          if (prepared) this.clearScheduleApplyIntent(confirmed.id);
          throw error;
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/launch-skin') {
        await readJson(request);
        return sendJson(response, 410, {ok: false, error: '直接重启接口已停用；请先创建一次性确认操作'});
      }
      if (request.method === 'POST' && url.pathname === '/api/teardown') {
        const body = await readJson(request);
        const result = await this.managers.get(validClientId(body.clientId ?? 'codex')).teardown();
        return sendJson(response, 200, result);
      }
      if (request.method === 'POST' && url.pathname === '/api/restore-stock') {
        await readJson(request);
        return sendJson(response, 410, {ok: false, error: '直接恢复接口已停用；请先创建一次性确认操作'});
      }
      if (request.method === 'GET' && url.pathname === '/api/logs') {
        return sendJson(response, 200, {ok: true, logs: this.logs.slice(-100)});
      }
      if (request.method === 'POST' && url.pathname === '/api/shutdown') {
        await readJson(request);
        sendJson(response, 200, {ok: true});
        setTimeout(() => this.shutdown().catch((error) => {
          this.addLog('error', `关闭失败：${error.message}`);
        }), 100);
        return;
      }
      return sendJson(response, 404, {ok: false, error: 'API 不存在'});
    } catch (error) {
      this.addLog('error', error.message);
      const status = Number.isInteger(error.httpStatus) && error.httpStatus >= 400 && error.httpStatus <= 599
        ? error.httpStatus
        : ['RESTART_CONFIRMATION_REQUIRED', 'VIP_REQUIRED'].includes(error.code) ? 409 : 400;
      return sendJson(response, status, {ok: false, error: error.message, code: error.code ?? null});
    }
  }

  staticFile(request, response, url) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return sendJson(response, 405, {ok: false, error: 'Method not allowed'});
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendJson(response, 400, {ok: false, error: 'Bad path'});
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//u, '');
    if (!/^[a-zA-Z0-9._/-]+$/u.test(relative) || relative.includes('..')) {
      return sendJson(response, 404, {ok: false, error: 'Not found'});
    }
    const filePath = path.resolve(publicRoot, relative);
    if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`) || !fs.existsSync(filePath)) {
      return sendJson(response, 404, {ok: false, error: 'Not found'});
    }
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return sendJson(response, 404, {ok: false, error: 'Not found'});
    securityHeaders(response);
    response.writeHead(200, {'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream'});
    if (request.method === 'HEAD') return response.end();
    // The file can still disappear or fail between the checks above and the
    // last byte.  `pipe` would leave that stream error unobserved, which ends
    // the whole local service; `pipeline` destroys both sides instead.
    pipeline(fs.createReadStream(filePath), response, () => {});
  }

  async handle(request, response) {
    const url = new URL(request.url, `http://${this.host}:${this.port}`);
    if (url.pathname.startsWith('/api/')) return this.api(request, response, url);
    return this.staticFile(request, response, url);
  }

  async start({port = 0} = {}) {
    if (typeof this.commerceBridge.initialize === 'function') {
      try {
        await this.commerceBridge.initialize();
      } catch (error) {
        // A damaged or legacy Keychain authorization record must not take the
        // embedded local service (catalog, themes, schedules, custom editor)
        // down with it. Authorization endpoints still retry initialization
        // and return the precise vault error until the user repairs it.
        this.commerceInitializationError = Object.freeze({
          code: error?.code ?? 'COMMERCE_INITIALIZATION_FAILED',
          message: String(error?.message || '授权缓存初始化失败').slice(0, 300),
        });
        this.addLog('error', `授权缓存暂不可用；其他本地功能继续运行：${this.commerceInitializationError.message}`);
      }
    }
    this.refreshDoctor();
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch((error) => sendJson(response, 500, {ok: false, error: error.message}));
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, this.host, resolve);
    });
    this.port = this.server.address().port;
    const sessionTemp = `${this.lockPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(sessionTemp, JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      instanceId: this.instanceId,
      host: this.host,
      port: this.port,
      token: this.token,
      runtimeIdentity: this.runtimeIdentity,
      startedAt: new Date().toISOString(),
    }), {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    fs.renameSync(sessionTemp, this.lockPath);
    this.addLog('success', `灵妆已在 ${this.host}:${this.port} 启动；未启动任何目标应用`);
    this.backgroundTimer = setInterval(() => {
      this.backgroundReminderTick().catch((error) => this.addLog('error', `自动换肤提醒失败：${error.message}`));
    }, 15000);
    this.backgroundTimer.unref?.();
    this.licenseRefreshStopped = false;
    this.scheduleLicenseRefresh();
    const url = `http://${this.host}:${this.port}/#token=${encodeURIComponent(this.token)}`;
    if (this.openBrowser) await openUrlWithoutArgv(url);
    return {url, host: this.host, port: this.port, token: this.token};
  }

  async shutdown() {
    if (this.backgroundTimer) clearInterval(this.backgroundTimer);
    this.backgroundTimer = null;
    this.licenseRefreshStopped = true;
    if (this.licenseRefreshTimer) clearTimeout(this.licenseRefreshTimer);
    this.licenseRefreshTimer = null;
    for (const manager of this.managers.values()) {
      if (manager.status().mode) await manager.stop({terminateApp: true});
      else await manager.stop({terminateApp: false});
    }
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    try {
      const lock = readPrivateJson(this.lockPath);
      if (lock.pid === process.pid && lock.instanceId === this.instanceId) fs.unlinkSync(this.lockPath);
    } catch {}
    releaseOwnerLock(this.ownerLock);
    this.ownerLock = null;
  }
}

export async function existingStudio(dataDir, {
  openBrowser = false,
  runtimeIdentity = CURRENT_RUNTIME_IDENTITY,
} = {}) {
  if (!validRuntimeIdentity(runtimeIdentity)) throw new Error('运行时身份格式无效');
  const lockPath = path.join(ensureDataDir(dataDir), 'studio-session.json');
  let lock;
  try {
    lock = readPrivateJson(lockPath);
    if (lock.schemaVersion !== 1 || lock.host !== '127.0.0.1' || !Number.isInteger(lock.port) ||
        !Number.isInteger(lock.pid) || !/^[a-f0-9]{32}$/u.test(lock.instanceId || '') ||
        !/^[A-Za-z0-9_-]{40,50}$/u.test(lock.token || '')) {
      throw new Error('invalid lock');
    }
    if (runtimeIdentity !== null && lock.runtimeIdentity !== runtimeIdentity) {
      throw new Error('runtime identity mismatch');
    }
    if (!processAlive(lock.pid)) throw new Error('stale process');
    const response = await fetch(`http://${lock.host}:${lock.port}/api/status`, {
      headers: {Authorization: `Bearer ${lock.token}`},
      // Cold-start Agent signature discovery can briefly occupy the local
      // process. Allow a bounded three-second authenticated reuse handshake so
      // a healthy LingGlow instance is not misclassified as disconnected.
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('stale server');
    const payload = await response.json();
    if (payload.studio?.instanceId !== lock.instanceId ||
        (runtimeIdentity !== null && payload.studio?.runtimeIdentity !== runtimeIdentity)) {
      throw new Error('server identity mismatch');
    }
  } catch {
    return null;
  }
  const url = `http://${lock.host}:${lock.port}/#token=${encodeURIComponent(lock.token)}`;
  if (openBrowser) await openUrlWithoutArgv(url);
  return {...lock, url, reused: true, studio: null};
}

export async function startStudioServer(options = {}) {
  const dataDir = options.dataDir ?? defaultDataDir();
  const runtimeIdentity = options.runtimeIdentity ?? CURRENT_RUNTIME_IDENTITY;
  if (!validRuntimeIdentity(runtimeIdentity)) throw new Error('运行时身份格式无效');
  const existing = await existingStudio(dataDir, {...options, runtimeIdentity});
  if (existing) return existing;
  let ownerLock = acquireOwnerLock(dataDir);
  if (!ownerLock) {
    // A cold signed build can spend well over three seconds validating the
    // bundled runtime and installed Agent identities before publishing its
    // session file. Treat the live owner lock as an in-flight startup. If that
    // owner exits during a version handoff, claim the now-free owner lock in
    // this same process instead of leaving the native client disconnected.
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const concurrentlyStarted = await existingStudio(dataDir, {...options, runtimeIdentity});
      if (concurrentlyStarted) return concurrentlyStarted;
      ownerLock = acquireOwnerLock(dataDir);
      if (ownerLock) break;
    }
    if (!ownerLock) throw new Error('灵妆内置功能启动协调超时');
  }
  let studio = null;
  try {
    try {
      const staleSession = path.join(dataDir, 'studio-session.json');
      if (fs.existsSync(staleSession)) fs.unlinkSync(staleSession);
    } catch {}
    studio = new StudioServer({...options, dataDir, ownerLock, runtimeIdentity});
    const address = await studio.start(options);
    return {studio, ...address};
  } catch (error) {
    if (studio?.server) await new Promise((resolve) => studio.server.close(resolve));
    releaseOwnerLock(ownerLock);
    throw error;
  }
}
