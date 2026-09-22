ALTER TABLE tenant_payment_configs
  ADD COLUMN bank_mfo TEXT NOT NULL DEFAULT '',
  ADD COLUMN bank_edrpou TEXT NOT NULL DEFAULT '';

CREATE TABLE payment_reconciliation_state (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL DEFAULT '',
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE telegram_notification_outbox
  DROP CONSTRAINT IF EXISTS telegram_notification_outbox_kind_check;
ALTER TABLE telegram_notification_outbox
  ADD CONSTRAINT telegram_notification_outbox_kind_check
  CHECK (kind IN ('trip_status','individual_transfer_request_status','payment_confirmed'));
