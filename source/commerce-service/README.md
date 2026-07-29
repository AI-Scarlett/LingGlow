# LingGlow Commerce Service

This directory is the internet-facing trust boundary for LingGlow's Dodo Payments checkout, license redemption, immutable grants, device activations, verified webhooks, and short-lived Ed25519 leases. It is server software; none of its API keys, webhook keys, database credentials, KMS configuration, or trust modules may be copied into the macOS app.

The runtime now includes concrete adapters for the official `dodopayments` TypeScript SDK and PostgreSQL. It still fails closed until every secret, URL, database TLS choice, and deployment-owned customer-auth/KMS trust module is configured. No deployment URL or live Product ID is guessed in source control.

## Critical environment boundary

The four Product IDs currently defined in `../src/products.mjs` were verified on 2026-07-16 against Dodo's hosted checkout and are **test-mode-only IDs**. The test checkout host resolves them; the live checkout host returns not-found. Therefore:

- `DODO_PAYMENTS_ENVIRONMENT=test_mode` is the only permitted environment for this directory as currently published.
- `live_mode` returns `DODO_LIVE_PRODUCT_IDS_REQUIRED` before an SDK/database call.
- A live release must provision four separate live products, review their license entitlements, and replace the complete canonical directory. Merely changing the environment variable is forbidden.
- A Product ID routes checkout and reconciliation. It never proves ownership.

Observed test-product deployment fixture (not an authorization rule):

| Catalog item | Test price configuration | Billing | License entitlement |
|---|---:|---|---|
| VIP monthly | USD 1.00 | recurring, 1 Month | automatic, one activation, 1 Month duration |
| VIP yearly | USD 9.99 | recurring, 1 Year | automatic, one activation, 1 Year duration |
| Single skin | minimum USD 0.10; PWYW; suggested USD 0.90 | one time | automatic, one activation |
| Custom slot | USD 0.10 | one time | automatic, one activation |

`license_key_enabled=false` on the legacy product field is not an error when the product's modern `entitlements` array contains the automatic `license_key` integration. Prices are deployment diagnostics only and are never accepted from the client or used as entitlement evidence.

## Runtime composition

```text
bounded Node HTTP server
  -> CommerceService domain
       -> canonical Product directory (../../src/products.mjs)
       -> official Dodo SDK adapter
       -> PostgreSQL repository + immutable triggers
       -> deployment-owned customer authenticator
       -> deployment-owned KMS/HSM Ed25519 signer
  <- schemaVersion 2 signed lease
```

Built-in modules:

- `src/dodo-sdk-adapter.mjs`: exact official calls to `checkoutSessions.create`, `licenses.validate`, `licenses.activate`, `licenses.deactivate`, `licenseKeys.retrieve`, and verified `webhooks.unwrap`.
- `src/postgres-repository.mjs`: every domain repository Port, transactional advisory locks, durable webhook replay claims, audit events, and immutable binding storage.
- `src/production-adapters.mjs`: constructs the official SDK and `pg` Pool, then loads only customer-auth/KMS from a server-owned trust module.
- `src/request-origin.mjs`: enforces the configured HTTPS public origin and trusts forwarding headers only from explicitly listed proxy IPs.
- `src/runtime-config.mjs`: strict host/port/timeouts/proxy parsing.
- `scripts/migrate.mjs`: checksum-pinned, advisory-locked PostgreSQL migration runner.

`LINGGLOW_COMMERCE_ADAPTER_MODULE` remains available as a full composition override for an audited private deployment. Dependency injection used by tests and private deployments is preserved.

## Required configuration

All values belong in a server secret manager, never a desktop `.env`:

```text
DODO_PAYMENTS_API_KEY
DODO_PAYMENTS_WEBHOOK_KEY
DODO_PAYMENTS_ENVIRONMENT=test_mode
SKIN_STUDIO_ENTITLEMENT_DATABASE_URL
SKIN_STUDIO_LEASE_SIGNING_KEY_REF
SKIN_STUDIO_CHECKOUT_RETURN_URL=https://...
SKIN_STUDIO_PUBLIC_BASE_URL=https://commerce.example.com/
SKIN_STUDIO_DATABASE_SSL_MODE=verify-full|require|disable
LINGGLOW_COMMERCE_TRUST_MODULE=/absolute/server/path/trust-module.mjs
```

`SKIN_STUDIO_PUBLIC_BASE_URL` is an HTTPS origin only: no path, query, fragment, username, or password. The checkout return URL must also use HTTPS without embedded credentials.

Database TLS is explicit. `disable` is accepted only for a loopback PostgreSQL host. `SKIN_STUDIO_DATABASE_CA_FILE` can point to an absolute CA bundle. Pool settings are bounded by the parser; see `.env.example`.

Behind an HTTPS ingress, set `COMMERCE_TRUSTED_PROXY_ADDRESSES` to the exact peer IP or comma-separated peer IPs seen by this process. CIDR shortcuts and arbitrary hostnames are rejected. Requests from other peers cannot assert `X-Forwarded-Proto` or `X-Forwarded-Host`; ambiguous comma-separated/`Forwarded` values are rejected.

The trust module must export:

```js
export async function createCommerceTrustAdapters(env, {repository, dodoClient}) {
  return {
    leaseSigner: {
      configured: true,
      async signEd25519({keyRef, message}) {
        // Ask the deployment KMS/HSM to sign. Return exactly 64 bytes.
      },
    },
    authenticator: {
      configured: true,
      async authenticate({headers, remoteAddress}) {
        // Validate a server-side session and return {customerId}.
      },
    },
    async close() {},
  };
}
```

No PEM, private seed, API token, raw license key, or raw device ID should be logged or persisted. The database stores only a SHA-256 license-key lookup and SHA-256 device identity, plus Dodo's immutable public resource IDs.

## HTTP contract

- `GET /healthz` is a sanitized liveness response and remains available in fail-closed review mode.
- `GET /readyz` returns `200` only when trusted configuration, all adapters, the customer authenticator, webhook verifier, signer, PostgreSQL ping, and the four-product deployment fixture are ready; otherwise it returns sanitized `503`. Successful Dodo catalog probes are cached for 60 seconds (failures for 5 seconds) to keep health polling bounded.
- Every response is `no-store`, includes a request ID, and contains no server secret.

All POST routes require the configured HTTPS public-origin policy in a configured deployment. JSON bodies are bounded to 64 KiB; webhook raw bodies to 1 MiB.

### `POST /v1/checkouts`

The authenticated body contains only:

```json
{
  "catalogProductId": "skin-permanent",
  "idempotencyKey": "client-random-at-least-16-chars"
}
```

The shared single-skin product does **not** accept `skinId` at checkout. All Product IDs, quantity `1`, return URL, and metadata are fixed server-side. Dodo receives only `metadata: {order_ref}`. The official SDK response is normalized from `session_id`/`checkout_url`; a null, non-HTTPS, credential-bearing URL or invalid session ID fails closed.

### `POST /v1/redemptions`

```json
{
  "licenseKey": "user-entered-code",
  "deviceId": "keychain-random-device-id",
  "clientVersion": "2.0.0",
  "platform": "macos",
  "skinId": "violet-nebula"
}
```

`skinId` is optional at the JSON-schema layer because the server must first discover the verified code type:

- first redemption of `skin_once`: `skinId` is required and must be in the published sellable catalog (legacy VIP skins plus the SHA-locked registered VIP Theme Packs); otherwise `SELECTION_REQUIRED`;
- later redemption of the same code: omission or the original `skinId` is accepted; another value is `BINDING_IMMUTABLE`;
- VIP or custom-slot code with `skinId`: `SKIN_NOT_ALLOWED`;
- first custom-slot redemption creates one opaque `profileId`; content can change, the slot identity cannot;
- refunds/disputes may revoke use but never delete or rewrite a skin/profile binding.

The service first calls the public official validation endpoint, activates the device through Dodo, retrieves the authenticated Dodo license record, constant-time compares the returned raw key in memory, verifies `source=auto`, product/customer identity, payment/subscription reference and expiry, then persists only a key hash and immutable identity. Product ID alone is never sufficient.

### `POST /v1/leases/refresh`

Requires an active local device row with Dodo's real `license_key_instance_id`. It validates the exact instance, retrieves the authenticated license record again, reconciles subscription expiry, and issues a new 24-hour lease.

### `POST /v1/devices/deactivate`

Calls `licenses.deactivate` with the persisted official instance ID, never the app's local device ID. Only the device row changes; a before/after comparison rejects accidental grant mutation.

### `POST /v1/webhooks/dodo`

The HTTP layer retains the exact bytes, performs fatal UTF-8 decoding once, and calls only:

```js
client.webhooks.unwrap(rawBodyText, {
  headers: {"webhook-id", "webhook-signature", "webhook-timestamp"}
})
```

`unsafeUnwrap` is not referenced. The signed `webhook-id` header is the durable replay key. Only confirmed allowlisted event names can transition local state; legacy/unknown names are recorded as no-ops. Refunds and disputes reconcile by Dodo `payment_id`, subscription expiry by `subscription_id`, and entitlement-grant revocation by its available purchase reference. Those references have partial unique indexes in PostgreSQL. A verified event that cannot be matched is durably recorded and acknowledged with `200`, while the 24-hour refresh path still revalidates Dodo and fails closed.

Official references:

- https://docs.dodopayments.com/developer-resources/checkout-session
- https://docs.dodopayments.com/features/license-keys
- https://docs.dodopayments.com/api-reference/licenses/activate-license
- https://docs.dodopayments.com/api-reference/licenses/validate-license
- https://docs.dodopayments.com/api-reference/licenses/deactivate-license
- https://docs.dodopayments.com/developer-resources/webhooks

## PostgreSQL and migrations

The schema provides checkout idempotency, processed-webhook replay protection, immutable first-redemption bindings, immutable grant identity, historical device activations, hashed license identities, and append-only audits. Database triggers independently reject binding/grant/identity deletion or rewrite.

Apply migrations only from the trusted server:

```bash
npm ci
npm run migrations:list
npm run migrate
```

The runner uses a PostgreSQL advisory lock, records filename/SHA-256, and refuses migration drift. Migration `005` deliberately stops if an older pre-release database still contains checkout-selected skins; those rows require an explicit audit before changing semantics.

## Local fail-closed review

```bash
npm ci
npm test
npm run check
npm start
```

With empty secrets, `npm start` imports neither the Dodo SDK nor PostgreSQL, listens on `127.0.0.1:8787`, serves liveness, and returns `503` for readiness/commerce routes. This is a wiring review mode, not a payment sandbox.

## Deployment checklist

1. Confirm the canonical directory is still test-only; do not attempt live mode.
2. Provision PostgreSQL, choose explicit TLS mode, and run all migrations with the service stopped.
3. Provision an Ed25519 KMS/HSM key and a server-side customer authenticator through the trust module.
4. Configure the public HTTPS origin, exact ingress peer IPs, return URL, webhook secret, and Dodo test API key in a secret manager.
5. In Dodo Dashboard confirm all four products are active and carry an automatic license-key entitlement with one activation; treat the price table above as a deployment drift check, not authorization.
6. Subscribe the verified webhook endpoint to required payment/refund/dispute/subscription/entitlement events.
7. Exercise test cards, replay, concurrent first redemption, wrong-skin rebinding, refund, subscription expiry, and device deactivation.
8. Only after separate live Product IDs exist and the canonical directory is reviewed should a future release permit `live_mode`.
