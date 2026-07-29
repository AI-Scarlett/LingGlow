#!/usr/bin/env node
/**
 * Apply a World Cup theme pack to the full Doubao App and HOLD the skin session.
 * Do not exit until SIGINT/SIGTERM — exiting would drop CDP inject and restore stock look.
 *
 * Usage:
 *   node scripts/apply-doubao-worldcup.mjs [cr7-portugal|messi-argentina|neymar-brazil]
 */
import {findDoubaoApp} from '../src/client-app.mjs';
import {compatibilityFor} from '../src/adapter.mjs';
import {getRegisteredThemePack, materializeThemePack} from '../src/catalog/theme-pack.mjs';
import {SkinSessionManager} from '../src/cdp.mjs';

const packId = process.argv[2] || 'cr7-portugal';
const pack = getRegisteredThemePack(packId);
if (!pack) {
  console.error(`未知主题包: ${packId}`);
  process.exit(1);
}

const profile = materializeThemePack(pack, 'doubao');
profile.advanced.enabled = true;

const app = findDoubaoApp({fresh: true});
if (!app?.safeToLaunch) {
  console.error('未找到可安全启动的豆包 App');
  process.exit(1);
}
const compatibility = compatibilityFor(app);
if (!compatibility.advancedAllowed) {
  console.error(compatibility.reason || '豆包尚未开放换肤');
  process.exit(1);
}

const manager = new SkinSessionManager();
manager.on('log', (entry) => {
  const msg = entry?.message || entry;
  console.log(`[灵妆] ${msg}`);
});

console.log(JSON.stringify({
  action: 'apply-doubao-full-app',
  packId,
  accent: profile.official?.accent,
  adapter: compatibility.adapter?.adapterId,
  level: compatibility.level,
}, null, 2));

const status = await manager.launch({
  app,
  profile,
  compatibility,
  confirmRestart: true,
});

console.log(JSON.stringify({
  ok: true,
  state: status.state,
  injectedTargets: status.injectedTargets,
  nestedPid: status.pid,
  mainPid: manager.doubaoMainPid,
  profileId: status.profileId,
  hold: '皮肤会话常驻中。按 Ctrl+C 才会恢复原版。请查看 Dock 中的【豆包】App（仅启动 Doubao.app，不再单独打开豆包浏览器）。',
}, null, 2));

const shutdown = async (signal) => {
  console.log(`\n收到 ${signal}，正在恢复原版…`);
  try {
    await manager.stop({terminateApp: true});
  } catch (error) {
    console.error('stop:', error.message);
  }
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Keep event loop alive
setInterval(() => {
  const live = manager.status();
  if (live.state === 'error' || live.state === 'idle') {
    console.error('皮肤会话已结束:', live);
    process.exit(1);
  }
}, 5000).unref?.();
