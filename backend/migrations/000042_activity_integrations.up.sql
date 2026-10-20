CREATE TABLE integration_health (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider IN ('monobank','telegram')),
  credential_hash bytea NOT NULL,
  status text NOT NULL CHECK(status IN ('working','error')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  PRIMARY KEY(tenant_id,provider)
);
CREATE FUNCTION reset_integration_health() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.monobank_token IS DISTINCT FROM OLD.monobank_token THEN DELETE FROM integration_health WHERE tenant_id=NEW.tenant_id AND provider='monobank'; END IF;
    IF NEW.telegram_bot_token IS DISTINCT FROM OLD.telegram_bot_token THEN DELETE FROM integration_health WHERE tenant_id=NEW.tenant_id AND provider='telegram'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER integration_key_changed AFTER UPDATE ON tenant_integration_secrets FOR EACH ROW EXECUTE FUNCTION reset_integration_health();
CREATE TABLE api_request_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  request_id text NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  status integer NOT NULL,
  duration_ms bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_requests_tenant_id_idx ON api_request_logs(tenant_id,id DESC);
CREATE INDEX api_requests_retention_idx ON api_request_logs(created_at);
CREATE INDEX activity_events_entity_idx ON activity_events(tenant_id,entity_id,id DESC);
CREATE TRIGGER realtime_integration_health AFTER INSERT OR UPDATE OR DELETE ON integration_health FOR EACH ROW EXECUTE FUNCTION capture_crm_event();
CREATE TRIGGER realtime_integration_secrets AFTER INSERT OR UPDATE OR DELETE ON tenant_integration_secrets FOR EACH ROW EXECUTE FUNCTION capture_crm_event();
CREATE TRIGGER realtime_exchange_rates AFTER INSERT OR UPDATE OR DELETE ON tenant_exchange_rates FOR EACH ROW EXECUTE FUNCTION capture_crm_event();

CREATE FUNCTION audit_integration_health() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW; END IF;
 INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,details)
 VALUES(NEW.tenant_id,(SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND u.is_system ORDER BY m.id LIMIT 1),'system','integration_status_changed','integration-secrets',jsonb_build_object('provider',NEW.provider,'status',NEW.status));
 RETURN NEW;
END $$;
CREATE TRIGGER audit_integration_health AFTER INSERT OR UPDATE ON integration_health FOR EACH ROW EXECUTE FUNCTION audit_integration_health();
