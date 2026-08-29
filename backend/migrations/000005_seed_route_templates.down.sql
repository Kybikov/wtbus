DELETE FROM routes
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'vivat-bus')
  AND name IN ('Варшава — Киев', 'Краков — Львов', 'Киев — Варшава');
