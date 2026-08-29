DO $$
DECLARE
  v_tenant_id UUID;
  v_sprinter_id UUID;
  v_crafter_id UUID;
  v_vito_id UUID;
  v_master_id UUID;
  v_andriy_id UUID;
  v_serhii_id UUID;
  v_mykola_id UUID;
  v_oleh_id UUID;
BEGIN
  INSERT INTO tenants (slug, name, timezone, base_currency, subscription_status)
  VALUES ('vivat-bus', 'Vivat Bus', 'Europe/Warsaw', 'EUR', 'trial')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_tenant_id;

  INSERT INTO tenant_branding (tenant_id, primary_color, default_theme)
  VALUES (v_tenant_id, '#E9B74D', 'dark')
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO drivers (tenant_id, full_name, phone_e164)
  VALUES
    (v_tenant_id, 'Андрей П.', '+380670000001'),
    (v_tenant_id, 'Сергей М.', '+380670000002'),
    (v_tenant_id, 'Николай К.', '+380670000003'),
    (v_tenant_id, 'Олег Д.', '+380670000004');

  SELECT id INTO v_andriy_id FROM drivers WHERE tenant_id = v_tenant_id AND phone_e164 = '+380670000001';
  SELECT id INTO v_serhii_id FROM drivers WHERE tenant_id = v_tenant_id AND phone_e164 = '+380670000002';
  SELECT id INTO v_mykola_id FROM drivers WHERE tenant_id = v_tenant_id AND phone_e164 = '+380670000003';
  SELECT id INTO v_oleh_id FROM drivers WHERE tenant_id = v_tenant_id AND phone_e164 = '+380670000004';

  INSERT INTO vehicles (tenant_id, name, registration_number, vehicle_class, capacity)
  VALUES
    (v_tenant_id, 'Mercedes Sprinter', 'VIVAT-001', 'microbus', 17),
    (v_tenant_id, 'VW Crafter', 'VIVAT-002', 'microbus', 20),
    (v_tenant_id, 'Mercedes Vito', 'VIVAT-003', 'minivan', 8),
    (v_tenant_id, 'Renault Master', 'VIVAT-004', 'microbus', 17);

  SELECT id INTO v_sprinter_id FROM vehicles WHERE tenant_id = v_tenant_id AND registration_number = 'VIVAT-001';
  SELECT id INTO v_crafter_id FROM vehicles WHERE tenant_id = v_tenant_id AND registration_number = 'VIVAT-002';
  SELECT id INTO v_vito_id FROM vehicles WHERE tenant_id = v_tenant_id AND registration_number = 'VIVAT-003';
  SELECT id INTO v_master_id FROM vehicles WHERE tenant_id = v_tenant_id AND registration_number = 'VIVAT-004';

  INSERT INTO customers (tenant_id, full_name, phone_e164, telegram_id)
  VALUES
    (v_tenant_id, 'Елена Савчук', '+380670000011', 100000011),
    (v_tenant_id, 'Игорь Коваленко', '+380670000012', 100000012),
    (v_tenant_id, 'Марина Петренко', '+380670000013', 100000013);

  INSERT INTO trips (tenant_id, vehicle_id, driver_id, kind, status, origin_name, destination_name, starts_at, ends_at, capacity, price_minor, currency)
  VALUES
    (v_tenant_id, v_sprinter_id, v_andriy_id, 'regular', 'in_progress', 'Варшава', 'Киев', '2026-08-23 08:30:00+02', '2026-08-23 18:10:00+02', 17, 7900, 'EUR'),
    (v_tenant_id, v_sprinter_id, v_andriy_id, 'individual', 'assigned', 'Киев', 'Люблин', '2026-08-23 19:20:00+02', '2026-08-23 23:10:00+02', 4, 42000, 'EUR'),
    (v_tenant_id, v_crafter_id, v_serhii_id, 'regular', 'assigned', 'Краков', 'Львов', '2026-08-23 10:15:00+02', '2026-08-23 17:50:00+02', 20, 6500, 'EUR'),
    (v_tenant_id, v_vito_id, v_mykola_id, 'regular', 'new', 'Киев', 'Варшава', '2026-08-23 13:00:00+02', '2026-08-23 22:20:00+02', 8, 8900, 'EUR'),
    (v_tenant_id, v_master_id, v_oleh_id, 'individual', 'assigned', 'Львов', 'Жешув', '2026-08-23 16:45:00+02', '2026-08-23 20:10:00+02', 12, 36500, 'EUR');
END $$;
