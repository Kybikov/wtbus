package main

import (
	"testing"
	"time"
)

func TestFlexibleTripRecurrence(t *testing.T) {
	zone, err := time.LoadLocation("Europe/Warsaw")
	if err != nil {
		t.Fatal(err)
	}
	parse := func(value string) time.Time {
		v, e := time.ParseInLocation("2006-01-02T15:04", value, zone)
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	for _, tc := range []struct {
		name, start, until, freq string
		interval, monthDay       int
		days                     map[time.Weekday]struct{}
		want                     []string
	}{
		{"every two weeks", "2026-11-02T09:00", "2026-11-30T00:00", "weekly", 2, 0, map[time.Weekday]struct{}{time.Monday: {}, time.Wednesday: {}}, []string{"11-02 09:00", "11-04 09:00", "11-16 09:00", "11-18 09:00", "11-30 09:00"}},
		{"first departure anchors week windows", "2026-11-04T09:00", "2026-11-23T00:00", "weekly", 2, 0, map[time.Weekday]struct{}{time.Monday: {}}, []string{"11-04 09:00", "11-09 09:00", "11-23 09:00"}},
		{"custom monthly day does not remove the first trip", "2027-01-20T09:00", "2027-03-15T00:00", "monthly", 1, 15, nil, []string{"01-20 09:00", "02-15 09:00", "03-15 09:00"}},
		{"monthly short month", "2027-01-31T09:00", "2027-03-31T00:00", "monthly", 1, 31, nil, []string{"01-31 09:00", "02-28 09:00", "03-31 09:00"}},
		{"every two months leap day", "2027-12-31T09:00", "2028-04-30T00:00", "monthly", 2, -1, nil, []string{"12-31 09:00", "02-29 09:00", "04-30 09:00"}},
		{"daily across DST", "2027-03-27T09:00", "2027-03-29T00:00", "daily", 1, 0, nil, []string{"03-27 09:00", "03-28 09:00", "03-29 09:00"}},
		{"nonexistent departure skipped", "2027-03-27T02:30", "2027-03-29T00:00", "daily", 1, 0, nil, []string{"03-27 02:30", "03-29 02:30"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			start := parse(tc.start)
			got := expandTripRecurrence(start, start.Add(2*time.Hour), parse(tc.until), tc.days, tc.freq, tc.interval, tc.monthDay)
			if len(got) != len(tc.want) {
				t.Fatalf("count %d want %d: %+v", len(got), len(tc.want), got)
			}
			for i, item := range got {
				if item.startsAt.Format("01-02 15:04") != tc.want[i] || item.endsAt.Sub(item.startsAt) != 2*time.Hour {
					t.Fatalf("occurrence%d: %+v", i, item)
				}
			}
		})
	}
}
