package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Run only against a disposable, migrated local database. The fixture does not
// create tenant_payment_configs: cash collection must work without an IBAN.
func TestCashOnBoardingWithoutPaymentConfiguration(t *testing.T) {
	url := os.Getenv("CASH_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set CASH_TEST_DATABASE_URL to a migrated local test database")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	slug := fmt.Sprintf("cash-test-%d", time.Now().UnixNano())
	var tenantID, userID, memberID, driverID, vehicleID, tripID, customerID string
	row := func(query string, destination *string, arguments ...any) {
		t.Helper()
		if err := db.QueryRow(ctx, query, arguments...).Scan(destination); err != nil {
			t.Fatal(err)
		}
	}
	row(`INSERT INTO tenants(slug,name) VALUES($1,'Cash Test') RETURNING id::text`, &tenantID, slug)
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
	row(`INSERT INTO users(email,display_name) VALUES($1,'Cash driver') RETURNING id::text`, &userID, slug+"@test.invalid")
	row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'driver') RETURNING id::text`, &memberID, tenantID, userID)
	row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'Cash driver','+380500000011') RETURNING id::text`, &driverID, tenantID, memberID)
	row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Cash bus','CASH-TEST','bus',8) RETURNING id::text`, &vehicleID, tenantID)
	row(`INSERT INTO trips(tenant_id,vehicle_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency) VALUES($1,$2,$3,'individual','assigned','A','B',now()-interval '10 minutes',now()+interval '2 hours',8,1250,'EUR') RETURNING id::text`, &tripID, tenantID, vehicleID, driverID)
	row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Cash passenger','+380500000012') RETURNING id::text`, &customerID, tenantID)

	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	request := func(method string, body any, actor identity, handler http.HandlerFunc) *httptest.ResponseRecorder {
		encoded, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/", bytes.NewReader(encoded))
		r.SetPathValue("slug", slug)
		r = r.WithContext(context.WithValue(r.Context(), identityContextKey{}, actor))
		w := httptest.NewRecorder()
		handler(w, r)
		return w
	}

	manager := identity{TenantID: tenantID, TenantSlug: slug, Role: "owner"}
	created := request("POST", createBookingRequest{
		TripID: tripID, CustomerID: customerID, Seats: 2,
		PassengerName: "Cash passenger", PassengerPhone: "+380500000012", PassengerBirthDate: "1990-01-01",
	}, manager, app.createBooking)
	if created.Code != http.StatusCreated {
		t.Fatalf("create cash booking status %d: %s", created.Code, created.Body)
	}
	var bookingResult struct {
		Item struct {
			ID         string `json:"id"`
			Status     string `json:"status"`
			PriceMinor int64  `json:"priceMinor"`
		} `json:"item"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &bookingResult); err != nil {
		t.Fatal(err)
	}
	if bookingResult.Item.Status != "cash_on_boarding" || bookingResult.Item.PriceMinor != 2500 {
		t.Fatalf("unexpected cash booking: %s", created.Body)
	}
	var paymentConfigurations int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM tenant_payment_configs WHERE tenant_id=$1`, tenantID).Scan(&paymentConfigurations); err != nil {
		t.Fatal(err)
	}
	if paymentConfigurations != 0 {
		t.Fatal("test fixture unexpectedly has a payment configuration")
	}
	people := `[ {"firstName":"Ivan","lastName":"Petrenko","birthDate":"1990-01-01"}, {"firstName":"Anna","lastName":"Petrenko","birthDate":"1992-02-29"} ]`
	if _, err := db.Exec(ctx, `UPDATE bookings SET custom_data=custom_data||jsonb_build_object('passengers',$2::jsonb) WHERE id=$1`, bookingResult.Item.ID, people); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{bookingResult.Item.ID, "Anna Petrenko", "Cash passenger", "+380500000012"} {
		r := httptest.NewRequest("GET", "/?q="+neturl.QueryEscape(query), nil)
		r.SetPathValue("slug", slug)
		w := httptest.NewRecorder()
		app.listBookings(w, r)
		if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(bookingResult.Item.ID)) {
			t.Fatalf("booking search %q: %d %s", query, w.Code, w.Body)
		}
	}
	if _, err := db.Exec(ctx, `UPDATE memberships SET role='developer' WHERE id=$1`, memberID); err != nil {
		t.Fatal(err)
	}
	// The collection footer needs the full matching count, independent of LIMIT.
	if _, err := db.Exec(ctx, `INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency,source) SELECT $1,$2,$3,'cancelled',2,2500,'EUR','dispatcher' FROM generate_series(1,2)`, tenantID, tripID, customerID); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		params string
		total  int
	}{{"limit=1", 3}, {"limit=1&status=cancelled", 2}, {"limit=1&status=cash_on_boarding", 1}, {"limit=1&q=missing-passenger", 0}, {"limit=1&date=2030-01-01", 0}} {
		r := httptest.NewRequest("GET", "/?"+check.params, nil)
		r.SetPathValue("slug", slug)
		w := httptest.NewRecorder()
		app.listBookings(w, r)
		var payload struct {
			Total int
			Items []bookingListItem
		}
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || payload.Total != check.total || len(payload.Items) > 1 {
			t.Fatalf("wrong booking metric total for %s: %d %s", check.params, w.Code, w.Body)
		}
	}
	app.bootstrapEmail, app.bootstrapPassword, app.bootstrapTenant = slug+"@test.invalid", "disposable-owner-password", slug
	if err := app.ensureBootstrapOwner(ctx); err != nil {
		t.Fatal(err)
	}
	var bootstrapRole string
	if err := db.QueryRow(ctx, `SELECT role::text FROM memberships WHERE id=$1`, memberID).Scan(&bootstrapRole); err != nil || bootstrapRole != "developer" {
		t.Fatalf("bootstrap overwrote developer role: %s %v", bootstrapRole, err)
	}
	token := "disposable-developer-session-" + slug
	hash := sha256.Sum256([]byte(token))
	if _, err := db.Exec(ctx, `INSERT INTO user_sessions(user_id,membership_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')`, userID, memberID, hash[:]); err != nil {
		t.Fatal(err)
	}
	protected := app.requireRoles("owner")(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"role": "developer"})
	})
	for _, company := range []string{slug, "other-company"} {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("Authorization", "Bearer "+token)
		r.SetPathValue("slug", company)
		w := httptest.NewRecorder()
		protected(w, r)
		want := 200
		if company != slug {
			want = 403
		}
		if w.Code != want {
			t.Fatalf("developer access %s: %d %s", company, w.Code, w.Body)
		}
	}
	manifest := func(trip string, member string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/?tripId="+trip, nil)
		r.SetPathValue("slug", slug)
		r = r.WithContext(context.WithValue(r.Context(), identityContextKey{}, identity{TenantID: tenantID, MembershipID: member, Role: "driver"}))
		w := httptest.NewRecorder()
		app.driverPassengers(w, r)
		return w
	}
	list := manifest(tripID, memberID)
	if list.Code != 200 || !bytes.Contains(list.Body.Bytes(), []byte(`"firstName":"Anna"`)) || !bytes.Contains(list.Body.Bytes(), []byte(bookingResult.Item.ID)) {
		t.Fatalf("assigned manifest: %d %s", list.Code, list.Body)
	}
	if other := manifest("00000000-0000-4000-8000-000000000099", memberID); other.Code != 403 {
		t.Fatalf("other trip leaked: %d %s", other.Code, other.Body)
	}
	if other := manifest(tripID, "00000000-0000-4000-8000-000000000099"); other.Code != 403 {
		t.Fatalf("other member leaked: %d %s", other.Code, other.Body)
	}
	if _, err := db.Exec(ctx, `UPDATE trips SET status='in_progress' WHERE id=$1`, tripID); err != nil {
		t.Fatal(err)
	}

	driver := identity{UserID: userID, MembershipID: memberID, TenantID: tenantID, TenantSlug: slug, Role: "driver"}
	summary := request("GET", nil, driver, app.driverCashSummary)
	if summary.Code != http.StatusOK || !bytes.Contains(summary.Body.Bytes(), []byte(`"amountMinor":2500`)) {
		t.Fatalf("cash summary status %d: %s", summary.Code, summary.Body)
	}
	received := request("POST", confirmDriverCashReceivedRequest{TripID: tripID}, driver, app.confirmDriverCashReceived)
	if received.Code != http.StatusOK {
		t.Fatalf("confirm cash status %d: %s", received.Code, received.Body)
	}
	var recorded int64
	if err := db.QueryRow(ctx, `SELECT amount_minor FROM driver_cash_ledger WHERE tenant_id=$1 AND trip_id=$2 AND kind='cash_collected'`, tenantID, tripID).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	if recorded != 2500 {
		t.Fatalf("recorded cash = %d, want 2500", recorded)
	}
}
