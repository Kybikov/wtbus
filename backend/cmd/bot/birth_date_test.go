package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/redis/go-redis/v9"
)

func TestBirthDateCandidates(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		input string
		want  []string
	}{
		{"27122005", []string{"2005-12-27"}},
		{"271220025", []string{"2025-12-27", "2005-12-27", "2002-12-27"}},
		{"31.02.2005", nil}, {"2712abcd", nil}, {"27/12/2005", []string{"2005-12-27"}},
	} {
		if got := passengerBirthDateCandidates(test.input, time.UTC, now); !reflect.DeepEqual(got, test.want) {
			t.Errorf("%q: got %v want %v", test.input, got, test.want)
		}
	}
}

func TestTelegramBirthdayConfirmation(t *testing.T) {
	for _, test := range []struct {
		name, birthday, step string
		available            bool
	}{
		{"full profile", `{"day":27,"month":12,"year":2005}`, "passenger_birth_date", true},
		{"individual request", `{"day":27,"month":12,"year":2005}`, "request_passenger_birth_date", true},
		{"hidden year", `{"day":27,"month":12}`, "passenger_birth_date", false},
		{"missing birthday", `null`, "passenger_birth_date", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/getMe") {
					io.WriteString(w, `{"ok":true,"result":{"id":123,"is_bot":true,"first_name":"QA"}}`)
					return
				}
				if strings.HasSuffix(r.URL.Path, "/getChat") {
					fmt.Fprintf(w, `{"ok":true,"result":{"id":123,"type":"private","birthdate":%s}}`, test.birthday)
					return
				}
				io.WriteString(w, `{"ok":true,"result":{"message_id":1,"chat":{"id":123,"type":"private"}}}`)
			}))
			defer server.Close()
			bot, err := tgbotapi.NewBotAPIWithClient("123:qa", server.URL+"/bot%s/%s", server.Client())
			if err != nil {
				t.Fatal(err)
			}
			cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
			defer cache.Close()
			app := &app{bot: bot, redis: cache, tenantID: "birthday-test", timezone: time.UTC}
			app.askTelegramBirthDate(123, bookingState{Step: test.step})
			state, _ := app.getState(123)
			if state.PassengerBirthDate != "" || state.Step != test.step {
				t.Fatal("profile birthday saved without confirmation")
			}
			if !test.available {
				if len(state.PendingBirthDates) != 0 {
					t.Fatal("missing year was invented")
				}
				return
			}
			if len(state.PendingBirthDates) != 1 || state.PendingBirthDates[0] != "2005-12-27" {
				t.Fatalf("profile birthday missing: %+v", state)
			}
			app.handleBirthDateCallback(123, "dob:stale:0")
			unchanged, _ := app.getState(123)
			if unchanged.PassengerBirthDate != "" {
				t.Fatal("stale confirmation accepted")
			}
			app.handleBirthDateCallback(123, "dob:"+state.BirthDateNonce+":0")
			confirmed, _ := app.getState(123)
			wantStep := "seats"
			if strings.HasPrefix(test.step, "request_") {
				wantStep = "request_seats"
			}
			if confirmed.PassengerBirthDate != "2005-12-27" || confirmed.Step != wantStep {
				t.Fatalf("confirmation not applied: %+v", confirmed)
			}
			app.handleBirthDateCallback(123, "dob:"+state.BirthDateNonce+":0")
			repeated, _ := app.getState(123)
			if repeated.Step != wantStep {
				t.Fatal("replayed confirmation changed state")
			}
		})
	}
}
