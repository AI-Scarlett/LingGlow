import {createCommerceHttpServer} from './http-server.mjs';
import {loadDeploymentAdapters} from './adapter-loader.mjs';
import {createProductDirectory} from './product-directory.mjs';
import {createCommerceService} from './service.mjs';
import {loadRuntimeConfig} from './runtime-config.mjs';
import {createRequestOriginPolicy} from './request-origin.mjs';
import {commerceReadiness, loadTrustedCommerceConfig} from './config.mjs';

const runtime = loadRuntimeConfig(process.env);

// This entrypoint intentionally wires no network, database, SDK, or KMS
// implementation. It can expose /healthz, while every commerce route remains
// fail-closed with 503 until a deployment-owned composition root injects all
// trusted adapters.
const adapters = await loadDeploymentAdapters(process.env);
const service = createCommerceService({
  env: process.env,
  repository: adapters.repository,
  dodoClient: adapters.dodoClient,
  webhookVerifier: adapters.webhookVerifier,
  leaseSigner: adapters.leaseSigner,
  productDirectory: createProductDirectory(),
});
const readiness = commerceReadiness(process.env);
const requestOriginPolicy = readiness.configured
  ? createRequestOriginPolicy({
      publicBaseUrl: loadTrustedCommerceConfig(process.env).publicBaseUrl,
      trustedProxyAddresses: runtime.trustedProxyAddresses,
    })
  : null;
const server = createCommerceHttpServer({service, authenticator: adapters.authenticator, requestOriginPolicy});
server.headersTimeout = runtime.headersTimeoutMs;
server.requestTimeout = runtime.requestTimeoutMs;
server.keepAliveTimeout = runtime.keepAliveTimeoutMs;

server.listen(runtime.port, runtime.host, () => {
  const address = server.address();
  // Only sanitized readiness and the listening address are logged. Secrets,
  // request bodies, license keys, customer ids, and device ids are forbidden.
  process.stdout.write(`${JSON.stringify({
    service: 'lingglow-commerce',
    address: typeof address === 'object' && address ? {address: address.address, port: address.port} : address,
    readiness: service.readiness(),
  })}\n`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`${JSON.stringify({service: 'lingglow-commerce', event: 'shutdown', signal})}\n`);
  const timer = setTimeout(() => {
    server.closeAllConnections?.();
    process.exitCode = 1;
  }, runtime.shutdownTimeoutMs);
  timer.unref();
  server.closeIdleConnections?.();
  await new Promise((resolve) => server.close(resolve));
  try {
    if (typeof adapters.close === 'function') await adapters.close();
  } finally {
    clearTimeout(timer);
  }
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
