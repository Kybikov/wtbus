// Package telegramoutbox defines durable events sent by the booking bot.
package telegramoutbox

import "time"

const (
	KindTripStatus                 = "trip_status"
	KindIndividualTransferRequest = "individual_transfer_request_status"
)

// TripStatusPayload contains only passenger-safe trip data.
type TripStatusPayload struct {
	Status      string    `json:"status"`
	Origin      string    `json:"origin"`
	Destination string    `json:"destination"`
	StartsAt    time.Time `json:"startsAt"`
	Vehicle     string    `json:"vehicle,omitempty"`
	Driver      string    `json:"driver,omitempty"`
	DriverPhone string    `json:"driverPhone,omitempty"`
}

// IndividualTransferRequestPayload contains the passenger-safe request context
// needed to acknowledge a dispatcher's status decision in Telegram.
type IndividualTransferRequestPayload struct {
	Status               string    `json:"status"`
	Origin               string    `json:"origin"`
	Destination          string    `json:"destination"`
	RequestedDepartureAt time.Time `json:"requestedDepartureAt"`
}
