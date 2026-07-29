/**
 * Public product catalog and trusted-commerce readiness checks.
 *
 * This is the only module that may contain Dodo Product IDs. A Product ID is
 * routing data for Dodo hosted checkout and public License API reconciliation;
 * it is never proof that a customer owns an entitlement. The desktop activates
 * and validates the Dodo-issued License Key before granting access.
 */

export const PRODUCT_CATALOG_SCHEMA_VERSION = 1;

// Verified against Dodo's hosted checkout on 2026-07-16: these four IDs exist
// Production product directory provisioned in Dodo live mode. The desktop
// opens static hosted checkout links and never embeds the merchant API key.
export const DODO_PRODUCT_DIRECTORY_ENVIRONMENT = 'live_mode';

export const DODO_PRODUCT_IDS = deepFreeze({
  vipMonthly: 'pdt_0NjWZqz1TDby1TNwWNDrb',
  vipYearly: 'pdt_0NjWZq3bhAD1lTsmOK0jU',
  skinPermanent: 'pdt_0NjWZpRBh70r1nylL6Pjw',
  customSlotPermanent: 'pdt_0NjWZonG0ci4Cfuk68jmw',
});

export const PRODUCT_CATALOG = deepFreeze([
  {
    id: 'vip-monthly',
    dodoProductId: DODO_PRODUCT_IDS.vipMonthly,
    offerType: 'vip_subscription',
    name: 'VIP 月度订阅',
    summary: '订阅有效期内解锁全部 VIP 皮肤、自定义皮肤与七日自动换肤。',
    billing: {kind: 'subscription', interval: 'month'},
    binding: {kind: 'none', immutable: false, selection: 'none'},
    features: ['全部 VIP 皮肤', '自定义皮肤', '七日自动换肤', '后续新增 VIP 功能'],
  },
  {
    id: 'vip-yearly',
    dodoProductId: DODO_PRODUCT_IDS.vipYearly,
    offerType: 'vip_subscription',
    name: 'VIP 年度订阅',
    summary: '按年订阅 VIP；权益范围与月度订阅一致。',
    billing: {kind: 'subscription', interval: 'year'},
    binding: {kind: 'none', immutable: false, selection: 'none'},
    features: ['全部 VIP 皮肤', '自定义皮肤', '七日自动换肤', '后续新增 VIP 功能'],
  },
  {
    id: 'skin-permanent',
    dodoProductId: DODO_PRODUCT_IDS.skinPermanent,
    offerType: 'skin_once',
    name: '单套皮肤永久授权',
    summary: '无需 VIP；授权码首次兑换时选择一套付费皮肤，绑定后永久不可更换。',
    billing: {kind: 'one_time', interval: null},
    binding: {kind: 'skin', immutable: true, selection: 'first_redemption'},
    features: ['首次兑换选定一套付费皮肤', '永久购买记录', '绑定后不可换肤'],
  },
  {
    id: 'custom-slot-permanent',
    dodoProductId: DODO_PRODUCT_IDS.customSlotPermanent,
    offerType: 'custom_slot_once',
    name: '自定义皮肤位永久授权',
    summary: '无需 VIP；解锁一个可持续编辑的自定义皮肤位，首次绑定后不可换位。',
    billing: {kind: 'one_time', interval: null},
    binding: {kind: 'profile', immutable: true, selection: 'first_redemption'},
    features: ['一个自定义皮肤位', '皮肤内容可持续编辑', '绑定后不可换位'],
  },
]);

export const TRUSTED_COMMERCE_ENV = deepFreeze({
  apiKey: 'DODO_PAYMENTS_API_KEY',
  webhookKey: 'DODO_PAYMENTS_WEBHOOK_KEY',
  environment: 'DODO_PAYMENTS_ENVIRONMENT',
  databaseUrl: 'SKIN_STUDIO_ENTITLEMENT_DATABASE_URL',
  leaseSigningKeyRef: 'SKIN_STUDIO_LEASE_SIGNING_KEY_REF',
  checkoutReturnUrl: 'SKIN_STUDIO_CHECKOUT_RETURN_URL',
  publicBaseUrl: 'SKIN_STUDIO_PUBLIC_BASE_URL',
});

const DODO_ENVIRONMENTS = new Set(['test_mode', 'live_mode']);
const CATALOG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validHttpsUrl(value) {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validPublicBaseUrl(value) {
  if (!validHttpsUrl(value)) return false;
  const url = new URL(value);
  return url.pathname === '/' && !url.search && !url.hash;
}

/**
 * Presence-only configuration audit for the trusted internet-facing service.
 * Secret values are deliberately never copied into the returned object.
 */
export function trustedCommerceReadiness(env = {}) {
  const environment = DODO_ENVIRONMENTS.has(env[TRUSTED_COMMERCE_ENV.environment])
    ? env[TRUSTED_COMMERCE_ENV.environment]
    : null;
  const checks = {
    api: nonEmpty(env[TRUSTED_COMMERCE_ENV.apiKey]) && environment !== null &&
      environment === DODO_PRODUCT_DIRECTORY_ENVIRONMENT,
    webhook: nonEmpty(env[TRUSTED_COMMERCE_ENV.webhookKey]),
    persistence: nonEmpty(env[TRUSTED_COMMERCE_ENV.databaseUrl]),
    leaseSigner: nonEmpty(env[TRUSTED_COMMERCE_ENV.leaseSigningKeyRef]),
    returnUrl: validHttpsUrl(env[TRUSTED_COMMERCE_ENV.checkoutReturnUrl]),
    publicUrl: validPublicBaseUrl(env[TRUSTED_COMMERCE_ENV.publicBaseUrl]),
  };
  const configured = Object.values(checks).every(Boolean);
  const reasonCode = environment === 'live_mode' &&
    DODO_PRODUCT_DIRECTORY_ENVIRONMENT === 'test_mode'
    ? 'DODO_LIVE_PRODUCT_IDS_REQUIRED'
    : configured ? null : 'TRUSTED_COMMERCE_UNCONFIGURED';
  return deepFreeze({
    status: configured ? 'configured' : 'unconfigured',
    configured,
    environment,
    checkoutEnabled: configured,
    redemptionEnabled: configured,
    webhookVerificationEnabled: checks.webhook,
    productDirectoryEnvironment: DODO_PRODUCT_DIRECTORY_ENVIRONMENT,
    reasonCode,
  });
}

export function requireTrustedCommerceConfiguration(env = {}) {
  const readiness = trustedCommerceReadiness(env);
  if (!readiness.configured) {
    const error = new Error('Dodo Payments 可信授权服务尚未完成配置');
    error.code = readiness.reasonCode === 'DODO_LIVE_PRODUCT_IDS_REQUIRED'
      ? 'DODO_LIVE_PRODUCT_IDS_REQUIRED' : 'COMMERCE_NOT_CONFIGURED';
    error.httpStatus = 503;
    throw error;
  }
  return readiness;
}

export function productByCatalogId(id) {
  if (typeof id !== 'string' || !CATALOG_ID.test(id)) return null;
  return PRODUCT_CATALOG.find((product) => product.id === id) ?? null;
}

/**
 * Trusted-server webhook/redemption lookup only. Finding a product here must
 * still be followed by verified payment/license state and a signed lease.
 */
export function productByDodoProductId(productId) {
  if (typeof productId !== 'string') return null;
  return PRODUCT_CATALOG.find((product) => product.dodoProductId === productId) ?? null;
}

export function publicProductCatalog({env = {}} = {}) {
  const commerce = trustedCommerceReadiness(env);
  return deepFreeze({
    schemaVersion: PRODUCT_CATALOG_SCHEMA_VERSION,
    provider: 'dodo_payments',
    commerce,
    products: PRODUCT_CATALOG.map((product) => ({
      id: product.id,
      dodoProductId: product.dodoProductId,
      offerType: product.offerType,
      name: product.name,
      summary: product.summary,
      billing: {...product.billing},
      binding: {...product.binding},
      features: [...product.features],
    })),
  });
}
