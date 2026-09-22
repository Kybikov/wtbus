CREATE TABLE workflow_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('routes','vehicles','drivers','trips','requests','bookings','payments')),
  key TEXT NOT NULL CHECK (key ~ '^[a-z0-9_]{2,64}$'),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  tone TEXT NOT NULL DEFAULT 'neutral' CHECK (tone IN ('success','warning','danger','info','neutral','violet')),
  semantic_phase TEXT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, key)
);

CREATE INDEX workflow_statuses_tenant_entity_position_idx
  ON workflow_statuses (tenant_id, entity_type, position, created_at);

CREATE FUNCTION workflow_status_phase(p_tenant UUID, p_entity TEXT, p_key TEXT)
RETURNS TEXT STABLE LANGUAGE sql AS $$
  SELECT semantic_phase FROM workflow_statuses
  WHERE tenant_id=p_tenant AND entity_type=p_entity AND key=p_key
$$;

ALTER TABLE individual_transfer_requests
  DROP CONSTRAINT IF EXISTS individual_transfer_requests_status_check;

ALTER TABLE routes
  ADD COLUMN driver_pay_minor BIGINT NOT NULL DEFAULT 0 CHECK (driver_pay_minor >= 0);

CREATE TABLE tenant_integration_secrets (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monobank_token TEXT,
  telegram_bot_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO workflow_statuses (tenant_id,entity_type,key,label,tone,semantic_phase,is_available,is_terminal,is_system,position)
SELECT tenant_id,'routes',key,label,tone,key,is_available,key='archived',is_system,position FROM route_statuses;

INSERT INTO workflow_statuses (tenant_id,entity_type,key,label,tone,semantic_phase,is_available,is_terminal,is_system,position)
SELECT t.id,s.entity_type,s.key,s.label,s.tone,s.phase,s.available,s.terminal,true,s.position
FROM tenants t CROSS JOIN (VALUES
  ('vehicles','ready','Готов','success','ready',true,false,10),
  ('vehicles','on_route','В маршруте','info','on_route',false,false,20),
  ('vehicles','reserved','Зарезервирован','violet','reserved',false,false,30),
  ('vehicles','maintenance','На ТО','warning','maintenance',false,false,40),
  ('vehicles','repair','Ремонт','danger','repair',false,false,50),
  ('vehicles','temporarily_unavailable','Временно недоступен','warning','unavailable',false,false,60),
  ('vehicles','archived','Архив','neutral','archived',false,true,70),
  ('drivers','ready','Готов','success','ready',true,false,10),
  ('drivers','assigned','Назначен','violet','assigned',false,false,20),
  ('drivers','on_route','В рейсе','info','on_route',false,false,30),
  ('drivers','rest','Отдых','neutral','rest',false,false,40),
  ('drivers','sick_leave','Больничный','warning','unavailable',false,false,50),
  ('drivers','vacation','Отпуск','violet','unavailable',false,false,60),
  ('drivers','inactive','Неактивен','neutral','inactive',false,true,70),
  ('trips','draft','Черновик','neutral','draft',false,false,10),
  ('trips','new','Запланирован','info','planned',true,false,20),
  ('trips','boarding','Посадка','warning','assigned',false,false,30),
  ('trips','assigned','Назначен','violet','assigned',false,false,40),
  ('trips','delayed','Задерживается','danger','assigned',false,false,50),
  ('trips','in_progress','В пути','info','in_progress',false,false,60),
  ('trips','completed','Завершён','success','completed',false,true,70),
  ('trips','cancelled','Отменён','danger','cancelled',false,true,80),
  ('requests','new','Новая','info','new',true,false,10),
  ('requests','in_progress','В работе','warning','in_progress',true,false,20),
  ('requests','awaiting_details','Уточнение данных','warning','in_progress',true,false,30),
  ('requests','awaiting_trip','Подбор рейса','violet','awaiting_trip',true,false,40),
  ('requests','awaiting_customer','Ожидает решения клиента','info','awaiting_trip',true,false,50),
  ('requests','booking_created','Бронь создана','success','booking_created',false,true,60),
  ('requests','closed','Закрыта без брони','neutral','closed',false,true,70),
  ('requests','cancelled','Отклонена','danger','cancelled',false,true,80),
  ('bookings','pending','Создано','info','pending',true,false,10),
  ('bookings','awaiting_payment','Ожидает оплату','warning','awaiting_payment',true,false,20),
  ('bookings','cash_on_boarding','Наличными при посадке','info','confirmed',true,false,30),
  ('bookings','confirmed','Подтверждено','success','confirmed',true,false,40),
  ('bookings','passenger_arrived','Пассажир прибыл','success','confirmed',true,false,50),
  ('bookings','no_show','Не явился','danger','completed',false,true,60),
  ('bookings','completed','Завершено','success','completed',false,true,70),
  ('bookings','cancelled','Отменено','neutral','cancelled',false,true,80),
  ('bookings','expired','Срок оплаты истёк','danger','cancelled',false,true,90),
  ('payments','pending','Ожидается','warning','pending',true,false,10),
  ('payments','authorized','Авторизована','info','authorized',true,false,20),
  ('payments','paid','Оплачена','success','paid',false,true,30),
  ('payments','failed','Ошибка','danger','failed',false,true,40),
  ('payments','cancelled','Отменена','neutral','cancelled',false,true,50),
  ('payments','refunded','Возвращена','violet','refunded',false,true,60)
) AS s(entity_type,key,label,tone,phase,available,terminal,position)
ON CONFLICT (tenant_id,entity_type,key) DO NOTHING;

ALTER TABLE vehicles ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
UPDATE vehicles SET status=CASE WHEN is_active THEN 'ready' ELSE 'archived' END;
ALTER TABLE drivers ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
UPDATE drivers SET status=CASE WHEN is_active THEN 'ready' ELSE 'inactive' END;

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_vehicle_no_overlap;
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_driver_no_overlap;
DROP INDEX IF EXISTS trips_vehicle_range_idx;
DROP INDEX IF EXISTS trips_driver_range_idx;
DROP INDEX IF EXISTS bookings_one_active_per_customer_trip_idx;
DROP INDEX IF EXISTS bookings_payment_hold_expiry_idx;

ALTER TABLE trips ALTER COLUMN status DROP DEFAULT;
ALTER TABLE trips ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE trips ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE bookings ALTER COLUMN status DROP DEFAULT;
ALTER TABLE bookings ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE payments ALTER COLUMN status DROP DEFAULT;
ALTER TABLE payments ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'pending';
DROP TYPE trip_status;
DROP TYPE booking_status;
DROP TYPE payment_status;

CREATE INDEX trips_vehicle_range_idx ON trips (vehicle_id, starts_at, ends_at) WHERE status <> 'cancelled';
CREATE INDEX trips_driver_range_idx ON trips (driver_id, starts_at, ends_at) WHERE status <> 'cancelled';
ALTER TABLE trips ADD CONSTRAINT trips_vehicle_no_overlap EXCLUDE USING gist (
  vehicle_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (vehicle_id IS NOT NULL AND status <> 'cancelled');
ALTER TABLE trips ADD CONSTRAINT trips_driver_no_overlap EXCLUDE USING gist (
  driver_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (driver_id IS NOT NULL AND status <> 'cancelled');
CREATE UNIQUE INDEX bookings_one_active_per_customer_trip_idx
  ON bookings (trip_id, customer_id)
  WHERE status IN ('pending','awaiting_payment','cash_on_boarding','confirmed');
CREATE INDEX bookings_payment_hold_expiry_idx
  ON bookings (payment_hold_expires_at) WHERE status='awaiting_payment';

ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_status_fk;
DROP TABLE route_statuses;

CREATE FUNCTION seed_workflow_statuses_for_tenant() RETURNS trigger AS $$
BEGIN
  INSERT INTO workflow_statuses (tenant_id,entity_type,key,label,tone,semantic_phase,is_available,is_terminal,is_system,position)
  SELECT DISTINCT ON (entity_type,key) NEW.id,entity_type,key,label,tone,semantic_phase,is_available,is_terminal,true,position
  FROM workflow_statuses WHERE tenant_id<>NEW.id AND is_system
  ORDER BY entity_type,key,created_at
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_seed_workflow_statuses AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION seed_workflow_statuses_for_tenant();
