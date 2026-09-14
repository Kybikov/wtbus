DROP TABLE IF EXISTS activity_events;

DELETE FROM users WHERE is_system;

ALTER TABLE users DROP COLUMN IF EXISTS is_system;
