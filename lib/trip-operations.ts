export type TripOperations = {
  serverNow: string
  boardingStartedAt?: string
  departedAt?: string
  completedAt?: string
  departureDelayMinutes: number
  arrivalDelayMinutes: number
  departureDelayed: boolean
  arrivalDelayed: boolean
  beforeDeparture: boolean
  allPassengersBoarded: boolean
  activeSeats: number
  earlyDepartureApproved: boolean
  earlyDepartureApprovedAt?: string
  canApproveEarlyDeparture: boolean
}

export function earlyDepartureReason(operations?: TripOperations) {
  return operations?.beforeDeparture &&
    !operations.allPassengersBoarded &&
    !operations.earlyDepartureApproved
    ? "До времени отправления выехать можно, только если все пассажиры на месте или диспетчер разрешил ранний выезд."
    : null
}
