#!/usr/bin/env node
import {compatibilityFor} from './adapter.mjs';
import {
  SUPPORTED_CLIENT_IDS,
  findClientApp,
  launchStock,
  quitClientGracefully,
  runningMainProcesses,
} from './client-app.mjs';
import {startStudioServer} from './server.mjs';

const [command = 'dashboard', ...args] = process.argv.slice(2);

function printDoctor() {
  const payload = Object.fromEntries(SUPPORTED_CLIENT_IDS.map((clientId) => {
    const app = findClientApp(clientId, {fresh: true});
    const compatibility = compatibilityFor(app);
    return [clientId, {
      app: app ? {
        path: app.path,
        bundleId: app.bundleId,
        version: app.version,
        build: app.build,
        chromium: app.chromium,
        teamId: app.teamId,
        cdHash: app.cdHash,
        signatureValid: app.signatureValid,
        asarSha256: app.asarSha256,
        manifestCommit: app.manifestCommit ?? null,
        nestedBrowser: app.nestedBrowser ?? null,
        localExtension: app.localExtension ?? null,
        artifactSha256: app.artifactSha256 ?? null,
        targetAllowlist: app.targetAllowlist ?? [],
        transportVerification: app.transportVerification ?? null,
        launchStrategies: app.launchStrategies ?? [],
        signals: app.signals,
        running: runningMainProcesses(app).length > 0,
      } : null,
      compatibility,
    }];
  }));
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = Object.values(payload).some((item) => item.compatibility.advancedAllowed) ? 0 : 2;
}

async function restoreStock(clientId = 'codex') {
  if (!SUPPORTED_CLIENT_IDS.includes(clientId)) {
    throw new Error('恢复目标只支持 codex、workbuddy 或 doubao');
  }
  const app = findClientApp(clientId, {fresh: true});
  if (!app?.safeToLaunch) throw new Error(`未找到经过官方签名验证的 ${clientId}`);
  const quit = await quitClientGracefully(app);
  if (!quit.ok) throw new Error(quit.error);
  const currentApp = findClientApp(clientId, {fresh: true});
  if (!currentApp?.safeToLaunch) throw new Error(`退出后未找到经过官方签名验证的 ${clientId}`);
  await launchStock(currentApp);
  console.log(`已无调试参数重新启动 ${currentApp.displayName}，官方界面已恢复。`);
}

async function dashboard() {
  const {studio, host, port, reused} = await startStudioServer({openBrowser: args.includes('--open')});
  console.log(`灵妆 LingGlow: http://${host}:${port}/（会话令牌未写入日志）`);
  if (reused || !studio) return;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await studio.shutdown();
      process.exitCode = 0;
    } catch (error) {
      stopping = false;
      process.exitCode = 1;
      console.error(`无法安全关闭：${error.message}`);
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

try {
  if (command === 'doctor') printDoctor();
  else if (command === 'restore-stock' || command === 'stock') await restoreStock(args[0] || 'codex');
  else if (command === 'dashboard' || command === 'start') await dashboard();
  else {
    console.error('用法: cli.mjs [dashboard --open | doctor | restore-stock codex|workbuddy|doubao]');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
