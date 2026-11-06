DROP TRIGGER trip_boarding_time ON trips;
DROP FUNCTION record_trip_boarding_time();
DROP FUNCTION trip_departure_manifest_key(uuid,uuid);
DROP TRIGGER trip_departure_plan ON trips;
DROP FUNCTION revise_trip_departure_plan();
ALTER TABLE trips DROP COLUMN actual_boarding_started_at, DROP COLUMN early_departure_approved_at,
 DROP COLUMN early_departure_approved_by, DROP COLUMN early_departure_approval_key, DROP COLUMN departure_plan_revision;
INSERT INTO workflow_statuses(tenant_id,entity_type,key,label,tone,semantic_phase,is_available,is_terminal,is_system,position)
SELECT id,'trips','delayed','Задерживается','danger','assigned',false,false,true,50 FROM tenants ON CONFLICT DO NOTHING;
INSERT INTO workflow_statuses(tenant_id,entity_type,key,label,tone,semantic_phase,is_available,is_terminal,is_system,position)
SELECT id,'trips','in_progress_delayed','В пути · задержка','danger','in_progress',false,false,true,65 FROM tenants ON CONFLICT DO NOTHING;
