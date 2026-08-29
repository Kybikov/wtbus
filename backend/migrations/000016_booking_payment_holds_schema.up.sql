ALTER TABLE routes
  ADD COLUMN default_pricing_mode TEXT NOT NULL DEFAULT 'per_passenger'
    CHECK (default_pricing_mode IN ('per_passenger', 'per_booking'));

ALTER TABLE trips
  ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'per_passenger'
    CHECK (pricing_mode IN ('per_passenger', 'per_booking'));

ALTER TABLE bookings
  ADD COLUMN payment_hold_expires_at TIMESTAMPTZ;

DROP INDEX IF EXISTS bookings_one_active_per_customer_trip_idx;
CREATE UNIQUE INDEX bookings_one_active_per_customer_trip_idx
  ON bookings (trip_id, customer_id)
  WHERE status IN ('pending', 'awaiting_payment', 'cash_on_boarding', 'confirmed');

CREATE INDEX bookings_payment_hold_expiry_idx
  ON bookings (payment_hold_expires_at)
  WHERE status = 'awaiting_payment';
