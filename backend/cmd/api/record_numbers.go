package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode"
)

type recordNumberSetting struct {
	Entity string `json:"entity"`
	Prefix string `json:"prefix"`
	Suffix string `json:"suffix"`
	Digits int    `json:"digits"`
}

var numberedEntities = []string{"customers", "bookings", "trips", "routes", "fleet", "team", "requests", "availability"}

func validNumberSetting(s recordNumberSetting) bool {
	found := false
	for _, entity := range numberedEntities {
		if s.Entity == entity {
			found = true
		}
	}
	if !found || s.Digits < 1 || s.Digits > 12 || len([]rune(s.Prefix)) > 16 || len([]rune(s.Suffix)) > 16 {
		return false
	}
	for _, r := range s.Prefix + s.Suffix {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func (app *application) recordNumberSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	actor, authenticated := identityFromContext(r.Context())
	if !authenticated || actor.TenantID != company.ID || (actor.Role != "owner" && actor.Role != "admin" && actor.Role != "developer") {
		writeJSON(w, 403, map[string]string{"error": "Настройки нумерации доступны администратору и владельцу компании."})
		return
	}
	if r.Method == "PATCH" {
		var input recordNumberSetting
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || !validNumberSetting(input) {
			writeJSON(w, 400, map[string]string{"error": "Укажите тип записи, префикс и суффикс до 16 символов без управляющих знаков и от 1 до 12 цифр."})
			return
		}
		_, err := app.db.Exec(r.Context(), `INSERT INTO record_number_settings(tenant_id,entity,prefix,suffix,digits) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,entity) DO UPDATE SET prefix=excluded.prefix,suffix=excluded.suffix,digits=excluded.digits`, company.ID, input.Entity, input.Prefix, input.Suffix, input.Digits)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"item": input})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT e.entity,COALESCE(s.prefix,default_record_prefix(e.entity)),COALESCE(s.suffix,''),COALESCE(s.digits,5) FROM unnest($2::text[]) e(entity) LEFT JOIN record_number_settings s ON s.entity=e.entity AND s.tenant_id=$1 ORDER BY e.entity`, company.ID, numberedEntities)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer rows.Close()
	items := []recordNumberSetting{}
	for rows.Next() {
		var s recordNumberSetting
		if err = rows.Scan(&s.Entity, &s.Prefix, &s.Suffix, &s.Digits); err != nil {
			app.publicFailure(w, err)
			return
		}
		items = append(items, s)
	}
	if rows.Err() != nil {
		app.publicFailure(w, rows.Err())
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (app *application) searchRecordNumbers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	actor, ok := identityFromContext(r.Context())
	if !ok || actor.TenantID != company.ID {
		writeJSON(w, 403, map[string]string{"error": "Доступ запрещён."})
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len([]rune(q)) > 120 {
		writeJSON(w, 200, map[string]any{"items": []any{}})
		return
	}
	// Match literals: user input cannot broaden LIKE through wildcard characters.
	q = strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.ToLower(q))
	rows, err := app.db.Query(r.Context(), `SELECT n.record_id::text,n.entity,n.number,COALESCE(c.full_name,v.name,rt.name,u.display_name,t.origin_name||' → '||t.destination_name,bt.origin_name||' → '||bt.destination_name,r.origin_name||' → '||r.destination_name,'')
 FROM record_numbers n
 LEFT JOIN customers c ON n.entity='customers' AND c.id=n.record_id AND c.tenant_id=n.tenant_id
 LEFT JOIN vehicles v ON n.entity='fleet' AND v.id=n.record_id AND v.tenant_id=n.tenant_id
 LEFT JOIN routes rt ON n.entity='routes' AND rt.id=n.record_id AND rt.tenant_id=n.tenant_id
 LEFT JOIN memberships m ON n.entity='team' AND m.id=n.record_id AND m.tenant_id=n.tenant_id LEFT JOIN users u ON u.id=m.user_id
 LEFT JOIN trips t ON n.entity='trips' AND t.id=n.record_id AND t.tenant_id=n.tenant_id
 LEFT JOIN bookings b ON n.entity='bookings' AND b.id=n.record_id AND b.tenant_id=n.tenant_id LEFT JOIN trips bt ON bt.id=b.trip_id AND bt.tenant_id=b.tenant_id
 LEFT JOIN individual_transfer_requests r ON n.entity='requests' AND r.id=n.record_id AND r.tenant_id=n.tenant_id
 WHERE n.tenant_id=$1 AND ($3 OR n.entity<>'team') AND (lower(n.number) LIKE $2||'%' OR n.sequence::text=$4)
 ORDER BY lower(n.number) LIMIT 12`, company.ID, q, actor.Role == "developer" || actor.Role == "owner" || actor.Role == "admin", strings.TrimSpace(r.URL.Query().Get("q")))
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]string{}
	for rows.Next() {
		var id, entity, number, label string
		if err = rows.Scan(&id, &entity, &number, &label); err != nil {
			app.publicFailure(w, err)
			return
		}
		items = append(items, map[string]string{"id": id, "entity": entity, "number": number, "label": label})
	}
	if rows.Err() != nil {
		app.publicFailure(w, rows.Err())
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
