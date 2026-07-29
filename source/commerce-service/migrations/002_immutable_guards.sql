BEGIN;

CREATE FUNCTION reject_checkout_binding_rewrite() RETURNS trigger AS $$
BEGIN
  IF NEW.order_ref <> OLD.order_ref
     OR NEW.customer_id <> OLD.customer_id
     OR NEW.catalog_product_id <> OLD.catalog_product_id
     OR NEW.dodo_product_id <> OLD.dodo_product_id
     OR NEW.offer_type <> OLD.offer_type
     OR NEW.locked_skin_id IS DISTINCT FROM OLD.locked_skin_id
     OR NEW.idempotency_key_hash <> OLD.idempotency_key_hash
     OR NEW.request_hash <> OLD.request_hash
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ORDER_SELECTION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER checkout_order_selection_is_immutable
BEFORE UPDATE ON checkout_orders
FOR EACH ROW EXECUTE FUNCTION reject_checkout_binding_rewrite();

CREATE FUNCTION reject_idempotency_identity_rewrite() RETURNS trigger AS $$
BEGIN
  IF NEW.scope <> OLD.scope
     OR NEW.actor_hash <> OLD.actor_hash
     OR NEW.key_hash <> OLD.key_hash
     OR NEW.request_hash <> OLD.request_hash
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'IDEMPOTENCY_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER idempotency_identity_is_immutable
BEFORE UPDATE ON idempotency_records
FOR EACH ROW EXECUTE FUNCTION reject_idempotency_identity_rewrite();

CREATE FUNCTION reject_binding_rewrite() RETURNS trigger AS $$
BEGIN
  IF NEW.dodo_license_key_id <> OLD.dodo_license_key_id
     OR NEW.customer_id <> OLD.customer_id
     OR NEW.product_id <> OLD.product_id
     OR NEW.offer_type <> OLD.offer_type
     OR NEW.bound_resource_id <> OLD.bound_resource_id
     OR NEW.bound_at <> OLD.bound_at THEN
    RAISE EXCEPTION 'BINDING_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER redemption_binding_is_immutable
BEFORE UPDATE ON redemption_bindings
FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();

CREATE FUNCTION reject_grant_identity_rewrite() RETURNS trigger AS $$
BEGIN
  IF NEW.grant_id <> OLD.grant_id
     OR NEW.dodo_license_key_id <> OLD.dodo_license_key_id
     OR NEW.customer_id <> OLD.customer_id
     OR NEW.product_id <> OLD.product_id
     OR NEW.offer_type <> OLD.offer_type
     OR NEW.binding_id IS DISTINCT FROM OLD.binding_id
     OR NEW.bound_at <> OLD.bound_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'GRANT_BINDING_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entitlement_grant_identity_is_immutable
BEFORE UPDATE ON entitlement_grants
FOR EACH ROW EXECUTE FUNCTION reject_grant_identity_rewrite();

CREATE FUNCTION reject_immutable_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_ROW_DELETE_FORBIDDEN' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER redemption_binding_delete_forbidden
BEFORE DELETE ON redemption_bindings
FOR EACH ROW EXECUTE FUNCTION reject_immutable_delete();

CREATE TRIGGER entitlement_grant_delete_forbidden
BEFORE DELETE ON entitlement_grants
FOR EACH ROW EXECUTE FUNCTION reject_immutable_delete();

CREATE TRIGGER processed_webhook_delete_forbidden
BEFORE DELETE ON processed_webhook_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_delete();

CREATE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_update_forbidden
BEFORE UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER audit_event_delete_forbidden
BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

COMMIT;
