package notificationprefs

import (
	"encoding/json"
	"testing"
	"time"
)

func TestChannelsAndRoles(t *testing.T) {
	p := Defaults(map[string]bool{"trips": false})
	if p.Enabled("tripAssigned", "trips", "push") || !p.Enabled("tripAssigned", "trips", "telegram") {
		t.Fatal("legacy push preference leaked across channels")
	}
	p.Events["tripAssigned"] = Channels{Push: true, Telegram: false}
	raw, _ := json.Marshal(p)
	loaded := Load(raw, map[string]bool{"trips": false})
	if !loaded.Enabled("tripAssigned", "trips", "push") || loaded.Enabled("tripAssigned", "trips", "telegram") {
		t.Fatal("per-event preference lost")
	}
	for _, role := range []string{"owner", "admin", "developer"} {
		if !Allowed(role, "payments") || !Allowed(role, "team") {
			t.Fatal(role)
		}
	}
	if Allowed("driver", "payments") || Allowed("dispatcher", "team") || Allowed("dispatcher", "payments") || Allowed("unknown", "trips") {
		t.Fatal("role scope expanded")
	}
	if Validate(p) != nil {
		t.Fatal("valid preferences rejected")
	}
	p.Events["unknown"] = Channels{}
	if Validate(p) == nil {
		t.Fatal("unknown event accepted")
	}
}
func TestQuietHoursOvernightAndDST(t *testing.T) {
	p := Defaults(nil)
	p.Quiet.Enabled = true
	p.Quiet.Days = []int{1}
	p.Quiet.Timezone = "Europe/Berlin"
	for _, tc := range []struct{ now, want string }{
		{"2026-10-19T19:00:00+02:00", "2026-10-19T19:00:00+02:00"},
		{"2026-10-19T21:00:00+02:00", "2026-10-20T08:00:00+02:00"},
		{"2026-10-20T07:59:00+02:00", "2026-10-20T08:00:00+02:00"},
		{"2026-10-20T08:00:00+02:00", "2026-10-20T08:00:00+02:00"},
		{"2026-10-20T21:00:00+02:00", "2026-10-20T21:00:00+02:00"},
	} {
		now, _ := time.Parse(time.RFC3339, tc.now)
		want, _ := time.Parse(time.RFC3339, tc.want)
		if got := p.ResumeAt(now); !got.Equal(want) {
			t.Fatalf("%s: %s != %s", tc.now, got, want)
		}
	}
	p.Quiet.Days = []int{6}
	now, _ := time.Parse(time.RFC3339, "2026-10-24T21:00:00+02:00")
	want, _ := time.Parse(time.RFC3339, "2026-10-25T08:00:00+01:00")
	if !p.ResumeAt(now).Equal(want) {
		t.Fatal("DST boundary changed local quiet end")
	}
	p.Quiet.Enabled = false
	if !p.ResumeAt(now).Equal(now) {
		t.Fatal("disabled quiet hours deferred")
	}
	p.Quiet.Timezone = "bad/timezone"
	if Validate(p) == nil {
		t.Fatal("bad timezone accepted")
	}
	p.Quiet.Timezone = "UTC"
	p.Quiet.Start = p.Quiet.End
	if Validate(p) == nil {
		t.Fatal("zero-length quiet range accepted")
	}
}
