import crypto from 'node:crypto';
import {commerceError} from './errors.mjs';
import {assertTestProductConfiguration, normalizeDodoProduct} from './test-product-expectations.mjs';

const HEADER_NAMES = Object.freeze(['webhook-id', 'webhook-signature', 'webhook-timestamp']);

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertConfiguredValue(actual, expected, label) {
  if (!sameSecret(actual, expected)) {
    throw commerceError('DODO_ADAPTER_CONFIGURATION_MISMATCH', 503, `${label} 与已配置 Dodo client 不一致`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw commerceError('DODO_RESPONSE_INVALID', 502, `Dodo ${label} 响应无效`);
  }
  return value;
}

function sdkFailure(error, code = 'DODO_UPSTREAM_UNAVAILABLE', status = 502) {
  if (error?.code === 'DODO_RESPONSE_INVALID' || error?.code === 'LICENSE_NOT_ACTIVE') return error;
  return commerceError(code, status, code === 'WEBHOOK_SIGNATURE_INVALID'
    ? 'Dodo Webhook 签名无效'
    : 'Dodo 服务暂不可用', {cause: error});
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0);
}

function normalizedWebhookData(payload) {
  const data = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data : {};
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata : {};
  const payment = data.payment && typeof data.payment === 'object' && !Array.isArray(data.payment)
    ? data.payment : {};
  const subscription = data.subscription && typeof data.subscription === 'object' &&
    !Array.isArray(data.subscription) ? data.subscription : {};
  const licenseKey = data.license_key && typeof data.license_key === 'object' &&
    !Array.isArray(data.license_key) ? data.license_key : {};
  const result = {};
  const orderRef = firstString(data.order_ref, metadata.order_ref, payment.metadata?.order_ref);
  const directLicenseKeyId = firstString(data.license_key_id, data.licenseKeyId,
    licenseKey.license_key_id, licenseKey.id);
  const licenseKeyId = directLicenseKeyId ??
    (payload?.type === 'license_key.created' ? firstString(data.id) : undefined);
  const paymentId = firstString(data.payment_id, payment.payment_id, data.paymentId);
  const subscriptionId = firstString(data.subscription_id, subscription.subscription_id,
    data.subscriptionId,
    typeof payload?.type === 'string' && payload.type.startsWith('subscription.') ? data.id : undefined);
  if (orderRef !== undefined) result.orderRef = orderRef;
  if (licenseKeyId !== undefined) result.licenseKeyId = licenseKeyId;
  if (paymentId !== undefined) result.paymentId = paymentId;
  if (subscriptionId !== undefined) result.subscriptionId = subscriptionId;
  if (typeof data.external_id === 'string') result.externalId = data.external_id;
  return result;
}

function assertProductConfiguration(catalogProduct, response, environment) {
  if (environment === 'test_mode') {
    return assertTestProductConfiguration(catalogProduct, response);
  }
  const actual = normalizeDodoProduct(response);
  if (actual.productId !== catalogProduct.dodoProductId || actual.hasLicenseEntitlement !== true) {
    const error = new Error(`Dodo live 商品配置漂移: ${catalogProduct.id}`);
    error.code = 'DODO_PRODUCT_CONFIGURATION_DRIFT';
    throw error;
  }
  return true;
}

export function createOfficialDodoAdapters({
  client,
  apiKey,
  webhookKey,
  environment,
} = {}) {
  if (!client?.checkoutSessions || !client?.licenses || !client?.licenseKeys || !client?.webhooks || !client?.products) {
    throw new Error('缺少完整的 Dodo Payments 官方 SDK client');
  }
  if (typeof apiKey !== 'string' || !apiKey || typeof webhookKey !== 'string' || !webhookKey ||
      !['test_mode', 'live_mode'].includes(environment)) {
    throw new Error('Dodo Payments adapter 配置无效');
  }

  const dodoClient = Object.freeze({
    configured: true,
    adapterName: 'Dodo Payments official TypeScript SDK',

    async probeProductCatalog({products}) {
      if (!Array.isArray(products) || products.length !== 4) {
        throw commerceError('DODO_PRODUCT_CONFIGURATION_DRIFT', 503, 'Dodo 商品目录数量不正确');
      }
      try {
        for (const product of products) {
          const response = await client.products.retrieve(product.dodoProductId);
          assertProductConfiguration(product, response, environment);
        }
        return true;
      } catch (error) {
        if (error?.code === 'DODO_PRODUCT_CONFIGURATION_DRIFT') {
          throw commerceError('DODO_PRODUCT_CONFIGURATION_DRIFT', 503, 'Dodo 商品配置与发布预期不一致', {cause: error});
        }
        throw sdkFailure(error);
      }
    },

    async createCheckoutSession(input) {
      assertConfiguredValue(input.apiKey, apiKey, 'API key');
      assertConfiguredValue(input.environment, environment, 'environment');
      try {
        const response = requireObject(await client.checkoutSessions.create({
          product_cart: input.product_cart,
          return_url: input.return_url,
          metadata: input.metadata,
        }), 'checkout session');
        return {
          sessionId: response.session_id,
          checkoutUrl: response.checkout_url,
        };
      } catch (error) {
        throw sdkFailure(error);
      }
    },

    async validateLicense(input) {
      assertConfiguredValue(input.apiKey, apiKey, 'API key');
      assertConfiguredValue(input.environment, environment, 'environment');
      try {
        const response = requireObject(await client.licenses.validate({
          license_key: input.licenseKey,
          ...(input.licenseKeyInstanceId === undefined ? {} : {
            license_key_instance_id: input.licenseKeyInstanceId,
          }),
        }), 'license validation');
        return {valid: response.valid === true};
      } catch (error) {
        throw sdkFailure(error);
      }
    },

    async activateLicense(input) {
      assertConfiguredValue(input.environment, environment, 'environment');
      try {
        const response = requireObject(await client.licenses.activate({
          license_key: input.licenseKey,
          name: input.name,
        }), 'license activation');
        return {
          licenseKeyInstanceId: response.id,
          licenseKeyId: response.license_key_id,
          productId: response.product?.product_id,
          customerId: response.customer?.customer_id,
        };
      } catch (error) {
        throw sdkFailure(error);
      }
    },

    async retrieveLicense(input) {
      assertConfiguredValue(input.apiKey, apiKey, 'API key');
      assertConfiguredValue(input.environment, environment, 'environment');
      try {
        const response = requireObject(await client.licenseKeys.retrieve(input.licenseKeyId), 'license key');
        return {
          licenseKeyId: response.id,
          productId: response.product_id,
          customerId: response.customer_id,
          status: response.status,
          source: response.source,
          key: response.key,
          expiresAt: response.expires_at ?? null,
          paymentId: response.payment_id ?? null,
          subscriptionId: response.subscription_id ?? null,
        };
      } catch (error) {
        throw sdkFailure(error);
      }
    },

    async deactivateLicense(input) {
      assertConfiguredValue(input.environment, environment, 'environment');
      try {
        await client.licenses.deactivate({
          license_key: input.licenseKey,
          license_key_instance_id: input.licenseKeyInstanceId,
        });
        return {ok: true};
      } catch (error) {
        throw sdkFailure(error);
      }
    },
  });

  const webhookVerifier = Object.freeze({
    configured: true,
    adapterName: 'Dodo Payments official webhook unwrap',
    async unwrap({rawBodyText, headers, webhookKey: requestedWebhookKey}) {
      assertConfiguredValue(requestedWebhookKey, webhookKey, 'webhook key');
      if (typeof rawBodyText !== 'string') {
        throw commerceError('WEBHOOK_RAW_BODY_REQUIRED', 400, 'Webhook 必须传入原始字符串');
      }
      const selectedHeaders = {};
      for (const name of HEADER_NAMES) {
        if (typeof headers?.[name] !== 'string' || !headers[name]) {
          throw commerceError('WEBHOOK_SIGNATURE_INVALID', 401, `Webhook 缺少 ${name}`);
        }
        selectedHeaders[name] = headers[name];
      }
      try {
        // Deliberately call only the verified SDK API. unsafeUnwrap is never
        // referenced, even in test mode.
        const payload = requireObject(await client.webhooks.unwrap(rawBodyText, {
          headers: selectedHeaders,
        }), 'webhook');
        return {
          id: selectedHeaders['webhook-id'],
          type: payload.type,
          occurredAt: payload.timestamp,
          data: normalizedWebhookData(payload),
        };
      } catch (error) {
        throw sdkFailure(error, 'WEBHOOK_SIGNATURE_INVALID', 401);
      }
    },
  });

  return Object.freeze({dodoClient, webhookVerifier});
}

export const dodoSdkAdapterInternals = Object.freeze({normalizedWebhookData});
