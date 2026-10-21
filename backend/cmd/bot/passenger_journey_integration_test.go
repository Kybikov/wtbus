package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/vivat-bus/tms/internal/telegramoutbox"
)

func TestTelegramPassengerJourneyPostgres(t *testing.T) {
	dsn := os.Getenv("AUTOMATION_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set AUTOMATION_TEST_DATABASE_URL to a disposable migrated database")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	row := func(q string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, q, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	suffix := time.Now().UnixNano()
	tenant := row(`INSERT INTO tenants(slug,name,timezone,base_currency,subscription_status) VALUES($1,'Telegram QA','UTC','UAH','active') RETURNING id::text`, fmt.Sprintf("tg-journey-%d", suffix))
	system := row(`INSERT INTO users(email,display_name,is_system) VALUES($1,'Automat QA',true) RETURNING id::text`, fmt.Sprintf("tg-journey-%d@test.invalid", suffix))
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin') RETURNING id::text`, tenant, system)
	defer func() {
		db.Exec(ctx, `DELETE FROM payments WHERE tenant_id=$1`, tenant)
		db.Exec(ctx, `DELETE FROM bookings WHERE tenant_id=$1`, tenant)
		db.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
		db.Exec(ctx, `DELETE FROM users WHERE id=$1`, system)
	}()
	route := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'QA A B','Kyiv','Lviv','UAH') RETURNING id::text`, tenant)
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'QA Bus','TG-QA','bus',8) RETURNING id::text`, tenant)
	trip := row(`INSERT INTO trips(tenant_id,route_id,vehicle_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency) VALUES($1,$2,$3,'regular','assigned','Kyiv','Lviv',now()+interval '1 day',now()+interval '1 day 8 hours',8,125000,'UAH') RETURNING id::text`, tenant, route, vehicle)
	exec(`INSERT INTO tenant_payment_configs(tenant_id,provider,merchant_name,iban,edrpou,bank_name,is_enabled) VALUES($1,'internal','ФОП QA','UA599999990000000000000000001','0000000000','QA bank',true)`, tenant)
	var mu sync.Mutex
	var messages []string
	photos := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
		if method == "getMe" {
			io.WriteString(w, `{"ok":true,"result":{"id":123,"is_bot":true,"first_name":"QA","username":"vivat_test_bot"}}`)
			return
		}
		if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
			if err := r.ParseMultipartForm(2 << 20); err != nil {
				t.Error(err)
			}
			if r.MultipartForm != nil {
				defer r.MultipartForm.RemoveAll()
			}
		} else {
			r.ParseForm()
		}
		mu.Lock()
		defer mu.Unlock()
		if method == "sendPhoto" {
			file, _, err := r.FormFile("photo")
			if err != nil {
				t.Error(err)
			} else {
				defer file.Close()
				data, _ := io.ReadAll(file)
				if !bytes.HasPrefix(data, []byte{137, 80, 78, 71}) {
					t.Error("bot sent invalid QR image")
				}
			}
			photos++
		}
		messages = append(messages, r.FormValue("text")+r.FormValue("caption"))
		if method == "answerCallbackQuery" {
			io.WriteString(w, `{"ok":true,"result":true}`)
			return
		}
		io.WriteString(w, `{"ok":true,"result":{"message_id":1,"date":1,"chat":{"id":900123,"type":"private"},"text":"QA"}}`)
	}))
	defer server.Close()
	bot, err := tgbotapi.NewBotAPIWithClient("123:test-only", server.URL+"/bot%s/%s", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	defer cache.Close()
	app := &app{db: db, redis: cache, bot: bot, tenantID: tenant, tenantName: "Telegram QA", systemMembershipID: member, timezone: time.UTC, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	const chatID int64 = 900123
	from := &tgbotapi.User{ID: chatID, FirstName: "Test", LastName: "Passenger"}
	chat := &tgbotapi.Chat{ID: chatID, Type: "private"}
	message := func(text string) { app.handleMessage(&tgbotapi.Message{From: from, Chat: chat, Text: text}) }
	callback := func(data string) {
		app.handleCallback(&tgbotapi.CallbackQuery{ID: "qa", From: from, Message: &tgbotapi.Message{Chat: chat, MessageID: 1}, Data: data})
	}
	date := time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02")
	app.saveState(chatID, bookingState{Date: date})
	callback("book:" + trip)
	state, _ := app.getState(chatID)
	if state.Step != "contact" {
		t.Fatalf("first booking did not request contact: %s", state.Step)
	}
	app.handleMessage(&tgbotapi.Message{From: from, Chat: chat, Contact: &tgbotapi.Contact{UserID: chatID, PhoneNumber: "+380500005001"}})
	for _, text := range []string{"Ivan Test", "+380500005001", "01.01.1990", "2"} {
		message(text)
	}
	booking := row(`SELECT id::text FROM bookings WHERE tenant_id=$1`, tenant)
	payment := row(`SELECT id::text FROM payments WHERE tenant_id=$1`, tenant)
	if got := row(`SELECT price_minor::text||':'||seats::text||':'||source FROM bookings WHERE id=$1`, booking); got != "250000:2:telegram" {
		t.Fatalf("incorrect Telegram booking: %s", got)
	}
	callback("pay:bank:mono:" + payment)
	if photos != 1 {
		t.Fatalf("expected exactly one payment QR, got %d", photos)
	}
	if got := row(`SELECT payment_method FROM payments WHERE id=$1`, payment); got != "bank_transfer" {
		t.Fatalf("bank selection not saved: %s", got)
	}
	if _, err := app.loadTelegramPayment(ctx, payment, chatID+1); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("foreign user can open payment: %v", err)
	}
	// The API reconciliation test supplies the bank credit; here verify the
	// resulting durable Telegram message is delivered once and only once.
	exec(`UPDATE payments SET status='paid',paid_at=now() WHERE id=$1`, payment)
	exec(`UPDATE bookings SET status='confirmed',payment_hold_expires_at=NULL WHERE id=$1`, booking)
	payload, _ := json.Marshal(telegramoutbox.PaymentConfirmedPayload{BookingID: booking, AmountMinor: 250000, Currency: "UAH"})
	exec(`INSERT INTO telegram_notification_outbox(tenant_id,chat_id,kind,payload) VALUES($1,$2,$3,$4)`, tenant, chatID, telegramoutbox.KindPaymentConfirmed, payload)
	for i := 0; i < 2; i++ {
		if err := app.deliverPendingTelegramNotifications(ctx); err != nil {
			t.Fatal(err)
		}
	}
	mu.Lock()
	confirmed := 0
	for _, text := range messages {
		if strings.Contains(text, "Оплата подтверждена") {
			confirmed++
		}
	}
	mu.Unlock()
	if confirmed != 1 {
		t.Fatalf("payment confirmation delivered %d times", confirmed)
	}
	callback("pay:bank:mono:" + payment)
	if photos != 1 {
		t.Fatal("paid booking offered another QR")
	}
	// A separate passenger can explicitly reserve with cash instead.
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164,telegram_id) VALUES($1,'Cash QA','+380500005002',900124) RETURNING id::text`, tenant)
	cashState := bookingState{Date: date, Origin: "Kyiv", Destination: "Lviv", PendingSeats: 1, PassengerName: "Cash QA", PassengerPhone: "+380500005002", PassengerBirthDate: "1990-01-01"}
	cash, err := app.createBooking(ctx, customer, trip, cashState)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.chooseCashBooking(ctx, cash.PaymentID); err != nil {
		t.Fatal(err)
	}
	if got := row(`SELECT b.status||':'||p.payment_method FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1`, cash.ID); got != "cash_on_boarding:cash" {
		t.Fatalf("incorrect cash selection: %s", got)
	}
	if err := app.setTelegramPaymentMethod(ctx, cash.PaymentID, "bank_transfer", "mono"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("stale bank button overwrote cash: %v", err)
	}
	// A custom confirmed status occupies seats just like the built-in status.
	exec(`INSERT INTO workflow_statuses(tenant_id,entity_type,key,label,semantic_phase) VALUES($1,'bookings','qa_paid','Оплачена QA','confirmed')`, tenant)
	exec(`UPDATE bookings SET status='qa_paid' WHERE id=$1`, booking)
	exec(`UPDATE trips SET capacity=3 WHERE id=$1`, trip)
	third := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Third QA','+380500005003') RETURNING id::text`, tenant)
	if _, err := app.createBooking(ctx, third, trip, cashState); !errors.Is(err, errNoSeats) {
		t.Fatalf("custom status caused overselling: %v", err)
	}
	day, _ := time.Parse("2006-01-02", date)
	if items, err := app.findTrips(ctx, "Kyiv", "Lviv", day); err != nil || len(items) != 0 {
		t.Fatalf("full custom-status trip listed: %d %v", len(items), err)
	}
	if items, err := app.findUpcomingTrips(ctx, 10); err != nil || len(items) != 0 {
		t.Fatalf("full trip offered as upcoming: %d %v", len(items), err)
	}
	if items, err := app.findAvailableDirections(ctx); err != nil || len(items) != 0 {
		t.Fatalf("full trip offered as a direction: %d %v", len(items), err)
	}
	if _, err := app.findTripDirection(ctx, trip); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("full trip accepted by callback: %v", err)
	}
	exec(`UPDATE trips SET capacity=8 WHERE id=$1`, trip)
	exec(`UPDATE bookings SET status='confirmed' WHERE id=$1`, booking)
	// Web and bot must reject the same disabled, private and departed trips.
	checks := []struct{ change, restore string }{{`UPDATE routes SET is_active=false WHERE id=$1`, `UPDATE routes SET is_active=true WHERE id=$1`}, {`UPDATE trips SET kind='individual' WHERE route_id=$1`, `UPDATE trips SET kind='regular' WHERE route_id=$1`}, {`UPDATE trips SET starts_at=now()-interval '1 minute' WHERE route_id=$1`, `UPDATE trips SET starts_at=now()+interval '1 day' WHERE route_id=$1`}}
	for _, check := range checks {
		exec(check.change, route)
		if _, err := app.createBooking(ctx, customer, trip, cashState); !errors.Is(err, errUnavailableTrip) {
			t.Fatalf("unavailable trip sold: %v", err)
		}
		day, _ := time.Parse("2006-01-02", date)
		items, err := app.findTrips(ctx, "Kyiv", "Lviv", day)
		if err != nil || len(items) != 0 {
			t.Fatalf("unavailable trip listed: %d %v", len(items), err)
		}
		exec(check.restore, route)
	}
}
