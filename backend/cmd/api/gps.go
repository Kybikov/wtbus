package main

import (
	"math"
	"regexp"
	"time"
)

var gpsUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func validGPSPoint(point gpsPointRequest, now time.Time) bool {
	if !gpsUUID.MatchString(point.VehicleID) || (point.TripID != "" && !gpsUUID.MatchString(point.TripID)) {
		return false
	}
	if point.ClientPointID != "" && (!gpsUUID.MatchString(point.ClientPointID) || point.RecordedAt == nil || !gpsUUID.MatchString(point.MembershipID)) {
		return false
	}
	if point.MembershipID != "" && !gpsUUID.MatchString(point.MembershipID) {
		return false
	}
	if math.IsNaN(point.Latitude) || math.IsInf(point.Latitude, 0) || math.Abs(point.Latitude) > 90 ||
		math.IsNaN(point.Longitude) || math.IsInf(point.Longitude, 0) || math.Abs(point.Longitude) > 180 {
		return false
	}
	if point.AccuracyMeters != nil && (math.IsNaN(*point.AccuracyMeters) || math.IsInf(*point.AccuracyMeters, 0) || *point.AccuracyMeters < 0 || *point.AccuracyMeters > 10000) {
		return false
	}
	return point.RecordedAt == nil || (!point.RecordedAt.Before(now.Add(-48*time.Hour)) && !point.RecordedAt.After(now.Add(5*time.Minute)))
}
