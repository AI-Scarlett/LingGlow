import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {commerceReadiness} from './config.mjs';
import {createBuiltInCommerceAdapters} from './production-adapters.mjs';
import {createUnavailableAdapters} from './unavailable-adapters.mjs';

export async function loadDeploymentAdapters(env = {}) {
  // Do not even import a deployment-owned module until every trusted setting
  // is present. Import-time database or SDK initialization would otherwise be
  // an external side effect in a configuration that must fail closed.
  if (!commerceReadiness(env).configured) return createUnavailableAdapters();
  const modulePath = env.LINGGLOW_COMMERCE_ADAPTER_MODULE?.trim();
  if (!modulePath) return createBuiltInCommerceAdapters(env);
  if (!path.isAbsolute(modulePath)) throw new Error('LINGGLOW_COMMERCE_ADAPTER_MODULE 必须是绝对路径');
  const loaded = await import(pathToFileURL(modulePath).href);
  if (typeof loaded.createCommerceAdapters !== 'function') {
    throw new Error('部署 adapter 模块必须导出 createCommerceAdapters(env)');
  }
  const adapters = await loaded.createCommerceAdapters(env);
  for (const name of ['repository', 'dodoClient', 'webhookVerifier', 'leaseSigner', 'authenticator']) {
    if (!adapters?.[name] || adapters[name].configured !== true) {
      throw new Error(`部署 adapter 缺少已配置的 ${name}`);
    }
  }
  return Object.freeze(adapters);
}
