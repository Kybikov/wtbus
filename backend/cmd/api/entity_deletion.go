package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// A developer can remove operational data in their company, irrespective of
// workflow phase. Dependencies are previewed and confirmed, never guessed by UI.
var deletionTables = map[string]string{
	"customers": "customers", "trips": "trips", "bookings": "bookings",
	"routes": "routes", "fleet": "vehicles", "requests": "individual_transfer_requests",
	"availability": "availability_blocks",
}

type deletionEffect struct {
	Label     string `json:"label"`
	Count     int64  `json:"count"`
	Operation string `json:"operation"`
}
type deletionPreview struct {
	Token   string           `json:"token"`
	Effects []deletionEffect `json:"effects"`
}
type deletionSet struct{ table, predicate, entity, label, operation string }

func deletionSets(entity string) []deletionSet {
	table := deletionTables[entity]
	sets := []deletionSet{{table, "t.id=$1::uuid", entity, "Выбранная запись", "delete"}}
	bookings := ""
	switch entity {
	case "customers":
		bookings = "t.customer_id=$1::uuid"
		sets = append(sets, deletionSet{"individual_transfer_requests", "t.customer_id=$1::uuid", "requests", "Заявки клиента", "delete"})
	case "trips":
		bookings = "t.trip_id=$1::uuid"
	case "bookings":
		bookings = "t.id=$1::uuid"
	case "routes":
		sets = append(sets, deletionSet{"availability_blocks", "t.route_id=$1::uuid", "availability", "Блокировки маршрута", "delete"}, deletionSet{"trips", "t.route_id=$1::uuid", "trips", "Рейсы сохранятся без привязки к маршруту", "unlink"})
	case "fleet":
		sets = append(sets, deletionSet{"gps_points", "t.vehicle_id=$1::uuid", "", "Точки GPS автомобиля", "delete"}, deletionSet{"trips", "t.vehicle_id=$1::uuid", "trips", "Рейсы сохранятся без привязки к автомобилю", "unlink"})
	}
	if bookings != "" {
		if entity != "bookings" {
			sets = append(sets, deletionSet{"bookings", bookings, "bookings", "Бронирования", "delete"})
		}
		bookingSelection := "SELECT t.id FROM bookings t WHERE t.tenant_id=$2::uuid AND " + bookings
		sets = append(sets, deletionSet{"payments", "t.booking_id IN (" + bookingSelection + ")", "payments", "Платёжные записи в CRM", "delete"})
		if entity != "customers" {
			sets = append(sets, deletionSet{"individual_transfer_requests", "t.booking_id IN (" + bookingSelection + ")", "requests", "Заявки сохранятся без привязки к бронированию", "unlink"})
		}
	}
	return sets
}

func readDeletionPreview(ctx context.Context, tx pgx.Tx, entity, id, tenant string) (deletionPreview, error) {
	result := deletionPreview{Effects: []deletionEffect{}}
	hash := sha256.New()
	hash.Write([]byte(tenant + ":" + entity + ":" + id))
	for index, set := range deletionSets(entity) {
		var count int64
		var fingerprint string
		// Hash full row versions internally, exposing only a digest. IDs and values
		// in a changed dependency invalidate consent even if its count stays equal.
		err := tx.QueryRow(ctx, "SELECT count(*),coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id)),md5('')) FROM "+set.table+" t WHERE t.tenant_id=$2::uuid AND "+set.predicate, id, tenant).Scan(&count, &fingerprint)
		if err != nil {
			return result, err
		}
		if index == 0 && count == 0 {
			return result, pgx.ErrNoRows
		}
		hash.Write([]byte(set.table + ":" + set.operation + ":" + fingerprint))
		if count > 0 {
			result.Effects = append(result.Effects, deletionEffect{set.label, count, set.operation})
		}
	}
	result.Token = hex.EncodeToString(hash.Sum(nil))
	return result, nil
}

func (app *application) entityDeletion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "Войдите в аккаунт."})
		return
	}
	if actor.Role != "developer" {
		writeJSON(w, 403, map[string]string{"error": "Удаление доступно только разработчику."})
		return
	}
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	if actor.TenantID != company.ID {
		writeJSON(w, 403, map[string]string{"error": "Нет доступа к компании."})
		return
	}
	entity, id := r.PathValue("entity"), r.PathValue("recordID")
	table, exists := deletionTables[entity]
	if !exists {
		writeJSON(w, 404, map[string]string{"error": "Удаление этой записи недоступно."})
		return
	}
	if !entityRecordID.MatchString(id) {
		writeJSON(w, 400, map[string]string{"error": "Некорректный ID записи."})
		return
	}
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
		var found string
		err = tx.QueryRow(r.Context(), "SELECT id::text FROM "+table+" WHERE id=$1 AND tenant_id=$2 FOR UPDATE", id, company.ID).Scan(&found)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 404, map[string]string{"error": "Запись уже удалена."})
			return
		}
		if err != nil {
			app.deletionFailure(w, err)
			return
		}
	}
	preview, err := readDeletionPreview(r.Context(), tx, entity, id, company.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Запись не найдена."})
		return
	}
	if err != nil {
		app.deletionFailure(w, err)
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
	if err = decoder.Decode(&input); err != nil || input.Token == "" {
		writeJSON(w, 400, map[string]string{"error": "Подтвердите состав удаляемых записей."})
		return
	}
	if input.Token != preview.Token {
		writeJSON(w, 409, map[string]string{"error": "Запись или её связи изменились. Проверьте состав удаления ещё раз."})
		return
	}

	sets := deletionSets(entity)
	// Children before parents; FK SET NULL keeps independent trips, GPS history,
	// cash ledger and expenses intact. No dynamic client table or predicate enters SQL.
	for _, kind := range []string{"payments", "bookings", "individual_transfer_requests", "availability_blocks", "gps_points"} {
		for index, set := range sets {
			if index == 0 || set.operation != "delete" || set.table != kind {
				continue
			}
			if err = app.deleteRecordSet(r.Context(), tx, set, id, company.ID, actor); err != nil {
				app.deletionFailure(w, err)
				return
			}
		}
	}
	// Remove the selected parent only after its explicitly previewed children.
	if err = app.deleteRecordSet(r.Context(), tx, sets[0], id, company.ID, actor); err != nil {
		app.deletionFailure(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		app.deletionFailure(w, err)
		return
	}
	if capture, _ := r.Context().Value(auditContextKey{}).(*auditCapture); capture != nil {
		capture.activityRecorded = true
	}
	writeJSON(w, 200, map[string]any{"id": id, "deleted": true})
}

func (app *application) deleteRecordSet(ctx context.Context, tx pgx.Tx, set deletionSet, id, tenant string, actor identity) error {
	rows, err := tx.Query(ctx, "DELETE FROM "+set.table+" t WHERE t.tenant_id=$2::uuid AND "+set.predicate+" RETURNING id::text", id, tenant)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var removed string
		if err = rows.Scan(&removed); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, removed)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if set.entity == "" {
		return nil
	}
	// An activity row per removed business record survives the deletion. No raw
	// passenger data, credentials or provider payload is copied into the log.
	_, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) SELECT $1::uuid,$2::uuid,'human','record_deleted',$3,x,jsonb_build_object('deletedFrom',$4::text) FROM unnest($5::text[]) x`, tenant, actor.MembershipID, set.entity, id, ids)
	return err
}

func (app *application) deletionFailure(w http.ResponseWriter, err error) {
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && (pgerr.Code == "40001" || pgerr.Code == "40P01" || pgerr.Code == "23503") {
		writeJSON(w, 409, map[string]string{"error": "Связанные записи изменились. Обновите состав удаления и повторите попытку."})
		return
	}
	app.publicFailure(w, err)
}
