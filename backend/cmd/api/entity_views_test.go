package main

import "testing"

func TestEntityViewNewCollections(t *testing.T) {
	for entity, config := range map[string]entityViewConfig{
		"routes":        {Mode: "gallery", Filters: map[string]string{"active": "active"}},
		"fleet":         {Mode: "kanban", Filters: map[string]string{"active": "inactive"}},
		"requests":      {Mode: "calendar", Filters: map[string]string{"status": "in_progress"}},
		"availability":  {Mode: "calendar", Filters: map[string]string{"scope": "route"}},
		"trips":         {Mode: "schedule", Filters: map[string]string{"kind": "regular", "status": "assigned"}},
		"cash-balances": {Mode: "list", Filters: map[string]string{"currency": "EUR"}},
	} {
		config.Columns = []string{"name"}
		input := entityViewInput{Name: "New collection", Visibility: "shared", Config: config}
		if !validateEntityView(entity, &input) {
			t.Fatalf("%s config rejected", entity)
		}
		input.Config.Filters = map[string]string{"unknown": "x"}
		if validateEntityView(entity, &input) {
			t.Fatalf("%s accepts arbitrary filters", entity)
		}
		input.Config.Filters = nil
		input.Config.Mode = "schedule"
		if entity != "trips" && validateEntityView(entity, &input) {
			t.Fatalf("%s accepts trip schedule", entity)
		}
	}
	input := entityViewInput{Name: "Unknown", Visibility: "private", Config: entityViewConfig{Mode: "table", Columns: []string{"name"}}}
	if validateEntityView("unknown", &input) {
		t.Fatal("unknown collection accepted")
	}
}

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

func TestEntityViewMetricValidation(t *testing.T) {
	valid := func() entityViewInput {
		return entityViewInput{Name: "Metrics", Visibility: "private", Config: entityViewConfig{Mode: "table", Columns: []string{"name"}, Metrics: []entityViewMetric{{Field: "status", Operation: "equals", Value: "active"}, {Field: "custom-number", Operation: "sum"}}}}
	}
	input := valid()
	if !validateEntityView("team", &input) {
		t.Fatal("valid metrics rejected")
	}
	for _, change := range []func(*entityViewInput){
		func(v *entityViewInput) { v.Config.Metrics = append(v.Config.Metrics, v.Config.Metrics[0]) },
		func(v *entityViewInput) { v.Config.Metrics[0].Field = "bad field" },
		func(v *entityViewInput) { v.Config.Metrics[0].Operation = "execute" },
		func(v *entityViewInput) { v.Config.Metrics[0].Value = "" },
		func(v *entityViewInput) { v.Config.Metrics[1].Value = "unexpected" },
		func(v *entityViewInput) { v.Config.Metrics = make([]entityViewMetric, 13) },
	} {
		input = valid()
		change(&input)
		if validateEntityView("team", &input) {
			t.Fatal("invalid metrics accepted")
		}
	}
}
