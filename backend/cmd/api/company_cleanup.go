package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

func deletionTenantScope(table string) string {
	switch table {
	case "app_notifications":
		return "t.membership_id IN (SELECT id FROM memberships WHERE tenant_id=$2::uuid)"
	case "push_jobs":
		return "t.notification_id IN (SELECT n.id FROM app_notifications n JOIN memberships m ON m.id=n.membership_id WHERE m.tenant_id=$2::uuid)"
	default:
		return "t.tenant_id=$2::uuid"
	}
}

// Child-first, explicit allowlist. Users, memberships, sessions, company settings,
// bank connection/cursor, saved views, number counters and audit history survive.
func companyCleanupSets() []deletionSet {
	entries := []struct{ table, entity, label string }{
		{"public_booking_requests", "", "Запросы публичного бронирования"},
		{"individual_transfer_requests", "requests", "Индивидуальные заявки"},
		{"driver_booking_checkins", "", "Отметки посадки и получения наличных"},
		{"payments", "payments", "Платёжные записи в CRM"},
		{"driver_payroll_accruals", "payroll_accruals", "Начисления зарплаты"},
		{"driver_payroll_payouts", "payroll_payouts", "Выплаты зарплаты"},
		{"finance_tax_payments", "tax_payments", "Налоговые выплаты"},
		{"driver_cash_ledger", "driver_cash", "Движение наличных водителей"},
		{"driver_cash_handovers", "cash_handovers", "Передачи наличных"},
		{"company_cash_receipts", "cash_receipts", "Приходы в кассу"},
		{"operational_expenses", "expenses", "Расходы"},
		{"bank_statement_transactions", "bank_transactions", "Банковская выписка в CRM"},
		{"finance_review_marks", "", "Отметки проверки финансов"},
		{"finance_operation_requests", "", "Запросы финансовых операций"},
		{"driver_payroll_settings", "", "Расчётные параметры удаляемых водителей"},
		{"bookings", "bookings", "Бронирования"},
		{"gps_points", "", "Точки GPS"},
		{"availability_blocks", "availability", "Блокировки маршрутов"},
		{"trips", "trips", "Рейсы"},
		{"vehicles", "fleet", "Автомобили"},
		{"routes", "routes", "Маршруты"},
		{"customers", "customers", "Клиенты и пассажиры"},
		{"drivers", "drivers", "Профили водителей"},
		{"telegram_notification_outbox", "", "Очередь сообщений по старым записям"},
		{"push_jobs", "", "Очередь push-уведомлений"},
		{"app_notifications", "", "Уведомления по старым записям"},
		{"realtime_events", "", "События обновления старых записей"},
	}
	sets := make([]deletionSet, 0, len(entries))
	for _, entry := range entries {
		sets = append(sets, deletionSet{entry.table, "$1::uuid=$2::uuid", entry.entity, entry.label, "delete"})
	}
	return sets
}

func (app *application) companyCleanup(w http.ResponseWriter, r *http.Request, tenant string, actor identity) {
	options := pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	if r.Method == http.MethodDelete {
		options = pgx.TxOptions{IsoLevel: pgx.Serializable}
	}
	tx, err := app.db.BeginTx(r.Context(), options)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if r.Method == http.MethodDelete {
		// Prevent inserts between preview validation and deletion, including children
		// written by background jobs. All table names are from the server allowlist.
		tables := []string{"memberships"}
		for _, set := range companyCleanupSets() {
			tables = append(tables, set.table)
		}
		sort.Strings(tables)
		if _, err = tx.Exec(r.Context(), "SET LOCAL lock_timeout='5s'"); err == nil {
			_, err = tx.Exec(r.Context(), "LOCK TABLE "+strings.Join(tables, ",")+" IN SHARE ROW EXCLUSIVE MODE")
		}
		if err != nil {
			app.deletionFailure(w, err)
			return
		}
	}
	preview, err := readDeletionPreview(r.Context(), tx, "company", tenant, tenant)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if r.Method == http.MethodGet {
		writeJSON(w, 200, preview)
		return
	}
	if r.Method != http.MethodDelete {
		writeJSON(w, 405, map[string]string{"error": "Метод недоступен."})
		return
	}
	var input struct {
		Token string `json:"token"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || input.Token == "" {
		writeJSON(w, 400, map[string]string{"error": "Подтвердите состав очищаемых данных."})
		return
	}
	if input.Token != preview.Token {
		writeJSON(w, 409, map[string]string{"error": "Данные компании изменились. Обновите состав очистки."})
		return
	}
	for _, set := range companyCleanupSets() {
		if err = app.deleteRecordSet(r.Context(), tx, set, tenant, tenant, actor); err != nil {
			app.deletionFailure(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		app.deletionFailure(w, err)
		return
	}
	if capture, _ := r.Context().Value(auditContextKey{}).(*auditCapture); capture != nil {
		capture.activityRecorded = true
	}
	writeJSON(w, 200, map[string]bool{"deleted": true})
}
