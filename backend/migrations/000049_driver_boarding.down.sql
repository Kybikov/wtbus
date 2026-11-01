DROP FUNCTION booking_received_minor(uuid,uuid);
-- Do not silently coalesce financial events on downgrade.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM driver_cash_ledger WHERE source_key IS NOT NULL) THEN RAISE EXCEPTION 'Reconcile individual cash receipts before downgrade'; END IF; END $$;
DROP INDEX driver_cash_ledger_trip_cash_receipt_idx;
ALTER TABLE driver_cash_ledger DROP COLUMN source_key;
CREATE UNIQUE INDEX driver_cash_ledger_trip_cash_receipt_idx ON driver_cash_ledger(tenant_id,trip_id,currency) WHERE kind='cash_collected' AND trip_id IS NOT NULL;
DROP TRIGGER trip_actual_times ON trips;
DROP FUNCTION record_trip_actual_times();
ALTER TABLE trips DROP COLUMN actual_started_at, DROP COLUMN actual_completed_at;
DROP TABLE driver_booking_checkins;
