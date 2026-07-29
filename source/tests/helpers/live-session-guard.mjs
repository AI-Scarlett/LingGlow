import fs from 'node:fs';
import path from 'node:path';
import {defaultDataDir} from '../../src/profile.mjs';

// Real-client QA restarts the target Agent. Refuse to do that while the local
// LingGlow service owns an active skin, unless a developer explicitly opts in.
// This prevents a visual test from silently replacing the user's applied skin
// with the stock client during cleanup.
export async function refuseManagedLiveSession(clientId, {
  allowEnvironment = 'LINGGLOW_LIVE_QA_REPLACE_ACTIVE',
} = {}) {
  if (process.env[allowEnvironment] === '1') return;
  const lockPath = path.join(defaultDataDir(), 'studio-session.json');
  if (!fs.existsSync(lockPath)) return;
  const stat = fs.lstatSync(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 16 * 1024) {
    throw new Error('本地灵妆会话文件不安全，拒绝运行真实客户端测试');
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock?.host !== '127.0.0.1' || !Number.isInteger(lock?.port) ||
      lock.port < 1 || lock.port > 65535 || typeof lock?.token !== 'string' || !lock.token) {
    throw new Error('本地灵妆会话文件无效，拒绝运行真实客户端测试');
  }
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${lock.port}/api/status`, {
      headers: {Authorization: `Bearer ${lock.token}`, Accept: 'application/json'},
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    return;
  }
  if (!response.ok) return;
  const status = await response.json();
  const session = status?.clients?.[clientId]?.session;
  if (session?.state === 'active' || session?.mode) {
    throw new Error(
      `${clientId} 正由本机灵妆服务应用皮肤（${session.profileId || '未知皮肤'}）；` +
      `真实客户端测试已拒绝覆盖。仅在明确允许替换当前皮肤时设置 ${allowEnvironment}=1。`,
    );
  }
}
