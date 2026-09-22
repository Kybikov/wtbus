ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_status_fk;
ALTER TABLE routes DROP COLUMN IF EXISTS status;
DROP TRIGGER IF EXISTS tenants_seed_route_statuses ON tenants;
DROP FUNCTION IF EXISTS seed_route_statuses_for_tenant();
DROP TABLE IF EXISTS route_statuses;
