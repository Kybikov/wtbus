package main

import "testing"

func TestEntityViewValidation(t *testing.T) {
	valid := func() entityViewInput {
		return entityViewInput{Name: "  Active  ", Visibility: "private", Config: entityViewConfig{Mode: "table", Columns: []string{"name", "custom:test"}, Filters: map[string]string{"status": "cash_on_boarding", "date": "2026-09-21"}}}
	}
	input := valid()
	if !validateEntityView("bookings", &input) || input.Name != "Active" {
		t.Fatal("valid config rejected")
	}
	for _, change := range []func(*entityViewInput){
		func(v *entityViewInput) { v.Name = " " }, func(v *entityViewInput) { v.Visibility = "public" }, func(v *entityViewInput) { v.Config.Columns = []string{"name", "name"} }, func(v *entityViewInput) { v.Config.Columns = nil }, func(v *entityViewInput) { v.Config.Filters["date"] = "2026-02-30" }, func(v *entityViewInput) { v.Config.Filters["status"] = "unknown" }, func(v *entityViewInput) { v.Config.Filters["unknown"] = "yes" },
	} {
		input = valid()
		change(&input)
		if validateEntityView("bookings", &input) {
			t.Fatal("invalid config accepted")
		}
	}
	input = valid()
	input.Config.Filters = nil
	input.Config.Mode = "calendar"
	if validateEntityView("customers", &input) {
		t.Fatal("unsupported mode accepted")
	}
}
func TestEntityViewEditingPermissions(t *testing.T) {
	owner := "author"
	for _, role := range []string{"dispatcher", "admin", "owner", "developer"} {
		if !canEditEntityView(identity{MembershipID: owner, Role: role}, &owner, "private") {
			t.Fatal("author cannot edit")
		}
		if canEditEntityView(identity{MembershipID: "other", Role: role}, &owner, "private") {
			t.Fatal("other user's private view editable")
		}
		if canEditEntityView(identity{MembershipID: "other", Role: role}, &owner, "shared") != (role != "dispatcher") {
			t.Fatal("shared editing permissions wrong")
		}
	}
}
