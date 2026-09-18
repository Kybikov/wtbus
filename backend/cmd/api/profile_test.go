package main

import (
	"strings"
	"testing"
)

func TestProfileValidation(t *testing.T) {
	name := "Ксенія"
	empty := "  "
	long := strings.Repeat("І", 101)
	newline := "Name\nadmin"
	for _, tc := range []struct {
		name  string
		input profileUpdate
		want  bool
	}{
		{"name", profileUpdate{DisplayName: &name}, true},
		{"empty", profileUpdate{DisplayName: &empty}, false},
		{"too long", profileUpdate{DisplayName: &long}, false},
		{"line break", profileUpdate{DisplayName: &newline}, false},
		{"no changes", profileUpdate{}, false},
		{"short password", profileUpdate{CurrentPassword: "old", NewPassword: "short"}, false},
		{"no reauthentication", profileUpdate{NewPassword: "new-password-123"}, false},
		{"bcrypt byte limit", profileUpdate{CurrentPassword: "old", NewPassword: strings.Repeat("І", 37)}, false},
		{"valid password", profileUpdate{CurrentPassword: "old", NewPassword: "new-password-123"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := validProfileUpdate(tc.input); got != tc.want {
				t.Fatalf("valid = %v, want %v", got, tc.want)
			}
		})
	}
}
