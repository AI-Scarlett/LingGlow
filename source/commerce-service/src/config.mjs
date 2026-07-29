import {
  TRUSTED_COMMERCE_ENV,
  requireTrustedCommerceConfiguration,
  trustedCommerceReadiness,
} from '../../src/products.mjs';

function secret(env, key) {
  return String(env[key]).trim();
}

export function commerceReadiness(env = {}) {
  return trustedCommerceReadiness(env);
}

export function loadTrustedCommerceConfig(env = {}) {
  const readiness = requireTrustedCommerceConfiguration(env);
  return Object.freeze({
    environment: readiness.environment,
    apiKey: secret(env, TRUSTED_COMMERCE_ENV.apiKey),
    webhookKey: secret(env, TRUSTED_COMMERCE_ENV.webhookKey),
    databaseUrl: secret(env, TRUSTED_COMMERCE_ENV.databaseUrl),
    leaseSigningKeyRef: secret(env, TRUSTED_COMMERCE_ENV.leaseSigningKeyRef),
    checkoutReturnUrl: secret(env, TRUSTED_COMMERCE_ENV.checkoutReturnUrl),
    publicBaseUrl: secret(env, TRUSTED_COMMERCE_ENV.publicBaseUrl),
  });
}

export function publicReadiness(env = {}) {
  const status = commerceReadiness(env);
  return Object.freeze({
    status: status.status,
    configured: status.configured,
    environment: status.environment,
    reasonCode: status.reasonCode,
  });
}
