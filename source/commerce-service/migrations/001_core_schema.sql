BEGIN;

CREATE TABLE checkout_orders (
  id uuid PRIMARY KEY,
  order_ref text NOT NULL UNIQUE,
  customer_id text NOT NULL,
  catalog_product_id text NOT NULL,
  dodo_product_id text NOT NULL,
  offer_type text NOT NULL CHECK (
    offer_type IN ('vip_subscription', 'skin_once', 'custom_slot_once')
  ),
  locked_skin_id text,
  idempotency_key_hash text NOT NULL CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'checkout_created', 'paid', 'revoked', 'failed')
  ),
  dodo_checkout_session_id text,
  checkout_url text,
  paid_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (customer_id, idempotency_key_hash),
  CHECK (
    locked_skin_id IS NULL
  ),
  CHECK (
    (status = 'paid' AND paid_at IS NOT NULL) OR status <> 'paid'
  ),
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL) OR status <> 'revoked'
  )
);

CREATE UNIQUE INDEX checkout_orders_dodo_session_unique
ON checkout_orders (dodo_checkout_session_id)
WHERE dodo_checkout_session_id IS NOT NULL;

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  actor_hash text NOT NULL CHECK (actor_hash ~ '^[a-f0-9]{64}$'),
  key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (scope, actor_hash, key_hash),
  CHECK (
    (response_status IS NULL AND response_body IS NULL AND completed_at IS NULL) OR
    (response_status BETWEEN 200 AND 599 AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE processed_webhook_events (
  webhook_id text PRIMARY KEY,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  processing_error_code text
);

CREATE TABLE redemption_bindings (
  id uuid PRIMARY KEY,
  dodo_license_key_id text NOT NULL UNIQUE,
  customer_id text NOT NULL,
  product_id text NOT NULL,
  offer_type text NOT NULL CHECK (offer_type IN ('skin_once', 'custom_slot_once')),
  bound_resource_id text NOT NULL,
  bound_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  revoked_at timestamptz,
  CHECK (
    (status = 'active' AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE entitlement_grants (
  id uuid PRIMARY KEY,
  grant_id text NOT NULL UNIQUE,
  dodo_license_key_id text NOT NULL UNIQUE,
  customer_id text NOT NULL,
  product_id text NOT NULL,
  offer_type text NOT NULL CHECK (
    offer_type IN ('vip_subscription', 'skin_once', 'custom_slot_once')
  ),
  binding_id uuid REFERENCES redemption_bindings(id),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  bound_at timestamptz NOT NULL,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (
    (offer_type = 'vip_subscription' AND binding_id IS NULL AND valid_until IS NOT NULL) OR
    (offer_type <> 'vip_subscription' AND binding_id IS NOT NULL AND valid_until IS NULL)
  ),
  CHECK (
    (status = 'active' AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CHECK (valid_until IS NULL OR valid_until > bound_at)
);

CREATE INDEX entitlement_grants_customer_id_idx
ON entitlement_grants (customer_id);

CREATE TABLE device_activations (
  id uuid PRIMARY KEY,
  dodo_license_key_id text NOT NULL,
  dodo_license_key_instance_id text NOT NULL,
  customer_id text NOT NULL,
  device_hash text NOT NULL CHECK (device_hash ~ '^[a-f0-9]{64}$'),
  client_version text NOT NULL,
  platform text NOT NULL CHECK (platform = 'macos'),
  activated_at timestamptz NOT NULL,
  deactivated_at timestamptz,
  CHECK (deactivated_at IS NULL OR deactivated_at >= activated_at)
);

CREATE INDEX device_activations_customer_id_idx
ON device_activations (customer_id);

CREATE UNIQUE INDEX device_activations_dodo_instance_unique_idx
ON device_activations (dodo_license_key_instance_id);

CREATE UNIQUE INDEX device_activations_one_active_device_idx
ON device_activations (dodo_license_key_id, device_hash)
WHERE deactivated_at IS NULL;

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_id_hash text,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  request_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX audit_events_subject_idx
ON audit_events (subject_type, subject_id, created_at);

COMMIT;
