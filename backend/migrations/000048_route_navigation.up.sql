ALTER TABLE routes ADD COLUMN navigation jsonb;
ALTER TABLE trips ADD COLUMN navigation jsonb;

-- Freeze the planned road when a trip is created or assigned another route.
CREATE FUNCTION snapshot_trip_navigation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.route_id IS DISTINCT FROM OLD.route_id THEN
    NEW.navigation := (SELECT r.navigation FROM routes r WHERE r.id=NEW.route_id AND r.tenant_id=NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trip_navigation_snapshot BEFORE INSERT OR UPDATE OF route_id ON trips
FOR EACH ROW EXECUTE FUNCTION snapshot_trip_navigation();

-- The first complete trip road seeds its route. Once set, route points are
-- independent defaults and cannot be overwritten by a later trip.
CREATE FUNCTION inherit_route_navigation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(jsonb_array_length(NEW.navigation->'coordinates'),0)>=2 THEN
    UPDATE routes r SET navigation=NEW.navigation,updated_at=now()
    WHERE r.id=NEW.route_id AND r.tenant_id=NEW.tenant_id
      AND r.navigation IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trip_route_navigation_inheritance AFTER INSERT OR UPDATE OF navigation ON trips
FOR EACH ROW EXECUTE FUNCTION inherit_route_navigation();
