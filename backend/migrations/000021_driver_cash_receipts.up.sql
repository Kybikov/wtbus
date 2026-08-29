CREATE UNIQUE INDEX driver_cash_ledger_trip_cash_receipt_idx
  ON driver_cash_ledger (tenant_id, trip_id, currency)
  WHERE kind = 'cash_collected' AND trip_id IS NOT NULL;
