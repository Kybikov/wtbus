CREATE UNIQUE INDEX bookings_one_active_per_customer_trip_idx
  ON bookings (trip_id, customer_id)
  WHERE status IN ('pending', 'confirmed');
