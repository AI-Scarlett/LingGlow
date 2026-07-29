/**
 * Release root for the desktop commerce configuration.
 *
 * This intentionally ships as null in source builds. A production release
 * must replace it with the Base64URL encoded DER/SPKI Ed25519 public key,
 * rebuild the app, sign the complete .app bundle, and notarize it. The private
 * signing key never belongs in this repository or the desktop app.
 */
export const BUNDLED_COMMERCE_CONFIG_PUBLIC_KEY_SPKI = null;
