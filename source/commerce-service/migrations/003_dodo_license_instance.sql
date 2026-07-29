BEGIN;

-- Expansion phase. Existing installations cannot infer an official Dodo
-- instance ID from a local device ID, so the column remains nullable until the
-- deployment has reconciled every legacy row against Dodo. Migration 004 is
-- the fail-closed enforcement phase.
ALTER TABLE device_activations
ADD COLUMN IF NOT EXISTS dodo_license_key_instance_id text;

ALTER TABLE device_activations
DROP CONSTRAINT IF EXISTS device_activations_dodo_license_key_id_device_hash_key;

CREATE UNIQUE INDEX IF NOT EXISTS device_activations_dodo_instance_unique_idx
ON device_activations (dodo_license_key_instance_id);

CREATE UNIQUE INDEX IF NOT EXISTS device_activations_one_active_device_idx
ON device_activations (dodo_license_key_id, device_hash)
WHERE deactivated_at IS NULL;

CREATE OR REPLACE FUNCTION reject_device_activation_identity_rewrite() RETURNS trigger AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.dodo_license_key_id <> OLD.dodo_license_key_id
     OR (OLD.dodo_license_key_instance_id IS NOT NULL AND
         NEW.dodo_license_key_instance_id IS DISTINCT FROM OLD.dodo_license_key_instance_id)
     OR NEW.customer_id <> OLD.customer_id
     OR NEW.device_hash <> OLD.device_hash
     OR NEW.platform <> OLD.platform
     OR NEW.activated_at <> OLD.activated_at THEN
    RAISE EXCEPTION 'DEVICE_ACTIVATION_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'device_activation_identity_is_immutable'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER device_activation_identity_is_immutable
    BEFORE UPDATE ON device_activations
    FOR EACH ROW EXECUTE FUNCTION reject_device_activation_identity_rewrite();
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMIT;
