import net from 'node:net';

function integer(env, name, fallback, {min, max}) {
  const raw = env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 的整数`);
  }
  return value;
}

function proxyAddresses(raw = '') {
  if (!String(raw).trim()) return Object.freeze([]);
  const values = String(raw).split(',').map((value) => value.trim()).filter(Boolean);
  if (!values.length || new Set(values).size !== values.length || values.some((value) => net.isIP(value) === 0)) {
    throw new Error('COMMERCE_TRUSTED_PROXY_ADDRESSES 只接受逗号分隔的精确 IP 地址');
  }
  return Object.freeze(values);
}

export function loadRuntimeConfig(env = {}) {
  const host = String(env.COMMERCE_HOST ?? '').trim() || '127.0.0.1';
  if (net.isIP(host) === 0 && host !== 'localhost') throw new Error('COMMERCE_HOST 必须是 IP 或 localhost');
  return Object.freeze({
    host,
    port: integer(env, 'PORT', 8787, {min: 1, max: 65535}),
    trustedProxyAddresses: proxyAddresses(env.COMMERCE_TRUSTED_PROXY_ADDRESSES),
    headersTimeoutMs: integer(env, 'COMMERCE_HEADERS_TIMEOUT_MS', 15_000, {min: 1_000, max: 120_000}),
    requestTimeoutMs: integer(env, 'COMMERCE_REQUEST_TIMEOUT_MS', 30_000, {min: 1_000, max: 300_000}),
    keepAliveTimeoutMs: integer(env, 'COMMERCE_KEEP_ALIVE_TIMEOUT_MS', 5_000, {min: 500, max: 60_000}),
    shutdownTimeoutMs: integer(env, 'COMMERCE_SHUTDOWN_TIMEOUT_MS', 10_000, {min: 1_000, max: 60_000}),
  });
}

export const runtimeConfigInternals = Object.freeze({proxyAddresses});
