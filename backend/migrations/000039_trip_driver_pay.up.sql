ALTER TABLE trips
  ADD COLUMN driver_pay_minor BIGINT NOT NULL DEFAULT 0 CHECK (driver_pay_minor >= 0);

CREATE UNIQUE INDEX operational_expenses_driver_pay_trip_idx
  ON operational_expenses (tenant_id, trip_id)
  WHERE category='driver_pay' AND trip_id IS NOT NULL;
