CREATE TABLE telegram_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chat_id BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('trip_status')),
  payload JSONB NOT NULL,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX telegram_notification_outbox_pending_idx
  ON telegram_notification_outbox (tenant_id, available_at, created_at)
  WHERE delivered_at IS NULL;
