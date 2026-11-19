ALTER TABLE routes ADD COLUMN itinerary jsonb NOT NULL DEFAULT '{"stops":[],"fares":[]}';
ALTER TABLE trips ADD COLUMN itinerary jsonb NOT NULL DEFAULT '{"stops":[],"fares":[]}';

ALTER TABLE bookings
    ADD COLUMN segment_from smallint,
    ADD COLUMN segment_to smallint,
    ADD COLUMN segment_origin text,
    ADD COLUMN segment_destination text,
    ADD COLUMN segment_pickup text,
    ADD COLUMN segment_dropoff text,
    ADD CONSTRAINT booking_segment_bounds CHECK (
        (segment_from IS NULL AND segment_to IS NULL)
        OR (segment_from IS NOT NULL AND segment_to IS NOT NULL AND segment_from >= 0 AND segment_to > segment_from)
    );

CREATE FUNCTION snapshot_trip_itinerary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.route_id IS NOT DISTINCT FROM OLD.route_id THEN RETURN NEW; END IF;
        IF EXISTS (SELECT 1 FROM bookings WHERE tenant_id=OLD.tenant_id AND trip_id=OLD.id AND segment_from IS NOT NULL)
        THEN RETURN NEW; END IF;
    END IF;

    NEW.itinerary := COALESCE(
        (SELECT itinerary FROM routes WHERE id=NEW.route_id AND tenant_id=NEW.tenant_id),
        NEW.itinerary
    );
    RETURN NEW;
END $$;

CREATE TRIGGER trip_itinerary_snapshot BEFORE INSERT OR UPDATE OF route_id ON trips
FOR EACH ROW EXECUTE FUNCTION snapshot_trip_itinerary();

-- The last stop is dynamic for a legacy/full-length booking. Partial bookings
-- have frozen stop ordinals and keep using the same legs after a fare change.
CREATE FUNCTION trip_occupied_seats(t trips, from_stop integer DEFAULT 0,
    to_stop integer DEFAULT NULL, include_completed boolean DEFAULT false)
RETURNS bigint LANGUAGE sql STABLE AS $$
    WITH active AS MATERIALIZED (
        SELECT b.seats, COALESCE(b.segment_from,0) AS first_leg,
               COALESCE(b.segment_to,jsonb_array_length(t.itinerary->'stops')+1) AS end_stop
        FROM bookings b
        WHERE b.tenant_id=t.tenant_id AND b.trip_id=t.id
          AND (workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed')
            OR (include_completed AND workflow_status_phase(b.tenant_id,'bookings',b.status)='completed')
            OR (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>now()))
    )
    SELECT COALESCE(max(load.seats),0)
    FROM generate_series(from_stop,COALESCE(to_stop,jsonb_array_length(t.itinerary->'stops')+1)-1) leg
    CROSS JOIN LATERAL (
        SELECT sum(a.seats) AS seats FROM active a WHERE a.first_leg<=leg AND a.end_stop>leg
    ) load
$$;

CREATE FUNCTION booking_departure_time(t trips, b bookings)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN b.segment_from>0
                THEN t.starts_at+make_interval(mins => (t.itinerary->'stops'->(b.segment_from-1)->>'minutes')::int)
                ELSE t.starts_at END
$$;

CREATE FUNCTION trip_sale_segments(t trips)
RETURNS TABLE (
    from_stop integer, to_stop integer, origin text, destination text,
    starts_at timestamptz, ends_at timestamptz, price_minor bigint,
    pickup text, dropoff text
) LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    SELECT 0, jsonb_array_length(t.itinerary->'stops')+1,
        t.origin_name, t.destination_name, t.starts_at, t.ends_at, t.price_minor,
        COALESCE(t.navigation->>'startLabel',''), COALESCE(t.navigation->>'endLabel','')
    UNION ALL
    SELECT x.first_stop, x.last_stop, x.origin, x.destination, x.departure, x.arrival, x.price, x.pickup, x.dropoff
    FROM (
        SELECT
            f."from" AS first_stop, f."to" AS last_stop,
            COALESCE(a.value->>'city',t.origin_name) AS origin,
            COALESCE(b.value->>'city',t.destination_name) AS destination,
            COALESCE(t.starts_at+make_interval(mins => (a.value->>'minutes')::int),t.starts_at) AS departure,
            COALESCE(t.starts_at+make_interval(mins => (b.value->>'minutes')::int),t.ends_at) AS arrival,
            f."priceMinor" AS price,
            COALESCE(a.value->>'address',t.navigation->>'startLabel','') AS pickup,
            COALESCE(b.value->>'address',t.navigation->>'endLabel','') AS dropoff
        FROM jsonb_to_recordset(t.itinerary->'fares') AS f("from" integer,"to" integer,"priceMinor" bigint)
        LEFT JOIN LATERAL (SELECT t.itinerary->'stops'->(f."from"-1) AS value WHERE f."from">0) a ON true
        LEFT JOIN LATERAL (SELECT t.itinerary->'stops'->(f."to"-1) AS value WHERE f."to"<=jsonb_array_length(t.itinerary->'stops')) b ON true
    ) x
    WHERE t.pricing_mode='per_passenger' AND x.departure >= t.starts_at AND x.arrival <= t.ends_at AND x.departure < x.arrival
      AND x.origin IS DISTINCT FROM x.destination;
END
$$;
