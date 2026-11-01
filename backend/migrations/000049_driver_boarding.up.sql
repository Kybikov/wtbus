CREATE TABLE driver_booking_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  boarding jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(boarding)='object'),
  cash_minor bigint NOT NULL DEFAULT 0 CHECK (cash_minor>=0),
  actor_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_booking_checkins_tenant_idx ON driver_booking_checkins(tenant_id);
-- Preserve previously confirmed whole-trip receipts without collecting them twice.
INSERT INTO driver_booking_checkins(tenant_id,booking_id,cash_minor)
SELECT b.tenant_id,b.id,b.price_minor FROM bookings b
WHERE workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('confirmed','completed')
  AND EXISTS(SELECT 1 FROM driver_cash_ledger l WHERE l.tenant_id=b.tenant_id AND l.trip_id=b.trip_id AND l.kind='cash_collected')
  AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.payment_method='bank_transfer');
ALTER TABLE trips ADD COLUMN actual_started_at timestamptz;
ALTER TABLE trips ADD COLUMN actual_completed_at timestamptz;
CREATE FUNCTION record_trip_actual_times() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF workflow_status_phase(NEW.tenant_id,'trips',NEW.status)='in_progress'
     AND workflow_status_phase(OLD.tenant_id,'trips',OLD.status)<>'in_progress' THEN
    NEW.actual_started_at := COALESCE(OLD.actual_started_at,now());
  END IF;
  IF workflow_status_phase(NEW.tenant_id,'trips',NEW.status)='completed'
     AND workflow_status_phase(OLD.tenant_id,'trips',OLD.status)<>'completed' THEN
    NEW.actual_completed_at := COALESCE(OLD.actual_completed_at,now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trip_actual_times BEFORE UPDATE OF status ON trips FOR EACH ROW EXECUTE FUNCTION record_trip_actual_times();

ALTER TABLE driver_cash_ledger ADD COLUMN source_key text;
CREATE UNIQUE INDEX driver_cash_ledger_source_key_idx ON driver_cash_ledger(tenant_id,source_key) WHERE source_key IS NOT NULL;
DROP INDEX driver_cash_ledger_trip_cash_receipt_idx;
CREATE UNIQUE INDEX driver_cash_ledger_trip_cash_receipt_idx ON driver_cash_ledger(tenant_id,trip_id,currency) WHERE kind='cash_collected' AND trip_id IS NOT NULL AND source_key IS NULL;

-- Customer totals are received money, not the face value of unpaid reservations.
CREATE FUNCTION booking_received_minor(company uuid,booking uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.tenant_id=company AND p.booking_id=booking AND workflow_status_phase(p.tenant_id,'payments',p.status)='paid'),0)
 + COALESCE((SELECT cash_minor FROM driver_booking_checkins c WHERE c.tenant_id=company AND c.booking_id=booking),
 (SELECT b.price_minor FROM bookings b WHERE b.tenant_id=company AND b.id=booking
 AND workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('confirmed','completed')
 AND EXISTS(SELECT 1 FROM driver_cash_ledger l WHERE l.tenant_id=company AND l.trip_id=b.trip_id AND l.kind='cash_collected' AND l.source_key IS NULL)
 AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.tenant_id=company AND p.booking_id=booking)),0)
$$;
