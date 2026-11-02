export function calendarDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
export function parseCalendarDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  )
  return calendarDayKey(date) === value ? date : null
}
export function calendarMonthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const length = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0
  ).getDate()
  return Array.from(
    { length: Math.ceil((offset + length) / 7) * 7 },
    (_, index) =>
      new Date(month.getFullYear(), month.getMonth(), index - offset + 1)
  )
}
