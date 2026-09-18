DROP TABLE IF EXISTS public_booking_requests;
UPDATE bookings SET source = 'dispatcher' WHERE source = 'web';
ALTER TABLE bookings DROP CONSTRAINT bookings_source_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_source_check CHECK (source IN ('telegram', 'dispatcher', 'import'));
