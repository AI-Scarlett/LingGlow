# PostgreSQL migrations

The SQL files are ordered, transactional, and intentionally contain no Dodo Product IDs or secrets.

Production deployment must run them with a migration identity, then run the service with a more restricted identity. The runtime identity must not receive `DELETE` on `redemption_bindings`, `entitlement_grants`, `processed_webhook_events`, or `audit_events`.

Example review command (does not connect to a database):

```bash
npm run migrations:list
```

Deployment command, only after supplying the real database URL and explicit TLS settings through the deployment secret manager:

```bash
npm run migrate
```

`003_dodo_license_instance.sql` is the expansion phase: it introduces the
official Dodo `license_key_instance_id`, makes an assigned instance immutable,
and replaces permanent `(license, device)` uniqueness with one active row at a
time so a previously deactivated Mac can be activated again without rewriting
history. Existing rows remain nullable only during this controlled migration
window. Reconcile each one to its real Dodo activation `id`; a local `deviceId`
or hash cannot be converted into that value. `004_require_dodo_license_instance.sql`
then aborts with `DODO_LICENSE_INSTANCE_BACKFILL_REQUIRED` until every row has
been reconciled, after which it enforces `NOT NULL`. The runtime service must
not be deployed between 003 and 004.

`005_first_redemption_and_license_identity.sql` removes checkout-time skin
selection, introduces hashed immutable Dodo license identities, and creates
partial unique indexes for `payment_id` and `subscription_id`. It aborts if a
legacy database still contains checkout-selected rows so they can be audited
instead of silently rewritten.

The migration runner takes a PostgreSQL advisory lock, wraps each migration in
a transaction, records its SHA-256, and refuses any drift in an already applied
file. It runs only when explicitly invoked; service startup never migrates the
database automatically.
