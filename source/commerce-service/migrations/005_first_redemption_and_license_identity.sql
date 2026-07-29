BEGIN;

-- The shared single-skin Product ID never chooses a skin at checkout. Existing
-- pre-release databases must clear only unfulfilled checkout selections before
-- applying this migration. Paid production rows require an explicit audit and
-- must not be rewritten automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM checkout_orders
    WHERE locked_skin_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'LEGACY_CHECKOUT_SKIN_SELECTION_REVIEW_REQUIRED' USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'checkout_orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%locked_skin_id%'
  LOOP
    EXECUTE format('ALTER TABLE checkout_orders DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE checkout_orders
ADD CONSTRAINT checkout_orders_no_skin_selection
CHECK (locked_skin_id IS NULL);

-- Maps only a one-way hash of the user-entered key to the immutable identity
-- returned by Dodo. The raw key is never persisted.
CREATE TABLE dodo_license_identities (
  id uuid PRIMARY KEY,
  license_key_hash text NOT NULL UNIQUE CHECK (license_key_hash ~ '^[a-f0-9]{64}$'),
  dodo_license_key_id text NOT NULL UNIQUE,
  customer_id text NOT NULL,
  product_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('auto', 'import')),
  payment_id text,
  subscription_id text,
  first_seen_at timestamptz NOT NULL,
  CHECK (
    (payment_id IS NOT NULL AND subscription_id IS NULL) OR
    (payment_id IS NULL AND subscription_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX dodo_license_identities_payment_id_unique_idx
ON dodo_license_identities (payment_id)
WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX dodo_license_identities_subscription_id_unique_idx
ON dodo_license_identities (subscription_id)
WHERE subscription_id IS NOT NULL;

CREATE FUNCTION reject_license_identity_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LICENSE_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dodo_license_identity_update_forbidden
BEFORE UPDATE ON dodo_license_identities
FOR EACH ROW EXECUTE FUNCTION reject_license_identity_mutation();

CREATE TRIGGER dodo_license_identity_delete_forbidden
BEFORE DELETE ON dodo_license_identities
FOR EACH ROW EXECUTE FUNCTION reject_license_identity_mutation();

COMMIT;
