package bookingrules

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type Segment struct {
	From, To                             *int
	Origin, Destination, Pickup, Dropoff *string
	StartsAt, EndsAt                     time.Time
	Price                                int64
	Occupied                             int
}

// FindSegment reads the current quote and per-leg occupancy. Callers must lock
// the trip in the same transaction before reserving seats.
func FindSegment(ctx context.Context, tx pgx.Tx, tenantID, tripID, origin, destination string) (Segment, error) {
	var result Segment
	err := tx.QueryRow(ctx, `
		SELECT CASE WHEN s.from_stop=0 AND s.to_stop=jsonb_array_length(t.itinerary->'stops')+1 THEN NULL ELSE s.from_stop END,
		       CASE WHEN s.from_stop=0 AND s.to_stop=jsonb_array_length(t.itinerary->'stops')+1 THEN NULL ELSE s.to_stop END,
		       s.origin,s.destination,s.pickup,s.dropoff,s.starts_at,s.ends_at,s.price_minor,`+SegmentOccupiedSQL+`
		FROM trips t CROSS JOIN LATERAL trip_sale_segments(t) s
		WHERE t.id=$1 AND t.tenant_id=$2 AND (
			($3='' AND $4='' AND s.from_stop=0 AND s.to_stop=jsonb_array_length(t.itinerary->'stops')+1)
			OR (s.origin=$3 AND s.destination=$4)
		)`, tripID, tenantID, origin, destination).Scan(&result.From, &result.To, &result.Origin, &result.Destination, &result.Pickup, &result.Dropoff, &result.StartsAt, &result.EndsAt, &result.Price, &result.Occupied)
	if result.From == nil {
		result.Origin, result.Destination, result.Pickup, result.Dropoff = nil, nil, nil, nil
	}
	return result, err
}
