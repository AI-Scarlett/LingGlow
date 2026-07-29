function stringIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.length > 0))];
}

export function hasEntitlementPermission(entitlement, permission) {
  return entitlement?.permissions?.[permission] === true;
}

export function purchasedSkinIds(entitlement) {
  return stringIds(entitlement?.skinIds);
}

export function boundCustomProfileIds(entitlement) {
  return stringIds(entitlement?.customProfileIds);
}

export function canUseCatalogSkin(entitlement, skin) {
  if (!skin || typeof skin.id !== 'string') return false;
  if (skin.tier !== 'vip') return hasEntitlementPermission(entitlement, 'freeCatalog');
  return hasEntitlementPermission(entitlement, 'vipCatalog') ||
    purchasedSkinIds(entitlement).includes(skin.id);
}

export function canAccessCustomStudio(entitlement) {
  if (hasEntitlementPermission(entitlement, 'allFeatures')) return true;
  return hasEntitlementPermission(entitlement, 'custom') &&
    boundCustomProfileIds(entitlement).length > 0;
}

export function canPersistCustomProfile(entitlement, profileId) {
  if (typeof profileId !== 'string' || profileId.length === 0) return false;
  if (hasEntitlementPermission(entitlement, 'allFeatures')) return true;
  return hasEntitlementPermission(entitlement, 'custom') &&
    boundCustomProfileIds(entitlement).includes(profileId);
}
