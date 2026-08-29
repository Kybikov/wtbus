INSERT INTO routes (tenant_id, name, origin_name, destination_name, currency)
SELECT t.id, route.name, route.origin_name, route.destination_name, 'EUR'
FROM tenants t
CROSS JOIN (
  VALUES
    ('Варшава — Киев', 'Варшава', 'Киев'),
    ('Краков — Львов', 'Краков', 'Львов'),
    ('Киев — Варшава', 'Киев', 'Варшава')
) AS route(name, origin_name, destination_name)
WHERE t.slug = 'vivat-bus'
  AND NOT EXISTS (
    SELECT 1 FROM routes r WHERE r.tenant_id = t.id AND r.name = route.name
  );
