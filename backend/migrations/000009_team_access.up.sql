CREATE INDEX memberships_tenant_active_created_idx
  ON memberships (tenant_id, is_active, created_at DESC);
