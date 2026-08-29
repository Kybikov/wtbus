UPDATE trips
SET
  starts_at = CASE
    WHEN origin_name = 'Варшава' THEN '2026-08-23 08:30:00+00'::timestamptz
    WHEN origin_name = 'Краков' THEN '2026-08-23 10:15:00+00'::timestamptz
    WHEN origin_name = 'Львов' THEN '2026-08-23 16:45:00+00'::timestamptz
    WHEN (origin_name = 'Киев' AND destination_name = 'Варшава') THEN '2026-08-23 13:00:00+00'::timestamptz
    WHEN (origin_name = 'Киев' AND destination_name = 'Люблин') THEN '2026-08-23 19:20:00+00'::timestamptz
    ELSE starts_at
  END,
  ends_at = CASE
    WHEN origin_name = 'Варшава' THEN '2026-08-23 18:10:00+00'::timestamptz
    WHEN origin_name = 'Краков' THEN '2026-08-23 17:50:00+00'::timestamptz
    WHEN origin_name = 'Львов' THEN '2026-08-23 20:10:00+00'::timestamptz
    WHEN (origin_name = 'Киев' AND destination_name = 'Варшава') THEN '2026-08-23 13:00:00+00'::timestamptz
    WHEN (origin_name = 'Киев' AND destination_name = 'Люблин') THEN '2026-08-23 23:10:00+00'::timestamptz
    ELSE ends_at
  END
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'vivat-bus');
