// Deployment-drift fixture observed from Dodo test checkout hydration on
// 2026-07-16. Prices never authorize access; verified licenses and signed
// leases do. No Product ID is duplicated here.
export const TEST_PRODUCT_EXPECTATIONS = Object.freeze({
  'vip-monthly': Object.freeze({
    recurring: true,
    price: Object.freeze({type: 'recurring_price', amount: 100, currency: 'USD',
      intervalCount: 1, interval: 'Month'}),
    license: Object.freeze({fulfillmentMode: 'auto', activationsLimit: 1,
      durationCount: 1, durationInterval: 'Month'}),
  }),
  'vip-yearly': Object.freeze({
    recurring: true,
    price: Object.freeze({type: 'recurring_price', amount: 999, currency: 'USD',
      intervalCount: 1, interval: 'Year'}),
    license: Object.freeze({fulfillmentMode: 'auto', activationsLimit: 1,
      durationCount: 1, durationInterval: 'Year'}),
  }),
  'skin-permanent': Object.freeze({
    recurring: false,
    price: Object.freeze({type: 'one_time_price', amount: 10, currency: 'USD',
      payWhatYouWant: true, suggestedPrice: 90}),
    license: Object.freeze({fulfillmentMode: 'auto', activationsLimit: 1}),
  }),
  'custom-slot-permanent': Object.freeze({
    recurring: false,
    price: Object.freeze({type: 'one_time_price', amount: 10, currency: 'USD',
      payWhatYouWant: false, suggestedPrice: null}),
    license: Object.freeze({fulfillmentMode: 'auto', activationsLimit: 1}),
  }),
});

function info(value) {
  return value?.product_info && typeof value.product_info === 'object' ? value.product_info : value;
}

export function normalizeDodoProduct(value) {
  const product = info(value);
  const price = product?.price ?? {};
  const entitlement = Array.isArray(product?.entitlements)
    ? product.entitlements.find((item) => item?.integration_type === 'license_key') : null;
  const license = entitlement?.integration_config ?? {};
  return {
    productId: product?.product_id,
    recurring: product?.is_recurring,
    price: {
      type: price.type,
      amount: price.price,
      currency: price.currency,
      intervalCount: price.payment_frequency_count,
      interval: price.payment_frequency_interval,
      payWhatYouWant: price.pay_what_you_want,
      suggestedPrice: price.suggested_price ?? null,
    },
    hasLicenseEntitlement: Boolean(entitlement),
    license: {
      fulfillmentMode: license.fulfillment_mode,
      activationsLimit: license.activations_limit,
      durationCount: license.duration_count,
      durationInterval: license.duration_interval,
    },
  };
}

function matchesSubset(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return Object.entries(expected).every(([key, value]) => matchesSubset(actual?.[key], value));
  }
  return Object.is(actual, expected);
}

export function assertTestProductConfiguration(catalogProduct, response) {
  const expected = TEST_PRODUCT_EXPECTATIONS[catalogProduct.id];
  if (!expected) throw new Error(`没有 ${catalogProduct.id} 的部署预检 fixture`);
  const actual = normalizeDodoProduct(response);
  if (actual.productId !== catalogProduct.dodoProductId || actual.hasLicenseEntitlement !== true ||
      !matchesSubset(actual, expected)) {
    const error = new Error(`Dodo test 商品配置漂移: ${catalogProduct.id}`);
    error.code = 'DODO_PRODUCT_CONFIGURATION_DRIFT';
    throw error;
  }
  return true;
}
