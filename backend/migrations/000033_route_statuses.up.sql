CREATE TABLE route_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'neutral',
  is_available BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  CHECK (key ~ '^[a-z0-9_]{2,64}$'),
  CHECK (char_length(label) BETWEEN 1 AND 80),
  CHECK (tone IN ('success', 'warning', 'danger', 'info', 'neutral'))
);

CREATE INDEX route_statuses_tenant_position_idx
  ON route_statuses (tenant_id, position, created_at);

CREATE FUNCTION seed_route_statuses_for_tenant() RETURNS trigger AS $$
BEGIN
  INSERT INTO route_statuses (tenant_id, key, label, tone, is_available, is_system, position)
  VALUES
    (NEW.id, 'active', 'Активный', 'success', true, true, 10),
    (NEW.id, 'temporarily_unavailable', 'Временно недоступный', 'warning', false, true, 20),
    (NEW.id, 'inactive', 'Неактивный', 'neutral', false, true, 30),
    (NEW.id, 'archived', 'Архив', 'neutral', false, true, 40)
  ON CONFLICT (tenant_id, key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_seed_route_statuses
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION seed_route_statuses_for_tenant();

INSERT INTO route_statuses (tenant_id, key, label, tone, is_available, is_system, position)
SELECT id, status.key, status.label, status.tone, status.is_available, true, status.position
FROM tenants
CROSS JOIN (VALUES
  ('active', 'Активный', 'success', true, 10),
  ('temporarily_unavailable', 'Временно недоступный', 'warning', false, 20),
  ('inactive', 'Неактивный', 'neutral', false, 30),
  ('archived', 'Архив', 'neutral', false, 40)
) AS status(key, label, tone, is_available, position)
ON CONFLICT (tenant_id, key) DO NOTHING;

ALTER TABLE routes ADD COLUMN status TEXT;
UPDATE routes SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END;
ALTER TABLE routes ALTER COLUMN status SET NOT NULL;
ALTER TABLE routes ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE routes
  ADD CONSTRAINT routes_status_fk
  FOREIGN KEY (tenant_id, status)
  REFERENCES route_statuses(tenant_id, key);
