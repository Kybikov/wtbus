CREATE TABLE tenant_exchange_rates (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rate_to_base NUMERIC(20,8) NOT NULL CHECK (rate_to_base > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, currency)
);

INSERT INTO tenant_exchange_rates (tenant_id, currency, rate_to_base)
SELECT id, base_currency, 1 FROM tenants
ON CONFLICT DO NOTHING;

CREATE FUNCTION seed_base_exchange_rate_for_tenant() RETURNS trigger AS $$
BEGIN
  INSERT INTO tenant_exchange_rates (tenant_id, currency, rate_to_base)
  VALUES (NEW.id, NEW.base_currency, 1)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_seed_base_exchange_rate
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION seed_base_exchange_rate_for_tenant();
