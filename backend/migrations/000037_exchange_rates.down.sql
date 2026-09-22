DROP TRIGGER IF EXISTS tenants_seed_base_exchange_rate ON tenants;
DROP FUNCTION IF EXISTS seed_base_exchange_rate_for_tenant();
DROP TABLE IF EXISTS tenant_exchange_rates;
