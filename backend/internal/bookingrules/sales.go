// Package bookingrules keeps passenger sales rules identical across web and bot.
package bookingrules

// SalePredicate expects the trips table to use alias t.
const SalePredicate = `t.kind = 'regular' AND t.pricing_mode = 'per_passenger'
 AND workflow_status_phase(t.tenant_id,'trips',t.status) IN ('planned','assigned') AND t.starts_at > now()
 AND (t.route_id IS NULL OR EXISTS (SELECT 1 FROM routes r WHERE r.id=t.route_id AND r.tenant_id=t.tenant_id AND r.is_active))
 AND (t.vehicle_id IS NULL OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id=t.vehicle_id AND v.tenant_id=t.tenant_id AND v.is_active))
 AND NOT EXISTS (SELECT 1 FROM availability_blocks a WHERE a.tenant_id=t.tenant_id
   AND (a.route_id IS NULL OR a.route_id=t.route_id) AND a.starts_at<t.ends_at AND a.ends_at>t.starts_at)`

// SegmentOccupiedSQL expects a trip t and a selected segment s.
const SegmentOccupiedSQL = `trip_occupied_seats(t,s.from_stop,s.to_stop)`
