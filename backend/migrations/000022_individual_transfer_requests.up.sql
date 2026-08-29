CREATE TABLE individual_transfer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  telegram_id BIGINT,
  origin_name TEXT NOT NULL,
  destination_name TEXT NOT NULL,
  requested_departure_at TIMESTAMPTZ NOT NULL,
  passenger_name TEXT NOT NULL,
  passenger_phone_e164 TEXT NOT NULL,
  passenger_birth_date DATE NOT NULL,
  seats SMALLINT NOT NULL CHECK (seats BETWEEN 1 AND 20),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'closed', 'cancelled')),
  operator_note TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(origin_name) BETWEEN 2 AND 120),
  CHECK (char_length(destination_name) BETWEEN 2 AND 120),
  CHECK (char_length(passenger_name) BETWEEN 2 AND 160),
  CHECK (char_length(passenger_phone_e164) BETWEEN 8 AND 20),
  CHECK (comment IS NULL OR char_length(comment) <= 2000),
  CHECK (operator_note IS NULL OR char_length(operator_note) <= 2000)
);

CREATE INDEX individual_transfer_requests_tenant_status_created_idx
  ON individual_transfer_requests (tenant_id, status, created_at DESC);
CREATE INDEX individual_transfer_requests_tenant_departure_idx
  ON individual_transfer_requests (tenant_id, requested_departure_at);
