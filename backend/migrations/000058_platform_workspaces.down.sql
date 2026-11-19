DROP TABLE workspace_subscription_payments;
ALTER TABLE subscription_events DROP COLUMN actor_user_id;
ALTER TABLE tenants DROP COLUMN platform_created_by;
ALTER TABLE users DROP COLUMN is_platform_admin;
