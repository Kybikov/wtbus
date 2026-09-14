package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Run only against a disposable, migrated local database. All fixture rows are
// owned by a unique tenant and removed on completion.
func TestGPSPostgresDelivery(t *testing.T) {
	url := os.Getenv("GPS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set GPS_TEST_DATABASE_URL to a migrated local test database")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var tenantID, userID, memberID, vehicleID, driverID, otherDriverID, tripID, otherTripID string
	slug := fmt.Sprintf("gps-test-%d", time.Now().UnixNano())
	row := func(query string, dest *string, args ...any) {
		t.Helper()
		if err := db.QueryRow(ctx, query, args...).Scan(dest); err != nil {
			t.Fatal(err)
		}
	}
	row(`INSERT INTO tenants(slug,name) VALUES($1,'GPS Test') RETURNING id::text`, &tenantID, slug)
	defer func() {
		if _, err := db.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenantID); err != nil {
			t.Error(err)
		}
		if userID != "" {
			if _, err := db.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID); err != nil {
				t.Error(err)
			}
		}
	}()
	row(`INSERT INTO users(email,display_name) VALUES($1,'GPS driver') RETURNING id::text`, &userID, slug+"@test.invalid")
	row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'driver') RETURNING id::text`, &memberID, tenantID, userID)
	row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'GPS driver','+380500000001') RETURNING id::text`, &driverID, tenantID, memberID)
	row(`INSERT INTO drivers(tenant_id,full_name,phone_e164) VALUES($1,'Other driver','+380500000002') RETURNING id::text`, &otherDriverID, tenantID)
	row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Shared bus','GPS-TEST','bus',8) RETURNING id::text`, &vehicleID, tenantID)
	row(`INSERT INTO trips(tenant_id,vehicle_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,$3,'individual','assigned','A','B',now()+interval '2 days',now()+interval '2 days 2 hours',8,'EUR') RETURNING id::text`, &tripID, tenantID, vehicleID, driverID)
	row(`INSERT INTO trips(tenant_id,vehicle_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,$3,'individual','in_progress','C','D',now()-interval '1 hour',now()+interval '1 hour',8,'EUR') RETURNING id::text`, &otherTripID, tenantID, vehicleID, otherDriverID)
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	actor := identity{UserID: userID, MembershipID: memberID, TenantID: tenantID, TenantSlug: slug, Role: "driver"}
	request := func(method string, body any, handler http.HandlerFunc) *httptest.ResponseRecorder {
		encoded, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/", bytes.NewReader(encoded))
		r.SetPathValue("slug", slug)
		r = r.WithContext(context.WithValue(r.Context(), identityContextKey{}, actor))
		w := httptest.NewRecorder()
		handler(w, r)
		return w
	}
	t.Run("driver receives their own trip on a shared vehicle", func(t *testing.T) {
		w := request("GET", nil, app.listFleet)
		if w.Code != 200 {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
		var result struct {
			Items []struct {
				ActiveTrip struct {
					ID string `json:"id"`
				} `json:"activeTrip"`
			} `json:"items"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Items) != 1 || result.Items[0].ActiveTrip.ID != tripID {
			t.Fatalf("wrong assigned trip: %s", w.Body)
		}
	})
	now := time.Now().UTC().Truncate(time.Millisecond)
	accuracy := 10.0
	p := gpsPointRequest{ClientPointID: "00000000-0000-4000-8000-000000000001", MembershipID: memberID, VehicleID: vehicleID, TripID: tripID, Latitude: 50.123456789, Longitude: 30.987654321, AccuracyMeters: &accuracy, RecordedAt: &now}
	t.Run("concurrent retry inserts one row and returns one ID", func(t *testing.T) {
		var workers sync.WaitGroup
		responses := make(chan *httptest.ResponseRecorder, 8)
		for i := 0; i < 8; i++ {
			workers.Add(1)
			go func() { defer workers.Done(); responses <- request("POST", p, app.recordGPSPoint) }()
		}
		workers.Wait()
		close(responses)
		var first int64
		for w := range responses {
			if w.Code != 201 {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
			var result struct {
				ID int64 `json:"id"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if first == 0 {
				first = result.ID
			}
			if first != result.ID {
				t.Fatal("duplicate IDs")
			}
		}
		var count int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM gps_points WHERE tenant_id=$1`, tenantID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("%d duplicate rows", count)
		}
	})
	t.Run("identifier cannot overwrite previous coordinates", func(t *testing.T) {
		changed := p
		changed.Latitude = 49
		if w := request("POST", changed, app.recordGPSPoint); w.Code != 409 {
			t.Fatalf("%d: %s", w.Code, w.Body)
		}
	})
	t.Run("different membership rejected", func(t *testing.T) {
		changed := p
		changed.MembershipID = "00000000-0000-4000-8000-000000000099"
		if w := request("POST", changed, app.recordGPSPoint); w.Code != 403 {
			t.Fatalf("%d: %s", w.Code, w.Body)
		}
	})
	t.Run("different driver trip rejected", func(t *testing.T) {
		changed := p
		changed.TripID = otherTripID
		if w := request("POST", changed, app.recordGPSPoint); w.Code != 400 {
			t.Fatalf("%d: %s", w.Code, w.Body)
		}
	})
	t.Run("old clients remain supported", func(t *testing.T) {
		changed := p
		changed.ClientPointID = ""
		changed.MembershipID = ""
		if w := request("POST", changed, app.recordGPSPoint); w.Code != 201 {
			t.Fatalf("%d: %s", w.Code, w.Body)
		}
	})
	t.Run("completed trip rejects new telemetry", func(t *testing.T) {
		if _, err := db.Exec(ctx, `UPDATE trips SET status='completed' WHERE id=$1`, tripID); err != nil {
			t.Fatal(err)
		}
		changed := p
		changed.ClientPointID = "00000000-0000-4000-8000-000000000002"
		if w := request("POST", changed, app.recordGPSPoint); w.Code != 400 {
			t.Fatalf("%d: %s", w.Code, w.Body)
		}
	})
}
