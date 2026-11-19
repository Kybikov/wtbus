ALTER TABLE users ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

-- The original installation has one designated developer. Other tenant
-- developer memberships do not grant platform-wide access.
WITH original_developers AS (
    SELECT m.user_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id
    JOIN users u ON u.id=m.user_id AND NOT u.is_system
    WHERE t.slug='vivat-bus' AND m.role='developer' AND m.is_active
)
UPDATE users SET is_platform_admin=true
WHERE id IN (SELECT user_id FROM original_developers)
  AND (SELECT count(*) FROM original_developers)=1;

ALTER TABLE tenants ADD COLUMN platform_created_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE subscription_events ADD COLUMN actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE workspace_subscription_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 100000000),
    currency text NOT NULL DEFAULT 'UAH' CHECK (currency='UAH'),
    paid_on date NOT NULL,
    source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','wtbackend')),
    reference text NOT NULL CHECK (length(reference) BETWEEN 1 AND 160),
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id,source,reference)
);
CREATE INDEX workspace_subscription_payment_date_idx ON workspace_subscription_payments(tenant_id,paid_on DESC,id);
