package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

type crewQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// The caller layers company-wide permissions explicitly; this function answers
// only an active trip assignment. An inactive row revokes legacy fallback.
func tripCrewCan(ctx context.Context, q crewQueryer, tenant, trip, member, capability string) (bool, error) {
	column := map[string]string{"drive": "can_drive", "collect": "can_collect", "board": "can_board", "manage": "can_manage", "gps": "can_gps", "read": "is_active"}[capability]
	if column == "" || member == "" {
		return false, nil
	}
	var allowed bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM trip_crew c JOIN memberships m ON m.id=c.membership_id AND m.tenant_id=c.tenant_id JOIN users u ON u.id=m.user_id
 WHERE c.tenant_id=$1 AND c.trip_id=$2 AND c.membership_id=$3 AND c.is_active AND m.is_active AND NOT u.is_system AND c.`+column+`) OR EXISTS(
 SELECT 1 FROM trips t JOIN drivers d ON d.id=t.driver_id AND d.tenant_id=t.tenant_id JOIN memberships m ON m.id=d.membership_id AND m.tenant_id=d.tenant_id JOIN users u ON u.id=m.user_id
 WHERE t.tenant_id=$1 AND t.id=$2 AND m.id=$3 AND m.is_active AND d.is_active AND NOT u.is_system
 AND NOT EXISTS(SELECT 1 FROM trip_crew c WHERE c.tenant_id=t.tenant_id AND c.trip_id=t.id AND c.membership_id=m.id)
 AND ($4<>'gps' OR NOT EXISTS(SELECT 1 FROM trip_crew c WHERE c.tenant_id=t.tenant_id AND c.trip_id=t.id AND c.is_active AND c.can_gps)))`, tenant, trip, member, capability).Scan(&allowed)
	return allowed, err
}

func crewCompanyManager(actor identity) bool {
	return actor.Role == "owner" || actor.Role == "admin" || actor.Role == "dispatcher" || actor.Role == "developer"
}

// Call under the tenant lock before boarding/departure. A secondary driver is
// physically unavailable too when another trip is boarding or in progress.
func tripCrewReadiness(ctx context.Context, q crewQueryer, tenant, trip string) (string, error) {
	var conflict bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM trip_crew selected JOIN memberships m ON m.id=selected.membership_id AND m.tenant_id=selected.tenant_id JOIN trip_crew other ON other.tenant_id=selected.tenant_id AND other.membership_id=selected.membership_id AND other.trip_id<>selected.trip_id JOIN trips t ON t.id=other.trip_id AND t.tenant_id=other.tenant_id WHERE selected.tenant_id=$1 AND selected.trip_id=$2 AND selected.is_active AND selected.can_drive AND m.is_active AND other.is_active AND other.can_drive AND (t.status='boarding' OR workflow_status_phase(t.tenant_id,'trips',t.status)='in_progress'))`, tenant, trip).Scan(&conflict)
	if err != nil {
		return "", err
	}
	if conflict {
		return "Участник команды с правом вождения занят посадкой или выполнением другого рейса. Сначала завершите его или смените состав команды.", nil
	}
	return "", nil
}

type tripCrewMember struct {
	MembershipID string    `json:"membershipId"`
	Name         string    `json:"name"`
	Role         string    `json:"role"`
	CanDrive     bool      `json:"canDrive"`
	CanCollect   bool      `json:"canCollect"`
	CanBoard     bool      `json:"canBoard"`
	CanManage    bool      `json:"canManage"`
	CanGPS       bool      `json:"canGPS"`
	PayMinor     int64     `json:"payMinor"`
	PayCurrency  string    `json:"payCurrency"`
	IsPrimary    bool      `json:"isPrimary"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type tripCrewPatch struct {
	MembershipID string  `json:"membershipId"`
	Role         *string `json:"role"`
	CanDrive     *bool   `json:"canDrive"`
	CanCollect   *bool   `json:"canCollect"`
	CanBoard     *bool   `json:"canBoard"`
	CanManage    *bool   `json:"canManage"`
	CanGPS       *bool   `json:"canGPS"`
	PayMinor     *int64  `json:"payMinor"`
	PayCurrency  *string `json:"payCurrency"`
	Remove       bool    `json:"remove"`
}

func (app *application) tripCrew(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	actor, ok := identityFromContext(r.Context())
	if !ok || actor.TenantID != company.ID {
		writeJSON(w, 403, map[string]string{"error": "Доступ к компании запрещён."})
		return
	}
	trip := r.PathValue("tripID")
	if !entityRecordID.MatchString(trip) {
		writeJSON(w, 400, map[string]string{"error": "Некорректный рейс."})
		return
	}
	manager := crewCompanyManager(actor)
	if !manager {
		allowed, err := tripCrewCan(r.Context(), app.db, company.ID, trip, actor.MembershipID, "read")
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		if !allowed {
			writeJSON(w, 403, map[string]string{"error": "Вы не назначены в команду этого рейса."})
			return
		}
	}
	if r.Method == "PATCH" {
		if !manager {
			writeJSON(w, 403, map[string]string{"error": "Изменять команду рейса может диспетчер, администратор или владелец."})
			return
		}
		app.patchTripCrew(w, r, company.ID, trip, actor)
		return
	}
	var phase string
	if err := app.db.QueryRow(r.Context(), `SELECT coalesce(workflow_status_phase(tenant_id,'trips',status),'') FROM trips WHERE id=$1 AND tenant_id=$2`, trip, company.ID).Scan(&phase); errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Рейс не найден."})
		return
	} else if err != nil {
		app.publicFailure(w, err)
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT c.membership_id::text,u.display_name,c.role,c.can_drive,c.can_collect,c.can_board,c.can_manage,c.can_gps,c.pay_minor,c.pay_currency,c.is_primary,c.updated_at
 FROM trip_crew c JOIN memberships m ON m.id=c.membership_id AND m.tenant_id=c.tenant_id JOIN users u ON u.id=m.user_id
 WHERE c.tenant_id=$1 AND c.trip_id=$2 AND c.is_active AND m.is_active AND NOT u.is_system ORDER BY c.is_primary DESC,c.role,u.display_name,c.membership_id`, company.ID, trip)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	items := []tripCrewMember{}
	for rows.Next() {
		var item tripCrewMember
		if err = rows.Scan(&item.MembershipID, &item.Name, &item.Role, &item.CanDrive, &item.CanCollect, &item.CanBoard, &item.CanManage, &item.CanGPS, &item.PayMinor, &item.PayCurrency, &item.IsPrimary, &item.UpdatedAt); err != nil {
			rows.Close()
			app.publicFailure(w, err)
			return
		}
		if !manager && item.MembershipID != actor.MembershipID {
			item.PayMinor = 0
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	eligible := []map[string]any{}
	if manager {
		members, e := app.db.Query(r.Context(), `SELECT m.id::text,u.display_name,m.role::text FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.is_active AND NOT u.is_system ORDER BY u.display_name,m.id`, company.ID)
		if e != nil {
			app.publicFailure(w, e)
			return
		}
		for members.Next() {
			var id, name, role string
			if e = members.Scan(&id, &name, &role); e != nil {
				break
			}
			eligible = append(eligible, map[string]any{"membershipId": id, "name": name, "role": role})
		}
		if e == nil {
			e = members.Err()
		}
		members.Close()
		if e != nil {
			app.publicFailure(w, e)
			return
		}
	}
	canEdit := manager && phase != "completed" && phase != "cancelled"
	reason := "Команду назначает владелец, администратор или диспетчер."
	if manager && !canEdit {
		reason = "Команда закрытого рейса сохранена в истории. Для расчётов используйте финансовую корректировку."
	}
	writeJSON(w, 200, map[string]any{"items": items, "eligibleMembers": eligible, "canEdit": canEdit, "canViewPay": manager, "disabledReason": reason, "membershipId": actor.MembershipID})
}

func (app *application) patchTripCrew(w http.ResponseWriter, r *http.Request, tenant, trip string, actor identity) {
	var input tripCrewPatch
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || !entityRecordID.MatchString(input.MembershipID) {
		writeJSON(w, 400, map[string]string{"error": "Выберите сотрудника и изменения команды."})
		return
	}
	if input.Role != nil && *input.Role != "driver" && *input.Role != "manager" {
		writeJSON(w, 400, map[string]string{"error": "Выберите роль: водитель или менеджер рейса."})
		return
	}
	if input.PayMinor != nil && (*input.PayMinor < 0 || *input.PayMinor > 10000000000) {
		writeJSON(w, 400, map[string]string{"error": "Проверьте сумму оплаты сотруднику."})
		return
	}
	if input.PayCurrency != nil && !validBookingCurrency(*input.PayCurrency) {
		writeJSON(w, 400, map[string]string{"error": "Выберите валюту оплаты."})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), `SELECT id FROM tenants WHERE id=$1 FOR UPDATE`, tenant); err != nil {
		app.publicFailure(w, err)
		return
	}
	var currency, phase string
	err = tx.QueryRow(r.Context(), `SELECT currency,coalesce(workflow_status_phase(tenant_id,'trips',status),'') FROM trips WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, trip, tenant).Scan(&currency, &phase)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Рейс не найден."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	// Completed payroll is immutable; a correction is a separate financial entry.
	if phase == "completed" || phase == "cancelled" {
		writeJSON(w, 409, map[string]string{"error": "Команда закрытого рейса сохранена в истории. Для расчётов используйте финансовую корректировку."})
		return
	}
	var active bool
	err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.id=$2 AND m.is_active AND NOT u.is_system)`, tenant, input.MembershipID).Scan(&active)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if !active {
		writeJSON(w, 400, map[string]string{"error": "Сотрудник неактивен или относится к другой компании."})
		return
	}
	item := tripCrewMember{MembershipID: input.MembershipID, Role: "manager", PayCurrency: currency}
	var wasActive, customPay bool
	err = tx.QueryRow(r.Context(), `SELECT role,can_drive,can_collect,can_board,can_manage,can_gps,pay_minor,pay_currency,is_primary,is_active,custom_pay FROM trip_crew WHERE tenant_id=$1 AND trip_id=$2 AND membership_id=$3 FOR UPDATE`, tenant, trip, input.MembershipID).Scan(&item.Role, &item.CanDrive, &item.CanCollect, &item.CanBoard, &item.CanManage, &item.CanGPS, &item.PayMinor, &item.PayCurrency, &item.IsPrimary, &wasActive, &customPay)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		app.publicFailure(w, err)
		return
	}
	before := item
	if input.Remove {
		if !wasActive {
			writeJSON(w, 409, map[string]string{"error": "Сотрудник уже исключён из команды."})
			return
		}
		if item.IsPrimary {
			writeJSON(w, 409, map[string]string{"error": "Сначала смените основного водителя в связанных записях рейса."})
			return
		}
		_, err = tx.Exec(r.Context(), `UPDATE trip_crew SET is_active=false,can_gps=false,updated_at=now() WHERE tenant_id=$1 AND trip_id=$2 AND membership_id=$3`, tenant, trip, input.MembershipID)
	} else {
		if input.Role != nil {
			item.Role = *input.Role
			if item.Role == "manager" {
				item.CanDrive = false
				item.CanGPS = false
			}
		}
		if input.CanDrive != nil {
			item.CanDrive = *input.CanDrive
			if !item.CanDrive {
				item.CanGPS = false
			}
		}
		if input.CanCollect != nil {
			item.CanCollect = *input.CanCollect
		}
		if input.CanBoard != nil {
			item.CanBoard = *input.CanBoard
		}
		if input.CanManage != nil {
			item.CanManage = *input.CanManage
		}
		if input.CanGPS != nil {
			item.CanGPS = *input.CanGPS
		}
		if item.CanDrive && item.Role != "driver" || item.CanGPS && (!item.CanDrive || item.Role != "driver") {
			writeJSON(w, 400, map[string]string{"error": "Передавать GPS может назначенный водитель с правом управления автомобилем."})
			return
		}
		if input.PayMinor != nil {
			item.PayMinor = *input.PayMinor
			customPay = true
		}
		if input.PayCurrency != nil {
			item.PayCurrency = *input.PayCurrency
			customPay = true
		}
		if item.CanGPS {
			_, err = tx.Exec(r.Context(), `UPDATE trip_crew SET can_gps=false,updated_at=now() WHERE tenant_id=$1 AND trip_id=$2 AND can_gps AND membership_id<>$3`, tenant, trip, input.MembershipID)
			if err != nil {
				app.publicFailure(w, err)
				return
			}
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO trip_crew(tenant_id,trip_id,membership_id,role,can_drive,can_collect,can_board,can_manage,can_gps,pay_minor,pay_currency,is_active,is_primary,custom_pay)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13)
  ON CONFLICT(tenant_id,trip_id,membership_id) DO UPDATE SET role=EXCLUDED.role,can_drive=EXCLUDED.can_drive,can_collect=EXCLUDED.can_collect,can_board=EXCLUDED.can_board,can_manage=EXCLUDED.can_manage,can_gps=EXCLUDED.can_gps,pay_minor=EXCLUDED.pay_minor,pay_currency=EXCLUDED.pay_currency,is_active=true,source_legacy=false,custom_pay=EXCLUDED.custom_pay,updated_at=now()`, tenant, trip, input.MembershipID, item.Role, item.CanDrive, item.CanCollect, item.CanBoard, item.CanManage, item.CanGPS, item.PayMinor, item.PayCurrency, item.IsPrimary, customPay)
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if !input.Remove && item.CanDrive {
		var running bool
		if err = tx.QueryRow(r.Context(), `SELECT status='boarding' OR workflow_status_phase(tenant_id,'trips',status)='in_progress' FROM trips WHERE tenant_id=$1 AND id=$2`, tenant, trip).Scan(&running); err != nil {
			app.publicFailure(w, err)
			return
		}
		if running {
			reason, e := tripCrewReadiness(r.Context(), tx, tenant, trip)
			if e != nil {
				app.publicFailure(w, e)
				return
			}
			if reason != "" {
				writeJSON(w, 409, map[string]string{"error": reason})
				return
			}
		}
	}
	action := "trip.crew_updated"
	if input.Remove {
		action = "trip.crew_removed"
	} else if !wasActive {
		action = "trip.crew_added"
	}
	changes := []auditFieldChange{}
	oldFields := map[string]any{"crew_role": before.Role, "crew_can_drive": before.CanDrive, "crew_can_collect": before.CanCollect, "crew_can_board": before.CanBoard, "crew_can_manage": before.CanManage, "crew_can_gps": before.CanGPS, "crew_pay_minor": before.PayMinor, "crew_pay_currency": before.PayCurrency, "crew_active": wasActive}
	newFields := map[string]any{"crew_role": item.Role, "crew_can_drive": item.CanDrive, "crew_can_collect": item.CanCollect, "crew_can_board": item.CanBoard, "crew_can_manage": item.CanManage, "crew_can_gps": item.CanGPS, "crew_pay_minor": item.PayMinor, "crew_pay_currency": item.PayCurrency, "crew_active": !input.Remove}
	for _, key := range []string{"crew_role", "crew_can_drive", "crew_can_collect", "crew_can_board", "crew_can_manage", "crew_can_gps", "crew_pay_minor", "crew_pay_currency", "crew_active"} {
		if oldFields[key] != newFields[key] {
			changes = append(changes, auditFieldChange{Field: key, Before: oldFields[key], After: newFields[key]})
		}
	}
	details, _ := json.Marshal(map[string]any{"membershipId": input.MembershipID, "changes": changes})
	_, err = tx.Exec(r.Context(), `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,NULLIF($2,'')::uuid,'human',$3,'trips',$4,$5)`, tenant, actor.MembershipID, action, trip, details)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		app.publicFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 200, map[string]any{"item": item, "removed": input.Remove})
}

// Includes completed assignments so staff can settle outstanding receipts.
func (app *application) myCrewTrips(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "Войдите в аккаунт."})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT t.id::text,t.origin_name,t.destination_name,t.starts_at,t.ends_at,t.status,coalesce(workflow_status_phase(t.tenant_id,'trips',t.status),''),t.currency,coalesce(t.vehicle_id::text,''),coalesce(v.name,''),c.role,c.can_drive,c.can_collect,c.can_board,c.can_manage,c.can_gps,c.pay_minor,c.pay_currency
 FROM trip_crew c JOIN trips t ON t.id=c.trip_id AND t.tenant_id=c.tenant_id JOIN memberships m ON m.id=c.membership_id AND m.tenant_id=c.tenant_id LEFT JOIN vehicles v ON v.id=t.vehicle_id AND v.tenant_id=t.tenant_id
 WHERE c.tenant_id=$1 AND c.membership_id=$2 AND c.is_active AND m.is_active AND workflow_status_phase(t.tenant_id,'trips',t.status)<>'cancelled' ORDER BY t.starts_at DESC LIMIT 200`, actor.TenantID, actor.MembershipID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, origin, destination, status, statusPhase, currency, vehicleID, vehicle, role, payCurrency string
		var starts, ends time.Time
		var drive, collect, board, manage, gps bool
		var pay int64
		if err = rows.Scan(&id, &origin, &destination, &starts, &ends, &status, &statusPhase, &currency, &vehicleID, &vehicle, &role, &drive, &collect, &board, &manage, &gps, &pay, &payCurrency); err != nil {
			app.publicFailure(w, err)
			return
		}
		items = append(items, map[string]any{"id": id, "origin": origin, "destination": destination, "startsAt": starts, "endsAt": ends, "status": status, "statusPhase": statusPhase, "currency": currency, "vehicleId": vehicleID, "vehicle": vehicle, "role": role, "canDrive": drive, "canCollect": collect, "canBoard": board, "canManage": manage, "canGPS": gps, "payMinor": pay, "payCurrency": payCurrency})
	}
	if err = rows.Err(); err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "membershipId": actor.MembershipID})
}

func tripCrewOwnsPrimaryPayroll(ctx context.Context, q crewQueryer, tenant, trip string) (bool, error) {
	var owns bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM trip_crew c WHERE tenant_id=$1 AND trip_id=$2 AND is_primary AND is_active AND custom_pay)`, tenant, trip).Scan(&owns)
	return owns, err
}

// Manager payroll uses the same cash journal as driver payroll, without requiring
// a fictional driver profile. Linked drivers remain on the existing payroll API.
func (app *application) crewPayroll(w http.ResponseWriter, r *http.Request) {
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
	if r.Method == "GET" {
		rows, err := app.db.Query(r.Context(), `SELECT c.id::text,c.trip_id::text,c.membership_id::text,coalesce(u.display_name,'Удалённый сотрудник'),c.gross_minor,c.currency,c.gross_minor-coalesce((SELECT sum(p.amount_minor) FROM crew_payroll_payouts p WHERE p.tenant_id=c.tenant_id AND p.accrual_id=c.id),0),c.occurred_at FROM crew_payroll_accruals c LEFT JOIN memberships m ON m.id=c.membership_id AND m.tenant_id=c.tenant_id LEFT JOIN users u ON u.id=m.user_id WHERE c.tenant_id=$1 AND ($2 OR c.membership_id=$3) AND NOT EXISTS(SELECT 1 FROM driver_payroll_accruals d WHERE d.tenant_id=c.tenant_id AND d.expense_id=c.expense_id) ORDER BY c.occurred_at DESC LIMIT 200`, company.ID, moneyViewer(actor), actor.MembershipID)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, trip, member, name, currency string
			var gross, due int64
			var at time.Time
			if err = rows.Scan(&id, &trip, &member, &name, &gross, &currency, &due, &at); err != nil {
				app.publicFailure(w, err)
				return
			}
			items = append(items, map[string]any{"id": id, "tripId": trip, "membershipId": member, "name": name, "grossMinor": gross, "dueMinor": due, "currency": currency, "occurredAt": at})
		}
		if err = rows.Err(); err != nil {
			app.publicFailure(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "canPay": moneyManager(actor)})
		return
	}
	if !moneyManager(actor) {
		writeJSON(w, 403, map[string]string{"error": "Выплату проводит владелец или администратор."})
		return
	}
	var in struct {
		AccrualID string `json:"accrualId"`
		AccountID string `json:"accountId"`
		Amount    int64  `json:"amountMinor"`
		RequestID string `json:"requestId"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || !validUUID(in.AccrualID) || !validUUID(in.AccountID) || !validUUID(in.RequestID) || in.Amount <= 0 || in.Amount > 10000000000 {
		writeJSON(w, 400, map[string]string{"error": "Выберите начисление, кошелёк и сумму выплаты."})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	ctx := r.Context()
	if _, err = tx.Exec(ctx, `SELECT id FROM tenants WHERE id=$1 FOR UPDATE`, company.ID); err != nil {
		app.publicFailure(w, err)
		return
	}
	var priorID, priorAccrual, priorActor, priorAccount string
	var priorAmount int64
	err = tx.QueryRow(ctx, `SELECT p.id::text,p.accrual_id::text,p.actor_membership_id::text,p.amount_minor,(SELECT account_id::text FROM money_postings WHERE tenant_id=p.tenant_id AND journal_id=p.journal_id AND amount_minor<0 LIMIT 1) FROM crew_payroll_payouts p WHERE p.tenant_id=$1 AND p.request_id=$2`, company.ID, in.RequestID).Scan(&priorID, &priorAccrual, &priorActor, &priorAmount, &priorAccount)
	if err == nil {
		if priorAccrual != in.AccrualID || priorActor != actor.MembershipID || priorAmount != in.Amount || priorAccount != in.AccountID {
			writeJSON(w, 409, map[string]string{"error": "Номер выплаты уже использован с другими данными."})
			return
		}
		writeJSON(w, 200, map[string]string{"id": priorID})
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		app.publicFailure(w, err)
		return
	}
	var trip, currency string
	var due int64
	err = tx.QueryRow(ctx, `SELECT c.trip_id::text,c.currency,c.gross_minor-coalesce((SELECT sum(amount_minor) FROM crew_payroll_payouts WHERE tenant_id=c.tenant_id AND accrual_id=c.id),0) FROM crew_payroll_accruals c WHERE c.tenant_id=$1 AND c.id=$2 AND NOT EXISTS(SELECT 1 FROM driver_payroll_accruals d WHERE d.tenant_id=c.tenant_id AND d.expense_id=c.expense_id) FOR UPDATE`, company.ID, in.AccrualID).Scan(&trip, &currency, &due)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Начисление менеджеру рейса не найдено. Выплаты водителям доступны в зарплате водителей."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	source, err := moneyWalletLoad(ctx, tx, company.ID, in.AccountID)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "Кошелёк не найден."})
		return
	}
	if !moneySpend(actor, source) {
		writeJSON(w, 403, map[string]string{"error": "Нет права расходовать деньги из этого кошелька."})
		return
	}
	if source.Currency != currency || in.Amount > due {
		writeJSON(w, 400, map[string]string{"error": "Валюта должна совпадать с начислением, сумма — не превышать остаток зарплаты."})
		return
	}
	available, err := moneyAccountAvailable(ctx, tx, company.ID, source.Kind, source.Owner, currency)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if available < in.Amount {
		writeJSON(w, 409, map[string]string{"error": "Недостаточно свободных денег в выбранном кошельке."})
		return
	}
	system, err := moneyAccount(ctx, tx, company.ID, "system", company.ID, currency)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	journal, err := moneyPost(ctx, tx, actor, "salary_payment", "crew-payout:"+in.RequestID, "Выплата менеджеру рейса", trip, "", time.Now(), map[string]int64{source.ID: -in.Amount, system: in.Amount})
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO crew_payroll_payouts(tenant_id,accrual_id,journal_id,amount_minor,currency,actor_membership_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`, company.ID, in.AccrualID, journal, in.Amount, currency, actor.MembershipID, in.RequestID).Scan(&id)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,$2,'human','trip.crew_pay_paid','trips',$3,jsonb_build_object('accrualId',$4::text,'amountMinor',$5::bigint,'currency',$6::text))`, company.ID, actor.MembershipID, trip, in.AccrualID, in.Amount, currency)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 200, map[string]string{"id": id})
}

// Must be called inside completion transaction, after legacy primary accrual.
func (app *application) accrueTripCrewPay(ctx context.Context, tx pgx.Tx, tenant, trip string, actor identity) error {
	var phase string
	if err := tx.QueryRow(ctx, `SELECT coalesce(workflow_status_phase(tenant_id,'trips',status),'') FROM trips WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, trip).Scan(&phase); err != nil {
		return err
	}
	if phase != "completed" {
		return errors.New("crew payroll requires a completed trip")
	}
	rows, err := tx.Query(ctx, `SELECT c.membership_id::text,c.pay_minor,c.pay_currency,coalesce(d.id::text,''),u.display_name
 FROM trip_crew c JOIN memberships m ON m.id=c.membership_id AND m.tenant_id=c.tenant_id JOIN users u ON u.id=m.user_id LEFT JOIN drivers d ON d.membership_id=c.membership_id AND d.tenant_id=c.tenant_id
 WHERE c.tenant_id=$1 AND c.trip_id=$2 AND c.is_active AND c.pay_minor>0 AND (NOT c.is_primary OR c.custom_pay)
 ORDER BY c.membership_id`, tenant, trip)
	if err != nil {
		return err
	}
	type pay struct {
		member, driver, name, currency string
		amount                         int64
	}
	items := []pay{}
	for rows.Next() {
		var p pay
		if err = rows.Scan(&p.member, &p.amount, &p.currency, &p.driver, &p.name); err != nil {
			rows.Close()
			return err
		}
		items = append(items, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, p := range items {
		var already bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM crew_payroll_accruals WHERE tenant_id=$1 AND trip_id=$2 AND membership_id=$3)`, tenant, trip, p.member).Scan(&already); err != nil {
			return err
		}
		if already {
			continue
		}
		key := "crew-pay:" + trip + ":" + p.member
		category := "crew_pay"
		if p.driver != "" {
			category = "driver_pay"
		}
		var expense string
		err = tx.QueryRow(ctx, `INSERT INTO operational_expenses(tenant_id,trip_id,driver_id,category,amount_minor,currency,description,occurred_at,source_key,actor_membership_id,payment_source)
  VALUES($1,$2,NULLIF($3,'')::uuid,$4,$5,$6,$7,now(),$8,NULLIF($9,'')::uuid,'unallocated')
  ON CONFLICT(tenant_id,source_key) WHERE source_key IS NOT NULL DO UPDATE SET source_key=EXCLUDED.source_key RETURNING id::text`, tenant, trip, p.driver, category, p.amount, p.currency, "Начислена оплата команды: "+p.name, key, actor.MembershipID).Scan(&expense)
		if err != nil {
			return err
		}
		tag, e := tx.Exec(ctx, `INSERT INTO crew_payroll_accruals(tenant_id,trip_id,membership_id,expense_id,gross_minor,currency,occurred_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(tenant_id,trip_id,membership_id) DO NOTHING`, tenant, trip, p.member, expense, p.amount, p.currency)
		if e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		if p.driver != "" {
			if err = app.ensurePayrollAccrual(ctx, tx, tenant, expense); err != nil {
				return err
			}
		}
		data, _ := json.Marshal(map[string]any{"membershipId": p.member, "finance": map[string]any{"amountMinor": p.amount, "currency": p.currency}})
		if _, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,NULLIF($2,'')::uuid,'human','trip.crew_pay_accrued','trips',$3,$4)`, tenant, actor.MembershipID, trip, data); err != nil {
			return fmt.Errorf("crew payroll activity: %w", err)
		}
	}
	return nil
}
