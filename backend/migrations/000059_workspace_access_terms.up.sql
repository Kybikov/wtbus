ALTER TABLE user_sessions ADD COLUMN platform_access boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN subscription_through date;
ALTER TABLE subscription_events ADD COLUMN previous_through date, ADD COLUMN next_through date;

CREATE FUNCTION effective_workspace_status(configured text, access_through date, today date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN configured IN ('trial','active') AND access_through < today THEN 'past_due' ELSE configured END
$$;

INSERT INTO subscription_events (tenant_id,external_event_id,previous_status,next_status,reason,previous_through,next_through)
SELECT id,'manual-trial-vivat-2026-12-01',subscription_status,'trial','Пробный доступ Vivat до 01.12.2026 включительно',subscription_through,DATE '2026-12-01'
FROM tenants WHERE slug='vivat-bus';

UPDATE tenants SET subscription_status='trial',subscription_through=DATE '2026-12-01',updated_at=now() WHERE slug='vivat-bus';
