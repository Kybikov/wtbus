ALTER TABLE routes
  DROP COLUMN IF EXISTS vehicle_class_rates,
  DROP COLUMN IF EXISTS distance_km,
  DROP COLUMN IF EXISTS tariff_mode;
