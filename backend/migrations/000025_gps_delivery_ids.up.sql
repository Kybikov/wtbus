ALTER TABLE gps_points ADD COLUMN client_point_id UUID;
ALTER TABLE gps_points ADD COLUMN membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX gps_points_client_point_idx
  ON gps_points (tenant_id, client_point_id) WHERE client_point_id IS NOT NULL;
