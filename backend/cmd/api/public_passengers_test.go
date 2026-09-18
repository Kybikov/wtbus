package main

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizePublicPassengers(t *testing.T) {
	now := time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC)
	valid := func() publicBookingInput {
		return publicBookingInput{Seats: 2, PaymentMethod: "cash_on_boarding", PassengerPhone: "+380 67 000 00 13", Passengers: []publicPassenger{{FirstName: " Ivan ", LastName: "O'Neil", BirthDate: "1990-01-01"}, {FirstName: "Anna-Maria", LastName: "Petrenko", BirthDate: "2000-02-29"}}}
	}
	input := valid()
	lead, err := normalizePublicPassengers(&input, now)
	if err != nil || lead.Name != "Ivan O'Neil" || lead.Phone != "+380670000013" || input.Passengers[0].FirstName != "Ivan" {
		t.Fatalf("normalization: %+v %v", lead, err)
	}
	cases := map[string]func(*publicBookingInput){
		"unselected payment":       func(i *publicBookingInput) { i.PaymentMethod = "" },
		"unavailable bank payment": func(i *publicBookingInput) { i.PaymentMethod = "iban" },
		"missing person":           func(i *publicBookingInput) { i.Passengers = i.Passengers[:1] },
		"extra person":             func(i *publicBookingInput) { i.Seats = 1 },
		"cyrillic first name":      func(i *publicBookingInput) { i.Passengers[1].FirstName = "Іван" },
		"name punctuation":         func(i *publicBookingInput) { i.Passengers[1].LastName = "Smith--Jones" },
		"long name":                func(i *publicBookingInput) { i.Passengers[1].FirstName = strings.Repeat("A", 81) },
		"future birth":             func(i *publicBookingInput) { i.Passengers[1].BirthDate = "2026-09-19" },
		"invalid leap day":         func(i *publicBookingInput) { i.Passengers[1].BirthDate = "2001-02-29" },
		"invalid phone":            func(i *publicBookingInput) { i.PassengerPhone = "123" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			i := valid()
			mutate(&i)
			if _, err := normalizePublicPassengers(&i, now); err == nil {
				t.Fatal("accepted invalid checkout")
			}
		})
	}
}
