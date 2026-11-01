package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

type driverCheckinRequest struct {
	TripID         string `json:"tripId"`
	BookingID      string `json:"bookingId"`
	PassengerIndex *int   `json:"passengerIndex,omitempty"`
	Boarding       string `json:"boarding,omitempty"`
	// Cumulative received amount, not a delta: repeated submissions cannot double-charge.
	CashMinor *int64 `json:"cashMinor,omitempty"`
}

func (app *application) driverCheckin(w http.ResponseWriter, r *http.Request) {
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "Войдите в аккаунт."})
		return
	}
	var input driverCheckinRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || !publicUUID.MatchString(input.TripID) || !publicUUID.MatchString(input.BookingID) || (input.CashMinor == nil) == (input.PassengerIndex == nil) || (input.PassengerIndex != nil && input.Boarding != "waiting" && input.Boarding != "boarded" && input.Boarding != "absent") {
		writeJSON(w, 400, map[string]string{"error": "Выберите пассажира и отметку посадки или укажите полученную сумму."})
		return
	}
	driver, err := app.activeDriverID(r.Context(), company.ID, actor.MembershipID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 403, map[string]string{"error": "Профиль водителя не подключён."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// Match cash handover lock order; serialize receipt increments against completion.
	var locked string
	if err = tx.QueryRow(r.Context(), `SELECT id::text FROM drivers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, company.ID, driver).Scan(&locked); err != nil {
		app.publicFailure(w, err)
		return
	}
	var phase string
	err = tx.QueryRow(r.Context(), `SELECT workflow_status_phase(tenant_id,'trips',status) FROM trips WHERE tenant_id=$1 AND id=$2 AND driver_id=$3 FOR UPDATE`, company.ID, input.TripID, driver).Scan(&phase)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Рейс вам не назначен."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if phase != "assigned" && phase != "in_progress" {
		writeJSON(w, 409, map[string]string{"error": "Посадка и оплата доступны только в назначенном или текущем рейсе."})
		return
	}
	var seats int
	var price int64
	var currency, bookingPhase string
	var bank bool
	err = tx.QueryRow(r.Context(), `SELECT seats,price_minor,currency,workflow_status_phase(tenant_id,'bookings',status),EXISTS(SELECT 1 FROM payments p WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.payment_method='bank_transfer') FROM bookings b WHERE tenant_id=$1 AND id=$2 AND trip_id=$3 FOR UPDATE`, company.ID, input.BookingID, input.TripID).Scan(&seats, &price, &currency, &bookingPhase, &bank)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Бронь не найдена в этом рейсе."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if bookingPhase != "confirmed" {
		writeJSON(w, 409, map[string]string{"error": "Сначала подтвердите бронь или дождитесь банковской оплаты."})
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO driver_booking_checkins(tenant_id,booking_id) VALUES($1,$2) ON CONFLICT(booking_id) DO NOTHING`, company.ID, input.BookingID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	var raw []byte
	var received int64
	if err = tx.QueryRow(r.Context(), `SELECT boarding,cash_minor FROM driver_booking_checkins WHERE tenant_id=$1 AND booking_id=$2 FOR UPDATE`, company.ID, input.BookingID).Scan(&raw, &received); err != nil {
		app.publicFailure(w, err)
		return
	}
	boarding := map[string]string{}
	if err = json.Unmarshal(raw, &boarding); err != nil {
		app.publicFailure(w, err)
		return
	}
	action := "driver.passenger_boarding"
	if input.PassengerIndex != nil {
		if *input.PassengerIndex < 0 || *input.PassengerIndex >= seats {
			writeJSON(w, 400, map[string]string{"error": "Пассажир не найден в брони."})
			return
		}
		boarding[strconv.Itoa(*input.PassengerIndex)] = input.Boarding
		absent := 0
		for i := 0; i < seats; i++ {
			if boarding[strconv.Itoa(i)] == "absent" {
				absent++
			}
		}
		if absent == seats && received > 0 {
			writeJSON(w, 409, map[string]string{"error": "По брони уже получены деньги. Для отмены обратитесь к диспетчеру."})
			return
		}
	} else {
		target := *input.CashMinor
		if bank {
			writeJSON(w, 409, map[string]string{"error": "По этой брони выбран банковский перевод. Повторно наличные не принимайте."})
			return
		}
		if target <= 0 || target > price || target < received {
			writeJSON(w, 409, map[string]string{"error": "Укажите общую полученную сумму: не меньше уже принятой и не больше стоимости брони."})
			return
		}
		boarded := false
		for _, status := range boarding {
			if status == "boarded" {
				boarded = true
			}
		}
		if !boarded {
			writeJSON(w, 409, map[string]string{"error": "Сначала отметьте пришедшего пассажира."})
			return
		}
		if target > received {
			var ledger string
			err = tx.QueryRow(r.Context(), `INSERT INTO driver_cash_ledger(tenant_id,driver_id,trip_id,amount_minor,currency,kind,actor_membership_id,source_key) VALUES($1,$2,$3,$4,$5,'cash_collected',NULLIF($6,'')::uuid,$7)
 RETURNING id::text`, company.ID, driver, input.TripID, target-received, currency, actor.MembershipID, "booking-cash:"+input.BookingID+":"+strconv.FormatInt(target, 10)).Scan(&ledger)
			if err != nil {
				app.publicFailure(w, err)
				return
			}
			if err = writeFinanceActivity(r.Context(), tx, actor, "finance.driver_cash_received", input.BookingID, map[string]any{"tripId": input.TripID, "driverId": driver, "amountMinor": target - received, "currency": currency}); err != nil {
				app.publicFailure(w, err)
				return
			}
		}
		received = target
		action = "driver.booking_cash"
	}
	raw, _ = json.Marshal(boarding)
	_, err = tx.Exec(r.Context(), `UPDATE driver_booking_checkins SET boarding=$3,cash_minor=$4,actor_membership_id=NULLIF($5,'')::uuid,updated_at=now() WHERE tenant_id=$1 AND booking_id=$2`, company.ID, input.BookingID, raw, received, actor.MembershipID)
	if err == nil && input.PassengerIndex != nil {
		details, _ := json.Marshal(map[string]any{"tripId": input.TripID, "passengerIndex": *input.PassengerIndex, "boarding": input.Boarding})
		_, err = tx.Exec(r.Context(), `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,NULLIF($2,'')::uuid,'human',$3,'bookings',$4,$5)`, company.ID, actor.MembershipID, action, input.BookingID, details)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 200, map[string]any{"boarding": boarding, "cashMinor": received})
}
