DROP TRIGGER trip_route_navigation_inheritance ON trips;
DROP FUNCTION inherit_route_navigation();
DROP TRIGGER trip_navigation_snapshot ON trips;
DROP FUNCTION snapshot_trip_navigation();
ALTER TABLE trips DROP COLUMN navigation;
ALTER TABLE routes DROP COLUMN navigation;
