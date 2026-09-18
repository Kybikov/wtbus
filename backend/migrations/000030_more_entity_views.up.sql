ALTER TABLE entity_views DROP CONSTRAINT entity_views_entity_check;
ALTER TABLE entity_views ADD CONSTRAINT entity_views_entity_check
  CHECK (entity IN ('customers','bookings','team','routes','fleet','requests','availability','trips','cash-balances'));
