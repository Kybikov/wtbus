type RecurrenceDate = { startsAt: string; weekdays: number[]; monthDay: number }

function day(value: string) {
  const text = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const date = new Date(`${text}T12:00:00Z`)
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === text
    ? date
    : null
}

// Follow the departure date until the user chooses a different recurrence day.
export function retargetTripDate<T extends RecurrenceDate>(
  current: T,
  startsAt: string
): T {
  const previous = day(current.startsAt),
    next = day(startsAt)
  return {
    ...current,
    startsAt,
    weekdays:
      next &&
      (!previous ||
        (current.weekdays.length === 1 &&
          current.weekdays[0] === previous.getUTCDay()))
        ? [next.getUTCDay()]
        : current.weekdays,
    monthDay:
      next && (!previous || current.monthDay === previous.getUTCDate())
        ? next.getUTCDate()
        : current.monthDay,
  }
}
