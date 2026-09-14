ALTER TABLE users
  ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE activity_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'system')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX activity_events_tenant_created_idx
  ON activity_events (tenant_id, created_at DESC);

CREATE INDEX activity_events_actor_created_idx
  ON activity_events (actor_membership_id, created_at DESC)
  WHERE actor_membership_id IS NOT NULL;

WITH created AS (
  INSERT INTO users (email, display_name, is_system)
  SELECT
    'automation+' || replace(tenant.id::text, '-', '') || '@system.local',
    'Автомат',
    true
  FROM tenants tenant
  ON CONFLICT (email) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        is_system = true,
        updated_at = now()
  RETURNING id, email
)
INSERT INTO memberships (tenant_id, user_id, role, is_active)
SELECT tenant.id, created.id, 'admin', true
FROM tenants tenant
JOIN created
  ON created.email = 'automation+' || replace(tenant.id::text, '-', '') || '@system.local'
ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET role = 'admin', is_active = true;
