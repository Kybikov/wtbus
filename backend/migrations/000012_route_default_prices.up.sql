ALTER TABLE routes
  ADD COLUMN default_price_minor BIGINT NOT NULL DEFAULT 0 CHECK (default_price_minor >= 0);

UPDATE routes
SET default_price_minor = CASE name
  WHEN 'Варшава — Киев' THEN 7900
  WHEN 'Краков — Львов' THEN 6500
  WHEN 'Киев — Варшава' THEN 8900
  ELSE default_price_minor
END
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'vivat-bus');
