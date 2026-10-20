package main

import (
	"fmt"
	"strings"
	"testing"
)

func TestEntityViewDatePeriod(t *testing.T) {
	for _, values := range [][]string{{"2026-10-20", "2026-10-25"}, {"2026-10-20", "2026-10-20"}} {
		count := 0
		if !validEntityQuery(&entityQueryNode{ID: "period", Field: "start", Operator: "between", Value: values}, 0, &count) {
			t.Fatal("valid date period rejected")
		}
	}
	for _, values := range [][]string{{"2026-10-20"}, {"2026-10-25", "2026-10-20"}, {"2026-02-30", "2026-03-05"}, {"", ""}} {
		count := 0
		if validEntityQuery(&entityQueryNode{ID: "period", Field: "start", Operator: "between", Value: values}, 0, &count) {
			t.Fatal("invalid period accepted")
		}
	}
}

func TestEntityViewCardOrder(t *testing.T) {
	input := entityViewInput{Name: "Board", Visibility: "private", Config: entityViewConfig{
		Mode: "kanban", Columns: []string{"name"}, Board: &entityViewBoard{OrderBy: "manual", CardOrder: []string{"a", "b"}},
	}}
	if !validateEntityView("routes", &input) {
		t.Fatal("valid card order rejected")
	}
	for _, ids := range [][]string{{"a", "a"}, {"bad\nvalue"}, {""}} {
		input.Config.Board.CardOrder = ids
		if validateEntityView("routes", &input) {
			t.Fatal("invalid card order accepted")
		}
	}
	input.Config.Board.CardOrder = make([]string, 5001)
	for i := range input.Config.Board.CardOrder {
		input.Config.Board.CardOrder[i] = fmt.Sprint(i)
	}
	if validateEntityView("routes", &input) {
		t.Fatal("excessive card order accepted")
	}
}

func TestEntityViewNewCollections(t *testing.T) {
	for entity, config := range map[string]entityViewConfig{
		"routes":        {Mode: "kanban", Filters: map[string]string{"active": "active"}},
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
		return entityViewInput{Name: "  Active  ", Visibility: "private", Config: entityViewConfig{Mode: "table", Columns: []string{"name", "custom:test"}, Filters: map[string]string{"status": "cash_on_boarding", "date": "2026-09-21", "source": "web", "tripStatus": "assigned", "paymentMethod": "cash_on_boarding"}, ColumnWidths: map[string]int{"name": 240}, PinnedColumns: entityViewPinnedColumns{Left: []string{"name"}}, Sort: &entityViewSort{ColumnID: "custom:test", Direction: "asc"}}}
	}
	input := valid()
	if !validateEntityView("bookings", &input) || input.Name != "Active" {
		t.Fatal("valid config rejected")
	}
	input.Config.Card = &entityViewCard{Size: "xs", Rows: []entityViewCardRow{{Fields: []string{"name", "custom:test"}, Layout: "two"}}}
	if !validateEntityView("bookings", &input) {
		t.Fatal("valid card rejected")
	}
	input.Config.Board = &entityViewBoard{OrderBy: "count", Hidden: []string{"pending"}, Order: []string{"confirmed", "Ожидает оплату"}}
	if !validateEntityView("bookings", &input) {
		t.Fatal("valid board rejected")
	}
	for _, change := range []func(*entityViewInput){
		func(v *entityViewInput) { v.Name = " " }, func(v *entityViewInput) { v.Visibility = "public" }, func(v *entityViewInput) { v.Config.Columns = []string{"name", "name"} }, func(v *entityViewInput) { v.Config.Columns = nil }, func(v *entityViewInput) { v.Config.Filters["date"] = "2026-02-30" }, func(v *entityViewInput) { v.Config.Filters["status"] = "bad status!" }, func(v *entityViewInput) { v.Config.Filters["source"] = "unknown" }, func(v *entityViewInput) { v.Config.Filters["tripStatus"] = "bad status!" }, func(v *entityViewInput) { v.Config.Filters["paymentMethod"] = "unknown" }, func(v *entityViewInput) { v.Config.Filters["unknown"] = "yes" }, func(v *entityViewInput) { v.Config.ColumnWidths["name"] = 20 }, func(v *entityViewInput) { v.Config.ColumnWidths["missing"] = 200 }, func(v *entityViewInput) { v.Config.PinnedColumns.Right = []string{"name"} }, func(v *entityViewInput) { v.Config.Sort.Direction = "sideways" }, func(v *entityViewInput) {
			v.Config.Card = &entityViewCard{Size: "huge", Rows: []entityViewCardRow{{Fields: []string{"name"}, Layout: "one"}}}
		},
		func(v *entityViewInput) { v.Config.Board = &entityViewBoard{OrderBy: "magic"} },
		func(v *entityViewInput) { v.Config.Board = &entityViewBoard{Hidden: []string{"pending", "pending"}} },
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

func TestEntityQueryValidation(t *testing.T) {
	rule := entityQueryNode{ID: "r", Field: "status", Operator: "in", Value: []string{"active", "inactive"}}
	input := entityViewInput{Name: "Query", Visibility: "private", Config: entityViewConfig{Mode: "table", Columns: []string{"name"}, Query: &entityQueryNode{ID: "g", Combinator: "and", Rules: []entityQueryNode{rule, {ID: "nested", Combinator: "or", Rules: []entityQueryNode{{ID: "empty", Field: "name", Operator: "empty"}}}}}}}
	if !validateEntityView("routes", &input) {
		t.Fatal("valid nested query rejected")
	}
	input.Config.Query.Rules[0].Operator = "execute_sql"
	if validateEntityView("routes", &input) {
		t.Fatal("unknown operator accepted")
	}
	input.Config.Query.Rules[0] = rule
	input.Config.Query.Rules[0].Value = []string{strings.Repeat("x", 501)}
	if validateEntityView("routes", &input) {
		t.Fatal("unbounded query value accepted")
	}
}
