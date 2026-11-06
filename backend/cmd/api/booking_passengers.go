package main

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type managedPassenger struct {
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	Phone     string `json:"phone"`
	BirthDate string `json:"birthDate"`
}

func bookingManifest(custom map[string]any, seats int, name, phone string) []managedPassenger {
	people := make([]managedPassenger, 0)
	raw, _ := json.Marshal(custom["passengers"])
	_ = json.Unmarshal(raw, &people)
	var stored []map[string]any
	_ = json.Unmarshal(raw, &stored)
	if len(people) > seats {
		people = people[:seats]
	}
	for len(people) < seats {
		people = append(people, managedPassenger{})
	}
	if seats > 0 {
		if people[0].FirstName == "" && people[0].LastName == "" {
			if v, ok := custom["passenger_name"].(string); ok && v != "" {
				name = v
			}
			pieces := strings.SplitN(strings.TrimSpace(name), " ", 2)
			people[0].FirstName = pieces[0]
			if len(pieces) > 1 {
				people[0].LastName = pieces[1]
			}
		}
		hasPhone := false
		if len(stored) > 0 {
			_, hasPhone = stored[0]["phone"]
		}
		if !hasPhone {
			people[0].Phone = phone
			if v, ok := custom["passenger_phone"].(string); ok && v != "" {
				people[0].Phone = v
			}
		}
		if people[0].BirthDate == "" {
			people[0].BirthDate, _ = custom["passenger_birth_date"].(string)
		}
	}
	return people
}

func passengerField(person *managedPassenger, field, value string) error {
	value = strings.TrimSpace(value)
	switch field {
	case "firstName", "lastName":
		if len([]rune(value)) > 160 || (field == "firstName" && value == "") {
			return errors.New("Укажите имя пассажира (до 160 символов).")
		}
		if field == "firstName" {
			person.FirstName = value
		} else {
			person.LastName = value
		}
	case "phone":
		if value != "" {
			value = normalizePhone(value)
			if value == "" {
				return errors.New("Укажите телефон в международном формате.")
			}
		}
		person.Phone = value
	case "birthDate":
		if value != "" {
			parsed, err := time.Parse("2006-01-02", value)
			now := time.Now().UTC()
			today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
			if err != nil || parsed.After(today) || parsed.Before(today.AddDate(-maximumPassengerAgeYears, 0, 0)) {
				return errors.New("Проверьте дату рождения пассажира.")
			}
		}
		person.BirthDate = value
	default:
		return errors.New("Неизвестное поле пассажира.")
	}
	return nil
}

// The trip row is the shared capacity lock used by all booking entry points.
// Field patches never replace another passenger's latest changes.
func (app *application) bookingPassengers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	actor, ok := identityFromContext(r.Context())
	if !ok || actor.TenantID != company.ID || (actor.Role != "owner" && actor.Role != "admin" && actor.Role != "developer" && actor.Role != "dispatcher") {
		writeJSON(w, 403, map[string]string{"error": "Изменять пассажиров может диспетчер или руководитель компании."})
		return
	}
	id := r.PathValue("bookingID")
	if !entityRecordID.MatchString(id) {
		writeJSON(w, 400, map[string]string{"error": "Некорректный номер бронирования."})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var tripID, name, phone, status, tripStatus, pricing, currency string
	var seats, capacity int
	var price int64
	var raw []byte
	var hold *time.Time
	// Lock the trip before booking to serialize changes to different bookings too.
	err = tx.QueryRow(r.Context(), `SELECT t.id::text FROM bookings b JOIN trips t ON t.id=b.trip_id AND t.tenant_id=b.tenant_id WHERE b.id=$1 AND b.tenant_id=$2 FOR UPDATE OF t`, id, company.ID).Scan(&tripID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Бронирование не найдено."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	err = tx.QueryRow(r.Context(), `SELECT b.seats,b.price_minor,b.currency,b.status,b.payment_hold_expires_at,b.custom_data,c.full_name,c.phone_e164,t.capacity,t.status,t.pricing_mode FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id JOIN trips t ON t.id=b.trip_id AND t.tenant_id=b.tenant_id WHERE b.id=$1 AND b.tenant_id=$2 FOR UPDATE OF b`, id, company.ID).Scan(&seats, &price, &currency, &status, &hold, &raw, &name, &phone, &capacity, &tripStatus, &pricing)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	custom, err := decodeCustomData(raw)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if custom == nil {
		custom = map[string]any{}
	}
	people := bookingManifest(custom, seats, name, phone)
	originalSeats, originalPrice := seats, price
	var occupied int
	err = tx.QueryRow(r.Context(), `SELECT coalesce(sum(b.seats),0) FROM bookings b WHERE b.tenant_id=$1 AND b.trip_id=$2 AND (workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed','completed') OR (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>now()))`, company.ID, tripID).Scan(&occupied)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	var phase, tripPhase string
	if err = tx.QueryRow(r.Context(), `SELECT workflow_status_phase($1,'bookings',$2),workflow_status_phase($1,'trips',$3)`, company.ID, status, tripStatus).Scan(&phase, &tripPhase); err != nil {
		app.publicFailure(w, err)
		return
	}
	reason := ""
	if phase == "cancelled" || phase == "completed" {
		reason = "В завершённое или отменённое бронирование нельзя добавлять пассажиров."
	} else if tripPhase == "completed" || tripPhase == "cancelled" {
		reason = "Рейс уже завершён или отменён."
	} else if phase == "awaiting_payment" && (hold == nil || !hold.After(time.Now())) {
		reason = "Срок резерва истёк. Создайте новое бронирование."
	} else if seats >= 20 {
		reason = "В одном бронировании может быть не более 20 пассажиров."
	} else if occupied >= capacity {
		reason = "В рейсе нет свободных мест."
	}
	var activePayment, bankPayment bool
	if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM payments WHERE tenant_id=$1 AND booking_id=$2 AND status IN ('pending','authorized')), EXISTS(SELECT 1 FROM payments WHERE tenant_id=$1 AND booking_id=$2 AND payment_method='bank_transfer')`, company.ID, id).Scan(&activePayment, &bankPayment); err != nil {
		app.publicFailure(w, err)
		return
	}
	if reason == "" && activePayment {
		reason = "Сначала завершите или отмените ожидающую оплату бронирования."
	}
	if reason == "" && (bankPayment || custom["payment_method"] == "bank_transfer") && pricing == "per_passenger" {
		reason = "Для дополнительных мест с банковской оплатой создайте отдельное бронирование."
	}
	nextPrice := price
	if pricing == "per_passenger" && seats > 0 {
		unit := price / int64(seats)
		if price > math.MaxInt64-unit {
			reason = "Стоимость бронирования превышает допустимую сумму."
		} else {
			nextPrice = price + unit
		}
	}
	if r.Method != "GET" {
		var input struct {
			Fields        map[string]string `json:"fields"`
			Passenger     *managedPassenger `json:"passenger"`
			ExpectedSeats int               `json:"expectedSeats"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&input); err != nil {
			writeJSON(w, 400, map[string]string{"error": "Проверьте данные пассажира."})
			return
		}
		if r.Method == "POST" {
			if reason != "" {
				writeJSON(w, 409, map[string]string{"error": reason})
				return
			}
			if input.ExpectedSeats != seats {
				writeJSON(w, 409, map[string]string{"error": "Список пассажиров изменился. Обновите бронирование."})
				return
			}
			if input.Passenger == nil {
				writeJSON(w, 400, map[string]string{"error": "Укажите пассажира."})
				return
			}
			p := managedPassenger{}
			for field, value := range map[string]string{"firstName": input.Passenger.FirstName, "lastName": input.Passenger.LastName, "phone": input.Passenger.Phone, "birthDate": input.Passenger.BirthDate} {
				if err = passengerField(&p, field, value); err != nil {
					writeJSON(w, 400, map[string]string{"error": err.Error()})
					return
				}
			}
			people = append(people, p)
			seats++
			occupied++
			price = nextPrice
		} else {
			if len(input.Fields) == 0 || len(input.Fields) > 80 {
				writeJSON(w, 400, map[string]string{"error": "Укажите изменённые поля пассажира."})
				return
			}
			for key, value := range input.Fields {
				parts := strings.SplitN(key, ".", 2)
				if len(parts) != 2 {
					writeJSON(w, 400, map[string]string{"error": "Неизвестное поле пассажира."})
					return
				}
				index, e := strconv.Atoi(parts[0])
				if e != nil || index < 0 || index >= len(people) {
					writeJSON(w, 409, map[string]string{"error": "Список пассажиров изменился. Обновите бронирование."})
					return
				}
				if e = passengerField(&people[index], parts[1], value); e != nil {
					writeJSON(w, 400, map[string]string{"error": e.Error()})
					return
				}
			}
		}
		custom["passengers"] = people
		custom["passenger_name"] = strings.TrimSpace(people[0].FirstName + " " + people[0].LastName)
		custom["passenger_phone"] = people[0].Phone
		custom["passenger_birth_date"] = people[0].BirthDate
		raw, err = json.Marshal(custom)
		if err == nil {
			_, err = tx.Exec(r.Context(), `UPDATE bookings SET seats=$3,price_minor=$4,custom_data=$5,updated_at=now() WHERE id=$1 AND tenant_id=$2`, id, company.ID, seats, price, raw)
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		action := "booking.passenger_updated"
		if r.Method == "POST" {
			action = "booking.passenger_added"
		}
		details := map[string]any{"passengerCount": seats}
		if r.Method == "POST" {
			details["changes"] = []auditFieldChange{{Field: "seats", Before: originalSeats, After: seats}, {Field: "price_minor", Before: originalPrice, After: price, BeforeCurrency: currency, AfterCurrency: currency}}
		}
		activityRaw, _ := json.Marshal(details)
		_, err = tx.Exec(r.Context(), `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,NULLIF($2,'')::uuid,'human',$3,'bookings',$4,$5)`, company.ID, actor.MembershipID, action, id, activityRaw)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		if err = tx.Commit(r.Context()); err != nil {
			app.publicFailure(w, err)
			return
		}
		if capture, _ := r.Context().Value(auditContextKey{}).(*auditCapture); capture != nil {
			capture.activityRecorded = true
		}
	}
	writeJSON(w, 200, map[string]any{"items": people, "seats": seats, "availableSeats": max(0, capacity-occupied), "priceMinor": price, "nextPriceMinor": nextPrice, "currency": currency, "addDisabledReason": reason})
}
