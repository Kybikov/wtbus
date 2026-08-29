ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'awaiting_payment';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'cash_on_boarding';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'expired';
