function unavailable(name, methods) {
  return Object.freeze({
    configured: false,
    adapterName: name,
    ...Object.fromEntries(methods.map((method) => [method, async () => {
      const error = new Error(`${name} adapter is not installed`);
      error.code = 'TRUSTED_ADAPTERS_UNCONFIGURED';
      error.httpStatus = 503;
      throw error;
    }])),
  });
}

export function createUnavailableAdapters() {
  return Object.freeze({
    repository: unavailable('PostgreSQL repository', [
      'createOrGetCheckoutOrder', 'completeCheckoutOrder', 'withLicenseLock',
      'findGrantByLicenseKeyId', 'createGrant', 'updateGrant', 'findBindingByLicenseKeyId',
      'createBinding', 'findPaidOrder', 'findActiveDevice', 'activateDevice', 'deactivateDevice',
      'findLicenseIdentityByKeyHash', 'findLicenseIdentityByPurchaseReference', 'createLicenseIdentity',
      'listGrantsByCustomer', 'withWebhookEvent', 'markOrderPaid',
      'revokeGrantByLicenseKeyId',
    ]),
    dodoClient: unavailable('Dodo client', [
      'createCheckoutSession', 'validateLicense', 'activateLicense', 'retrieveLicense', 'deactivateLicense',
    ]),
    webhookVerifier: unavailable('Dodo official webhook verifier', ['unwrap']),
    leaseSigner: unavailable('KMS Ed25519 signer', ['signEd25519']),
    authenticator: unavailable('customer authenticator', ['authenticate']),
  });
}
