package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRecordNumberValidation(t *testing.T) {
	for _, s := range []recordNumberSetting{{"trips", "РЕЙС_", "/26", 5}, {"customers", "", "", 1}} {
		if !validNumberSetting(s) {
			t.Fatalf("valid format rejected: %+v", s)
		}
	}
	for _, s := range []recordNumberSetting{{"secrets", "", "", 5}, {"trips", "a\nb", "", 5}, {"trips", strings.Repeat("Я", 17), "", 5}, {"trips", "", "", 0}, {"trips", "", "", 13}} {
		if validNumberSetting(s) {
			t.Fatalf("invalid format accepted: %+v", s)
		}
	}
}
func TestRecordNumbersPostgres(t *testing.T) {
	url := os.Getenv("RECORD_NUMBERS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set disposable RECORD_NUMBERS_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	root, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := fmt.Sprintf("numbers_%d", time.Now().UnixNano())
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	defer root.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	row := func(q string, args ...any) string {
		t.Helper()
		var v string
		if err := db.QueryRow(ctx, q, args...).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if strings.Contains(file, "000046_") {
			continue
		}
		sql, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		exec(string(sql))
	}
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('numbers-qa','Numbers') RETURNING id::text`)
	other := row(`INSERT INTO tenants(slug,name) VALUES('numbers-other','Other') RETURNING id::text`)
	oldID := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Existing','+380500000001') RETURNING id::text`, tenant)
	migration, err := os.ReadFile("../../migrations/000046_record_numbers.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(migration))
	if got := row(`SELECT number FROM record_numbers WHERE record_id=$1`, oldID); got != "CL-00001" {
		t.Fatal("backfill", got)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 24)
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := db.Exec(ctx, `INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Concurrent',$2)`, tenant, fmt.Sprintf("+380500001%03d", i))
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := row(`SELECT count(DISTINCT number)::text FROM record_numbers WHERE tenant_id=$1 AND entity='customers'`, tenant); got != "25" {
		t.Fatal("concurrent uniqueness", got)
	}
	exec(`UPDATE record_number_settings SET prefix='КЛ_',suffix='/26',digits=3 WHERE tenant_id=$1 AND entity='customers'`, tenant)
	nextID := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'New format','+380500009999') RETURNING id::text`, tenant)
	if got := row(`SELECT number FROM record_numbers WHERE record_id=$1`, nextID); got != "КЛ_026/26" {
		t.Fatal("new format", got)
	}
	if got := row(`SELECT number FROM record_numbers WHERE record_id=$1`, oldID); got != "CL-00001" {
		t.Fatal("renumbered old record", got)
	}
	exec(`DELETE FROM customers WHERE id=$1`, nextID)
	if got := row(`SELECT count(*)::text FROM record_numbers WHERE record_id=$1`, nextID); got != "0" {
		t.Fatal("orphaned registry", got)
	}
	exec(`INSERT INTO record_number_settings(tenant_id,entity,prefix,digits) VALUES($1,'routes','10',1)`, tenant)
	route := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'Route','A','B','EUR') RETURNING id::text`, tenant)
	if got := row(`SELECT number FROM record_numbers WHERE record_id=$1`, route); got != "101" {
		t.Fatal(got)
	}
	exec(`UPDATE record_number_settings SET prefix='',next_value=101 WHERE tenant_id=$1 AND entity='routes'`, tenant)
	route2 := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'Second','C','D','EUR') RETURNING id::text`, tenant)
	if got := row(`SELECT number FROM record_numbers WHERE record_id=$1`, route2); got != "102" {
		t.Fatal("collision or digit truncation", got)
	}
	// Rollback must not leave a number or increment the counter.
	before := row(`SELECT next_value::text FROM record_number_settings WHERE tenant_id=$1 AND entity='customers'`, tenant)
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Rolled back','+380500002222')`, tenant)
	if err != nil {
		t.Fatal(err)
	}
	tx.Rollback(ctx)
	if after := row(`SELECT next_value::text FROM record_number_settings WHERE tenant_id=$1 AND entity='customers'`, tenant); after != before {
		t.Fatal("counter escaped transaction")
	}
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	call := func(path string, who identity, search bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("GET", path, nil)
		r.SetPathValue("slug", who.TenantSlug)
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		if search {
			app.searchRecordNumbers(w, r)
		} else {
			app.recordNumberSettings(w, r)
		}
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body)
		}
		return w
	}
	actor := identity{TenantID: tenant, TenantSlug: "numbers-qa", Role: "developer"}
	patch := func(who identity, slug string, status int) {
		t.Helper()
		r := httptest.NewRequest("PATCH", "/", strings.NewReader(`{"entity":"customers","prefix":"НОМЕР_","suffix":"/26","digits":4}`))
		r.SetPathValue("slug", slug)
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		app.recordNumberSettings(w, r)
		if w.Code != status {
			t.Fatalf("settings patch: %d %s", w.Code, w.Body)
		}
	}
	patch(actor, "numbers-qa", 200)
	patch(identity{TenantID: tenant, TenantSlug: "numbers-qa", Role: "dispatcher"}, "numbers-qa", 403)
	patch(actor, "numbers-other", 403)
	fresh := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'API format','+380500008888') RETURNING id::text`, tenant)
	if got := row(`SELECT number FROM record_numbers WHERE record_id=$1`, fresh); got != "НОМЕР_0027/26" {
		t.Fatal("API format persistence", got)
	}
	user := row(`INSERT INTO users(email,display_name) VALUES('number-search@example.invalid','Hidden member') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'dispatcher') RETURNING id::text`, tenant, user)
	exec(`INSERT INTO user_preferences(membership_id,scale) VALUES($1,'xs')`, member)
	for _, scale := range []string{"xs", "sm", "md", "lg", "xl"} {
		exec(`UPDATE user_preferences SET scale=$2 WHERE membership_id=$1`, member, scale)
		if got := row(`SELECT scale FROM user_preferences WHERE membership_id=$1`, member); got != scale {
			t.Fatal("scale persistence", got)
		}
	}
	w := call("/?q=TM-", identity{TenantID: tenant, TenantSlug: "numbers-qa", Role: "dispatcher"}, true)
	if strings.Contains(w.Body.String(), "Hidden member") {
		t.Fatal("dispatcher saw management search results")
	}
	w = call("/?q=CL-00001", actor, true)
	if !strings.Contains(w.Body.String(), oldID) {
		t.Fatal("full number lookup", w.Body)
	}
	w = call("/?q=1", actor, true)
	if !strings.Contains(w.Body.String(), oldID) {
		t.Fatal("sequence lookup", w.Body)
	}
	w = call("/?q=%25", actor, true)
	if strings.Contains(w.Body.String(), oldID) {
		t.Fatal("wildcard leaked result")
	}
	w = call("/?q=CL-00001", identity{TenantID: other, TenantSlug: "numbers-other", Role: "developer"}, true)
	if strings.Contains(w.Body.String(), oldID) {
		t.Fatal("cross-tenant search")
	}
	w = call("/", identity{TenantID: other, TenantSlug: "numbers-other", Role: "developer"}, false)
	var settings struct{ Items []recordNumberSetting }
	if json.Unmarshal(w.Body.Bytes(), &settings) != nil || len(settings.Items) != len(numberedEntities) {
		t.Fatal("defaults lost when another tenant has settings", w.Body)
	}
	// Downgrade removes only the number feature, preserving original records.
	down, err := os.ReadFile("../../migrations/000046_record_numbers.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(down))
	if got := row(`SELECT full_name FROM customers WHERE id=$1`, oldID); got != "Existing" {
		t.Fatal("downgrade damaged data")
	}
}
