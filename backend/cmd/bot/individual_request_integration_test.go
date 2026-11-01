package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestIndividualTransferRequestPostgres(t *testing.T) {
	dsn := os.Getenv("PUBLIC_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set disposable PUBLIC_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := fmt.Sprintf("bot_request_test_%d", time.Now().UnixNano())
	if _, err = root.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = root.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE") })
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil || len(files) == 0 {
		t.Fatal("test migrations not found", err)
	}
	for _, file := range files {
		sql, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migration %s: %v", file, err)
		}
	}
	var tenant string
	if err = db.QueryRow(ctx, `INSERT INTO tenants(slug,name,timezone) VALUES('bot-request-qa','Bot Request QA','Europe/Kyiv') RETURNING id::text`).Scan(&tenant); err != nil {
		t.Fatal(err)
	}
	zone, err := time.LoadLocation("Europe/Kyiv")
	if err != nil {
		t.Fatal(err)
	}
	bot := &app{db: db, tenantID: tenant, timezone: zone}
	// The text handler stores the parser's ISO output, not the user's DD.MM.YYYY input.
	birthDate, ok := parsePassengerBirthDate("01.01.1990", zone, time.Now())
	if !ok {
		t.Fatal("valid user birth date rejected")
	}
	state := bookingState{Origin: "Киев", Destination: "Львов", Date: time.Now().In(zone).AddDate(0, 0, 2).Format("2006-01-02"), RequestedTime: "02:00", PassengerName: "Passenger QA", PassengerPhone: "+380500003099", PassengerBirthDate: birthDate, PendingSeats: 3, RequestComment: "Pickup QA"}
	departure, err := bot.createIndividualTransferRequest(ctx, 123456789, state)
	if err != nil {
		t.Fatal(err)
	}
	var status, name, phone, comment, number, savedBirthDate string
	var seats int
	var telegram int64
	var saved time.Time
	err = db.QueryRow(ctx, `SELECT r.status,c.full_name,c.phone_e164,r.comment,r.seats,r.telegram_id,r.requested_departure_at,n.number,r.passenger_birth_date::text FROM individual_transfer_requests r JOIN customers c ON c.id=r.customer_id AND c.tenant_id=r.tenant_id JOIN record_numbers n ON n.tenant_id=r.tenant_id AND n.entity='requests' AND n.record_id=r.id WHERE r.tenant_id=$1`, tenant).Scan(&status, &name, &phone, &comment, &seats, &telegram, &saved, &number, &savedBirthDate)
	if err != nil {
		t.Fatal(err)
	}
	if status != "new" || name != state.PassengerName || phone != state.PassengerPhone || comment != state.RequestComment || seats != 3 || telegram != 123456789 || !saved.Equal(departure) || saved.In(zone).Hour() != 2 || savedBirthDate != "1990-01-01" || strings.TrimSpace(number) == "" {
		t.Fatalf("request lost CRM fields: %s %s %s %s %d %d %s %s", status, name, phone, comment, seats, telegram, saved, number)
	}
	for _, change := range []func(*bookingState){func(s *bookingState) { s.PendingSeats = 0 }, func(s *bookingState) { s.PassengerPhone = "bad" }, func(s *bookingState) { s.Date = "2000-01-01" }, func(s *bookingState) { s.PassengerBirthDate = "2990-01-01" }} {
		invalid := state
		change(&invalid)
		if _, err = bot.createIndividualTransferRequest(ctx, 123456789, invalid); err == nil {
			t.Fatal("invalid request accepted")
		}
	}
	var count int
	if err = db.QueryRow(ctx, `SELECT count(*) FROM individual_transfer_requests WHERE tenant_id=$1`, tenant).Scan(&count); err != nil || count != 1 {
		t.Fatalf("invalid requests changed collection: %d %v", count, err)
	}
}
