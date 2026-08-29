DROP INDEX IF EXISTS bookings_payment_hold_expiry_idx;

DROP INDEX IF EXISTS bookings_one_active_per_customer_trip_idx;
CREATE UNIQUE INDEX bookings_one_active_per_customer_trip_idx
  ON bookings (trip_id, customer_id)
  WHERE status IN ('pending', 'confirmed');

ALTER TABLE bookings DROP COLUMN IF EXISTS payment_hold_expires_at;
ALTER TABLE trips DROP COLUMN IF EXISTS pricing_mode;
ALTER TABLE routes DROP COLUMN IF EXISTS default_pricing_mode;
