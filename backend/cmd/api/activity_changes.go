package main

import (
	"context"
	"reflect"
	"sort"
	"strings"
)

type auditFieldChange struct {
	Field          string `json:"field"`
	Before         any    `json:"before"`
	After          any    `json:"after"`
	BeforeLabel    string `json:"beforeLabel,omitempty"`
	AfterLabel     string `json:"afterLabel,omitempty"`
	BeforeTone     string `json:"beforeTone,omitempty"`
	AfterTone      string `json:"afterTone,omitempty"`
	BeforeCurrency string `json:"beforeCurrency,omitempty"`
	AfterCurrency  string `json:"afterCurrency,omitempty"`
}

// Audit only explicit operational values. Free-form notes, passenger documents,
// contacts, custom data, location, credentials and provider payloads stay out.
var auditValueFields = func() map[string]bool {
	m := map[string]bool{}
	for _, key := range strings.Fields("name full_name display_name status is_active role origin_name destination_name currency default_price_minor default_pricing_mode driver_pay_minor price_minor pricing_mode distance_km tariff_mode vehicle_class registration_number capacity vehicle_id driver_id route_id trip_id customer_id booking_id starts_at ends_at kind seats") {
		m[key] = true
	}
	return m
}()

func auditSafeValue(value any) (any, bool) {
	switch v := value.(type) {
	case nil, bool, float64:
		return v, true
	case string:
		if len([]rune(v)) <= 500 {
			return v, true
		}
	}
	return nil, false
}

// Joined display labels and live GPS are derived, not changes to this record.
func auditChangedFields(before, after map[string]any) []string {
	derived := map[string]bool{"updated_at": true, "created_at": true, "last_location": true, "vehicle_name": true, "driver_name": true, "route_name": true, "customer_name": true, "customer_phone": true, "driver_phone": true, "payment_status": true, "payment_method": true}
	fields := []string{}
	for key, value := range before {
		if !derived[key] && !reflect.DeepEqual(value, after[key]) {
			fields = append(fields, key)
		}
	}
	sort.Strings(fields)
	return fields
}

func auditChanges(before, after map[string]any) []auditFieldChange {
	keys := make([]string, 0, len(auditValueFields))
	for key := range auditValueFields {
		if !reflect.DeepEqual(before[key], after[key]) {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	changes := make([]auditFieldChange, 0, len(keys))
	for _, key := range keys {
		old, oldOK := auditSafeValue(before[key])
		next, nextOK := auditSafeValue(after[key])
		if !oldOK || !nextOK {
			continue
		}
		change := auditFieldChange{Field: key, Before: old, After: next}
		if strings.HasSuffix(key, "_minor") {
			change.BeforeCurrency, _ = before["currency"].(string)
			change.AfterCurrency, _ = after["currency"].(string)
		}
		changes = append(changes, change)
	}
	return changes
}

func (app *application) labelAuditChanges(ctx context.Context, actor identity, entity string, changes []auditFieldChange) {
	workflow := entity
	if entity == "fleet" {
		workflow = "vehicles"
	}
	for i := range changes {
		change := &changes[i]
		label := func(value any) (string, string) {
			key, ok := value.(string)
			if !ok || key == "" {
				return "", ""
			}
			var name, tone string
			if change.Field == "status" {
				_ = app.db.QueryRow(ctx, `SELECT label,tone FROM workflow_statuses WHERE tenant_id=$1 AND entity_type=$2 AND key=$3`, actor.TenantID, workflow, key).Scan(&name, &tone)
				return name, tone
			}
			query := map[string]string{
				"route_id":    `SELECT name FROM routes WHERE tenant_id=$1 AND id::text=$2`,
				"vehicle_id":  `SELECT name FROM vehicles WHERE tenant_id=$1 AND id::text=$2`,
				"driver_id":   `SELECT full_name FROM drivers WHERE tenant_id=$1 AND id::text=$2`,
				"customer_id": `SELECT full_name FROM customers WHERE tenant_id=$1 AND id::text=$2`,
				"trip_id":     `SELECT origin_name||' → '||destination_name FROM trips WHERE tenant_id=$1 AND id::text=$2`,
			}[change.Field]
			if query != "" {
				_ = app.db.QueryRow(ctx, query, actor.TenantID, key).Scan(&name)
			}
			return name, ""
		}
		change.BeforeLabel, change.BeforeTone = label(change.Before)
		change.AfterLabel, change.AfterTone = label(change.After)
	}
}
