CREATE TABLE customer_import_runs (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 preview_token text NOT NULL,
 source_digest text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,preview_token)
);
