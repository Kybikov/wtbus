package main

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
)

func prepareTripNavigation(ctx context.Context, input *routeNavigation) ([]byte, error) {
	if input == nil {
		return nil, nil
	}
	road, err := prepareRouteNavigation(ctx, *input)
	if err != nil {
		return nil, err
	}
	return json.Marshal(road)
}

// Apply after the route snapshot trigger, in the transaction that creates or
// updates the trip. A trip override never rewrites an independent route road.
func persistTripNavigation(ctx context.Context, tx pgx.Tx, tenantID, tripID string, road []byte) error {
	if road == nil {
		return nil
	}
	if _, err := tx.Exec(ctx, `UPDATE trips SET navigation=$3 WHERE tenant_id=$1 AND id=$2`, tenantID, tripID, road); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE routes r SET distance_km=round((t.navigation->>'distanceMeters')::numeric/1000,2) FROM trips t WHERE t.tenant_id=$1 AND t.id=$2 AND r.tenant_id=$1 AND r.id=t.route_id AND r.navigation=t.navigation`, tenantID, tripID)
	return err
}
