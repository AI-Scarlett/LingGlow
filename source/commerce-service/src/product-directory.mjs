import {listBuiltInSkins} from '../../src/catalog.mjs';
import {listRegisteredThemePacks} from '../../src/catalog/theme-pack.mjs';
import {DODO_PRODUCT_DIRECTORY_ENVIRONMENT, PRODUCT_CATALOG} from '../../src/products.mjs';
import {commerceError} from './errors.mjs';

const EXPECTED_CATALOG_IDS = Object.freeze([
  'vip-monthly',
  'vip-yearly',
  'skin-permanent',
  'custom-slot-permanent',
]);
const OFFER_TYPES = new Set(['vip_subscription', 'skin_once', 'custom_slot_once']);

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) freeze(nested);
  }
  return value;
}

function productProjection(product) {
  return {
    id: product.id,
    dodoProductId: product.dodoProductId,
    offerType: product.offerType,
    billing: clone(product.billing),
    binding: clone(product.binding),
  };
}

export function assertProductDirectoryMirror(mirror, canonical = PRODUCT_CATALOG) {
  if (!Array.isArray(mirror) || mirror.length !== canonical.length) {
    throw new Error('product directory mirror 数量不匹配');
  }
  const expected = canonical.map(productProjection).sort((a, b) => a.id.localeCompare(b.id));
  const actual = mirror.map(productProjection).sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('product directory mirror 与 src/products.mjs 不一致');
  }
  return true;
}

function validateProducts(products) {
  assertProductDirectoryMirror(products, PRODUCT_CATALOG);
  const ids = products.map(({id}) => id).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...EXPECTED_CATALOG_IDS].sort())) {
    throw new Error('可信商品目录不是预期四种商品');
  }
  if (new Set(products.map(({dodoProductId}) => dodoProductId)).size !== products.length ||
      !products.every(({offerType}) => OFFER_TYPES.has(offerType))) {
    throw new Error('可信商品目录 Product ID 或 offerType 不合法');
  }
}

function defaultSellableSkins() {
  return [
    ...listBuiltInSkins({tier: 'vip'}),
    ...listRegisteredThemePacks({clientId: 'codex', tier: 'vip'}),
  ];
}

export function createProductDirectory({
  products = PRODUCT_CATALOG,
  sellableSkins = defaultSellableSkins(),
} = {}) {
  validateProducts(products);
  if (!Array.isArray(sellableSkins) || !sellableSkins.length ||
      sellableSkins.some((skin) => skin?.tier !== 'vip' || typeof skin.id !== 'string') ||
      new Set(sellableSkins.map(({id}) => id)).size !== sellableSkins.length) {
    throw new Error('服务端可单卖皮肤目录无效');
  }
  const catalog = freeze(clone(products));
  const byCatalogId = new Map(catalog.map((product) => [product.id, product]));
  const byDodoProductId = new Map(catalog.map((product) => [product.dodoProductId, product]));
  const skinIds = new Set(sellableSkins.map(({id}) => id));
  return Object.freeze({
    schemaVersion: 1,
    dodoEnvironment: DODO_PRODUCT_DIRECTORY_ENVIRONMENT,
    source: '../../src/products.mjs',
    products: catalog,
    sellableSkinIds: Object.freeze([...skinIds].sort()),
    byCatalogId(id) {
      return byCatalogId.get(id) ?? null;
    },
    byDodoProductId(id) {
      return byDodoProductId.get(id) ?? null;
    },
    requireCatalogProduct(id) {
      const product = byCatalogId.get(id);
      if (!product) throw commerceError('PRODUCT_NOT_FOUND', 404, '未知商品');
      return product;
    },
    requireTrustedProduct(id) {
      const product = byDodoProductId.get(id);
      if (!product) throw commerceError('PRODUCT_NOT_ENTITLED', 403, '授权码商品不属于可信目录');
      return product;
    },
    requireSellableSkin(id) {
      if (!skinIds.has(id)) throw commerceError('SKIN_NOT_SELLABLE', 400, '该皮肤不在可单卖发布目录');
      return id;
    },
  });
}
