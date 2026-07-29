import {EventEmitter} from 'node:events';
import {spawn, execFileSync} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {resolveSkinCapabilityProfile} from './adapter.mjs';
import {cleanupSource, compileSkin, injectionSource, skinRuntimeIds} from './skin.mjs';
import {
  findClientApp,
  launchStock,
  quitClientGracefully,
  runningMainProcesses,
  sameAppFingerprint,
} from './client-app.mjs';
import {
  beginReviewedDoubaoSessionAttempt,
  bindReviewedDoubaoSessionChild,
  bindReviewedDoubaoSessionLoopback,
  bindReviewedDoubaoSessionTransport,
  cleanupReviewedDoubaoSessionAttempt,
  createReviewedDoubaoSessionPlan,
  launchStrategyFor,
  reviewedDoubaoLoopbackLaunchOptions,
  reviewedDoubaoSessionLaunchOptions,
  targetUrlMatchesAllowlist,
  DOUBAO_TARGET_ALLOWLIST,
} from './transport-strategy.mjs';

const CLEAN_EXIT_STABLE_SAMPLES = 10;
const CLEAN_EXIT_SAMPLE_INTERVAL_MS = 200;
const REINJECTION_GRACE_ATTEMPTS = 2;
const TARGET_SYNC_FAILURE_GRACE_ATTEMPTS = 8;
const MANAGED_RECOVERY_WINDOW_MS = 30000;
const MANAGED_RECOVERY_DELAY_MS = 500;
const MANAGED_RECOVERY_MAX_ATTEMPTS = 1;

function targetExitedError(code, signal, label = '目标应用') {
  const error = new Error(`${label}已退出 (${code ?? signal ?? 'unknown'})`);
  error.code = 'TARGET_EXITED_BEFORE_CDP';
  error.exitCode = code;
  error.signal = signal;
  return error;
}

function timeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

class MessageTransport extends EventEmitter {
  constructor() {
    super();
    this.nextId = 0;
    this.pending = new Map();
    this.closed = false;
  }

  dispatch(message) {
    if (message.id && this.pending.has(message.id)) {
      const {resolve, reject} = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'CDP command failed'));
      else resolve(message.result ?? {});
      return;
    }
    if (message.method) this.emit('event', message);
  }

  call(method, params = {}, sessionId = undefined, timeoutMs = 10000) {
    if (this.closed) return Promise.reject(new Error('CDP transport is closed'));
    const id = ++this.nextId;
    const message = {id, method, params};
    if (sessionId) message.sessionId = sessionId;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      try {
        this.send(message);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
    return timeout(promise, timeoutMs, method).finally(() => this.pending.delete(id));
  }

  failAll(error) {
    this.closed = true;
    for (const {reject} of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

export class PipeTransport extends MessageTransport {
  constructor(child) {
    super();
    this.child = child;
    this.input = child.stdio[3];
    this.output = child.stdio[4];
    this.buffer = '';
    this.output.setEncoding('utf8');
    this.output.on('data', (chunk) => this.onData(chunk));
    this.output.on('error', (error) => this.failAndClose(error));
    this.input.on('error', (error) => this.failAndClose(error));
    child.once('exit', (code, signal) => {
      this.failAll(targetExitedError(code, signal));
      this.emit('close', {code, signal});
    });
    child.on('error', (error) => this.failAll(error));
  }

  onData(chunk) {
    this.buffer += chunk;
    for (;;) {
      const end = this.buffer.indexOf('\0');
      if (end < 0) break;
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!raw) continue;
      try {
        this.dispatch(JSON.parse(raw));
      } catch {
        this.failAndClose(new Error('CDP pipe returned invalid JSON'));
      }
    }
  }

  // A broken pipe or an unparsable frame ends the session just as surely as a
  // child exit does.  Without a 'close' event the manager would keep polling a
  // dead transport while still reporting an active skin.
  failAndClose(error) {
    if (this.closed) return;
    this.failAll(error);
    this.emit('close', {error: error?.message});
  }

  send(message) {
    this.input.write(`${JSON.stringify(message)}\0`);
  }

  close() {
    this.failAll(new Error('CDP pipe closed'));
    this.input.destroy();
    this.output.destroy();
  }
}

export class WebSocketTransport extends MessageTransport {
  constructor(socket) {
    super();
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      try {
        this.dispatch(JSON.parse(String(event.data)));
      } catch {
        this.failAll(new Error('CDP WebSocket returned invalid JSON'));
      }
    });
    socket.addEventListener('error', (event) => {
      this.failAll(new Error(event?.message || 'CDP WebSocket error'));
    });
    socket.addEventListener('close', (event) => {
      if (!this.closed) this.failAll(new Error(`CDP WebSocket closed (${event.code})`));
      this.emit('close', {code: event.code, reason: event.reason});
    });
  }

  send(message) {
    if (this.socket.readyState !== 1) throw new Error('CDP WebSocket is not open');
    this.socket.send(JSON.stringify(message));
  }

  close() {
    if (this.closed) return;
    this.failAll(new Error('CDP WebSocket closed'));
    try { this.socket.close(); } catch {}
  }
}

async function connectWebSocket(url, timeoutMs = 10000) {
  if (typeof WebSocket !== 'function') throw new Error('Bundled Node runtime lacks WebSocket support');
  const socket = new WebSocket(url);
  await timeout(new Promise((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (event) => { cleanup(); reject(new Error(event?.message || 'WebSocket connection failed')); };
    const cleanup = () => {
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
    };
    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
  }), timeoutMs, 'CDP WebSocket connection');
  return new WebSocketTransport(socket);
}

async function bindEphemeralLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({host: '127.0.0.1', port: 0, exclusive: true}, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function pickEphemeralLoopbackPort(attempts = 5) {
  // 49853 sits inside the macOS ephemeral range, so the kernel can hand it out
  // by chance.  That is a transient condition: ask for another port instead of
  // failing the whole launch.
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = await bindEphemeralLoopbackPort();
    if (Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 49853) return port;
  }
  throw new Error('无法分配安全的豆包本机临时端口');
}

async function waitForLoopbackEndpoint(port, expectedProduct, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const endpoint = new URL(String(payload.webSocketDebuggerUrl || ''));
      if (payload.Browser !== expectedProduct || endpoint.protocol !== 'ws:' ||
          endpoint.hostname !== '127.0.0.1' || Number(endpoint.port) !== port ||
          !endpoint.pathname.startsWith('/devtools/browser/')) {
        throw new Error('豆包 CDP 端点身份与已锁定版本不匹配');
      }
      return {payload, webSocketUrl: endpoint.href};
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`豆包本机 CDP 未就绪：${lastError?.message ?? 'timeout'}`);
}

async function waitForSpawn(child, label) {
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onSpawn = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(new Error(`${label} 启动失败：${error.message}`)); };
    const onExit = (code, signal) => {
      cleanup();
      reject(targetExitedError(code, signal, `${label} 在建立通道前`));
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function waitForChildExit(child, timeoutMs = 10000) {
  if (!child || child.exitCode != null || child.signalCode != null) return true;
  return await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

function targetAllowed(target, expectedUrl = 'app://-/index.html', targetAllowlist = []) {
  const baseUrl = String(target.url || '').split(/[?#]/u, 1)[0];
  if (target.type !== 'page') return false;
  if (targetAllowlist.length) return targetUrlMatchesAllowlist(target.url, targetAllowlist);
  return baseUrl === expectedUrl;
}

const CODEX_PROBE_EXPRESSION = `(() => {
  const root = document.querySelectorAll('#root').length;
  const html = document.documentElement;
  const styles = getComputedStyle(html);
  return {
    url: location.href,
    root,
    electron: html.getAttribute('data-codex-window-type') === 'electron' ||
      html.classList.contains('electron-light') || html.classList.contains('electron-dark'),
    main: document.querySelectorAll('main, [role="main"]').length,
    semanticComposer: document.querySelectorAll('[data-codex-composer], [data-codex-composer-root]').length,
    designToken: Boolean(styles.getPropertyValue('--color-token-main-surface-primary').trim())
  };
})()`;

const WORKBUDDY_PROBE_EXPRESSION = `(() => {
  const root = document.querySelectorAll('#root').length;
  const body = document.body;
  const styleTarget = body || document.documentElement;
  const styles = styleTarget ? getComputedStyle(styleTarget) : null;
  return {
    url: location.href,
    root,
    title: document.title,
    applicationName: body?.getAttribute('data-application-name') || '',
    electronDesktop: body?.getAttribute('data-electron-desktop') || '',
    platform: body?.getAttribute('data-platform') || '',
    productVersion: body?.getAttribute('data-product-version') || '',
    designToken: Boolean(
      styles?.getPropertyValue('--vscode-editor-background').trim() ||
      styles?.getPropertyValue('--vscode-foreground').trim()
    )
  };
})()`;

// Deliberately fixed and data-minimised: this never reads visible text, form
// values, cookies, storage, or arbitrary page state.  A future exact Doubao
// Adapter must still be separately approved before this probe is reachable.
const DOUBAO_PROBE_EXPRESSION = `(() => {
  const html = document.documentElement;
  const bodyElement = document.body;
  const rootElement = document.querySelector('#root');
  const styles = getComputedStyle(html);
  const bodyRect = bodyElement?.getBoundingClientRect();
  const rootRect = rootElement?.getBoundingClientRect();
  return {
    url: location.href,
    body: document.querySelectorAll('body').length,
    root: document.querySelectorAll('#root').length,
    chatInput: document.querySelectorAll('[data-testid="chat_input"]').length,
    chatInputInput: document.querySelectorAll('[data-testid="chat_input_input"]').length,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    bodyWidth: bodyRect?.width || 0,
    bodyHeight: bodyRect?.height || 0,
    rootWidth: rootRect?.width || 0,
    rootHeight: rootRect?.height || 0,
    designToken: Boolean(
      styles.getPropertyValue('--s-color-bg-primary').trim() ||
      styles.getPropertyValue('--dbx-text-primary').trim() ||
      styles.getPropertyValue('--chat-bg-color').trim()
    )
  };
})()`;

// Fixed, read-only visual diagnostics. It returns selectors and computed paint
// values only; no page text, form values, storage, cookies, or arbitrary input.
const VISUAL_AUDIT_EXPRESSION = `(() => {
  const describe = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      classes: Array.from(element.classList || []).slice(0, 16),
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      color: style.color,
      webkitTextFillColor: style.webkitTextFillColor,
      opacity: style.opacity,
      filter: style.filter,
      mixBlendMode: style.mixBlendMode,
      display: style.display,
      content: style.content,
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
      width: style.width,
      height: style.height
    };
  };
  const pointStack = (x, y) => document.elementsFromPoint(x, y).slice(0, 14).map(describe);
  const selectors = [
    'body', '#root', '.teams-container', '.teams-main-content', '.main-content',
    '.main-content--chat', '.main-content--projects', '.main-content--automation',
    '.conversation-list', '.workbuddy-topbar', '.chat-container', '.wb-cb-chat',
    '.expert-center-page', '.ec-main-content', '.automation-main-page',
    '.project-grid__body', '.skills-panel', '.connector-panel', '.inspiration-panel',
    '.workbuddy-collab .landing > header.landing-header > img.landing-hero'
  ];
  return {
    ok: true,
    viewport: {width: innerWidth, height: innerHeight},
    rootProfile: document.documentElement.getAttribute(${JSON.stringify(skinRuntimeIds.rootAttribute)}),
    bodyBackground: describe(document.body),
    beforeBackground: getComputedStyle(document.body, '::before').backgroundImage,
    samples: Object.fromEntries(selectors.map((selector) => [
      selector,
      {count: document.querySelectorAll(selector).length, first: describe(document.querySelector(selector))}
    ])),
    mainStack: pointStack(Math.max(1, innerWidth * 0.62), Math.max(1, innerHeight * 0.42)),
    sidebarStack: pointStack(Math.max(1, innerWidth * 0.10), Math.max(1, innerHeight * 0.42)),
    workbuddyFeaturedStack: pointStack(Math.max(1, innerWidth * 0.28), Math.max(1, innerHeight * 0.21)),
    workbuddyCardStack: pointStack(Math.max(1, innerWidth * 0.30), Math.max(1, innerHeight * 0.60)),
    workbuddySearchStack: pointStack(Math.max(1, innerWidth * 0.82), Math.max(1, innerHeight * 0.04)),
    composerMascot: (() => {
      const anchorSelectors = [
        '[data-lingglow-workbuddy-composer="true"]',
        '[data-codex-composer-root]',
        '[data-codex-composer]:not(:has([data-codex-composer-root]))',
        '.composer-surface-chrome:not(:has([data-codex-composer-root], [data-codex-composer]))',
        '[data-testid="chat_input"]'
      ];
      const anchors = anchorSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
      const anchor = anchors.find((candidate) => getComputedStyle(candidate, '::after').backgroundImage.includes('data:image/'))
        ?? anchors[0]
        ?? null;
      const style = anchor ? getComputedStyle(anchor, '::after') : null;
      const frameStyle = anchor ? getComputedStyle(anchor) : null;
      const editor = anchor?.querySelector([
        '[data-codex-composer]',
        '[data-testid="chat_input_input"]',
        '.ProseMirror',
        '[role="textbox"]',
        'textarea',
        'input',
        '[contenteditable="true"]'
      ].join(',')) ?? null;
      const editorStyle = editor ? getComputedStyle(editor) : null;
      return {
        anchors: anchors.length,
        anchorKind: anchor ? anchorSelectors.find((selector) => anchor.matches(selector)) ?? null : null,
        agentActive: document.documentElement.getAttribute('data-lingglow-agent-active') === 'true',
        imagePresent: Boolean(style?.backgroundImage?.includes('data:image/')),
        animationName: style?.animationName ?? null,
        animationDuration: style?.animationDuration ?? null,
        animationPlayState: style?.animationPlayState ?? null,
        right: style?.right ?? null,
        transform: style?.transform ?? null,
        display: style?.display ?? null,
        opacity: style?.opacity ?? null,
        width: style?.width ?? null,
        height: style?.height ?? null,
        frame: frameStyle ? {
          borderTopWidth: frameStyle.borderTopWidth,
          borderTopStyle: frameStyle.borderTopStyle,
          borderRadius: frameStyle.borderRadius,
          boxShadow: frameStyle.boxShadow
        } : null,
        editor: editorStyle ? {
          borderTopWidth: editorStyle.borderTopWidth,
          borderRightWidth: editorStyle.borderRightWidth,
          borderBottomWidth: editorStyle.borderBottomWidth,
          borderLeftWidth: editorStyle.borderLeftWidth,
          borderTopStyle: editorStyle.borderTopStyle,
          outlineStyle: editorStyle.outlineStyle,
          boxShadow: editorStyle.boxShadow,
          backgroundColor: editorStyle.backgroundColor,
          backgroundImage: editorStyle.backgroundImage
        } : null
      };
    })()
  };
})()`;


function readProcessCommandTable() {
  try {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], {encoding: 'utf8'});
    return output.split('\n').flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/u);
      if (!match) return [];
      return [{pid: Number(match[1]), ppid: Number(match[2]), command: match[3]}];
    });
  } catch {
    return [];
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForPidExit(pid, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processAlive(pid);
}

async function waitForDoubaoLoopbackProcessChain(app, port, timeoutMs = 15000) {
  const portArgument = `--remote-debugging-port=${port}`;
  const addressArgument = '--remote-debugging-address=127.0.0.1';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = readProcessCommandTable();
    const main = rows.find(({command}) => command.startsWith(`${app.executable} `) &&
      command.includes(portArgument) && command.includes(addressArgument));
    if (main) {
      const nested = rows.find(({command}) =>
        command.startsWith(`${app.nestedBrowser.executable} `) &&
        command.includes(portArgument) && command.includes(addressArgument) &&
        command.includes(`--saman-from-chat=${main.pid}`));
      if (nested) return {mainPid: main.pid, nestedBrowserPid: nested.pid};
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('未验证豆包主进程与可见 Browser 的本机 CDP 转发链路');
}

function findNestedBrowserPids(nestedExecutable, {mainPid = null} = {}) {
  if (typeof nestedExecutable !== 'string' || !nestedExecutable.trim()) return [];
  return readProcessCommandTable().filter(({pid, ppid, command}) => {
    if (!command.includes(nestedExecutable) || command.includes('--type=')) return false;
    if (mainPid != null && !(ppid === mainPid || command.includes(`--saman-from-chat=${mainPid}`))) {
      return false;
    }
    return true;
  }).map(({pid}) => pid);
}

function signalPids(pids, signal = 'SIGTERM') {
  for (const pid of pids) {
    try { process.kill(pid, signal); } catch {}
  }
}

async function waitForNestedBrowserPids(nestedExecutable, mainPid, {
  timeoutMs = 15000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = findNestedBrowserPids(nestedExecutable, {mainPid});
    if (pids.length) return pids;
    await sleep(200);
  }
  return [];
}

export class SkinSessionManager extends EventEmitter {
  constructor({
    log = () => {},
    findClient = findClientApp,
    listMainProcesses = runningMainProcesses,
    retrySleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    spawnProcess = spawn,
    doubaoSessionBaseEnvironment = process.env,
  } = {}) {
    super();
    this.log = log;
    this.findClient = findClient;
    this.listMainProcesses = listMainProcesses;
    this.retrySleep = retrySleep;
    this.spawnProcess = spawnProcess;
    this.doubaoSessionBaseEnvironment = doubaoSessionBaseEnvironment;
    this.child = null;
    this.transport = null;
    this.mode = null;
    this.launchStrategyId = null;
    this.browserVersion = null;
    this.targets = new Map();
    this.pollTimer = null;
    this.pollInFlight = false;
    this.consecutiveSyncFailures = 0;
    this.syncPromise = null;
    this.rejectedTargets = new Map();
    this.injectionSourceCache = null;
    this.profile = null;
    this.compatibility = null;
    this.capabilities = [];
    this.capabilityLevel = 'generic-safe';
    this.targetUrl = 'app://-/index.html';
    this.clientId = 'codex';
    this.clientLabel = 'Codex';
    this.probeKind = 'codex-v1';
    this.appFingerprint = null;
    this.injectionEnabled = false;
    this.doubaoSessionPlan = null;
    this.doubaoSessionAttempt = null;
    this.doubaoMainChild = null;
    this.doubaoMainPid = null;
    this.state = 'idle';
    this.lastError = null;
    this.sessionEpoch = 0;
    this.managedRecovery = null;
    this.managedRecoveryTask = null;
    this.managedRecoveryTaskContext = null;
    this.expectedTransportCloses = new WeakSet();
  }

  status() {
    return {
      state: this.state,
      mode: this.mode,
      launchStrategyId: this.launchStrategyId,
      pid: this.child?.pid ?? this.doubaoMainPid ?? null,
      browserVersion: this.browserVersion,
      profileId: ['active', 'recovering'].includes(this.state) ? (this.profile?.id ?? null) : null,
      clientId: this.clientId,
      injectedTargets: this.targets.size,
      lastError: this.lastError,
    };
  }

  async cleanupDoubaoSessionAttempt(attempt = this.doubaoSessionAttempt) {
    if (!attempt) return null;
    const result = await cleanupReviewedDoubaoSessionAttempt(attempt);
    if (this.doubaoSessionAttempt === attempt) this.doubaoSessionAttempt = null;
    return result;
  }

  async spawnPipe(app, strategy, doubaoSessionPlan = null, allowUnverifiedDoubao = false) {
    const strategyId = strategy?.strategyId;
    const strategyTransport = strategy?.transport;
    if (app?.clientId === 'doubao') {
      if (strategyId !== 'launchservices-loopback' || strategyTransport !== 'loopback-cdp') {
        throw new Error('拒绝执行未验证的豆包启动策略');
      }
      return this.spawnDoubaoFullAppLoopback(app, doubaoSessionPlan, {allowUnverifiedDoubao});
    }
    if (strategyId !== 'direct-pipe') {
      throw new Error('拒绝执行未验证的 CDP Pipe 启动策略');
    }
    if (strategyTransport !== 'pipe' && strategyTransport !== undefined) {
      throw new Error('拒绝执行未验证的豆包启动策略');
    }
    const argumentsList = Object.freeze(['--remote-debugging-pipe']);
    const environment = {...process.env};
    this.log('info', `以安全 Pipe 模式启动 ${app.displayName}`);
    let child = null;
    let transport = null;
    try {
      child = this.spawnProcess(app.executable, argumentsList, {
        env: environment,
        stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      });
      await waitForSpawn(child, app.displayName || '目标应用');
      transport = new PipeTransport(child);
      const version = await transport.call('Browser.getVersion', {}, undefined, 10000);
      if (app.chromium && version.product !== `Chrome/${app.chromium}`) {
        throw new Error(`Chromium 版本不匹配：期望 ${app.chromium}，实际 ${version.product}`);
      }
      // Browser.getVersion can succeed while Electron is still releasing a
      // previous single-instance renderer.  Do not hand that half-started
      // connection to the apply path: wait briefly for any page (the exact
      // URL and runtime structure remain fail-closed checks in syncTargets).
      await this.waitForPipePageTarget(transport, app.displayName || '目标应用');
      return {child, transport, version, mode: 'pipe'};
    } catch (error) {
      if (transport && !transport.closed) transport.close();
      if (child && child.exitCode == null && child.signalCode == null && !child.killed) {
        child.kill('SIGTERM');
      }
      if (child && !await waitForChildExit(child, 10000)) {
        try { child.kill('SIGKILL'); } catch {}
        await waitForChildExit(child, 3000);
      }
      throw error;
    }
  }

  async waitForPipePageTarget(transport, clientLabel, timeoutMs = 8000) {
    await transport.call('Target.setDiscoverTargets', {discover: true});
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const {targetInfos = []} = await transport.call('Target.getTargets');
      if (targetInfos.some(({type}) => type === 'page')) return;
      await this.retrySleep(200);
    }
    const error = new Error(`${clientLabel} 调试通道已建立，但页面尚未就绪`);
    error.code = 'TARGET_PAGE_NOT_READY';
    throw error;
  }

  /**
   * Full Doubao App launch:
   * 1) start native main shell (user-facing App)
   * 2) replace its nested Chromium with a Pipe-enabled nested browser
   *    using the same real profile and --saman-from-chat=<mainPid>
   * CDP attaches to nested; the main shell keeps the product chrome.
   */

  async spawnDoubaoFullAppLoopback(app, doubaoSessionPlan, {allowUnverifiedDoubao = false} = {}) {
    if (!allowUnverifiedDoubao && !doubaoSessionPlan) {
      const error = new Error('豆包缺少已审核的会话计划；拒绝启动');
      error.code = 'TRANSPORT_UNVERIFIED';
      throw error;
    }
    if (!app.executable) throw new Error('豆包主程序可执行文件缺失；拒绝启动');

    const doubaoSessionAttempt = allowUnverifiedDoubao ? null : await beginReviewedDoubaoSessionAttempt(
      doubaoSessionPlan,
      app,
      this.compatibility?.transportVerification,
    );
    if (!allowUnverifiedDoubao && !doubaoSessionAttempt) {
      const error = new Error('豆包隔离会话计划无效；拒绝启动');
      error.code = 'TRANSPORT_UNVERIFIED';
      throw error;
    }
    const port = await pickEphemeralLoopbackPort();
    const options = doubaoSessionAttempt
      ? reviewedDoubaoLoopbackLaunchOptions(doubaoSessionAttempt, {port})
      : allowUnverifiedDoubao
        ? {
          argumentsList: Object.freeze([
            `--remote-debugging-port=${port}`,
            '--remote-debugging-address=127.0.0.1',
          ]),
          environment: {...process.env},
          endpoint: Object.freeze({host: '127.0.0.1', port}),
        }
        : null;
    const environment = options?.environment ? {...options.environment} : {...process.env};
    const argumentsList = options?.argumentsList;
    if (!Array.isArray(argumentsList) ||
        !argumentsList.includes(`--remote-debugging-port=${port}`) ||
        !argumentsList.includes('--remote-debugging-address=127.0.0.1')) {
      throw new Error('豆包会话没有提供固定本机 CDP 启动边界');
    }
    this.log('info', allowUnverifiedDoubao
      ? '通过受限兼容通道，以随机本机 CDP 会话启动豆包'
      : '通过 LaunchServices 以随机本机 CDP 会话启动豆包');
    let transport = null;
    let mainPid = null;
    try {
      const bundlePath = path.resolve(path.dirname(app.executable), '..', '..');
      const opener = this.spawnProcess('/usr/bin/open', ['-n', bundlePath, '--args', ...argumentsList], {
        env: environment,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      await waitForSpawn(opener, '豆包 LaunchServices');
      const endpoint = await waitForLoopbackEndpoint(port, `Chrome/${app.chromium || ''}`);
      transport = await connectWebSocket(endpoint.webSocketUrl);
      const version = await transport.call('Browser.getVersion', {}, undefined, 10000);
      const expected = `Chrome/${app.chromium || ''}`;
      if (app.chromium && version.product !== expected) {
        throw new Error(`Chromium 版本不匹配：期望 ${expected}，实际 ${version.product}`);
      }
      const chain = await waitForDoubaoLoopbackProcessChain(app, port);
      mainPid = chain.mainPid;
      if (!allowUnverifiedDoubao && !bindReviewedDoubaoSessionLoopback(doubaoSessionAttempt, {
        mainPid,
        nestedBrowserPid: chain.nestedBrowserPid,
        port,
        transport,
      })) {
        throw new Error('豆包本机 CDP 通道与审核计划不匹配');
      }
      this.doubaoMainPid = mainPid;
      this.doubaoSessionAttempt = allowUnverifiedDoubao ? null : doubaoSessionAttempt;
      return {
        child: null,
        transport,
        version,
        mode: 'loopback-cdp',
        mainPid,
      };
    } catch (error) {
      if (transport && !transport.closed) transport.close();
      if (mainPid && processAlive(mainPid)) {
        // The nested Browser owns the loopback CDP listener; leaving it alive
        // would keep a debug port open after the failed attempt.
        const nestedPids = findNestedBrowserPids(app.nestedBrowser?.executable || '', {mainPid});
        try { process.kill(mainPid, 'SIGTERM'); } catch {}
        signalPids(nestedPids, 'SIGTERM');
        if (!await waitForPidExit(mainPid, 5000)) {
          try { process.kill(mainPid, 'SIGKILL'); } catch {}
          await waitForPidExit(mainPid, 3000);
        }
        signalPids(nestedPids.filter((pid) => processAlive(pid)), 'SIGKILL');
      } else {
        try { await quitClientGracefully(app, 5000); } catch {}
      }
      this.doubaoMainChild = null;
      this.doubaoMainPid = null;
      try {
        if (doubaoSessionAttempt) await cleanupReviewedDoubaoSessionAttempt(doubaoSessionAttempt);
      } catch (cleanupError) {
        throw new Error(`${error.message}; 豆包会话清理未获证明：${cleanupError.message}`);
      }
      throw error;
    }
  }

  async waitForCleanExitStability(app) {
    for (let sample = 0; sample < CLEAN_EXIT_STABLE_SAMPLES; sample += 1) {
      if (this.listMainProcesses(app).length) {
        throw new Error(`${app.displayName || '目标应用'} 退出后仍有主进程，拒绝自动重试`);
      }
      if (sample + 1 < CLEAN_EXIT_STABLE_SAMPLES) {
        await this.retrySleep(CLEAN_EXIT_SAMPLE_INTERVAL_MS);
      }
    }
  }

  async spawnPipeWithSingleInstanceRetry(app, strategy, doubaoSessionPlan = null, allowUnverifiedDoubao = false) {
    try {
      return await this.spawnPipe(app, strategy, doubaoSessionPlan, allowUnverifiedDoubao);
    } catch (error) {
      const cleanEarlyExit = error?.code === 'TARGET_EXITED_BEFORE_CDP' &&
        error.exitCode === 0 && !error.signal;
      const pageNotReady = error?.code === 'TARGET_PAGE_NOT_READY';
      if (!cleanEarlyExit && !pageNotReady) throw error;

      const firstCheck = this.findClient(app.clientId, {fresh: true});
      if (!firstCheck?.safeToLaunch || !sameAppFingerprint(app, firstCheck)) {
        throw new Error(`${error.message}; 应用身份在单实例退出后发生变化，未重试`);
      }
      await this.waitForCleanExitStability(firstCheck);
      const finalCheck = this.findClient(app.clientId, {fresh: true});
      if (!finalCheck?.safeToLaunch || !sameAppFingerprint(app, finalCheck) ||
          this.listMainProcesses(finalCheck).length) {
        throw new Error(`${error.message}; 退出稳定等待后身份或进程状态不一致，未重试`);
      }
      this.log('info', pageNotReady
        ? `${app.displayName || '目标应用'} 页面未就绪；确认进程退出稳定后重试一次 Pipe 启动`
        : `${app.displayName || '目标应用'} 单实例锁正常释放，有界重试一次 Pipe 启动`);
      return this.spawnPipe(finalCheck, strategy, doubaoSessionPlan, allowUnverifiedDoubao);
    }
  }

  transportCloseMessage(details = {}) {
    if (details?.error) return String(details.error);
    if (details?.signal) return `进程收到 ${details.signal}`;
    if (details?.code != null) return `进程退出码 ${details.code}`;
    return '调试通道已关闭';
  }

  async waitForManagedRecoveryExit(app, deadline) {
    let stableSamples = 0;
    const maximumSamples = Math.max(
      CLEAN_EXIT_STABLE_SAMPLES,
      Math.ceil(Math.max(0, deadline - Date.now()) / CLEAN_EXIT_SAMPLE_INTERVAL_MS) + 1,
    );
    for (let sample = 0; sample < maximumSamples && Date.now() <= deadline; sample += 1) {
      if (this.listMainProcesses(app).length) {
        stableSamples = 0;
      } else {
        stableSamples += 1;
        if (stableSamples >= CLEAN_EXIT_STABLE_SAMPLES) return;
      }
      if (Date.now() < deadline) await this.retrySleep(CLEAN_EXIT_SAMPLE_INTERVAL_MS);
    }
    throw new Error(`${app.displayName || '目标应用'} 未在受管恢复窗口内保持退出稳定；未在无确认状态下强制重启`);
  }

  scheduleManagedRecovery(context) {
    if (!context || context.attempts >= MANAGED_RECOVERY_MAX_ATTEMPTS ||
        (this.managedRecoveryTask && this.managedRecoveryTaskContext === context)) return;
    context.attempts += 1;
    const task = (async () => {
      await this.retrySleep(MANAGED_RECOVERY_DELAY_MS);
      if (this.managedRecovery !== context || this.sessionEpoch !== context.epoch ||
          this.state !== 'recovering') return;
      if (Date.now() > context.recoveryDeadline) {
        throw new Error(`${context.app.displayName || '目标应用'} 受管恢复窗口已过期`);
      }

      const firstCheck = this.findClient(context.app.clientId, {fresh: true});
      if (!firstCheck?.safeToLaunch || !sameAppFingerprint(context.app, firstCheck)) {
        throw new Error(`${context.app.displayName || '目标应用'} 身份在断连后发生变化`);
      }
      await this.waitForManagedRecoveryExit(firstCheck, context.recoveryDeadline);
      const finalCheck = this.findClient(context.app.clientId, {fresh: true});
      if (!finalCheck?.safeToLaunch || !sameAppFingerprint(context.app, finalCheck) ||
          this.listMainProcesses(finalCheck).length) {
        throw new Error(`${context.app.displayName || '目标应用'} 退出稳定等待后身份或进程状态不一致`);
      }
      if (this.managedRecovery !== context || this.sessionEpoch !== context.epoch ||
          this.state !== 'recovering') return;
      if (Date.now() > context.recoveryDeadline) {
        throw new Error(`${context.app.displayName || '目标应用'} 受管恢复窗口已过期`);
      }

      this.log('info', `${context.app.displayName || '目标应用'} 皮肤通道意外断开；执行一次受管恢复`);
      await this.launch({
        app: finalCheck,
        profile: context.profile,
        compatibility: context.compatibility,
        confirmRestart: false,
        managedRecoveryEpoch: context.epoch,
      });
    })();
    this.managedRecoveryTask = task;
    this.managedRecoveryTaskContext = context;
    void task.catch((error) => {
      if (this.managedRecovery !== context || this.sessionEpoch !== context.epoch) return;
      this.injectionEnabled = false;
      this.lastError = `${context.app.displayName || '目标应用'} 皮肤会话意外断开，受管恢复失败：${error.message}`;
      this.state = 'error';
      this.emit('status', this.status());
    }).finally(() => {
      if (this.managedRecoveryTask === task) {
        this.managedRecoveryTask = null;
        this.managedRecoveryTaskContext = null;
      }
    });
  }

  async pollTargets() {
    if (this.pollInFlight || !this.injectionEnabled || !this.transport || this.transport.closed) return;
    const activeTransport = this.transport;
    this.pollInFlight = true;
    try {
      await this.syncTargets();
      if (this.transport !== activeTransport || activeTransport.closed) return;
      if (!this.targets.size) throw new Error(`暂未找到可验证的 ${this.clientLabel} 页面`);
      const recovered = this.consecutiveSyncFailures > 0 || this.state === 'recovering';
      this.consecutiveSyncFailures = 0;
      this.lastError = null;
      this.state = 'active';
      if (recovered) this.emit('status', this.status());
    } catch (error) {
      if (this.transport !== activeTransport || activeTransport.closed || this.state === 'stopping') return;
      this.consecutiveSyncFailures += 1;
      if (this.consecutiveSyncFailures <= TARGET_SYNC_FAILURE_GRACE_ATTEMPTS) {
        this.state = 'recovering';
        this.lastError = `${error.message}（正在重试 ${this.consecutiveSyncFailures}/${TARGET_SYNC_FAILURE_GRACE_ATTEMPTS}）`;
        this.emit('status', this.status());
        return;
      }

      // A renderer reload/probe failure must not terminate the user's whole
      // Agent. Stop only the failed injection loop and keep the already-owned
      // Pipe process alive; an explicit re-apply can safely rebuild the session.
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.injectionEnabled = false;
      this.state = 'error';
      this.lastError = `${error.message}；已停止皮肤轮询，但保留 ${this.clientLabel} 进程`;
      this.emit('status', this.status());
    } finally {
      this.pollInFlight = false;
    }
  }

  async launch({app, profile, compatibility, confirmRestart = false, managedRecoveryEpoch = null}) {
    // The approved Doubao verification is minted only while loadAdapters()
    // checks its three digest-pinned records. Never fall back to the app's
    // discovery-time status here.
    const launchStrategy = launchStrategyFor(app, compatibility?.transportVerification);
    const expectedTransport = app?.clientId === 'doubao' ? 'loopback-cdp' : 'pipe';
    if (!launchStrategy.allowed || launchStrategy.transport !== expectedTransport) {
      const error = new Error(launchStrategy.reason || '客户端调试传输尚未验证');
      error.code = 'TRANSPORT_UNVERIFIED';
      throw error;
    }
    if (!compatibility?.advancedAllowed) throw new Error(compatibility?.reason || '高级皮肤不可用');
    if (app?.clientId === 'doubao' && !launchStrategy.unverifiedFallback &&
        compatibility.adapter?.adapterId !== launchStrategy.reviewedExactAdapterId) {
      const error = new Error('豆包 exact Adapter 与内部审核启动许可不匹配');
      error.code = 'TRANSPORT_UNVERIFIED';
      throw error;
    }
    if (!profile?.advanced?.enabled) throw new Error('当前皮肤没有启用高级模式');
    const hasRunningProcess = this.listMainProcesses(app).length || (app.clientId === 'doubao' &&
      findNestedBrowserPids(app.nestedBrowser?.executable || '').length);
    if (hasRunningProcess && !confirmRestart) {
      const error = new Error(`需要先正常重启 ${app.displayName} 才能启用皮肤`);
      error.code = 'RESTART_CONFIRMATION_REQUIRED';
      throw error;
    }

    const recoveryContext = this.managedRecovery;
    const isManagedRecovery = Number.isInteger(managedRecoveryEpoch) &&
      recoveryContext?.epoch === managedRecoveryEpoch && this.sessionEpoch === managedRecoveryEpoch &&
      recoveryContext.app?.clientId === app.clientId;
    if (managedRecoveryEpoch != null && !isManagedRecovery) {
      throw new Error('受管恢复会话已经失效；拒绝复用旧启动请求');
    }
    const launchEpoch = isManagedRecovery ? managedRecoveryEpoch : this.sessionEpoch + 1;
    if (!isManagedRecovery) {
      this.sessionEpoch = launchEpoch;
      this.managedRecovery = null;
    }

    if (hasRunningProcess) {
      const closingTransport = this.transport;
      if (closingTransport) this.expectedTransportCloses.add(closingTransport);
      try {
        const quit = await quitClientGracefully(app, app.clientId === 'doubao' ? 20000 : 15000);
        if (!quit.ok) {
          // Doubao frequently ignores AppleScript quit when a modal is open.
          // After explicit user confirmRestart, terminate the main wrapper so
          // the full-app Pipe relaunch can proceed.
          if (app.clientId === 'doubao') {
            this.log('info', '豆包未在时限内正常退出；在已确认重启下结束主进程');
            for (const {pid} of runningMainProcesses(app)) {
              try { process.kill(pid, 'SIGTERM'); } catch {}
            }
            signalPids(findNestedBrowserPids(app.nestedBrowser?.executable || ''), 'SIGTERM');
            await this.retrySleep(800);
            for (const {pid} of runningMainProcesses(app)) {
              try { process.kill(pid, 'SIGKILL'); } catch {}
            }
            signalPids(findNestedBrowserPids(app.nestedBrowser?.executable || ''), 'SIGKILL');
            await this.retrySleep(400);
          } else {
            throw new Error(quit.error);
          }
        }
      } catch (error) {
        if (closingTransport) this.expectedTransportCloses.delete(closingTransport);
        if (closingTransport?.closed && ['active', 'recovering', 'stopping'].includes(this.state)) {
          this.injectionEnabled = false;
          this.state = 'error';
          this.lastError = `${app.displayName || '目标应用'} 调试通道已关闭，但正常退出未完成：${error.message}`;
          this.emit('status', this.status());
        }
        throw error;
      }
    }
    // A confirmed re-apply already owns the restart boundary. Use the bounded
    // terminate path so a successfully quit child whose Node exit event is a
    // few milliseconds late cannot leave an active-but-closed zombie session.
    await this.stop({
      terminateApp: Boolean(confirmRestart && hasRunningProcess),
      preserveRecovery: true,
    });
    const currentApp = this.findClient(app.clientId, {fresh: true});
    if (!currentApp?.safeToLaunch || !sameAppFingerprint(app, currentApp)) {
      throw new Error(`${app.displayName} 在安全检查后发生变化，已拒绝启动；请重新检测`);
    }
    app = currentApp;
    const doubaoSessionPlan = app.clientId === 'doubao' && !launchStrategy.unverifiedFallback
      ? createReviewedDoubaoSessionPlan(
        app,
        compatibility?.transportVerification,
        {baseEnvironment: this.doubaoSessionBaseEnvironment},
      )
      : null;
    if (app.clientId === 'doubao' && !launchStrategy.unverifiedFallback && !doubaoSessionPlan) {
      const error = new Error('豆包缺少由 digest 锁定的 exact 隔离会话计划；拒绝启动');
      error.code = 'TRANSPORT_UNVERIFIED';
      throw error;
    }
    this.state = 'starting';
    this.profile = profile;
    this.compatibility = compatibility;
    const skinProfile = resolveSkinCapabilityProfile(compatibility);
    this.capabilities = skinProfile.capabilities;
    this.capabilityLevel = skinProfile.capabilityLevel;
    this.targetUrl = compatibility.targetUrl ?? compatibility.adapter?.targetUrl ?? 'app://-/index.html';
    this.clientId = app.clientId ?? 'codex';
    this.clientLabel = app.displayName ?? ({
      workbuddy: 'WorkBuddy',
      doubao: '豆包',
      codex: 'Codex',
    }[this.clientId] ?? '目标应用');
    this.probeKind = compatibility.probeKind ?? compatibility.adapter?.probeKind ??
      ({workbuddy: 'workbuddy-v1', doubao: 'doubao-v1', codex: 'codex-v1'}[this.clientId] ?? 'codex-v1');
    this.appFingerprint = app.fingerprint;
    this.injectionEnabled = true;
    this.doubaoSessionPlan = doubaoSessionPlan;
    this.doubaoSessionAttempt = null;
    this.lastError = null;
    this.consecutiveSyncFailures = 0;
    this.pollInFlight = false;
    this.launchStrategyId = launchStrategy.strategyId;
    try {
      const connection = await this.spawnPipeWithSingleInstanceRetry(
        app,
        launchStrategy,
        doubaoSessionPlan,
        launchStrategy.unverifiedFallback,
      );
      this.child = connection.child;
      this.transport = connection.transport;
      this.browserVersion = connection.version;
      this.mode = connection.mode;
      const activeTransport = this.transport;
      this.transport.on('close', (details = {}) => {
        if (this.transport !== activeTransport) return;
        const expectedClose = this.expectedTransportCloses.has(activeTransport);
        if (expectedClose) this.expectedTransportCloses.delete(activeTransport);
        const previousState = this.state;
        const isolatedAttempt = this.doubaoSessionAttempt;
        const disconnectedDoubaoMainPid = this.clientId === 'doubao' ? this.doubaoMainPid : null;
        const recovery = this.managedRecovery;
        const processExited = details?.code != null || Boolean(details?.signal);
        const cleanProcessExit = details?.code === 0 && !details?.signal && !details?.error;
        const shouldRecover = !expectedClose && cleanProcessExit &&
          ['active', 'recovering'].includes(previousState) && this.clientId === 'workbuddy' &&
          this.mode === 'pipe' && recovery?.epoch === this.sessionEpoch &&
          recovery.attempts < MANAGED_RECOVERY_MAX_ATTEMPTS;
        if (shouldRecover) {
          recovery.recoveryDeadline = Date.now() + MANAGED_RECOVERY_WINDOW_MS;
        }
        const closeReason = this.transportCloseMessage(details);
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = null;
        this.pollInFlight = false;
        this.consecutiveSyncFailures = 0;
        this.injectionEnabled = false;
        this.targets.clear();
        this.rejectedTargets.clear();
        // A pipe/protocol failure can close CDP while the Electron process is
        // still alive. Retain that owned child so a later confirmed stop can
        // terminate it; only an actual child exit releases the handle.
        if (processExited) this.child = null;
        this.transport = null;
        this.doubaoMainPid = null;
        this.mode = null;
        this.launchStrategyId = null;
        this.lastError = expectedClose
          ? (cleanProcessExit ? null : `${this.clientLabel} 预期关闭期间调试通道异常：${closeReason}`)
          : shouldRecover
            ? `${this.clientLabel} 皮肤通道意外断开（${closeReason}），正在执行一次受管恢复`
            : `${this.clientLabel} 皮肤通道意外断开：${closeReason}`;
        this.state = expectedClose ? 'stopping' : shouldRecover ? 'recovering' : 'error';
        if (!shouldRecover && this.managedRecovery === recovery) this.managedRecovery = null;
        if (disconnectedDoubaoMainPid && processAlive(disconnectedDoubaoMainPid)) {
          try { process.kill(disconnectedDoubaoMainPid, 'SIGTERM'); } catch {}
        }
        this.emit('status', this.status());
        if (expectedClose || previousState === 'stopping') return;
        if (shouldRecover) this.scheduleManagedRecovery(recovery);
        if (!isolatedAttempt) {
          return;
        }
        // An unexpected target exit still needs the same child/handle proof
        // before its fresh profile can be removed.  A failure is surfaced as
        // an error rather than silently deleting or reusing the directory.
        void this.cleanupDoubaoSessionAttempt(isolatedAttempt).then(() => {
          if (this.doubaoSessionPlan && this.doubaoSessionAttempt === null) {
            this.doubaoSessionPlan = null;
          }
          this.emit('status', this.status());
        }).catch((cleanupError) => {
          this.lastError = `豆包隔离 profile 清理未获证明：${cleanupError.message}`;
          this.state = 'error';
          this.emit('status', this.status());
        });
      });
      await this.transport.call('Target.setDiscoverTargets', {discover: true});
      await this.waitForFirstTarget();
      if (this.transport !== activeTransport || activeTransport.closed) {
        throw new Error(`${this.clientLabel} 皮肤通道在完成注入前已关闭`);
      }
      this.pollTimer = setInterval(() => {
        void this.pollTargets();
      }, 1000);
      this.pollTimer.unref?.();
      this.state = 'active';
      if (this.clientId === 'workbuddy' && this.mode === 'pipe') {
        if (isManagedRecovery) {
          recoveryContext.app = app;
        } else {
          this.managedRecovery = {
            epoch: launchEpoch,
            app,
            profile,
            compatibility,
            attempts: 0,
            recoveryDeadline: null,
          };
        }
      }
      this.log('success', `皮肤已通过 ${this.mode} 注入 ${this.targets.size} 个 ${this.clientLabel} 页面`);
      this.emit('status', this.status());
      return this.status();
    } catch (error) {
      let failure = error.message;
      try {
        await this.stop({terminateApp: true, preserveRecovery: isManagedRecovery});
      } catch (stopError) {
        failure = `${failure}; ${stopError.message}`;
      }
      this.clientId = app.clientId ?? this.clientId;
      this.clientLabel = app.displayName ?? this.clientLabel;
      this.profile = profile;
      this.lastError = failure;
      this.state = 'error';
      this.emit('status', this.status());
      if (failure !== error.message) {
        const combinedError = new Error(failure, {cause: error});
        if (error.code) combinedError.code = error.code;
        throw combinedError;
      }
      throw error;
    }
  }

  async waitForFirstTarget() {
    const clientLabel = this.clientLabel;
    const deadline = Date.now() + (this.clientId === 'doubao' ? 60000 : 25000);
    let lastError;
    while (Date.now() < deadline) {
      try {
        // Doubao App already opens doubao://doubao-chat/chat itself.  Never
        // createTarget extra pages — that forces visible Browser dock items.
        await this.syncTargets();
        if (this.targets.size) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`未找到可验证的 ${clientLabel} 页面：${lastError?.message ?? 'timeout'}`);
  }

  async evaluateValue(expression, sessionId) {
    const result = await this.transport.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text || 'JavaScript 执行异常';
      throw new Error(description);
    }
    return result.result?.value;
  }

  async evaluateOk(expression, sessionId, label) {
    const value = await this.evaluateValue(expression, sessionId);
    if (!value?.ok) throw new Error(`${label} 没有返回成功状态`);
    return value;
  }

  async visualAudit() {
    if (this.state !== 'active' || !this.transport || this.transport.closed) {
      throw new Error('皮肤会话未运行，无法执行视觉审计');
    }
    const tracked = [...this.targets.values()].sort((first, second) =>
      ((second.probe?.viewportWidth || 0) * (second.probe?.viewportHeight || 0)) -
      ((first.probe?.viewportWidth || 0) * (first.probe?.viewportHeight || 0)))[0];
    if (!tracked?.sessionId) throw new Error('没有可审计的已验证页面');
    const result = await this.evaluateValue(VISUAL_AUDIT_EXPRESSION, tracked.sessionId);
    if (!result?.ok || result.rootProfile !== this.profile?.id) {
      throw new Error('视觉审计没有匹配当前皮肤会话');
    }
    return result;
  }

  async runtimeProbe(sessionId) {
    const deadline = Date.now() + 12000;
    let last;
    while (Date.now() < deadline) {
      const expression = this.probeKind === 'workbuddy-v1'
        ? WORKBUDDY_PROBE_EXPRESSION
        : this.probeKind === 'doubao-v1'
          ? DOUBAO_PROBE_EXPRESSION
          : CODEX_PROBE_EXPRESSION;
      try {
        last = await this.evaluateValue(expression, sessionId);
      } catch (error) {
        last = {probeError: error.message};
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      const baseUrl = String(last?.url || '').split(/[?#]/u, 1)[0];
      if (this.probeKind === 'workbuddy-v1') {
        const versionMatches = !this.compatibility?.adapter?.versions?.length ||
          this.compatibility.adapter.versions.includes(last?.productVersion);
        if (baseUrl === this.targetUrl && last?.root === 1 &&
            last.applicationName === 'workbuddy' && last.electronDesktop === 'true' &&
            last.platform === 'mac' && last.designToken && versionMatches) return last;
      } else if (this.probeKind === 'doubao-v1') {
        const targetAllowlist = this.compatibility?.targetAllowlist ?? [];
        const composerReady = !this.capabilities.includes('composer') ||
          (last?.chatInput > 0 && last?.chatInputInput > 0);
        const visibleSurface = last?.viewportWidth > 100 && last?.viewportHeight > 100 &&
          last?.bodyWidth > 100 && last?.bodyHeight > 100 &&
          last?.rootWidth > 100 && last?.rootHeight > 100;
        if (targetUrlMatchesAllowlist(last?.url, targetAllowlist) && last?.body === 1 &&
            last?.root === 1 && last?.designToken && visibleSurface && composerReady) return last;
      } else {
        const composerReady = !this.capabilities.includes('composer') || last?.semanticComposer > 0;
        if (baseUrl === this.targetUrl && last?.root === 1 && last.electron &&
            last.main > 0 && last.designToken && composerReady) return last;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`运行时结构探针不兼容：${JSON.stringify(last ?? {})}`);
  }

  injectionPresenceSource(profileId, expected) {
    return `(() => {
      const style = document.getElementById(${JSON.stringify(skinRuntimeIds.styleId)});
      const attr = document.documentElement.getAttribute(${JSON.stringify(skinRuntimeIds.rootAttribute)});
      const present = Boolean(style) && attr === ${JSON.stringify(profileId)};
      const clean = !style && attr === null;
      return {ok: ${expected ? 'present' : 'clean'}, present, clean, attr};
    })()`;
  }

  async detachTarget(target) {
    try {
      await this.transport.call('Target.detachFromTarget', {sessionId: target.sessionId});
    } catch {
      // Detach may race with a renderer that has already exited.
    }
  }

  async cleanupTarget(target) {
    if (target.identifier) {
      await this.transport.call('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: target.identifier,
      }, target.sessionId);
    }
    await this.evaluateOk(cleanupSource(), target.sessionId, '皮肤清理');
    await this.evaluateOk(
      this.injectionPresenceSource(this.profile?.id ?? '', false),
      target.sessionId,
      '皮肤清理校验',
    );
    await this.detachTarget(target);
  }

  // Compiling a skin decodes and re-encodes every embedded image; the poll
  // loop must not redo that work each second for a profile that cannot change
  // while the session is running.
  sessionInjectionSource() {
    const key = [
      this.profile?.id ?? '',
      this.capabilityLevel,
      this.capabilities.join(','),
      this.clientId,
      this.targetUrl,
      (this.compatibility?.targetAllowlist ?? []).join(','),
    ].join('|');
    const cached = this.injectionSourceCache;
    if (cached && cached.key === key && cached.profile === this.profile) return cached.source;
    const compiled = compileSkin(this.profile, {
      capabilityLevel: this.capabilityLevel,
      capabilities: this.capabilities,
      clientId: this.clientId,
    });
    const source = injectionSource(compiled, {
      targetUrl: this.targetUrl,
      targetAllowlist: this.compatibility?.targetAllowlist ?? [],
    });
    this.injectionSourceCache = {key, profile: this.profile, source};
    return source;
  }

  async syncTargets() {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.syncTargetsOnce().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  async syncTargetsOnce() {
    if (!this.injectionEnabled || !this.transport || this.transport.closed) return;
    const {targetInfos = []} = await this.transport.call('Target.getTargets');
    const infos = new Map(targetInfos.map((target) => [target.targetId, target]));
    for (const [targetId, tracked] of this.targets) {
      const current = infos.get(targetId);
      if (!current) {
        this.targets.delete(targetId);
        continue;
      }
      if (!targetAllowed(current, this.targetUrl, this.compatibility?.targetAllowlist)) {
        await this.cleanupTarget(tracked);
        this.targets.delete(targetId);
      }
    }
    for (const target of targetInfos.filter((item) =>
      targetAllowed(item, this.targetUrl, this.compatibility?.targetAllowlist))) {
      const existing = this.targets.get(target.targetId);
      if (existing) {
        try {
          await this.evaluateOk(
            this.injectionPresenceSource(this.profile.id, true),
            existing.sessionId,
            '皮肤存活校验',
          );
          continue;
        } catch {
          try {
            existing.probe = await this.runtimeProbe(existing.sessionId);
            await this.evaluateOk(this.sessionInjectionSource(), existing.sessionId, '皮肤重新注入');
            await this.evaluateOk(
              this.injectionPresenceSource(this.profile.id, true),
              existing.sessionId,
              '皮肤重新注入校验',
            );
            existing.url = target.url;
            this.rejectedTargets.delete(target.targetId);
            continue;
          } catch (error) {
            try { await this.cleanupTarget(existing); } catch {}
            this.targets.delete(target.targetId);
            // A reload can destroy the execution context for longer than one
            // probe window.  The page keeps no injection (cleanupTarget already
            // ran), so give a still-listed target a few ticks to come back
            // before the poll error path terminates the app the user is using.
            this.rejectedTargets.set(target.targetId, {
              url: target.url,
              error: `皮肤失效且重新注入失败：${error.message}`,
              at: Date.now(),
              attempts: (this.rejectedTargets.get(target.targetId)?.attempts ?? 0) + 1,
              grace: REINJECTION_GRACE_ATTEMPTS,
            });
            continue;
          }
        }
      }
      let tracked = null;
      try {
        const {sessionId} = await this.transport.call('Target.attachToTarget', {
          targetId: target.targetId,
          flatten: true,
        });
        tracked = {sessionId, identifier: null, probe: null, url: target.url};
        const {targetInfo} = await this.transport.call('Target.getTargetInfo', {targetId: target.targetId});
        if (!targetAllowed(targetInfo, this.targetUrl, this.compatibility?.targetAllowlist)) {
          throw new Error('目标在附加后已导航到未授权页面');
        }
        tracked.probe = await this.runtimeProbe(sessionId);
        const source = this.sessionInjectionSource();
        // The on-new-document script must share the execution world with the
        // Runtime.evaluate injection below and with cleanupSource(): the
        // runtime hotfix anchors its observers, background canvas and cleanup
        // handles on per-world `window` globals, so an isolated world would
        // leave a second, unreachable instance behind after teardown.
        const installed = await this.transport.call('Page.addScriptToEvaluateOnNewDocument', {
          source,
          runImmediately: true,
        }, sessionId);
        if (!installed.identifier) throw new Error('CDP 没有返回脚本 identifier');
        tracked.identifier = installed.identifier;
        this.targets.set(target.targetId, tracked);
        await this.evaluateOk(source, sessionId, '皮肤注入');
        await this.evaluateOk(
          this.injectionPresenceSource(this.profile.id, true),
          sessionId,
          '皮肤注入校验',
        );
        this.rejectedTargets.delete(target.targetId);
      } catch (error) {
        if (tracked) {
          try { await this.cleanupTarget(tracked); } catch (rollbackError) {
            throw new Error(`${error.message}; 注入回滚失败：${rollbackError.message}`);
          }
        }
        this.targets.delete(target.targetId);
        // Initial launch remains fail-fast inside waitForFirstTarget(), while a
        // renderer created after an active session receives the same short
        // reload grace as an existing renderer whose execution world vanished.
        const previous = this.rejectedTargets.get(target.targetId);
        this.rejectedTargets.set(target.targetId, {
          url: target.url,
          error: error.message,
          at: Date.now(),
          attempts: (previous?.attempts ?? 0) + 1,
          grace: previous?.grace ?? (this.state === 'starting' ? 0 : REINJECTION_GRACE_ATTEMPTS),
        });
      }
    }
    const active = new Set(targetInfos.map((target) => target.targetId));
    for (const targetId of this.rejectedTargets.keys()) {
      if (!active.has(targetId)) this.rejectedTargets.delete(targetId);
    }
    if (!this.targets.size && this.rejectedTargets.size) {
      const rejected = [...this.rejectedTargets.values()];
      if (rejected.some(({attempts = 1, grace = 0}) => attempts > grace)) {
        const last = rejected.at(-1);
        throw new Error(last?.error || `未找到可验证的 ${this.clientLabel} 页面`);
      }
    }
  }

  async teardown() {
    this.injectionEnabled = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.pollInFlight = false;
    this.consecutiveSyncFailures = 0;
    if (this.syncPromise) await this.syncPromise.catch(() => {});
    if (!this.transport || this.transport.closed) {
      if (this.targets.size) throw new Error('调试通道已关闭，无法确认皮肤清理');
      return {ok: true, targets: 0};
    }
    const {targetInfos = []} = await this.transport.call('Target.getTargets');
    const active = new Set(targetInfos.map((target) => target.targetId));
    let removed = 0;
    const failures = [];
    for (const [targetId, target] of this.targets) {
      if (!active.has(targetId)) {
        removed += 1;
        continue;
      }
      try {
        await this.cleanupTarget(target);
        removed += 1;
      } catch (error) {
        failures.push(error.message);
      }
    }
    if (failures.length) {
      this.state = 'error';
      throw new Error(`未能确认全部皮肤已清理：${failures.join('; ')}`);
    }
    this.targets.clear();
    this.state = 'disabled-live';
    this.log('success', `已从 ${removed} 个页面移除皮肤`);
    return {ok: true, targets: removed};
  }

  async stop({terminateApp = false, preserveRecovery = false} = {}) {
    const child = this.child;
    // If we are not terminating the target app and its child process is still
    // running, the skin session must stay resident.  Refuse BEFORE touching
    // any session state — the previous implementation cleared the poll timer,
    // disabled injection and even tore down targets first, then restored
    // `state` to `previousState` and threw.  That left a "zombie active"
    // session that claimed to be alive but no longer polled or injected.
    if (!terminateApp && ((child && child.exitCode == null && child.signalCode == null) ||
        (this.clientId === 'doubao' && processAlive(this.doubaoMainPid)))) {
      throw new Error(`拒绝在调试模式 ${this.clientLabel} 仍运行时关闭控制器（皮肤会话需常驻）`);
    }
    if (!preserveRecovery) {
      this.sessionEpoch += 1;
      this.managedRecovery = null;
    }
    const transport = this.transport;
    const doubaoSessionAttempt = this.doubaoSessionAttempt;
    this.state = 'stopping';
    if (transport) this.expectedTransportCloses.add(transport);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.pollInFlight = false;
    this.consecutiveSyncFailures = 0;
    this.injectionEnabled = false;
    if (this.syncPromise) await this.syncPromise.catch(() => {});
    let cleanupError = null;
    if (transport && !transport.closed && this.targets.size) {
      try { await this.teardown(); } catch (error) { cleanupError = error; }
    }
    if (terminateApp && child && child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM');
      if (!await waitForChildExit(child, 10000)) {
        try { child.kill('SIGKILL'); } catch {}
        await waitForChildExit(child, 3000);
      }
    }
    if (terminateApp && this.doubaoMainChild && this.doubaoMainChild.exitCode == null) {
      try { this.doubaoMainChild.kill('SIGTERM'); } catch {}
    } else if (terminateApp && this.doubaoMainPid && processAlive(this.doubaoMainPid)) {
      try { process.kill(this.doubaoMainPid, 'SIGTERM'); } catch {}
      if (!await waitForPidExit(this.doubaoMainPid, 10000)) {
        try { process.kill(this.doubaoMainPid, 'SIGKILL'); } catch {}
        await waitForPidExit(this.doubaoMainPid, 3000);
      }
    }
    if (terminateApp) {
      cleanupError = null;
    }
    this.doubaoMainChild = null;
    this.doubaoMainPid = null;
    if (transport && !transport.closed) transport.close();
    let isolationCleanupError = null;
    if (doubaoSessionAttempt) {
      try {
        await this.cleanupDoubaoSessionAttempt(doubaoSessionAttempt);
      } catch (error) {
        isolationCleanupError = error;
      }
    }
    this.transport = null;
    this.targets.clear();
    this.rejectedTargets.clear();
    this.injectionSourceCache = null;
    this.syncPromise = null;
    this.child = null;
    this.mode = null;
    this.launchStrategyId = null;
    this.browserVersion = null;
    this.capabilities = [];
    this.capabilityLevel = 'generic-safe';
    this.targetUrl = 'app://-/index.html';
    this.clientId = 'codex';
    this.clientLabel = 'Codex';
    this.probeKind = 'codex-v1';
    this.appFingerprint = null;
    if (!isolationCleanupError) this.doubaoSessionPlan = null;
    // A failed teardown means injection may still be present in live pages;
    // mark the session as errored rather than idle so callers do not assume a
    // clean slate.  An isolation cleanup failure is already surfaced below.
    this.state = (cleanupError || isolationCleanupError) ? 'error' : 'idle';
    if (transport) this.expectedTransportCloses.delete(transport);
    if (cleanupError) throw cleanupError;
    if (isolationCleanupError) {
      throw new Error(`豆包隔离 profile 清理未获证明：${isolationCleanupError.message}`);
    }
  }

  async restoreStock(app, {confirmRestart = false} = {}) {
    if (this.listMainProcesses(app).length && !confirmRestart) {
      const error = new Error('需要确认重启才能彻底关闭调试通道并恢复原版');
      error.code = 'RESTART_CONFIRMATION_REQUIRED';
      throw error;
    }
    const previousState = this.state;
    this.state = 'stopping';
    const quit = await quitClientGracefully(app);
    if (!quit.ok) {
      this.state = previousState;
      throw new Error(quit.error);
    }
    if (app.clientId === 'doubao' && this.doubaoMainPid &&
        !await waitForPidExit(this.doubaoMainPid, 10000)) {
      this.log('info', '豆包忽略了正常退出；在已确认恢复原版下结束本机 CDP 主进程');
      try { process.kill(this.doubaoMainPid, 'SIGTERM'); } catch {}
      if (!await waitForPidExit(this.doubaoMainPid, 5000)) {
        try { process.kill(this.doubaoMainPid, 'SIGKILL'); } catch {}
        await waitForPidExit(this.doubaoMainPid, 3000);
      }
      if (processAlive(this.doubaoMainPid)) {
        this.state = previousState;
        throw new Error('豆包本机 CDP 主进程未能在有界退出流程后结束');
      }
    }
    // A confirmed stock restore owns the managed debug child. Electron may
    // acknowledge the graceful quit before Node observes the child exit; use
    // the bounded terminate path so stop() cannot reject a successfully quit
    // client as a still-resident skin session.
    await this.stop({terminateApp: true});
    const currentApp = this.findClient(app.clientId, {fresh: true});
    if (!currentApp?.safeToLaunch) throw new Error(`退出后未找到经过签名验证的 ${app.displayName}`);
    await launchStock(currentApp);
    this.state = 'idle';
    this.log('success', `${app.displayName} 已无调试参数重新启动，恢复官方界面`);
    return {ok: true};
  }
}
