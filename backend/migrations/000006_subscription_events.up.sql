CREATE TABLE subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_event_id TEXT,
  previous_status TEXT NOT NULL CHECK (previous_status IN ('trial', 'active', 'past_due', 'suspended')),
  next_status TEXT NOT NULL CHECK (next_status IN ('trial', 'active', 'past_due', 'suspended')),
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(reason) <= 1000)
);

CREATE UNIQUE INDEX subscription_events_tenant_external_event_idx
  ON subscription_events (tenant_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE INDEX subscription_events_tenant_changed_idx
  ON subscription_events (tenant_id, changed_at DESC);
