UPDATE tenants t SET subscription_status=e.previous_status,updated_at=now()
FROM subscription_events e WHERE e.tenant_id=t.id AND e.external_event_id='manual-trial-vivat-2026-12-01'
  AND t.subscription_status=e.next_status AND t.subscription_through=e.next_through;
DELETE FROM subscription_events WHERE external_event_id='manual-trial-vivat-2026-12-01';
ALTER TABLE user_sessions DROP COLUMN platform_access;
DROP FUNCTION effective_workspace_status(text,date,date);
ALTER TABLE subscription_events DROP COLUMN previous_through, DROP COLUMN next_through;
ALTER TABLE tenants DROP COLUMN subscription_through;
