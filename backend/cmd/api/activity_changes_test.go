package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestAuditChangesAllowlist(t *testing.T) {
	before := map[string]any{"status": "inactive", "is_active": false, "price_minor": float64(1200), "currency": "EUR", "password": "secret-before", "notes": "private-before", "phone_e164": "private-phone-before", "custom_data": map[string]any{"passport": "private"}}
	after := map[string]any{"status": "active", "is_active": true, "price_minor": float64(2400), "currency": "UAH", "password": "secret-after", "notes": "private-after", "phone_e164": "private-phone-after", "custom_data": map[string]any{"passport": "changed"}}
	changes := auditChanges(before, after)
	fields := []string{}
	for _, change := range changes {
		fields = append(fields, change.Field)
		if change.Field == "price_minor" && (change.BeforeCurrency != "EUR" || change.AfterCurrency != "UAH") {
			t.Fatal("money lost its historical currency")
		}
	}
	if !reflect.DeepEqual(fields, []string{"currency", "is_active", "price_minor", "status"}) {
		t.Fatal(fields)
	}
	if len(auditChanges(before, before)) != 0 {
		t.Fatal("no-op generated a transition")
	}
	if len(auditChanges(map[string]any{"name": "Before"}, map[string]any{"name": strings.Repeat("x", 501)})) != 0 {
		t.Fatal("oversized value retained")
	}
	if len(auditChanges(map[string]any{"name": "Before"}, map[string]any{"name": map[string]any{"secret": "not scalar"}})) != 0 {
		t.Fatal("arbitrary object retained")
	}
}

func TestAuditFieldsIgnoreDerivedData(t *testing.T) {
	before := map[string]any{"status": "active", "notes": "before", "updated_at": "before", "last_location": "before", "driver_name": "before"}
	after := map[string]any{"status": "active", "notes": "after", "updated_at": "after", "last_location": "after", "driver_name": "after"}
	if !reflect.DeepEqual(auditChangedFields(before, after), []string{"notes"}) {
		t.Fatal("derived labels or GPS appeared as record edits")
	}
}

func TestAuditConfiguredPlacesShowOldAndNew(t *testing.T) {
	before := map[string]any{"navigation": map[string]any{"start": []float64{30.52, 50.45}, "startLabel": "Kyiv station", "end": []float64{13.4, 52.5}, "endLabel": "Berlin station", "distanceMeters": 1000000, "coordinates": []any{"private-polyline"}}, "last_location": "private-driver-gps"}
	after := map[string]any{"navigation": map[string]any{"start": []float64{30.53, 50.46}, "startLabel": "New Kyiv stop", "end": []float64{13.4, 52.5}, "endLabel": "Berlin station", "distanceMeters": 1001000}, "last_location": "another-private-gps"}
	changes := auditChanges(before, after)
	found := false
	for _, change := range changes {
		if change.Field == "pickup_place" {
			found = change.Before == "Kyiv station · 50.45000, 30.52000" && change.After == "New Kyiv stop · 50.46000, 30.53000"
		}
		if change.Field == "navigation" || change.Field == "last_location" {
			t.Fatal("raw navigation or GPS retained")
		}
	}
	if !found {
		t.Fatalf("pickup transition missing: %+v", changes)
	}
	if len(auditChanges(before, before)) != 0 {
		t.Fatal("unchanged road created history")
	}
	fields := auditChangedFields(before, after)
	if !reflect.DeepEqual(fields, []string{"distance_km", "pickup_place"}) {
		t.Fatalf("generic changed fields: %v", fields)
	}
}
