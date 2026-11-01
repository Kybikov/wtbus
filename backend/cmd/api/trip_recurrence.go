package main

import "time"

// Calendar arithmetic preserves local departure time across DST. Weeks start
// Monday; month days beyond the month's end use its final day.
func expandTripRecurrence(startsAt, endsAt, until time.Time, weekdays map[time.Weekday]struct{}, frequency string, interval, monthDay int) []scheduledTripInstance {
	if interval < 1 {
		interval = 1
	}
	if monthDay == 0 {
		monthDay = startsAt.Day()
	}
	location := startsAt.Location()
	first := time.Date(startsAt.Year(), startsAt.Month(), startsAt.Day(), 0, 0, 0, 0, location)
	weekOffset := (int(first.Weekday()) + 6) % 7
	result := make([]scheduledTripInstance, 0)
	for day, index := first, 0; !day.After(until); day, index = day.AddDate(0, 0, 1), index+1 {
		match := false
		switch frequency {
		case "daily":
			match = index%interval == 0
		case "weekly":
			_, selected := weekdays[day.Weekday()]
			match = selected && ((index+weekOffset)/7)%interval == 0
		case "monthly":
			months := (day.Year()-first.Year())*12 + int(day.Month()-first.Month())
			last := time.Date(day.Year(), day.Month()+1, 0, 0, 0, 0, 0, location).Day()
			selected := monthDay
			if selected == -1 || selected > last {
				selected = last
			}
			match = months%interval == 0 && day.Day() == selected
		}
		if !match {
			continue
		}
		start := time.Date(day.Year(), day.Month(), day.Day(), startsAt.Hour(), startsAt.Minute(), 0, 0, location)
		// Do not silently move an impossible spring-forward time to another hour.
		if start.Hour() != startsAt.Hour() || start.Minute() != startsAt.Minute() {
			continue
		}
		result = append(result, scheduledTripInstance{startsAt: start, endsAt: start.Add(endsAt.Sub(startsAt))})
	}
	return result
}
