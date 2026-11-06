package main

// The workflow phase defines whether a trip has departed. Labels such as
// boarding, delayed and company-specific statuses must follow that same rule.
func tripEditRestriction(role, phase string, terminal bool) string {
	if role == "developer" {
		return ""
	}
	if !terminal && (phase == "planned" || phase == "assigned") {
		return ""
	}
	if terminal || phase == "completed" || phase == "cancelled" {
		return "Рейс закрыт. Изменение его деталей недоступно."
	}
	if phase == "in_progress" {
		return "Рейс уже в пути. Изменять его детали можно до начала движения."
	}
	return "Детали можно менять у запланированного рейса до начала движения."
}
