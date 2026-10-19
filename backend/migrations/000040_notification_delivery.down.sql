CREATE OR REPLACE FUNCTION capture_crm_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  previous jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  company uuid := (item->>'tenant_id')::uuid;
  driver_member uuid;
  event bigint;
  category text;
  title text;
  body text := 'Откройте приложение, чтобы посмотреть подробности.';
  path text;
BEGIN
  -- Cascaded company deletion must not recreate events referencing the removed tenant.
  IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=company) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND item=previous THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='trips' THEN
    SELECT membership_id INTO driver_member FROM drivers WHERE id=(item->>'driver_id')::uuid AND tenant_id=company;
    IF TG_OP='INSERT' OR item->>'status' IS DISTINCT FROM previous->>'status'
       OR item->>'driver_id' IS DISTINCT FROM previous->>'driver_id'
       OR item->>'starts_at' IS DISTINCT FROM previous->>'starts_at' THEN
      category := 'trips'; title := 'Обновление рейса'; path := '/trips';
    END IF;
  ELSIF TG_TABLE_NAME IN ('bookings','gps_points') THEN
    SELECT d.membership_id INTO driver_member FROM trips t LEFT JOIN drivers d ON d.id=t.driver_id
      WHERE t.id=(item->>'trip_id')::uuid AND t.tenant_id=company;
    IF TG_TABLE_NAME='bookings' AND (TG_OP='INSERT' OR item->>'status' IS DISTINCT FROM previous->>'status') THEN
      category := 'newBookings'; title := CASE WHEN TG_OP='INSERT' THEN 'Новое бронирование' ELSE 'Статус бронирования изменён' END; path := '/bookings';
    END IF;
  ELSIF TG_TABLE_NAME='individual_transfer_requests' AND TG_OP='INSERT' THEN
    category := 'newRequests'; title := 'Новая индивидуальная заявка'; path := '/requests';
  ELSIF TG_TABLE_NAME='payments' AND (TG_OP='INSERT' OR item->>'status' IS DISTINCT FROM previous->>'status') THEN
    category := 'payments'; title := CASE WHEN item->>'status'='paid' THEN 'Оплата подтверждена' ELSE 'Обновление оплаты' END; path := '/finance';
  END IF;
  INSERT INTO realtime_events(tenant_id,entity,driver_membership_id) VALUES(company,TG_TABLE_NAME,driver_member) RETURNING id INTO event;
  IF category IS NOT NULL THEN
    INSERT INTO app_notifications(event_id,membership_id,category,title,body,url)
      SELECT event,m.id,category,title,body,CASE WHEN m.role='driver' THEN '/driver' ELSE path END
      FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.tenant_id=company AND m.is_active AND NOT u.is_system AND (
        (m.role IN ('owner','admin','developer')) OR
        (m.role='dispatcher' AND category<>'payments') OR
        (m.role='driver' AND m.id=driver_member AND category IN ('trips','newBookings')));
    INSERT INTO push_jobs(notification_id,subscription_id)
      SELECT n.id,s.id FROM app_notifications n JOIN push_subscriptions s ON s.membership_id=n.membership_id WHERE n.event_id=event;
  END IF;
  -- Reassigned drivers must also invalidate their previous trip screen (no sensitive payload).
  IF TG_TABLE_NAME='trips' AND TG_OP='UPDATE' AND item->>'driver_id' IS DISTINCT FROM previous->>'driver_id' THEN
    SELECT membership_id INTO driver_member FROM drivers WHERE id=(previous->>'driver_id')::uuid AND tenant_id=company;
    IF driver_member IS NOT NULL THEN INSERT INTO realtime_events(tenant_id,entity,driver_membership_id) VALUES(company,'trips',driver_member); END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER queue_staff_telegram ON app_notifications;
DROP FUNCTION queue_staff_telegram();
DROP TABLE telegram_delivery_jobs,staff_telegram_link_tokens,staff_telegram_connections;
ALTER TABLE app_notifications DROP COLUMN event_type;
ALTER TABLE notification_preferences DROP COLUMN delivery;
