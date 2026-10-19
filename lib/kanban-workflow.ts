type Status = {
  key: string
  semanticPhase: string
  isTerminal: boolean
}

const tripTransitions: Record<string, readonly string[]> = {
  draft: ["planned", "cancelled"],
  planned: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
}

export function canMoveTripStatus(
  statuses: readonly Status[],
  from: string,
  to: string
) {
  const current = statuses.find((status) => status.key === from)
  const next = statuses.find((status) => status.key === to)
  if (!current || !next || current.isTerminal) return false
  return (
    current.semanticPhase === next.semanticPhase ||
    Boolean(
      tripTransitions[current.semanticPhase]?.includes(next.semanticPhase)
    )
  )
}

export function canMoveBookingStatus(
  statuses: readonly Status[],
  from: string,
  to: string,
  tripPhase: string
) {
  const current = statuses.find((status) => status.key === from)
  const next = statuses.find((status) => status.key === to)
  if (!current || !next || current.isTerminal) return false
  // Payment confirmation and completion keep their explicit financial workflows.
  if (current.semanticPhase === next.semanticPhase) return true
  return (
    next.semanticPhase === "cancelled" &&
    current.semanticPhase !== "completed" &&
    !["in_progress", "completed"].includes(tripPhase)
  )
}
