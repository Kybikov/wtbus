DROP INDEX IF EXISTS operational_expenses_driver_pay_trip_idx;
ALTER TABLE trips DROP COLUMN IF EXISTS driver_pay_minor;
