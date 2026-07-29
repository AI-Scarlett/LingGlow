import http from 'node:http';
import crypto from 'node:crypto';
import {asCommerceError, commerceError, publicErrorBody} from './errors.mjs';

const JSON_LIMIT = 64 * 1024;
const WEBHOOK_LIMIT = 1024 * 1024;

function responseHeaders(requestId) {
  return {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  };
}

function sendJson(response, status, body, requestId) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {...responseHeaders(requestId), 'content-length': String(bytes.length)});
  response.end(bytes);
}

async function readRawBody(request, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw commerceError('REQUEST_TOO_LARGE', 413, '请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function readJson(request) {
  const type = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') throw commerceError('UNSUPPORTED_MEDIA_TYPE', 415, '请求必须是 application/json');
  const raw = await readRawBody(request, JSON_LIMIT);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw commerceError('INVALID_JSON', 400, '请求体不是有效 JSON');
  }
}

function normalizedHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    Array.isArray(value) ? value.join(',') : String(value ?? ''),
  ]));
}

function routeKey(request) {
  let url;
  try {
    url = new URL(request.url, 'http://commerce.invalid');
  } catch {
    throw commerceError('INVALID_URL', 400, '请求 URL 无效');
  }
  if (url.search) throw commerceError('QUERY_NOT_ALLOWED', 400, '该接口不接受 query 参数');
  return `${request.method ?? ''} ${url.pathname}`;
}

export function createCommerceHttpServer({service, authenticator, requestOriginPolicy = null} = {}) {
  if (!service) throw new Error('缺少 commerce service');
  return http.createServer(async (request, response) => {
    const requestId = crypto.randomUUID();
    try {
      const route = routeKey(request);
      if (route === 'GET /healthz') {
        sendJson(response, 200, {ok: true, service: 'lingglow-commerce', ...service.readiness()}, requestId);
        return;
      }

      if (route === 'GET /readyz') {
        const readiness = await service.probeReadiness();
        const authenticationReady = Boolean(authenticator?.configured === true &&
          typeof authenticator.authenticate === 'function');
        const ready = readiness.ready && authenticationReady;
        sendJson(response, ready ? 200 : 503, {
          ok: ready,
          service: 'lingglow-commerce',
          ready,
          reasonCode: ready ? null : authenticationReady ? readiness.reasonCode : 'AUTHENTICATOR_UNCONFIGURED',
        }, requestId);
        return;
      }

      if (requestOriginPolicy) requestOriginPolicy.assertPublicHttps(request);

      if (route === 'POST /v1/checkouts') {
        service.assertReady();
        if (!authenticator || authenticator.configured === false || typeof authenticator.authenticate !== 'function') {
          throw commerceError('TRUSTED_ADAPTERS_UNCONFIGURED', 503, '身份认证 adapter 尚未配置');
        }
        const customer = await authenticator.authenticate({
          headers: normalizedHeaders(request.headers),
          remoteAddress: request.socket.remoteAddress ?? null,
        });
        const result = await service.createCheckout(await readJson(request), customer);
        sendJson(response, result.reused ? 200 : 201, result, requestId);
        return;
      }

      if (route === 'POST /v1/webhooks/dodo') {
        service.assertReady({webhook: true});
        const raw = await readRawBody(request, WEBHOOK_LIMIT);
        const result = await service.processDodoWebhook(raw, normalizedHeaders(request.headers));
        sendJson(response, 200, result, requestId);
        return;
      }

      if (route === 'POST /v1/redemptions') {
        service.assertReady();
        sendJson(response, 200, await service.redeem(await readJson(request)), requestId);
        return;
      }

      if (route === 'POST /v1/leases/refresh') {
        service.assertReady();
        sendJson(response, 200, await service.refreshLease(await readJson(request)), requestId);
        return;
      }

      if (route === 'POST /v1/devices/deactivate') {
        service.assertReady();
        sendJson(response, 200, await service.deactivateDevice(await readJson(request)), requestId);
        return;
      }

      throw commerceError('NOT_FOUND', 404, '接口不存在');
    } catch (error) {
      const normalized = asCommerceError(error);
      sendJson(response, normalized.httpStatus, publicErrorBody(normalized, requestId), requestId);
    }
  });
}

export const httpServerInternals = Object.freeze({readRawBody, normalizedHeaders});
