ALTER TABLE bookings DROP CONSTRAINT bookings_source_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_source_check CHECK (source IN ('telegram', 'dispatcher', 'import', 'web'));

CREATE TABLE public_booking_requests (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_key UUID NOT NULL,
  request_hash BYTEA NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_key)
);
