package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// This predicate is shared by discovery and checkout. No private transfers,
// drafts, disabled routes/vehicles, departed trips or blocked departures are sold.
const publicSalePredicate = `t.kind = 'regular' AND t.pricing_mode = 'per_passenger'
 AND t.status IN ('new','assigned') AND t.starts_at > now()
 AND (t.route_id IS NULL OR EXISTS (SELECT 1 FROM routes r WHERE r.id=t.route_id AND r.tenant_id=t.tenant_id AND r.is_active))
 AND (t.vehicle_id IS NULL OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id=t.vehicle_id AND v.tenant_id=t.tenant_id AND v.is_active))
 AND NOT EXISTS (SELECT 1 FROM availability_blocks a WHERE a.tenant_id=t.tenant_id
   AND (a.route_id IS NULL OR a.route_id=t.route_id) AND a.starts_at<t.ends_at AND a.ends_at>t.starts_at)`

const publicOccupiedSQL = `(SELECT COALESCE(sum(b.seats),0) FROM bookings b WHERE b.trip_id=t.id
 AND (b.status IN ('pending','cash_on_boarding','confirmed') OR (b.status='awaiting_payment' AND b.payment_hold_expires_at>now())))`

var publicUUID = regexp.MustCompile(`(?i)^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

type publicRoute struct {
	Origin      string `json:"origin"`
	Destination string `json:"destination"`
}
type publicField struct {
	Key     string   `json:"key"`
	Label   string   `json:"label"`
	Type    string   `json:"type"`
	Options []string `json:"options"`
}
type publicTrip struct {
	ID             string    `json:"id"`
	Origin         string    `json:"origin"`
	Destination    string    `json:"destination"`
	StartsAt       time.Time `json:"startsAt"`
	EndsAt         time.Time `json:"endsAt"`
	PriceMinor     int64     `json:"priceMinor"`
	Currency       string    `json:"currency"`
	AvailableSeats int       `json:"availableSeats"`
}

func (app *application) publicTenant(w http.ResponseWriter, r *http.Request) (tenant, bool) {
	w.Header().Set("Cache-Control", "no-store")
	result, ok := app.loadTenant(w, r, strings.ToLower(strings.TrimSpace(r.PathValue("slug"))))
	if !ok {
		return result, false
	}
	if !subscriptionAllowsOperations(result.SubscriptionStatus) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Онлайн-бронювання тимчасово недоступне. Зверніться до перевізника."})
		return result, false
	}
	return result, true
}

func (app *application) publicFailure(w http.ResponseWriter, err error) {
	app.log.Error("public booking operation", "error", err)
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Не вдалося завантажити дані. Спробуйте ще раз."})
}

func (app *application) publicCatalog(w http.ResponseWriter, r *http.Request) {
	company, ok := app.publicTenant(w, r)
	if !ok {
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT origin_name,destination_name FROM routes WHERE tenant_id=$1 AND is_active
 UNION SELECT t.origin_name,t.destination_name FROM trips t WHERE t.tenant_id=$1 AND `+publicSalePredicate+`
 ORDER BY 1,2`, company.ID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	routes := make([]publicRoute, 0)
	for rows.Next() {
		var route publicRoute
		if err = rows.Scan(&route.Origin, &route.Destination); err != nil {
			rows.Close()
			app.publicFailure(w, err)
			return
		}
		routes = append(routes, route)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	fields := make([]publicField, 0)
	fieldRows, err := app.db.Query(r.Context(), `SELECT field_key,label,field_type,options FROM custom_field_definitions WHERE tenant_id=$1 AND entity_type='booking' AND is_active AND is_required ORDER BY position,created_at`, company.ID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer fieldRows.Close()
	for fieldRows.Next() {
		var field publicField
		var options []byte
		if err = fieldRows.Scan(&field.Key, &field.Label, &field.Type, &options); err != nil {
			app.publicFailure(w, err)
			return
		}
		if err = json.Unmarshal(options, &field.Options); err != nil {
			app.publicFailure(w, err)
			return
		}
		fields = append(fields, field)
	}
	if err = fieldRows.Err(); err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": company.Name, "timezone": company.Timezone, "routes": routes, "fields": fields})
}

func (app *application) publicTrips(w http.ResponseWriter, r *http.Request) {
	company, ok := app.publicTenant(w, r)
	if !ok {
		return
	}
	seats, err := strconv.Atoi(r.URL.Query().Get("seats"))
	if err != nil || seats < 1 || seats > 20 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Оберіть від 1 до 20 пасажирів."})
		return
	}
	origin, destination := strings.TrimSpace(r.URL.Query().Get("origin")), strings.TrimSpace(r.URL.Query().Get("destination"))
	date, err := time.Parse("2006-01-02", r.URL.Query().Get("date"))
	location, zoneErr := time.LoadLocation(company.Timezone)
	if err != nil || zoneErr != nil || origin == "" || destination == "" || origin == destination || len([]rune(origin)) > 120 || len([]rune(destination)) > 120 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Оберіть міста та дату поїздки."})
		return
	}
	start := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, location)
	rows, err := app.db.Query(r.Context(), `SELECT t.id::text,t.origin_name,t.destination_name,t.starts_at,t.ends_at,t.price_minor,t.currency,
 t.capacity-`+publicOccupiedSQL+` FROM trips t WHERE t.tenant_id=$1 AND t.origin_name=$2 AND t.destination_name=$3
 AND t.starts_at>=$4 AND t.starts_at<$5 AND `+publicSalePredicate+`
 ORDER BY t.starts_at LIMIT 200`, company.ID, origin, destination, start, start.AddDate(0, 0, 1))
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer rows.Close()
	items := make([]publicTrip, 0)
	available := false
	for rows.Next() {
		var item publicTrip
		if err = rows.Scan(&item.ID, &item.Origin, &item.Destination, &item.StartsAt, &item.EndsAt, &item.PriceMinor, &item.Currency, &item.AvailableSeats); err != nil {
			app.publicFailure(w, err)
			return
		}
		item.AvailableSeats = max(0, item.AvailableSeats)
		available = available || item.AvailableSeats >= seats
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		app.publicFailure(w, err)
		return
	}
	rows.Close()
	before, after := make([]publicTrip, 0), make([]publicTrip, 0)
	if !available {
		// Suggest only real, still saleable departures with enough seats. The
		// preceding side never includes departed trips; each side is bounded.
		nearby, queryErr := app.db.Query(r.Context(), `WITH eligible AS (
 SELECT t.id::text,t.origin_name,t.destination_name,t.starts_at,t.ends_at,t.price_minor,t.currency,
 t.capacity-`+publicOccupiedSQL+` AS available_seats FROM trips t
 WHERE t.tenant_id=$1 AND t.origin_name=$2 AND t.destination_name=$3 AND `+publicSalePredicate+`
 AND t.capacity-`+publicOccupiedSQL+` >= $6)
 (SELECT * FROM eligible WHERE starts_at<$4 ORDER BY starts_at DESC,id LIMIT 3)
 UNION ALL
 (SELECT * FROM eligible WHERE starts_at>=$5 ORDER BY starts_at,id LIMIT 3)`, company.ID, origin, destination, start, start.AddDate(0, 0, 1), seats)
		if queryErr != nil {
			app.publicFailure(w, queryErr)
			return
		}
		defer nearby.Close()
		for nearby.Next() {
			var item publicTrip
			if err = nearby.Scan(&item.ID, &item.Origin, &item.Destination, &item.StartsAt, &item.EndsAt, &item.PriceMinor, &item.Currency, &item.AvailableSeats); err != nil {
				app.publicFailure(w, err)
				return
			}
			if item.StartsAt.Before(start) {
				before = append(before, item)
			} else {
				after = append(after, item)
			}
		}
		if err = nearby.Err(); err != nil {
			app.publicFailure(w, err)
			return
		}
		sort.Slice(before, func(i, j int) bool { return before[i].StartsAt.After(before[j].StartsAt) })
		sort.Slice(after, func(i, j int) bool { return after[i].StartsAt.Before(after[j].StartsAt) })
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "before": before, "after": after, "timezone": company.Timezone})
}

type publicBookingInput struct {
	RequestKey       string            `json:"requestKey"`
	TripID           string            `json:"tripId"`
	QuotedPriceMinor int64             `json:"quotedPriceMinor"`
	Seats            int16             `json:"seats"`
	PassengerPhone   string            `json:"passengerPhone"`
	Passengers       []publicPassenger `json:"passengers"`
	PaymentMethod    string            `json:"paymentMethod"`
	CustomData       map[string]any    `json:"customData"`
	Consent          bool              `json:"consent"`
}

type publicPassenger struct {
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	BirthDate string `json:"birthDate"`
}

var publicLatinName = regexp.MustCompile(`^[A-Za-z]+([ '-][A-Za-z]+)*$`)

func normalizePublicPassengers(input *publicBookingInput, now time.Time) (bookingPassengerDetails, error) {
	if input.PaymentMethod != "cash_on_boarding" {
		return bookingPassengerDetails{}, errors.New("Оберіть доступний спосіб оплати: готівка при посадці.")
	}
	if len(input.Passengers) != int(input.Seats) || input.Seats < 1 || input.Seats > 20 {
		return bookingPassengerDetails{}, errors.New("Вкажіть дані кожного пасажира відповідно до кількості місць.")
	}
	var contact bookingPassengerDetails
	for index := range input.Passengers {
		person := &input.Passengers[index]
		person.FirstName = strings.TrimSpace(person.FirstName)
		person.LastName = strings.TrimSpace(person.LastName)
		if len(person.FirstName) > 80 || len(person.LastName) > 80 || !publicLatinName.MatchString(person.FirstName) || !publicLatinName.MatchString(person.LastName) {
			return bookingPassengerDetails{}, fmt.Errorf("Пасажир %d: ім’я та прізвище мають бути латиницею, як у документі.", index+1)
		}
		details, err := normalizeBookingPassengerDetails(person.FirstName+" "+person.LastName, input.PassengerPhone, person.BirthDate, now)
		if err != nil {
			return bookingPassengerDetails{}, fmt.Errorf("Пасажир %d: перевірте дату народження та контактний телефон.", index+1)
		}
		person.BirthDate = details.BirthDate
		if index == 0 {
			contact = details
		}
	}
	input.PassengerPhone = contact.Phone
	return contact, nil
}

type publicConfirmation struct {
	Reference  string `json:"reference"`
	Status     string `json:"status"`
	Seats      int16  `json:"seats"`
	PriceMinor int64  `json:"priceMinor"`
	Currency   string `json:"currency"`
}

func (app *application) publicCreateBooking(w http.ResponseWriter, r *http.Request) {
	company, ok := app.publicTenant(w, r)
	if !ok {
		return
	}
	var input publicBookingInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF || !publicUUID.MatchString(input.RequestKey) || !publicUUID.MatchString(input.TripID) || input.Seats < 1 || input.Seats > 20 || !input.Consent {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Перевірте дані бронювання та підтвердіть їх обробку."})
		return
	}
	passenger, err := normalizePublicPassengers(&input, time.Now().UTC())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	input.RequestKey, input.TripID = strings.ToLower(input.RequestKey), strings.ToLower(input.TripID)
	// Atomic fixed windows, scoped by a hashed phone (never log passenger data)
	// and by tenant. Do not trust caller-supplied forwarded-IP headers.
	for _, limit := range []struct {
		key   string
		count int
	}{{fmt.Sprintf("public:phone:%s:%x", company.ID, sha256.Sum256([]byte(passenger.Phone))), 10}, {"public:tenant:" + company.ID, 200}} {
		count, err := app.redis.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n`, []string{limit.key}).Int()
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		if count > limit.count {
			w.Header().Set("Retry-After", "900")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Забагато спроб. Спробуйте пізніше."})
			return
		}
	}
	canonical, _ := json.Marshal(input)
	hash := sha256.Sum256(canonical)
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, company.ID+input.RequestKey); err != nil {
		app.publicFailure(w, err)
		return
	}
	var previousHash []byte
	var result publicConfirmation
	err = tx.QueryRow(r.Context(), `SELECT p.request_hash,b.id::text,b.status::text,b.seats,b.price_minor,b.currency FROM public_booking_requests p JOIN bookings b ON b.id=p.booking_id WHERE p.tenant_id=$1 AND p.request_key=$2`, company.ID, input.RequestKey).Scan(&previousHash, &result.Reference, &result.Status, &result.Seats, &result.PriceMinor, &result.Currency)
	if err == nil {
		if string(previousHash) != string(hash[:]) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Дані змінились. Почніть нове бронювання."})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"item": result})
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		app.publicFailure(w, err)
		return
	}
	custom, err := app.validateCustomData(r.Context(), company.ID, "booking", input.CustomData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Перевірте додаткові обов’язкові поля бронювання."})
		return
	}
	var capacity int16
	var price int64
	var currency string
	var saleable bool
	err = tx.QueryRow(r.Context(), `SELECT t.capacity,t.price_minor,t.currency,(`+publicSalePredicate+`) FROM trips t WHERE t.id=$1 AND t.tenant_id=$2 FOR UPDATE OF t`, input.TripID, company.ID).Scan(&capacity, &price, &currency, &saleable)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !saleable) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Рейс уже недоступний. Оберіть інший."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if price != input.QuotedPriceMinor {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Ціна рейсу змінилася. Оновіть пошук і перевірте нову ціну."})
		return
	}
	var occupied int
	if err = tx.QueryRow(r.Context(), `SELECT `+publicOccupiedSQL+` FROM trips t WHERE t.id=$1`, input.TripID).Scan(&occupied); err != nil {
		app.publicFailure(w, err)
		return
	}
	if occupied+int(input.Seats) > int(capacity) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Недостатньо вільних місць. Оновіть результати пошуку."})
		return
	}
	total, valid := priceForBooking(price, input.Seats, "per_passenger")
	if !valid {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Ціна рейсу потребує уточнення у перевізника."})
		return
	}
	var customerID string
	// Reusing a phone must not overwrite an existing customer's identity.
	err = tx.QueryRow(r.Context(), `INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,$2,$3) ON CONFLICT(tenant_id,phone_e164) DO UPDATE SET phone_e164=EXCLUDED.phone_e164 RETURNING id::text`, company.ID, passenger.Name, passenger.Phone).Scan(&customerID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	var duplicate bool
	if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM bookings WHERE trip_id=$1 AND customer_id=$2 AND (status IN ('pending','cash_on_boarding','confirmed') OR (status='awaiting_payment' AND payment_hold_expires_at>now())))`, input.TripID, customerID).Scan(&duplicate); err != nil {
		app.publicFailure(w, err)
		return
	}
	if duplicate {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Для цього телефону вже є бронювання на рейс. Зверніться до перевізника для змін."})
		return
	}
	// Expired bank holds no longer occupy seats or the unique active-booking key.
	if _, err = tx.Exec(r.Context(), `UPDATE bookings SET status='expired',updated_at=now() WHERE trip_id=$1 AND customer_id=$2 AND status='awaiting_payment' AND payment_hold_expires_at<=now()`, input.TripID, customerID); err != nil {
		app.publicFailure(w, err)
		return
	}
	custom["passenger_name"], custom["passenger_phone"], custom["passenger_birth_date"] = passenger.Name, passenger.Phone, passenger.BirthDate
	custom["passengers"], custom["payment_method"] = input.Passengers, input.PaymentMethod
	data, _ := json.Marshal(custom)
	err = tx.QueryRow(r.Context(), `INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency,source,custom_data) VALUES($1,$2,$3,'cash_on_boarding',$4,$5,$6,'web',$7) RETURNING id::text,status::text,seats,price_minor,currency`, company.ID, input.TripID, customerID, input.Seats, total, currency, data).Scan(&result.Reference, &result.Status, &result.Seats, &result.PriceMinor, &result.Currency)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO public_booking_requests(tenant_id,request_key,request_hash,booking_id) VALUES($1,$2,$3,$4)`, company.ID, input.RequestKey, hash[:], result.Reference); err != nil {
		app.publicFailure(w, err)
		return
	}
	actor, err := ensureSystemActor(r.Context(), tx, company.ID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,$2,'system','public_booking_created','booking',$3,'{"source":"web"}')`, company.ID, actor, result.Reference); err != nil {
		app.publicFailure(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": result})
}
