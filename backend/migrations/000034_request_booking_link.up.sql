ALTER TABLE individual_transfer_requests
    DROP CONSTRAINT individual_transfer_requests_status_check;

ALTER TABLE individual_transfer_requests
    ADD CONSTRAINT individual_transfer_requests_status_check
    CHECK (status IN ('new', 'in_progress', 'awaiting_trip', 'booking_created', 'closed', 'cancelled'));

ALTER TABLE individual_transfer_requests
    ADD COLUMN booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX individual_transfer_requests_booking_id_idx
    ON individual_transfer_requests (booking_id)
    WHERE booking_id IS NOT NULL;
