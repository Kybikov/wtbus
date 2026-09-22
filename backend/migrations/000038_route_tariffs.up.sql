ALTER TABLE routes
  ADD COLUMN tariff_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (tariff_mode IN ('fixed','per_km')),
  ADD COLUMN distance_km NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
  ADD COLUMN vehicle_class_rates JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(vehicle_class_rates) = 'object');
