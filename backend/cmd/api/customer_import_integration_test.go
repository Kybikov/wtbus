package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/xuri/excelize/v2"
)

func TestCustomerImportPreviewCommitPostgres(t *testing.T) {
	ctx := context.Background()
	db := deliveryTestDatabase(t)
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	defer cache.Close()
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(query string, args ...any) string {
		t.Helper()
		var result string
		if err := db.QueryRow(ctx, query, args...).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	tenant := row(`INSERT INTO tenants(slug,name,subscription_status) VALUES('import-qa','Import QA','active') RETURNING id::text`)
	other := row(`INSERT INTO tenants(slug,name,subscription_status) VALUES('import-other','Other','active') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('import@test.invalid','Importer') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'developer') RETURNING id::text`, tenant, user)
	existing := row(`INSERT INTO customers(tenant_id,full_name,phone_e164,email,notes) VALUES($1,'Old','+380500001001','keep@example.test','Keep notes') RETURNING id::text`, tenant)
	row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Other company','+380500001002') RETURNING id::text`, other)
	session, err := app.createSession(ctx, identity{UserID: user, MembershipID: member, TenantID: tenant, TenantSlug: "import-qa", Role: "developer"})
	if err != nil {
		t.Fatal(err)
	}
	handler := app.routes()
	uploadName := "customers.csv"
	send := func(mode, policy, token, content, slug, sessionToken string, want int) customerImportReport {
		t.Helper()
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		file, _ := form.CreateFormFile("file", uploadName)
		_, _ = io.WriteString(file, content)
		_ = form.WriteField("mode", mode)
		_ = form.WriteField("duplicates", policy)
		_ = form.WriteField("token", token)
		_ = form.Close()
		request := httptest.NewRequest("POST", "/api/v1/tenants/"+slug+"/customers/import", &body)
		request.Header.Set("Content-Type", form.FormDataContentType())
		request.Header.Set("Authorization", "Bearer "+sessionToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, request)
		if w.Code != want {
			t.Fatalf("import %s: %d want %d: %s", mode, w.Code, want, w.Body)
		}
		var result customerImportReport
		if want == 200 {
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	csv := "ФИО;Телефон;Email;Заметки;Extra\nNew;+380500001002;;;ignored\nChanged;+380500001001;;;\nDuplicate;+380500001002;;;\nBad;no;;;\nShort\n"
	preview := send("preview", "update", "", csv, "import-qa", session.SessionToken, 200)
	if preview.Created != 1 || preview.Updated != 1 || preview.Skipped != 3 || preview.Errors != 2 || preview.Duplicates != 2 || preview.Committed {
		t.Fatalf("incorrect plan: %+v", preview)
	}
	if got := row(`SELECT count(*)::text FROM customers WHERE tenant_id=$1`, tenant); got != "1" {
		t.Fatal("preview wrote records")
	}
	ignored := false
	for _, column := range preview.Columns {
		if column.Source == "extra" && column.Target == "" {
			ignored = true
		}
	}
	if !ignored {
		t.Fatal("unknown column was not disclosed")
	}
	result := send("commit", "update", preview.Token, csv, "import-qa", session.SessionToken, 200)
	if !result.Committed || result.Rows[0].ID == "" {
		t.Fatal("missing row receipt", result)
	}
	if got := row(`SELECT full_name||'/'||email||'/'||notes FROM customers WHERE id=$1`, existing); got != "Changed/keep@example.test/Keep notes" {
		t.Fatal("empty import erased data:", got)
	}
	if got := row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND actor_membership_id=$2 AND entity_type='customers'`, tenant, member); got != "2" {
		t.Fatal("missing import audit", got)
	}
	replay := send("commit", "update", preview.Token, csv, "import-qa", session.SessionToken, 200)
	if importDigest(replay) != importDigest(result) {
		t.Fatal("retry changed the receipt")
	}
	if got := row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND entity_type='customers'`, tenant); got != "2" {
		t.Fatal("retry duplicated writes")
	}
	send("commit", "update", preview.Token, csv+"Changed file;+380500001099;;;\n", "import-qa", session.SessionToken, 409)
	skipped := send("preview", "skip", "", csv, "import-qa", session.SessionToken, 200)
	if skipped.Created != 0 || skipped.Updated != 0 {
		t.Fatal("skip duplicates would overwrite", skipped)
	}
	staleFile := "ФИО,Телефон\nFresh,+380500001003\n"
	stale := send("preview", "skip", "", staleFile, "import-qa", session.SessionToken, 200)
	row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Added after preview','+380500001003') RETURNING id::text`, tenant)
	send("commit", "skip", stale.Token, staleFile, "import-qa", session.SessionToken, 409)
	send("preview", "skip", "", csv, "import-other", session.SessionToken, 403)
	send("preview", "skip", "", csv, "import-qa", "", 401)
	request := httptest.NewRequest("GET", "/api/v1/tenants/import-qa/customers/import", nil)
	request.Header.Set("Authorization", "Bearer "+session.SessionToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, request)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	workbook, err := excelize.OpenReader(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	defer workbook.Close()
	headers, err := workbook.GetRows(workbook.GetSheetName(0))
	if err != nil || len(headers) != 1 || strings.Contains(strings.Join(headers[0], ","), "Создан") {
		t.Fatal("template is not blank import columns", headers, err)
	}
	if got := headers[0][1]; got != "Телефон" {
		t.Fatal("template phone missing", got)
	}
	if err = workbook.SetSheetRow(workbook.GetSheetName(0), "A2", &[]any{"Template roundtrip", "+380500001088", "template@example.test", "", "From template"}); err != nil {
		t.Fatal(err)
	}
	filled, err := workbook.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	uploadName = "filled-template.xlsx"
	xlsxPreview := send("preview", "skip", "", filled.String(), "import-qa", session.SessionToken, 200)
	if xlsxPreview.Created != 1 || xlsxPreview.Errors != 0 {
		t.Fatal("filled template does not import", xlsxPreview)
	}
	xlsxResult := send("commit", "skip", xlsxPreview.Token, filled.String(), "import-qa", session.SessionToken, 200)
	if !xlsxResult.Committed || row(`SELECT email FROM customers WHERE id=$1`, xlsxResult.Rows[0].ID) != "template@example.test" {
		t.Fatal("template roundtrip failed")
	}
	row(`UPDATE memberships SET role='driver' WHERE id=$1 RETURNING id::text`, member)
	send("preview", "skip", "", filled.String(), "import-qa", session.SessionToken, 403)
}
