UPDATE individual_transfer_requests
SET status = CASE
    WHEN status = 'booking_created' THEN 'closed'
    WHEN status = 'awaiting_trip' THEN 'in_progress'
    ELSE status
END;

DROP INDEX IF EXISTS individual_transfer_requests_booking_id_idx;

ALTER TABLE individual_transfer_requests DROP COLUMN booking_id;

ALTER TABLE individual_transfer_requests
    DROP CONSTRAINT individual_transfer_requests_status_check;

ALTER TABLE individual_transfer_requests
    ADD CONSTRAINT individual_transfer_requests_status_check
    CHECK (status IN ('new', 'in_progress', 'closed', 'cancelled'));
