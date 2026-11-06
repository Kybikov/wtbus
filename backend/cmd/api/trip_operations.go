package main

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const tripDelayThresholdMinutes = 15

type tripOperations struct {
	ServerNow                time.Time  `json:"serverNow"`
	BoardingStartedAt        *time.Time `json:"boardingStartedAt,omitempty"`
	DepartedAt               *time.Time `json:"departedAt,omitempty"`
	CompletedAt              *time.Time `json:"completedAt,omitempty"`
	DepartureDelayMinutes    int        `json:"departureDelayMinutes"`
	ArrivalDelayMinutes      int        `json:"arrivalDelayMinutes"`
	DepartureDelayed         bool       `json:"departureDelayed"`
	ArrivalDelayed           bool       `json:"arrivalDelayed"`
	BeforeDeparture          bool       `json:"beforeDeparture"`
	AllPassengersBoarded     bool       `json:"allPassengersBoarded"`
	ActiveSeats              int        `json:"activeSeats"`
	EarlyDepartureApproved   bool       `json:"earlyDepartureApproved"`
	EarlyDepartureApprovedAt *time.Time `json:"earlyDepartureApprovedAt,omitempty"`
	CanApproveEarlyDeparture bool       `json:"canApproveEarlyDeparture"`
}

func lateMinutes(planned, actual time.Time) int {
	if !actual.After(planned) {
		return 0
	}
	return int(actual.Sub(planned) / time.Minute)
}

func tripBoardingReadiness(ctx context.Context, tx pgx.Tx, tenant, trip string) (string, error) {
	var ready, conflict bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM trips t JOIN vehicles v ON v.id=t.vehicle_id AND v.tenant_id=t.tenant_id
	 JOIN drivers d ON d.id=t.driver_id AND d.tenant_id=t.tenant_id JOIN memberships m ON m.id=d.membership_id AND m.tenant_id=d.tenant_id
	 JOIN users u ON u.id=m.user_id
	 WHERE t.id=$1 AND t.tenant_id=$2 AND v.is_active AND d.is_active AND m.is_active AND m.role::text IN ('driver','developer') AND NOT u.is_system)`, trip, tenant).Scan(&ready)
	if err != nil {
		return "", err
	}
	if !ready {
		return "Для посадки и выезда назначьте активный автомобиль и водителя с доступом в систему.", nil
	}
	var capacity, occupied int
	err = tx.QueryRow(ctx, `SELECT v.capacity,COALESCE((SELECT sum(b.seats) FROM bookings b WHERE b.tenant_id=t.tenant_id AND b.trip_id=t.id AND
	 (workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed','completed') OR
	 (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>now()))),0)
	 FROM trips t JOIN vehicles v ON v.id=t.vehicle_id AND v.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND t.id=$2`, tenant, trip).Scan(&capacity, &occupied)
	if err != nil {
		return "", err
	}
	if occupied > capacity {
		return fmt.Sprintf("Забронировано мест: %d, вместимость автомобиля: %d. Назначьте автомобиль, в котором хватит мест всем пассажирам.", occupied, capacity), nil
	}
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM trips active JOIN trips selected ON selected.id=$2 AND selected.tenant_id=active.tenant_id
	 WHERE active.tenant_id=$1 AND active.id<>selected.id AND (workflow_status_phase(active.tenant_id,'trips',active.status)='in_progress' OR active.status='boarding')
	 AND (active.driver_id=selected.driver_id OR active.vehicle_id=selected.vehicle_id))`, tenant, trip).Scan(&conflict)
	if err != nil {
		return "", err
	}
	if conflict {
		return "Водитель или автомобиль занят посадкой или выполнением другого рейса. Сначала завершите его.", nil
	}
	return "", nil
}

// Used by the status command inside its locked transaction and by read models.
// No timer writes operational stages or invents actual event timestamps.
func readTripOperations(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, tenant string, ids []string) (map[string]*tripOperations, error) {
	result := map[string]*tripOperations{}
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := db.Query(ctx, `SELECT t.id::text,t.starts_at,t.ends_at,workflow_status_phase(t.tenant_id,'trips',t.status),
 COALESCE((SELECT is_terminal FROM workflow_statuses s WHERE s.tenant_id=t.tenant_id AND s.entity_type='trips' AND s.key=t.status),true),
 t.actual_boarding_started_at,t.actual_started_at,t.actual_completed_at,t.early_departure_approved_at,
 t.early_departure_approved_by IS NOT NULL AND t.early_departure_approval_key=trip_departure_manifest_key(t.tenant_id,t.id),
 COALESCE(sum(b.seats),0),
 COALESCE(bool_and(NOT EXISTS(SELECT 1 FROM generate_series(0,b.seats-1) i WHERE COALESCE(c.boarding->>i::text,'waiting')<>'boarded')) FILTER(WHERE b.id IS NOT NULL),false),
 now()
 FROM trips t LEFT JOIN bookings b ON b.tenant_id=t.tenant_id AND b.trip_id=t.id AND
 (workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed') OR
 (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>now()))
 LEFT JOIN driver_booking_checkins c ON c.tenant_id=b.tenant_id AND c.booking_id=b.id
 WHERE t.tenant_id=$1 AND t.id=ANY($2::uuid[])
 GROUP BY t.id`, tenant, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, phase string
		var starts, ends time.Time
		var terminal bool
		op := &tripOperations{}
		var approved *bool
		if err = rows.Scan(&id, &starts, &ends, &phase, &terminal, &op.BoardingStartedAt, &op.DepartedAt, &op.CompletedAt, &op.EarlyDepartureApprovedAt, &approved, &op.ActiveSeats, &op.AllPassengersBoarded, &op.ServerNow); err != nil {
			return nil, err
		}
		op.AllPassengersBoarded = op.ActiveSeats > 0 && op.AllPassengersBoarded
		op.BeforeDeparture = !terminal && op.ServerNow.Before(starts) && op.DepartedAt == nil && (phase == "planned" || phase == "assigned")
		op.EarlyDepartureApproved = approved != nil && *approved && op.EarlyDepartureApprovedAt != nil && op.BeforeDeparture
		op.CanApproveEarlyDeparture = op.BeforeDeparture && !op.EarlyDepartureApproved
		if op.DepartedAt != nil {
			op.DepartureDelayMinutes = lateMinutes(starts, *op.DepartedAt)
		} else if !terminal && (phase == "planned" || phase == "assigned") {
			op.DepartureDelayMinutes = lateMinutes(starts, op.ServerNow)
		}
		if op.CompletedAt != nil {
			op.ArrivalDelayMinutes = lateMinutes(ends, *op.CompletedAt)
		} else if phase == "in_progress" {
			op.ArrivalDelayMinutes = lateMinutes(ends, op.ServerNow)
		}
		op.DepartureDelayed = op.DepartureDelayMinutes >= tripDelayThresholdMinutes
		op.ArrivalDelayed = op.ArrivalDelayMinutes >= tripDelayThresholdMinutes
		result[id] = op
	}
	return result, rows.Err()
}
