package main

import (
	"reflect"
	"testing"
	"time"
)

func TestValidateRouteInputStatus(t *testing.T) {
	inactive := false
	tests := []struct {
		name       string
		status     string
		isActive   *bool
		wantValid  bool
		wantStatus string
	}{
		{name: "defaults to active", wantValid: true, wantStatus: "active"},
		{name: "maps legacy inactive flag", isActive: &inactive, wantValid: true, wantStatus: "inactive"},
		{name: "normalizes custom status", status: " Custom_Status ", wantValid: true, wantStatus: "custom_status"},
		{name: "rejects punctuation", status: "not available!", wantValid: false, wantStatus: "not available!"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := routeInput{
				Name: "Warsaw — Kyiv", Origin: "Warsaw", Destination: "Kyiv",
				Currency: "EUR", DefaultPricingMode: "per_passenger",
				Status: test.status, IsActive: test.isActive,
			}
			if got := validateRouteInput(&input, "EUR"); got != test.wantValid {
				t.Fatalf("validateRouteInput() = %t, want %t", got, test.wantValid)
			}
			if input.Status != test.wantStatus {
				t.Fatalf("status = %q, want %q", input.Status, test.wantStatus)
			}
		})
	}
}

func TestCanDeleteTeamMember(t *testing.T) {
	tests := []struct {
		name         string
		actorRole    string
		memberRole   string
		memberActive bool
		want         bool
	}{
		{name: "developer can delete inactive owner", actorRole: "developer", memberRole: "owner", want: true},
		{name: "owner cannot delete developer", actorRole: "owner", memberRole: "developer", want: false},
		{name: "admin cannot delete inactive developer", actorRole: "admin", memberRole: "developer", want: false},
		{name: "owner can delete inactive owner", actorRole: "owner", memberRole: "owner", want: true},
		{name: "admin can delete inactive owner", actorRole: "admin", memberRole: "owner", want: true},
		{name: "admin cannot delete active owner", actorRole: "admin", memberRole: "owner", memberActive: true, want: false},
		{name: "admin can delete active dispatcher", actorRole: "admin", memberRole: "dispatcher", memberActive: true, want: true},
		{name: "dispatcher cannot delete driver", actorRole: "dispatcher", memberRole: "driver", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canDeleteTeamMember(test.actorRole, test.memberRole, test.memberActive); got != test.want {
				t.Fatalf("canDeleteTeamMember(%q, %q, %t) = %t, want %t", test.actorRole, test.memberRole, test.memberActive, got, test.want)
			}
		})
	}
}

func TestDeveloperRoleManagement(t *testing.T) {
	for _, role := range []string{"developer", "owner", "admin", "dispatcher", "driver"} {
		if !canManageTeamRole("developer", role, role) {
			t.Fatalf("developer cannot manage %s", role)
		}
	}
	if canManageTeamRole("owner", "admin", "developer") || canManageTeamRole("owner", "developer", "admin") || canManageTeamRole("admin", "admin", "developer") {
		t.Fatal("ordinary managers must not change developer access")
	}
}

func TestSystemActorEmail(t *testing.T) {
	got := systemActorEmail("12345678-1234-1234-1234-123456789abc")
	want := "automation+12345678123412341234123456789abc@system.local"
	if got != want {
		t.Fatalf("systemActorEmail() = %q, want %q", got, want)
	}
}

func TestNormalizeProvisionTenantRequest(t *testing.T) {
	tests := []struct {
		name  string
		input provisionTenantRequest
		want  provisionTenantRequest
		ok    bool
	}{
		{
			name: "normalizes defaults and casing",
			input: provisionTenantRequest{
				Slug:             "  North-Travel ",
				Name:             " North Travel ",
				Timezone:         "Europe/Warsaw",
				OwnerEmail:       " OWNER@EXAMPLE.COM ",
				OwnerDisplayName: " Owner Name ",
			},
			want: provisionTenantRequest{
				Slug:               "north-travel",
				Name:               "North Travel",
				Timezone:           "Europe/Warsaw",
				BaseCurrency:       "EUR",
				SubscriptionStatus: "trial",
				OwnerEmail:         "owner@example.com",
				OwnerDisplayName:   "Owner Name",
				PrimaryColor:       "#E9B74D",
				DefaultTheme:       "dark",
			},
			ok: true,
		},
		{
			name: "rejects invalid tenant timezone",
			input: provisionTenantRequest{
				Slug:             "north-travel",
				Name:             "North Travel",
				Timezone:         "Mars/Base",
				OwnerEmail:       "owner@example.com",
				OwnerDisplayName: "Owner Name",
			},
		},
		{
			name: "rejects invalid owner email",
			input: provisionTenantRequest{
				Slug:             "north-travel",
				Name:             "North Travel",
				Timezone:         "Europe/Warsaw",
				OwnerEmail:       "not-an-email",
				OwnerDisplayName: "Owner Name",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := test.input
			err := normalizeProvisionTenantRequest(&input)
			if (err == nil) != test.ok {
				t.Fatalf("normalizeProvisionTenantRequest() error = %v, want success %t", err, test.ok)
			}
			if test.ok && input != test.want {
				t.Fatalf("normalized request = %#v, want %#v", input, test.want)
			}
		})
	}
}

func TestExpandWeeklyTripSchedule(t *testing.T) {
	location := time.FixedZone("test", 2*60*60)
	startsAt := time.Date(2026, time.September, 7, 9, 30, 0, 0, location) // Monday
	endsAt := time.Date(2026, time.September, 7, 12, 15, 0, 0, location)
	repeatUntil := time.Date(2026, time.September, 18, 0, 0, 0, 0, location)
	weekdays := map[time.Weekday]struct{}{
		time.Monday:    {},
		time.Wednesday: {},
		time.Friday:    {},
	}

	instances := expandWeeklyTripSchedule(startsAt, endsAt, repeatUntil, weekdays)
	if len(instances) != 6 {
		t.Fatalf("expandWeeklyTripSchedule() returned %d instances, want 6", len(instances))
	}
	wantStarts := []string{
		"2026-09-07T09:30:00+02:00",
		"2026-09-09T09:30:00+02:00",
		"2026-09-11T09:30:00+02:00",
		"2026-09-14T09:30:00+02:00",
		"2026-09-16T09:30:00+02:00",
		"2026-09-18T09:30:00+02:00",
	}
	for index, instance := range instances {
		if got := instance.startsAt.Format(time.RFC3339); got != wantStarts[index] {
			t.Fatalf("instance %d starts at %s, want %s", index, got, wantStarts[index])
		}
		if got := instance.endsAt.Sub(instance.startsAt); got != 2*time.Hour+45*time.Minute {
			t.Fatalf("instance %d duration %s, want 2h45m", index, got)
		}
	}
}

func TestValidUserPreferences(t *testing.T) {
	valid := defaultUserPreferences()
	if !validUserPreferences(valid) {
		t.Fatal("default preferences must be valid")
	}
	for _, mutate := range []func(*userPreferencesResponse){
		func(preferences *userPreferencesResponse) { preferences.Theme = "sepia" },
		func(preferences *userPreferencesResponse) { preferences.Accent = "custom" },
		func(preferences *userPreferencesResponse) { preferences.Density = "wide" },
		func(preferences *userPreferencesResponse) { preferences.Radius = "xl" },
		func(preferences *userPreferencesResponse) { preferences.Scale = "xl" },
		func(preferences *userPreferencesResponse) { preferences.SidebarVariant = "wide" },
		func(preferences *userPreferencesResponse) { preferences.SidebarMode = "collapsed" },
	} {
		preferences := valid
		mutate(&preferences)
		if validUserPreferences(preferences) {
			t.Fatalf("invalid preferences accepted: %#v", preferences)
		}
	}
}

func TestValidBookingCurrency(t *testing.T) {
	for _, currency := range []string{"UAH", "EUR"} {
		if !validBookingCurrency(currency) {
			t.Fatalf("validBookingCurrency(%q) = false, want true", currency)
		}
	}
	for _, currency := range []string{"usd", "USD", "PLN", "", "UA"} {
		if validBookingCurrency(currency) {
			t.Fatalf("validBookingCurrency(%q) = true, want false", currency)
		}
	}
}

func TestNormalizeBookingPassengerDetails(t *testing.T) {
	now := time.Date(2026, time.August, 29, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name      string
		passenger string
		phone     string
		birthDate string
		want      bookingPassengerDetails
		ok        bool
	}{
		{
			name:      "normalizes valid passenger",
			passenger: "  Олена Іваненко ",
			phone:     "+380 67 123 45 67",
			birthDate: "1994-11-07",
			want: bookingPassengerDetails{
				Name:      "Олена Іваненко",
				Phone:     "+380671234567",
				BirthDate: "1994-11-07",
			},
			ok: true,
		},
		{
			name:      "birth date at maximum age",
			passenger: "Іван",
			phone:     "+380671234567",
			birthDate: "1901-08-29",
			want:      bookingPassengerDetails{Name: "Іван", Phone: "+380671234567", BirthDate: "1901-08-29"},
			ok:        true,
		},
		{name: "empty name", phone: "+380671234567", birthDate: "1994-11-07"},
		{name: "invalid phone", passenger: "Іван", phone: "0671234567", birthDate: "1994-11-07"},
		{name: "future birth date", passenger: "Іван", phone: "+380671234567", birthDate: "2026-08-30"},
		{name: "unrealistically old birth date", passenger: "Іван", phone: "+380671234567", birthDate: "1901-08-28"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeBookingPassengerDetails(test.passenger, test.phone, test.birthDate, now)
			if (err == nil) != test.ok {
				t.Fatalf("normalizeBookingPassengerDetails() error = %v, want success %t", err, test.ok)
			}
			if test.ok && got != test.want {
				t.Fatalf("normalizeBookingPassengerDetails() = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestCanCreateBookingForTripStatus(t *testing.T) {
	for _, status := range []string{"new", "assigned"} {
		if !canCreateBookingForTripStatus(status) {
			t.Fatalf("canCreateBookingForTripStatus(%q) = false, want true", status)
		}
	}
	for _, status := range []string{"draft", "in_progress", "completed", "cancelled"} {
		if canCreateBookingForTripStatus(status) {
			t.Fatalf("canCreateBookingForTripStatus(%q) = true, want false", status)
		}
	}
}

func TestIndividualTransferRequestStatusTransitions(t *testing.T) {
	for _, status := range []string{"new", "in_progress", "closed", "cancelled"} {
		if !validIndividualTransferRequestStatus(status) {
			t.Fatalf("validIndividualTransferRequestStatus(%q) = false, want true", status)
		}
	}
	for _, status := range []string{"", "pending", "quoted", "completed"} {
		if validIndividualTransferRequestStatus(status) {
			t.Fatalf("validIndividualTransferRequestStatus(%q) = true, want false", status)
		}
	}
	for _, transition := range []struct{ current, next string }{
		{"new", "new"},
		{"new", "in_progress"},
		{"new", "cancelled"},
		{"in_progress", "closed"},
		{"in_progress", "cancelled"},
	} {
		if !canTransitionIndividualTransferRequest(transition.current, transition.next) {
			t.Fatalf("transition %s -> %s must be allowed", transition.current, transition.next)
		}
	}
	for _, transition := range []struct{ current, next string }{{"new", "closed"}, {"closed", "in_progress"}, {"cancelled", "new"}} {
		if canTransitionIndividualTransferRequest(transition.current, transition.next) {
			t.Fatalf("transition %s -> %s must be rejected", transition.current, transition.next)
		}
	}
}

func TestReservedBookingCustomFieldKey(t *testing.T) {
	for _, key := range []string{"passenger_name", "passenger_phone", "passenger_birth_date"} {
		if !isReservedBookingCustomFieldKey("booking", key) {
			t.Fatalf("booking field %q must be reserved", key)
		}
	}
	if isReservedBookingCustomFieldKey("customer", "passenger_name") {
		t.Fatal("customer fields must not be treated as booking-reserved")
	}
}

func TestDecodeCustomerLifetimeValue(t *testing.T) {
	got, err := decodeCustomerLifetimeValue([]byte(`[{"currency":"EUR","amountMinor":12500},{"currency":"UAH","amountMinor":34900}]`))
	if err != nil {
		t.Fatalf("decodeCustomerLifetimeValue() error = %v", err)
	}
	want := []customerRevenueResponse{
		{Currency: "EUR", AmountMinor: 12500},
		{Currency: "UAH", AmountMinor: 34900},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("decodeCustomerLifetimeValue() = %#v, want %#v", got, want)
	}
	if _, err := decodeCustomerLifetimeValue([]byte(`[{"currency":"EUR","amountMinor":-1}]`)); err == nil {
		t.Fatal("decodeCustomerLifetimeValue() accepted a negative amount")
	}
}

func TestSubscriptionAllowsOperations(t *testing.T) {
	for _, status := range []string{"trial", "active"} {
		if !subscriptionAllowsOperations(status) {
			t.Fatalf("subscriptionAllowsOperations(%q) = false, want true", status)
		}
	}
	for _, status := range []string{"past_due", "suspended", "cancelled", ""} {
		if subscriptionAllowsOperations(status) {
			t.Fatalf("subscriptionAllowsOperations(%q) = true, want false", status)
		}
	}
}

func TestExplicitlyEnabled(t *testing.T) {
	for _, value := range []string{"true", "TRUE", " True "} {
		if !explicitlyEnabled(value) {
			t.Fatalf("explicitlyEnabled(%q) = false, want true", value)
		}
	}
	for _, value := range []string{"", "false", "1", "yes"} {
		if explicitlyEnabled(value) {
			t.Fatalf("explicitlyEnabled(%q) = true, want false", value)
		}
	}
}
