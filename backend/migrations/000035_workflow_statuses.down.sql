DROP TRIGGER IF EXISTS tenants_seed_workflow_statuses ON tenants;
DROP FUNCTION IF EXISTS seed_workflow_statuses_for_tenant();

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_vehicle_no_overlap;
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_driver_no_overlap;
DROP INDEX IF EXISTS trips_vehicle_range_idx;
DROP INDEX IF EXISTS trips_driver_range_idx;
DROP INDEX IF EXISTS bookings_one_active_per_customer_trip_idx;
DROP INDEX IF EXISTS bookings_payment_hold_expiry_idx;

CREATE TYPE trip_status_legacy AS ENUM ('draft','new','assigned','in_progress','completed','cancelled');
UPDATE trips SET status=CASE WHEN status IN ('draft','new','assigned','in_progress','completed','cancelled') THEN status ELSE (SELECT semantic_phase FROM workflow_statuses s WHERE s.tenant_id=trips.tenant_id AND s.entity_type='trips' AND s.key=trips.status) END;
UPDATE trips SET status='assigned' WHERE status NOT IN ('draft','new','assigned','in_progress','completed','cancelled');
ALTER TABLE trips ALTER COLUMN status DROP DEFAULT;
ALTER TABLE trips ALTER COLUMN status TYPE trip_status_legacy USING status::trip_status_legacy;
ALTER TYPE trip_status_legacy RENAME TO trip_status;
ALTER TABLE trips ALTER COLUMN status SET DEFAULT 'draft';

CREATE TYPE booking_status_legacy AS ENUM ('pending','awaiting_payment','cash_on_boarding','confirmed','cancelled','completed','expired');
UPDATE bookings SET status=CASE WHEN status IN ('pending','awaiting_payment','cash_on_boarding','confirmed','cancelled','completed','expired') THEN status ELSE 'pending' END;
ALTER TABLE bookings ALTER COLUMN status DROP DEFAULT;
ALTER TABLE bookings ALTER COLUMN status TYPE booking_status_legacy USING status::booking_status_legacy;
ALTER TYPE booking_status_legacy RENAME TO booking_status;
ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending';

CREATE TYPE payment_status_legacy AS ENUM ('pending','authorized','paid','failed','cancelled','refunded');
UPDATE payments SET status='pending' WHERE status NOT IN ('pending','authorized','paid','failed','cancelled','refunded');
ALTER TABLE payments ALTER COLUMN status DROP DEFAULT;
ALTER TABLE payments ALTER COLUMN status TYPE payment_status_legacy USING status::payment_status_legacy;
ALTER TYPE payment_status_legacy RENAME TO payment_status;
ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'pending';

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

UPDATE individual_transfer_requests request
SET status = CASE status
  WHEN 'new' THEN 'new'
  WHEN 'in_progress' THEN 'in_progress'
  WHEN 'awaiting_trip' THEN 'awaiting_trip'
  WHEN 'booking_created' THEN 'booking_created'
  WHEN 'closed' THEN 'closed'
  WHEN 'cancelled' THEN 'cancelled'
  ELSE COALESCE((
    SELECT CASE semantic_phase
      WHEN 'new' THEN 'new'
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'awaiting_trip' THEN 'awaiting_trip'
      WHEN 'booking_created' THEN 'booking_created'
      WHEN 'closed' THEN 'closed'
      ELSE 'cancelled'
    END
    FROM workflow_statuses status
    WHERE status.tenant_id = request.tenant_id
      AND status.entity_type = 'requests'
      AND status.key = request.status
  ), 'cancelled')
END;
ALTER TABLE individual_transfer_requests
  ADD CONSTRAINT individual_transfer_requests_status_check
  CHECK (status IN ('new','in_progress','awaiting_trip','booking_created','closed','cancelled'));

CREATE TABLE route_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key ~ '^[a-z0-9_]{2,64}$'),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  tone TEXT NOT NULL DEFAULT 'neutral' CHECK (tone IN ('success','warning','danger','info','neutral','violet')),
  is_available BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
INSERT INTO route_statuses (tenant_id,key,label,tone,is_available,is_system,position,created_at,updated_at)
SELECT tenant_id,key,label,tone,is_available,is_system,position,created_at,updated_at
FROM workflow_statuses WHERE entity_type='routes';
ALTER TABLE routes ADD CONSTRAINT routes_status_fk
  FOREIGN KEY (tenant_id,status) REFERENCES route_statuses(tenant_id,key);

DROP TABLE tenant_integration_secrets;
ALTER TABLE routes DROP COLUMN driver_pay_minor;

ALTER TABLE vehicles DROP COLUMN status;
ALTER TABLE drivers DROP COLUMN status;
DROP FUNCTION workflow_status_phase(UUID,TEXT,TEXT);
DROP TABLE workflow_statuses;
