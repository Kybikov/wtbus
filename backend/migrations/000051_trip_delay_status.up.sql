INSERT INTO workflow_statuses(tenant_id,entity_type,key,label,tone,semantic_phase,is_available,is_terminal,is_system,position)
SELECT id,'trips','in_progress_delayed','В пути · задержка','danger','in_progress',false,false,true,65 FROM tenants
ON CONFLICT DO NOTHING;

-- Existing fully received cash remains in the ledger; only correct the booking label.
WITH corrected AS (
 UPDATE bookings b SET status='confirmed',updated_at=now()
 FROM driver_booking_checkins c
 WHERE b.tenant_id=c.tenant_id AND b.id=c.booking_id AND b.status='cash_on_boarding'
 AND c.cash_minor>=b.price_minor AND c.cash_minor>0
 RETURNING b.tenant_id,b.id
)
INSERT INTO activity_events(tenant_id,actor_kind,action,entity_type,entity_id,details)
SELECT tenant_id,'system','record_updated','bookings',id,
 jsonb_build_object('changes',jsonb_build_array(jsonb_build_object('field','status','before','cash_on_boarding','after','confirmed')))
FROM corrected;
