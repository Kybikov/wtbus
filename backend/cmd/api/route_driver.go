package main

import "net/http"

func routeDefaultDriverValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
func (app *application) validateRouteDefaultDriver(w http.ResponseWriter, r *http.Request, tenant string, value *string) bool {
	if value == nil || *value == "" {
		return true
	}
	if !publicUUID.MatchString(*value) {
		writeJSON(w, 400, map[string]string{"error": "Выберите основного водителя из команды."})
		return false
	}
	var available bool
	err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM drivers d JOIN memberships m ON m.id=d.membership_id AND m.tenant_id=d.tenant_id JOIN users u ON u.id=m.user_id WHERE d.id=$1 AND d.tenant_id=$2 AND d.is_active AND m.is_active AND m.role::text IN ('driver','developer') AND NOT u.is_system)`, *value, tenant).Scan(&available)
	if err != nil {
		app.publicFailure(w, err)
		return false
	}
	if !available {
		writeJSON(w, 400, map[string]string{"error": "Выберите активного водителя с доступом из этой компании."})
		return false
	}
	return true
}

func (app *application) fillTripDefaultDriver(w http.ResponseWriter, r *http.Request, tenant string, input *createTripRequest) bool {
	if input.DriverID != "" || input.RouteID == "" {
		return true
	}
	err := app.db.QueryRow(r.Context(), `SELECT COALESCE(default_driver_id::text,'') FROM routes WHERE id=$1 AND tenant_id=$2 AND is_active`, input.RouteID, tenant).Scan(&input.DriverID)
	if err != nil {
		app.writeResourceLookupError(w, err, "route")
		return false
	}
	return true
}
