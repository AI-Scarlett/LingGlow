import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import test from 'node:test';
import {createCommerceHttpServer} from '../src/http-server.mjs';
import {loadDeploymentAdapters} from '../src/adapter-loader.mjs';
import {createProductDirectory} from '../src/product-directory.mjs';
import {createCommerceService} from '../src/service.mjs';
import {createUnavailableAdapters} from '../src/unavailable-adapters.mjs';
import {
  FakeDodoClient,
  FakeWebhookVerifier,
  MemoryRepository,
  createTemporaryLeaseSigner,
  deterministicIds,
  fakeAuthenticator,
} from './fakes.mjs';

const ENV = Object.freeze({
  DODO_PAYMENTS_API_KEY: 'test-api-key',
  DODO_PAYMENTS_WEBHOOK_KEY: 'test-webhook-key',
  DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
  SKIN_STUDIO_ENTITLEMENT_DATABASE_URL: 'postgresql://test.invalid/lingglow',
  SKIN_STUDIO_LEASE_SIGNING_KEY_REF: 'kms://test/lingglow-lease',
  SKIN_STUDIO_CHECKOUT_RETURN_URL: 'https://account.test/checkout/return',
  SKIN_STUDIO_PUBLIC_BASE_URL: 'https://commerce.test/',
});

test('missing trusted settings never import a deployment adapter module', async () => {
  const adapters = await loadDeploymentAdapters({
    LINGGLOW_COMMERCE_ADAPTER_MODULE: '/definitely-not-importable/commerce-adapter.mjs',
  });
  assert.equal(adapters.repository.configured, false);
  assert.equal(adapters.dodoClient.configured, false);
});

async function invoke(server, {method = 'POST', url, headers = {}, body = Buffer.alloc(0)}) {
  const request = Readable.from(body.length ? [body] : []);
  request.method = method;
  request.url = url;
  request.headers = headers;
  request.socket = {remoteAddress: '127.0.0.1'};
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: null,
      headers: null,
      writeHead(statusCode, outgoingHeaders) {
        this.statusCode = statusCode;
        this.headers = outgoingHeaders;
      },
      end(bytes = Buffer.alloc(0)) {
        try {
          resolve({
            statusCode: this.statusCode,
            headers: this.headers,
            raw: Buffer.from(bytes),
            json: JSON.parse(Buffer.from(bytes).toString('utf8')),
          });
        } catch (error) {
          reject(error);
        }
      },
    };
    server.emit('request', request, response);
  });
}

test('unconfigured default composition exposes health but every commerce route is 503', async () => {
  const unavailable = createUnavailableAdapters();
  const service = createCommerceService({
    env: {},
    repository: unavailable.repository,
    dodoClient: unavailable.dodoClient,
    webhookVerifier: unavailable.webhookVerifier,
    leaseSigner: unavailable.leaseSigner,
  });
  const server = createCommerceHttpServer({service, authenticator: unavailable.authenticator});
  const health = await invoke(server, {method: 'GET', url: '/healthz'});
  assert.equal(health.statusCode, 200);
  assert.equal(health.json.configured, false);
  assert.equal(JSON.stringify(health.json).includes('test-api-key'), false);
  const checkout = await invoke(server, {
    url: '/v1/checkouts',
    headers: {'content-type': 'application/json'},
    body: Buffer.from('{}'),
  });
  assert.equal(checkout.statusCode, 503);
  assert.equal(checkout.json.error.code, 'COMMERCE_NOT_CONFIGURED');
  server.close();
});

test('webhook HTTP route passes the exact raw bytes and standard headers to the verifier', async () => {
  const repository = new MemoryRepository();
  const dodoClient = new FakeDodoClient();
  const webhookVerifier = new FakeWebhookVerifier();
  const signer = createTemporaryLeaseSigner();
  const service = createCommerceService({
    env: ENV,
    repository,
    dodoClient,
    webhookVerifier,
    leaseSigner: signer.adapter,
    productDirectory: createProductDirectory(),
    clock: () => new Date('2026-07-16T12:00:00.000Z'),
    randomId: deterministicIds(),
  });
  const server = createCommerceHttpServer({service, authenticator: fakeAuthenticator});
  const raw = Buffer.from('{ "id":"webhook-noop-1", "type":"payment.processing", "occurredAt":"2026-07-16T12:00:00.000Z", "data":{} }');
  const headers = {
    'content-type': 'application/json',
    'webhook-id': 'webhook-noop-1',
    'webhook-signature': 'valid-test-signature',
    'webhook-timestamp': '1784203200',
  };
  const result = await invoke(server, {url: '/v1/webhooks/dodo', headers, body: raw});
  assert.equal(result.statusCode, 200);
  assert.equal(result.json.duplicate, false);
  assert.equal(webhookVerifier.calls[0].rawBodyText, raw.toString('utf8'));
  assert.equal(webhookVerifier.calls[0].headers['webhook-id'], 'webhook-noop-1');

  const invalid = await invoke(server, {
    url: '/v1/webhooks/dodo',
    headers: {...headers, 'webhook-signature': 'wrong'},
    body: raw,
  });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.json.error.code, 'WEBHOOK_SIGNATURE_INVALID');

  const callsBeforeInvalidUtf8 = webhookVerifier.calls.length;
  const invalidUtf8 = await invoke(server, {
    url: '/v1/webhooks/dodo',
    headers,
    body: Buffer.from([0xff]),
  });
  assert.equal(invalidUtf8.statusCode, 400);
  assert.equal(invalidUtf8.json.error.code, 'WEBHOOK_PAYLOAD_INVALID');
  assert.equal(webhookVerifier.calls.length, callsBeforeInvalidUtf8);
  server.close();
});

test('checkout endpoint authenticates server-side and does not accept client product routing', async () => {
  const repository = new MemoryRepository();
  const dodoClient = new FakeDodoClient();
  const signer = createTemporaryLeaseSigner();
  const service = createCommerceService({
    env: ENV,
    repository,
    dodoClient,
    webhookVerifier: new FakeWebhookVerifier(),
    leaseSigner: signer.adapter,
    clock: () => new Date('2026-07-16T12:00:00.000Z'),
    randomId: deterministicIds(),
  });
  const server = createCommerceHttpServer({service, authenticator: fakeAuthenticator});
  const body = Buffer.from(JSON.stringify({
    catalogProductId: 'vip-monthly',
    idempotencyKey: 'checkout-idempotency-http-1',
    productId: 'client-selected-product',
  }));
  const result = await invoke(server, {
    url: '/v1/checkouts',
    headers: {'content-type': 'application/json', authorization: 'Bearer test-session'},
    body,
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.json.error.code, 'INVALID_REQUEST');
  assert.equal(dodoClient.checkouts.length, 0);
  server.close();
});
