ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_custom_data_object,
  DROP COLUMN IF EXISTS custom_data;

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_custom_data_object,
  DROP COLUMN IF EXISTS custom_data;
