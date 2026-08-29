ALTER TABLE trips
  ADD COLUMN custom_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT trips_custom_data_object CHECK (jsonb_typeof(custom_data) = 'object');

ALTER TABLE bookings
  ADD COLUMN custom_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT bookings_custom_data_object CHECK (jsonb_typeof(custom_data) = 'object');
