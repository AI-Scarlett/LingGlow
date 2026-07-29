BEGIN;

-- Contract phase. Do not invent a value from the local device id/hash. Apply
-- 003, reconcile each legacy row to its real Dodo activation id, then apply
-- this migration. Any unresolved row blocks deployment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM device_activations
    WHERE dodo_license_key_instance_id IS NULL
  ) THEN
    RAISE EXCEPTION 'DODO_LICENSE_INSTANCE_BACKFILL_REQUIRED' USING ERRCODE = '23502';
  END IF;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE device_activations
ALTER COLUMN dodo_license_key_instance_id SET NOT NULL;

COMMIT;
