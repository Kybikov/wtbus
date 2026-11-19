
ALTER TABLE tenants ADD COLUMN billing_owner_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX tenants_billing_owner_idx ON tenants(billing_owner_id);

UPDATE tenants t SET billing_owner_id = (
    SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.tenant_id=t.id AND m.role='owner' AND m.is_active AND NOT u.is_system
    ORDER BY m.created_at,m.id LIMIT 1
);

CREATE TABLE workspace_billing_accounts (
    owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    monthly_discount_minor bigint NOT NULL DEFAULT 0 CHECK (monthly_discount_minor BETWEEN 0 AND 100000000),
    discount_min_workspaces integer NOT NULL DEFAULT 2 CHECK (discount_min_workspaces BETWEEN 1 AND 10000),
    next_due_on date
);
INSERT INTO workspace_billing_accounts(owner_id,monthly_discount_minor)
SELECT billing_owner_id,100000 FROM tenants WHERE slug='vivat-bus' AND billing_owner_id IS NOT NULL;

CREATE TABLE workspace_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    role membership_role NOT NULL CHECK (role IN ('admin','dispatcher','driver','accountant')),
    driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
    created_by uuid REFERENCES memberships(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
    accepted_by uuid REFERENCES memberships(id) ON DELETE SET NULL,
    accepted_at timestamptz,
    revoked_at timestamptz,
    CHECK (driver_id IS NULL OR role='driver')
);
CREATE INDEX workspace_invitations_tenant_idx ON workspace_invitations(tenant_id,created_at DESC);
