CREATE TABLE entity_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  entity TEXT NOT NULL CHECK (entity IN ('customers','bookings','team')),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  visibility TEXT NOT NULL CHECK (visibility IN ('private','shared')),
  config JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entity_views_private_name ON entity_views(tenant_id,entity,owner_membership_id,lower(name)) WHERE visibility='private';
CREATE UNIQUE INDEX entity_views_shared_name ON entity_views(tenant_id,entity,lower(name)) WHERE visibility='shared';
CREATE INDEX entity_views_scope ON entity_views(tenant_id,entity,visibility,owner_membership_id);
