-- Refuses rollback while views for the new collections exist. Export them first.
ALTER TABLE entity_views DROP CONSTRAINT entity_views_entity_check;
ALTER TABLE entity_views ADD CONSTRAINT entity_views_entity_check
  CHECK (entity IN ('customers','bookings','team'));
