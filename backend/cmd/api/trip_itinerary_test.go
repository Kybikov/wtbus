package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vivat-bus/tms/internal/bookingrules"
)

func TestTripSegmentsUsePeakLoadAndSnapshotFares(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(query string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, query, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	tenantID := row(`INSERT INTO tenants(slug,name,timezone) VALUES('stop-test','Stops','UTC') RETURNING id::text`)
	routeID := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency,is_active)
	VALUES($1,'Kyiv to Lviv','Kyiv','Lviv','UAH',true) RETURNING id::text`, tenantID)
	change := func(entity, id string, itinerary tripItinerary) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(itinerary)
		r := httptest.NewRequest("PATCH", "/", bytes.NewReader(body))
		r.SetPathValue("slug", "stop-test")
		r.SetPathValue(entity+"ID", id)
		w := httptest.NewRecorder()
		app.tripItinerary(w, r)
		return w
	}
	config := tripItinerary{
		Stops: []itineraryStop{{City: "Zhytomyr", Address: "Bus station", Minutes: 120}},
		Fares: []itineraryFare{{From: 0, To: 1, Price: 30000}, {From: 1, To: 2, Price: 45000}},
	}
	if res := change("route", routeID, config); res.Code != 200 {
		t.Fatalf("route PATCH: %d %s", res.Code, res.Body)
	}
	start := time.Now().UTC().Truncate(24 * time.Hour).Add(60 * time.Hour)
	tripID := row(`INSERT INTO trips(tenant_id,route_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency,pricing_mode)
	VALUES($1,$2,'regular','assigned','Kyiv','Lviv',$3,$4,2,70000,'UAH','per_passenger') RETURNING id::text`, tenantID, routeID, start, start.Add(6*time.Hour))
	config.Fares[1].Price = 50000
	if res := change("route", routeID, config); res.Code != 200 {
		t.Fatalf("change route fare: %d %s", res.Code, res.Body)
	}

	query := func(origin, destination string) publicTrip {
		t.Helper()
		request := httptest.NewRequest("GET", "/trips?origin="+origin+"&destination="+destination+"&seats=1&date="+start.Format("2006-01-02"), nil)
		request.SetPathValue("slug", "stop-test")
		response := httptest.NewRecorder()
		app.publicTrips(response, request)
		var data struct{ Items []publicTrip }
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &data) != nil || len(data.Items) != 1 {
			t.Fatalf("%s to %s: %d %s", origin, destination, response.Code, response.Body)
		}
		return data.Items[0]
	}
	if got := query("Zhytomyr", "Lviv"); got.PriceMinor != 45000 || !got.StartsAt.Equal(start.Add(2*time.Hour)) || got.Pickup != "Bus station" || !got.Partial {
		t.Fatalf("trip should retain the copied fare and stop: %+v", got)
	}

	book := func(phone, origin, destination string, seats int) int64 {
		t.Helper()
		customerID := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Test Passenger',$2) RETURNING id::text`, tenantID, phone)
		body, _ := json.Marshal(createBookingRequest{TripID: tripID, CustomerID: customerID, PassengerName: "Test Passenger", PassengerPhone: phone, PassengerBirthDate: "1990-01-01", Seats: int16(seats), Origin: origin, Destination: destination})
		r := httptest.NewRequest("POST", "/bookings", bytes.NewReader(body))
		r.SetPathValue("slug", "stop-test")
		w := httptest.NewRecorder()
		app.createBooking(w, r)
		var data struct{ Item bookingResponse }
		if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &data) != nil {
			t.Fatalf("book %s to %s: %d %s", origin, destination, w.Code, w.Body)
		}
		return data.Item.PriceMinor
	}
	if got := book("+380500001501", "Kyiv", "Zhytomyr", 2); got != 60000 {
		t.Fatalf("first leg charged %d", got)
	}
	if got := query("Zhytomyr", "Lviv"); got.AvailableSeats != 2 {
		t.Fatalf("following leg availability %d", got.AvailableSeats)
	}
	if got := book("+380500001502", "Zhytomyr", "Lviv", 1); got != 45000 {
		t.Fatalf("second leg charged %d", got)
	}
	if got := query("Kyiv", "Lviv"); got.AvailableSeats != 0 || got.PriceMinor != 70000 || got.Partial {
		t.Fatalf("full-trip quote %+v", got)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	segment, err := bookingrules.FindSegment(ctx, tx, tenantID, tripID, "Zhytomyr", "Lviv")
	if err != nil || segment.Occupied != 1 || segment.From == nil || *segment.From != 1 || segment.To == nil || *segment.To != 2 {
		t.Fatalf("segment occupancy %+v: %v", segment, err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	config.Stops[0].Address = "Another station"
	if res := change("trip", tripID, config); res.Code != 409 {
		t.Fatalf("used stop edit: %d %s", res.Code, res.Body)
	}
	config.Stops[0].Address = "Bus station"
	if res := change("trip", tripID, config); res.Code != 200 {
		t.Fatalf("future fare edit: %d %s", res.Code, res.Body)
	}
	if got := query("Zhytomyr", "Lviv"); got.PriceMinor != 50000 || got.AvailableSeats != 1 {
		t.Fatalf("new fare quote %+v", got)
	}
}

func TestTripItineraryRejectsInvalidTimingsAndFares(t *testing.T) {
	i := tripItinerary{Stops: []itineraryStop{{City: "Middle", Address: "Station", Minutes: 45}},
		Fares: []itineraryFare{{From: 0, To: 2, Price: 100}}}
	if i.validate("First", "Last", 90) == nil {
		t.Fatal("whole-trip price belongs to the base fare")
	}
	i.Fares[0].To = 1
	if err := i.validate("First", "Last", 90); err != nil {
		t.Fatal(err)
	}
	if i.validate("First", "Last", 45) == nil {
		t.Fatal("a stop cannot be after arrival")
	}
	i.Stops[0].City = "first"
	if i.validate("First", "Last", 90) == nil {
		t.Fatal("duplicate cities are ambiguous for booking")
	}
}
