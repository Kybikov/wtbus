-- Migration 35 replaced route statuses; remove its obsolete tenant seed trigger.
DROP TRIGGER IF EXISTS tenants_seed_route_statuses ON tenants;
DROP FUNCTION IF EXISTS seed_route_statuses_for_tenant();
ALTER TABLE notification_preferences ADD COLUMN delivery jsonb NOT NULL DEFAULT '{}';
ALTER TABLE app_notifications ADD COLUMN event_type text NOT NULL DEFAULT '';
CREATE TABLE staff_telegram_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 membership_id uuid NOT NULL UNIQUE REFERENCES memberships(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 chat_id bigint NOT NULL CHECK(chat_id>0), username text NOT NULL DEFAULT '',
 connected_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,chat_id)
);
CREATE TABLE staff_telegram_link_tokens (
 membership_id uuid PRIMARY KEY REFERENCES memberships(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 token_hash bytea NOT NULL UNIQUE, expires_at timestamptz NOT NULL
);
CREATE TABLE telegram_delivery_jobs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 notification_id uuid NOT NULL REFERENCES app_notifications(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES staff_telegram_connections(id) ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 locked_until timestamptz, finished_at timestamptz,
 UNIQUE(notification_id,connection_id)
);
CREATE INDEX telegram_delivery_pending_idx ON telegram_delivery_jobs(available_at) WHERE finished_at IS NULL;
CREATE FUNCTION queue_staff_telegram() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.event_id IS NOT NULL THEN
  INSERT INTO telegram_delivery_jobs(notification_id,connection_id)
   SELECT NEW.id,c.id FROM staff_telegram_connections c JOIN memberships m ON m.id=c.membership_id AND m.tenant_id=c.tenant_id
   WHERE c.membership_id=NEW.membership_id AND m.is_active;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER queue_staff_telegram AFTER INSERT ON app_notifications FOR EACH ROW EXECUTE FUNCTION queue_staff_telegram();

CREATE OR REPLACE FUNCTION capture_crm_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  previous jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  company uuid := (item->>'tenant_id')::uuid;
  driver_member uuid;
  event bigint;
  category text;
  event_key text;
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
  IF TG_TABLE_NAME='bookings' AND TG_OP<>'DELETE' THEN
    IF TG_OP='INSERT' THEN event_key:='bookingCreated'; title:='Новое бронирование';
    ELSIF item->>'status' IS DISTINCT FROM previous->>'status' OR item->>'seats' IS DISTINCT FROM previous->>'seats' OR item->>'trip_id' IS DISTINCT FROM previous->>'trip_id' THEN
      event_key:=CASE WHEN workflow_status_phase(company,'bookings',item->>'status')='cancelled' THEN 'bookingCancelled' ELSE 'bookingChanged' END;
      title:=CASE WHEN event_key='bookingCancelled' THEN 'Бронирование отменено' ELSE 'Бронирование изменено' END;
    END IF;
    IF event_key IS NOT NULL THEN category:='newBookings';path:='/bookings'; END IF;
  ELSIF TG_TABLE_NAME='individual_transfer_requests' AND TG_OP<>'DELETE' THEN
    IF TG_OP='INSERT' THEN event_key:='requestCreated';title:='Новая индивидуальная заявка';
    ELSIF item->>'status' IS DISTINCT FROM previous->>'status' OR item->>'booking_id' IS DISTINCT FROM previous->>'booking_id' THEN event_key:='requestChanged';title:='Заявка обновлена'; END IF;
    IF event_key IS NOT NULL THEN category:='newRequests';path:='/requests';END IF;
  ELSIF TG_TABLE_NAME='trips' AND TG_OP<>'DELETE' THEN
    IF TG_OP='INSERT' OR item->>'driver_id' IS DISTINCT FROM previous->>'driver_id' THEN event_key:='tripAssigned';title:='Назначение рейса';
    ELSIF item->>'status' IS DISTINCT FROM previous->>'status' OR item->>'starts_at' IS DISTINCT FROM previous->>'starts_at' OR item->>'ends_at' IS DISTINCT FROM previous->>'ends_at' OR item->>'vehicle_id' IS DISTINCT FROM previous->>'vehicle_id' THEN
      event_key:=CASE WHEN workflow_status_phase(company,'trips',item->>'status')='cancelled' THEN 'tripCancelled' ELSE 'tripChanged' END;
      title:=CASE WHEN event_key='tripCancelled' THEN 'Рейс отменён' ELSE 'Рейс изменён' END;
    END IF;
    IF event_key IS NOT NULL THEN category:='trips';path:='/trips';END IF;
  ELSIF TG_TABLE_NAME='payments' AND category IS NOT NULL THEN
    event_key:=CASE WHEN workflow_status_phase(company,'payments',item->>'status')='paid' THEN 'paymentPaid' WHEN workflow_status_phase(company,'payments',item->>'status') IN ('failed','cancelled') THEN 'paymentFailed' ELSE 'paymentChanged' END;
  ELSIF TG_TABLE_NAME='memberships' AND TG_OP='UPDATE' AND (item->>'role' IS DISTINCT FROM previous->>'role' OR item->>'is_active' IS DISTINCT FROM previous->>'is_active') THEN
    category:='team';event_key:='teamChanged';title:='Доступ сотрудника изменён';path:='/team';
  END IF;
  INSERT INTO realtime_events(tenant_id,entity,driver_membership_id) VALUES(company,TG_TABLE_NAME,driver_member) RETURNING id INTO event;
  IF category IS NOT NULL THEN
    INSERT INTO app_notifications(event_id,membership_id,category,title,body,url,event_type)
      SELECT event,m.id,category,title,body,CASE WHEN m.role='driver' THEN '/driver' ELSE path END,coalesce(event_key,'')
      FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.tenant_id=company AND m.is_active AND NOT u.is_system AND (
        (m.role IN ('owner','admin','developer')) OR
        (m.role='dispatcher' AND category IN ('newRequests','newBookings','trips')) OR
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
