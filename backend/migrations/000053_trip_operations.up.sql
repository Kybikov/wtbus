ALTER TABLE trips ADD COLUMN actual_boarding_started_at timestamptz;
ALTER TABLE trips ADD COLUMN early_departure_approved_at timestamptz;
ALTER TABLE trips ADD COLUMN early_departure_approved_by uuid REFERENCES memberships(id) ON DELETE SET NULL;
ALTER TABLE trips ADD COLUMN early_departure_approval_key text;
ALTER TABLE trips ADD COLUMN departure_plan_revision bigint NOT NULL DEFAULT 0;

-- Repair only invalid, not-yet-departed snapshots when every reservation fits.
-- Deliberately reduced sales limits and historical trips remain untouched.
WITH before AS (
 SELECT t.id,t.tenant_id,t.capacity AS previous,v.capacity AS current
 FROM trips t JOIN vehicles v ON v.id=t.vehicle_id AND v.tenant_id=t.tenant_id
 JOIN workflow_statuses s ON s.tenant_id=t.tenant_id AND s.entity_type='trips' AND s.key=t.status
 WHERE t.actual_started_at IS NULL AND s.semantic_phase IN ('planned','assigned') AND NOT s.is_terminal
 AND t.capacity>v.capacity AND v.capacity >= COALESCE((SELECT sum(b.seats) FROM bookings b WHERE b.tenant_id=t.tenant_id AND b.trip_id=t.id AND
 (workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed','completed') OR
 (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>now()))),0)
), changed AS (
 UPDATE trips t SET capacity=b.current FROM before b WHERE t.id=b.id AND t.tenant_id=b.tenant_id
 RETURNING t.id,t.tenant_id,b.previous,t.capacity AS current
)
INSERT INTO activity_events(tenant_id,actor_kind,action,entity_type,entity_id,details)
SELECT tenant_id,'system','record_updated','trips',id,
 jsonb_build_object('changes',jsonb_build_array(jsonb_build_object('field','capacity','before',previous,'after',current))) FROM changed;

-- Keep evidence-backed boarding times; do not infer a departure from a clock.
UPDATE trips t SET actual_boarding_started_at=e.at
FROM (
 SELECT tenant_id,entity_id,min(created_at) AS at FROM activity_events e
 WHERE entity_type='trips' AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(details->'changes')='array' THEN details->'changes' ELSE '[]'::jsonb END) c
  WHERE c->>'field'='status' AND c->>'after'='boarding'
 ) GROUP BY tenant_id,entity_id
) e WHERE t.tenant_id=e.tenant_id AND t.id::text=e.entity_id;

WITH before AS (
 SELECT id,tenant_id,status FROM trips WHERE status IN ('delayed','in_progress_delayed')
), changed AS (
 UPDATE trips t SET status=CASE
  WHEN t.status='in_progress_delayed' THEN 'in_progress'
  WHEN t.actual_boarding_started_at IS NOT NULL THEN 'boarding'
  ELSE 'assigned' END
 FROM before b WHERE t.id=b.id AND t.tenant_id=b.tenant_id
 RETURNING t.id,t.tenant_id,b.status AS previous,t.status AS current
)
INSERT INTO activity_events(tenant_id,actor_kind,action,entity_type,entity_id,details)
SELECT tenant_id,'system','record_updated','trips',id,
 jsonb_build_object('changes',jsonb_build_array(jsonb_build_object('field','status','before',previous,'after',current)),
 'reason','Delay is now independent of trip stage') FROM changed;

DELETE FROM workflow_statuses WHERE entity_type='trips' AND key IN ('delayed','in_progress_delayed') AND is_system;

CREATE FUNCTION trip_departure_manifest_key(company uuid,trip uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT md5(jsonb_build_object('revision',t.departure_plan_revision,'vehicle',t.vehicle_id,'driver',t.driver_id,'departure',t.starts_at,
 'passengers',COALESCE((SELECT jsonb_agg(jsonb_build_array(b.id,b.seats,b.status,b.updated_at,b.payment_hold_expires_at) ORDER BY b.id)
 FROM bookings b WHERE b.tenant_id=company AND b.trip_id=t.id),'[]'::jsonb))::text)
 FROM trips t WHERE t.tenant_id=company AND t.id=trip
$$;

CREATE FUNCTION record_trip_boarding_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='boarding' AND OLD.status IS DISTINCT FROM 'boarding' THEN
  NEW.actual_boarding_started_at := COALESCE(OLD.actual_boarding_started_at,now());
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trip_boarding_time BEFORE UPDATE OF status ON trips FOR EACH ROW EXECUTE FUNCTION record_trip_boarding_time();

CREATE FUNCTION revise_trip_departure_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.vehicle_id,NEW.driver_id,NEW.starts_at) IS DISTINCT FROM ROW(OLD.vehicle_id,OLD.driver_id,OLD.starts_at) THEN
  NEW.departure_plan_revision := OLD.departure_plan_revision+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trip_departure_plan BEFORE UPDATE OF vehicle_id,driver_id,starts_at ON trips FOR EACH ROW EXECUTE FUNCTION revise_trip_departure_plan();
