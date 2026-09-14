package main

import (
	"context"
	"io"
	"log/slog"
	"math"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGPSPointValidation(t *testing.T) {
	now := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	accuracy := 12.0
	valid := gpsPointRequest{VehicleID: "00000000-0000-0000-0000-000000000001", TripID: "00000000-0000-0000-0000-000000000002", MembershipID: "00000000-0000-0000-0000-000000000003", ClientPointID: "00000000-0000-0000-0000-000000000004", Latitude: 50, Longitude: 30, AccuracyMeters: &accuracy, RecordedAt: &now}
	tests := []struct {
		name   string
		change func(*gpsPointRequest)
		ok     bool
	}{
		{"valid", func(p *gpsPointRequest) {}, true},
		{"offline point", func(p *gpsPointRequest) { at := now.Add(-24 * time.Hour); p.RecordedAt = &at }, true},
		{"expired", func(p *gpsPointRequest) { at := now.Add(-49 * time.Hour); p.RecordedAt = &at }, false},
		{"future", func(p *gpsPointRequest) { at := now.Add(6 * time.Minute); p.RecordedAt = &at }, false},
		{"nan latitude", func(p *gpsPointRequest) { p.Latitude = math.NaN() }, false},
		{"infinite longitude", func(p *gpsPointRequest) { p.Longitude = math.Inf(1) }, false},
		{"latitude out of range", func(p *gpsPointRequest) { p.Latitude = 91 }, false},
		{"negative accuracy", func(p *gpsPointRequest) { a := -1.0; p.AccuracyMeters = &a }, false},
		{"invalid point id", func(p *gpsPointRequest) { p.ClientPointID = "bad" }, false},
		{"missing replay time", func(p *gpsPointRequest) { p.RecordedAt = nil }, false},
		{"missing replay membership", func(p *gpsPointRequest) { p.MembershipID = "" }, false},
		{"legacy client", func(p *gpsPointRequest) { p.ClientPointID = ""; p.MembershipID = ""; p.RecordedAt = nil }, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			p := valid
			test.change(&p)
			if got := validGPSPoint(p, now); got != test.ok {
				t.Fatalf("validGPSPoint = %v, want %v", got, test.ok)
			}
		})
	}
}

func TestGPSDatabaseFailureIsRetryable(t *testing.T) {
	ctx := context.Background()
	db, err := pgxpool.New(ctx, "postgres://unused:unused@localhost:1/unused")
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"vehicleId":"00000000-0000-0000-0000-000000000001","latitude":50,"longitude":30}`))
	r = r.WithContext(context.WithValue(ctx, tenantContextKey{}, tenant{ID: "00000000-0000-0000-0000-000000000002"}))
	w := httptest.NewRecorder()
	app.recordGPSPoint(w, r)
	if w.Code != 503 {
		t.Fatalf("database failure must retain the offline point: status %d", w.Code)
	}
}
