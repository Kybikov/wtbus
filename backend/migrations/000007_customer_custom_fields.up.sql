ALTER TABLE customers
  ADD COLUMN custom_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT customers_custom_data_object CHECK (jsonb_typeof(custom_data) = 'object');

CREATE TABLE custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customer', 'trip', 'booking')),
  field_key TEXT NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, field_key)
);

CREATE INDEX custom_field_definitions_tenant_entity_idx
  ON custom_field_definitions (tenant_id, entity_type, is_active, position, created_at);
