CREATE UNIQUE INDEX drivers_tenant_identity_idx ON drivers(tenant_id,id);
ALTER TABLE routes ADD COLUMN default_driver_id uuid;
ALTER TABLE routes ADD CONSTRAINT routes_default_driver_company_fk
  FOREIGN KEY (tenant_id,default_driver_id) REFERENCES drivers(tenant_id,id)
  ON DELETE SET NULL (default_driver_id);
