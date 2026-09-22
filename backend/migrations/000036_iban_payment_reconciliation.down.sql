ALTER TABLE telegram_notification_outbox
  DROP CONSTRAINT IF EXISTS telegram_notification_outbox_kind_check;
ALTER TABLE telegram_notification_outbox
  ADD CONSTRAINT telegram_notification_outbox_kind_check
  CHECK (kind IN ('trip_status','individual_transfer_request_status'));

DROP TABLE IF EXISTS payment_reconciliation_state;

ALTER TABLE tenant_payment_configs
  DROP COLUMN IF EXISTS bank_edrpou,
  DROP COLUMN IF EXISTS bank_mfo;
