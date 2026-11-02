package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vivat-bus/tms/internal/customerexport"
	"github.com/vivat-bus/tms/internal/customerimport"
	"github.com/xuri/excelize/v2"
)

type customerImportLine struct {
	Row     int    `json:"row"`
	Name    string `json:"name"`
	Phone   string `json:"phone"`
	Status  string `json:"status"`
	Message string `json:"message"`
	ID      string `json:"id,omitempty"`
	data    customerimport.Row
	custom  map[string]any
}
type customerImportReport struct {
	Token      string                 `json:"token"`
	Created    int                    `json:"created"`
	Updated    int                    `json:"updated"`
	Skipped    int                    `json:"skipped"`
	Errors     int                    `json:"errors"`
	Duplicates int                    `json:"duplicates"`
	Committed  bool                   `json:"committed"`
	Rows       []customerImportLine   `json:"rows"`
	Columns    []customerImportColumn `json:"columns"`
}
type customerImportColumn struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

func importDigest(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func customerImportPhone(value string) string {
	return normalizePhone(strings.TrimPrefix(strings.TrimSpace(value), "'"))
}

func (app *application) customerImportTemplate(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	fields, err := app.loadCustomerImportFields(r.Context(), tenant.ID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	definitions := []customerexport.Field{}
	for _, field := range fields {
		definitions = append(definitions, customerexport.Field{Key: field.Key, Label: field.Label})
	}
	content, err := customerexport.XLSX(definitions, []customerexport.Record{})
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	book, e := excelize.OpenReader(bytes.NewReader(content))
	if e != nil {
		app.publicFailure(w, e)
		return
	}
	defer book.Close()
	sheet := book.GetSheetName(0)
	// Export-only creation date is not an import field. Keep identity values as text in Excel.
	if e = book.RemoveCol(sheet, "F"); e != nil {
		app.publicFailure(w, e)
		return
	}
	style, e := book.NewStyle(&excelize.Style{NumFmt: 49})
	if e != nil {
		app.publicFailure(w, e)
		return
	}
	for _, column := range []string{"B", "D"} {
		if e = book.SetColStyle(sheet, column, style); e != nil {
			app.publicFailure(w, e)
			return
		}
	}
	buffer, e := book.WriteToBuffer()
	if e != nil {
		app.publicFailure(w, e)
		return
	}
	content = buffer.Bytes()
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="vivat-customers-template.xlsx"`)
	_, _ = w.Write(content)
}

func (app *application) importCustomers(w http.ResponseWriter, r *http.Request) {
	// A file preview is not a customer creation; committed rows have their own journal entries.
	financeAuditDone(r)
	tenant, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	actor, _ := identityFromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeJSON(w, 400, map[string]string{"error": "Файл должен быть не больше 10 МБ."})
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	mode, policy := r.FormValue("mode"), r.FormValue("duplicates")
	if (mode != "preview" && mode != "commit") || (policy != "skip" && policy != "update") {
		writeJSON(w, 400, map[string]string{"error": "Сначала проверьте файл и выберите обработку дубликатов."})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "Выберите CSV или XLSX файл."})
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "Не удалось прочитать файл."})
		return
	}
	var source []customerimport.Row
	switch {
	case strings.HasSuffix(strings.ToLower(header.Filename), ".csv"):
		source, err = customerimport.ReadCSV(bytes.NewReader(raw))
	case strings.HasSuffix(strings.ToLower(header.Filename), ".xlsx"):
		source, err = customerimport.ReadXLSX(bytes.NewReader(raw))
	default:
		writeJSON(w, 400, map[string]string{"error": "Поддерживаются только CSV и XLSX."})
		return
	}
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	if len(source) == 0 || len(source) > 5000 {
		writeJSON(w, 400, map[string]string{"error": "В файле должно быть от 1 до 5000 строк клиентов."})
		return
	}
	fields, err := app.loadCustomerImportFields(r.Context(), tenant.ID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	inputDigest := importDigest([]any{tenant.ID, actor.MembershipID, policy, raw})
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize imports, and lock existing records before comparing the preview.
	if mode == "commit" {
		if _, err = tx.Exec(r.Context(), `SELECT id FROM tenants WHERE id=$1 FOR UPDATE`, tenant.ID); err != nil {
			app.publicFailure(w, err)
			return
		}
		var digest string
		var saved json.RawMessage
		err = tx.QueryRow(r.Context(), `SELECT source_digest,result FROM customer_import_runs WHERE tenant_id=$1 AND preview_token=$2`, tenant.ID, r.FormValue("token")).Scan(&digest, &saved)
		if err == nil {
			if digest != inputDigest {
				writeJSON(w, 409, map[string]string{"error": "Файл изменился. Проверьте его заново."})
				return
			}
			writeJSON(w, 200, saved)
			return
		}
		if err != pgx.ErrNoRows {
			app.publicFailure(w, err)
			return
		}
	}
	phones := make([]string, 0, len(source))
	for _, row := range source {
		if phone := customerImportPhone(row.Phone); phone != "" {
			phones = append(phones, phone)
		}
	}
	query := `SELECT phone_e164,id::text,to_jsonb(c) FROM customers c WHERE tenant_id=$1 AND phone_e164=ANY($2) ORDER BY phone_e164`
	if mode == "commit" {
		query += " FOR UPDATE"
	}
	records, err := tx.Query(r.Context(), query, tenant.ID, phones)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	ids := map[string]string{}
	snapshots := map[string]json.RawMessage{}
	for records.Next() {
		var phone, id string
		var snapshot json.RawMessage
		if err = records.Scan(&phone, &id, &snapshot); err != nil {
			records.Close()
			app.publicFailure(w, err)
			return
		}
		ids[phone] = id
		snapshots[phone] = snapshot
	}
	err = records.Err()
	records.Close()
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	report := customerImportReport{Rows: []customerImportLine{}, Columns: []customerImportColumn{}}
	for column := range source[0].Columns {
		target := customerimport.ColumnTarget(column)
		for _, field := range fields {
			if column == normalizeImportHeader(field.Key) || column == normalizeImportHeader(field.Label) {
				target = field.Label
			}
		}
		report.Columns = append(report.Columns, customerImportColumn{Source: column, Target: target})
	}
	sort.Slice(report.Columns, func(i, j int) bool { return report.Columns[i].Source < report.Columns[j].Source })
	seen := map[string]int{}
	for _, row := range source {
		line := customerImportLine{Row: row.Number, Name: strings.TrimSpace(row.FullName), Phone: customerImportPhone(row.Phone), Status: "create", Message: "Новый клиент", data: row}
		rowFields := append([]customFieldDefinition(nil), fields...)
		if ids[line.Phone] != "" {
			for i := range rowFields {
				rowFields[i].IsRequired = false
			}
		}
		line.custom, err = importCustomerCustomData(row, rowFields)
		switch {
		case line.Phone == "":
			line.Status = "error"
			line.Message = "Некорректный международный телефон"
		case len([]rune(line.Name)) > 160 || len([]rune(row.Notes)) > 4000:
			line.Status = "error"
			line.Message = "Имя — до 160 символов, комментарий — до 4000"
		case err != nil:
			line.Status = "error"
			line.Message = err.Error()
		}
		if line.Status != "error" && row.Email != "" {
			email := strings.ToLower(strings.TrimSpace(row.Email))
			parsed, e := mail.ParseAddress(email)
			if e != nil || parsed.Address != email {
				line.Status = "error"
				line.Message = "Некорректный email"
			}
		}
		if line.Status != "error" && row.TelegramID != "" {
			id, e := strconv.ParseInt(row.TelegramID, 10, 64)
			if e != nil || id <= 0 {
				line.Status = "error"
				line.Message = "Некорректный Telegram ID"
			}
		}
		if line.Status == "error" {
			report.Errors++
			report.Skipped++
		} else if previous, exists := seen[line.Phone]; exists {
			line.Status = "duplicate"
			line.Message = fmt.Sprintf("Повтор телефона из строки %d", previous)
			report.Duplicates++
			report.Skipped++
		} else {
			seen[line.Phone] = line.Row
			if id := ids[line.Phone]; id != "" {
				line.ID = id
				report.Duplicates++
				if policy == "update" {
					line.Status = "update"
					line.Message = "Совпадение по телефону · обновить заполненные поля"
					report.Updated++
				} else {
					line.Status = "duplicate"
					line.Message = "Клиент уже есть · пропустить"
					report.Skipped++
				}
			} else {
				report.Created++
			}
		}
		report.Rows = append(report.Rows, line)
	}
	report.Token = importDigest([]any{inputDigest, source, fields, snapshots, report.Rows})
	if mode == "preview" {
		writeJSON(w, 200, report)
		return
	}
	if report.Token != r.FormValue("token") {
		writeJSON(w, 409, map[string]string{"error": "Файл или данные клиентов изменились. Проверьте файл заново перед импортом."})
		return
	}
	for i := range report.Rows {
		line := &report.Rows[i]
		if line.Status != "create" && line.Status != "update" {
			continue
		}
		custom, _ := json.Marshal(line.custom)
		var telegram *int64
		if line.data.TelegramID != "" {
			v, _ := strconv.ParseInt(line.data.TelegramID, 10, 64)
			telegram = &v
		}
		before := map[string]any{}
		if snapshot := snapshots[line.Phone]; snapshot != nil {
			_ = json.Unmarshal(snapshot, &before)
		}
		if line.Status == "create" {
			err = tx.QueryRow(r.Context(), `INSERT INTO customers(tenant_id,full_name,phone_e164,email,telegram_id,notes,custom_data,imported_at) VALUES($1,NULLIF($2,''),$3,NULLIF($4,''),$5,NULLIF($6,''),$7,now()) ON CONFLICT(tenant_id,phone_e164) DO NOTHING RETURNING id::text`, tenant.ID, line.Name, line.Phone, strings.ToLower(strings.TrimSpace(line.data.Email)), telegram, line.data.Notes, custom).Scan(&line.ID)
		} else {
			_, err = tx.Exec(r.Context(), `UPDATE customers SET full_name=COALESCE(NULLIF($3,''),full_name),email=COALESCE(NULLIF($4,''),email),telegram_id=COALESCE($5,telegram_id),notes=COALESCE(NULLIF($6,''),notes),custom_data=custom_data||$7::jsonb,imported_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2`, tenant.ID, line.ID, line.Name, strings.ToLower(strings.TrimSpace(line.data.Email)), telegram, line.data.Notes, custom)
		}
		if err == pgx.ErrNoRows {
			writeJSON(w, 409, map[string]string{"error": "Клиент уже добавлен. Проверьте файл заново."})
			return
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		var afterRaw []byte
		if err = tx.QueryRow(r.Context(), `SELECT to_jsonb(c)-'tenant_id' FROM customers c WHERE tenant_id=$1 AND id=$2`, tenant.ID, line.ID).Scan(&afterRaw); err != nil {
			app.publicFailure(w, err)
			return
		}
		var after map[string]any
		_ = json.Unmarshal(afterRaw, &after)
		action := "record_created"
		if line.Status == "update" {
			action = "record_updated"
		}
		details, _ := json.Marshal(map[string]any{"source": "import", "row": line.Row, "changes": auditChanges(before, after)})
		if _, err = tx.Exec(r.Context(), `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,NULLIF($2,'')::uuid,'human',$3,'customers',$4,$5)`, tenant.ID, actor.MembershipID, action, line.ID, details); err != nil {
			app.publicFailure(w, err)
			return
		}
	}
	report.Committed = true
	result, _ := json.Marshal(report)
	if _, err = tx.Exec(r.Context(), `INSERT INTO customer_import_runs(tenant_id,preview_token,source_digest,result) VALUES($1,$2,$3,$4)`, tenant.ID, report.Token, inputDigest, result); err != nil {
		app.publicFailure(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		app.publicFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 200, report)
}
