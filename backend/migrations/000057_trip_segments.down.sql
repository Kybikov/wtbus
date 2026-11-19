DROP FUNCTION trip_sale_segments(trips);
DROP FUNCTION booking_departure_time(trips,bookings);
DROP FUNCTION trip_occupied_seats(trips,integer,integer,boolean);
DROP TRIGGER trip_itinerary_snapshot ON trips;
DROP FUNCTION snapshot_trip_itinerary();
ALTER TABLE bookings DROP CONSTRAINT booking_segment_bounds, DROP COLUMN segment_from, DROP COLUMN segment_to, DROP COLUMN segment_origin, DROP COLUMN segment_destination, DROP COLUMN segment_pickup, DROP COLUMN segment_dropoff;
ALTER TABLE trips DROP COLUMN itinerary;
ALTER TABLE routes DROP COLUMN itinerary;
