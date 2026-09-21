export type StaffRole =
  "developer" | "owner" | "admin" | "dispatcher" | "driver"
const operations: StaffRole[] = ["developer", "owner", "admin", "dispatcher"]
const managers: StaffRole[] = ["developer", "owner", "admin"]
export const createTargets = [
  { href: "/customers", label: "Клиент", roles: operations },
  { href: "/bookings", label: "Бронирование", roles: operations },
  { href: "/trips", label: "Рейс", roles: operations },
  { href: "/routes", label: "Маршрут", roles: operations },
  { href: "/fleet", label: "Автомобиль", roles: managers },
  {
    href: "/routes?availability=create#availability",
    label: "Блокировка дат",
    roles: operations,
  },
  { href: "/team", label: "Сотрудник", roles: managers },
]
// Protect spreadsheet readers from formula execution, preserving numeric cells.
export function csvCell(value: unknown): string {
  const raw =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value)
  const text =
    typeof value === "string" && /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw
  return '"' + text.replaceAll('"', '""') + '"'
}
export function serializeViewCsv(headers: string[], rows: unknown[][]): string {
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
  )
}
