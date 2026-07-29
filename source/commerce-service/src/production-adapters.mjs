import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadTrustedCommerceConfig} from './config.mjs';
import {createOfficialDodoAdapters} from './dodo-sdk-adapter.mjs';
import {createPostgresRepository} from './postgres-repository.mjs';

function absoluteModulePath(value, name) {
  const selected = String(value ?? '').trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error(`${name} 必须是绝对路径`);
  return selected;
}

function numberSetting(env, name, fallback, min, max) {
  const raw = String(env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 的整数`);
  }
  return value;
}

export function createPostgresPoolOptions(env, databaseUrl) {
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error('PostgreSQL URL 无效'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hash) {
    throw new Error('PostgreSQL URL 必须使用 postgres/postgresql 协议且不带 fragment');
  }
  const sslMode = String(env.SKIN_STUDIO_DATABASE_SSL_MODE ?? '').trim();
  if (!['verify-full', 'require', 'disable'].includes(sslMode)) {
    throw new Error('SKIN_STUDIO_DATABASE_SSL_MODE 必须显式设为 verify-full、require 或 disable');
  }
  const loopback = parsed.hostname === 'localhost' || net.isIP(parsed.hostname) > 0 &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === '::1');
  if (sslMode === 'disable' && !loopback) {
    throw new Error('非回环 PostgreSQL 连接不允许禁用 TLS');
  }
  let ssl = false;
  if (sslMode !== 'disable') {
    const caFile = String(env.SKIN_STUDIO_DATABASE_CA_FILE ?? '').trim();
    ssl = {rejectUnauthorized: true};
    if (caFile) {
      if (!path.isAbsolute(caFile)) throw new Error('SKIN_STUDIO_DATABASE_CA_FILE 必须是绝对路径');
      ssl.ca = fs.readFileSync(caFile, 'utf8');
    }
  }
  return Object.freeze({
    connectionString: databaseUrl,
    ssl,
    max: numberSetting(env, 'SKIN_STUDIO_DATABASE_POOL_MAX', 10, 1, 100),
    connectionTimeoutMillis: numberSetting(env, 'SKIN_STUDIO_DATABASE_CONNECT_TIMEOUT_MS', 5_000, 500, 60_000),
    idleTimeoutMillis: numberSetting(env, 'SKIN_STUDIO_DATABASE_IDLE_TIMEOUT_MS', 30_000, 1_000, 300_000),
    application_name: 'lingglow-commerce',
  });
}

export async function createBuiltInCommerceAdapters(env, {sdkModule, pgModule} = {}) {
  const config = loadTrustedCommerceConfig(env);
  const sdk = sdkModule ?? await import('dodopayments');
  const postgres = pgModule ?? await import('pg');
  const DodoPayments = sdk.default;
  const Pool = postgres.Pool ?? postgres.default?.Pool;
  if (typeof DodoPayments !== 'function' || typeof Pool !== 'function') {
    throw new Error('安装的 Dodo Payments 或 PostgreSQL SDK 导出无效');
  }
  const pool = new Pool(createPostgresPoolOptions(env, config.databaseUrl));
  const repository = createPostgresRepository({pool});
  try {
    const sdkClient = new DodoPayments({
      bearerToken: config.apiKey,
      environment: config.environment,
      webhookKey: config.webhookKey,
    });
    const {dodoClient, webhookVerifier} = createOfficialDodoAdapters({
      client: sdkClient,
      apiKey: config.apiKey,
      webhookKey: config.webhookKey,
      environment: config.environment,
    });
    const trustPath = absoluteModulePath(env.LINGGLOW_COMMERCE_TRUST_MODULE,
      'LINGGLOW_COMMERCE_TRUST_MODULE');
    const trustModule = await import(pathToFileURL(trustPath).href);
    if (typeof trustModule.createCommerceTrustAdapters !== 'function') {
      throw new Error('信任模块必须导出 createCommerceTrustAdapters(env, ports)');
    }
    const trust = await trustModule.createCommerceTrustAdapters(env, {repository, dodoClient});
    for (const name of ['leaseSigner', 'authenticator']) {
      if (!trust?.[name] || trust[name].configured !== true) {
        throw new Error(`信任模块缺少已配置的 ${name}`);
      }
    }
    return Object.freeze({
      repository,
      dodoClient,
      webhookVerifier,
      leaseSigner: trust.leaseSigner,
      authenticator: trust.authenticator,
      async close() {
        try {
          if (typeof trust.close === 'function') await trust.close();
        } finally {
          await repository.close();
        }
      },
    });
  } catch (error) {
    await repository.close().catch(() => {});
    throw error;
  }
}
