import type { StaffRole } from "./admin-actions.ts"

const operations: StaffRole[] = ["owner", "admin", "developer", "dispatcher"]
const management: StaffRole[] = ["owner", "admin", "developer"]
export const mobileDestinations = [
  { href: "/", label: "Обзор", icon: "home", roles: operations },
  { href: "/trips", label: "Рейсы", icon: "calendar", roles: operations },
  {
    href: "/bookings",
    label: "Бронирования",
    icon: "ticket",
    roles: operations,
  },
  { href: "/requests", label: "Заявки", icon: "inbox", roles: operations },
  { href: "/routes", label: "Маршруты", icon: "route", roles: operations },
  {
    href: "/availability",
    label: "Недоступность",
    icon: "calendar",
    roles: operations,
  },
  { href: "/fleet", label: "Автопарк", icon: "car", roles: operations },
  { href: "/customers", label: "Клиенты", icon: "users", roles: operations },
  { href: "/finance", label: "Финансы", icon: "wallet", roles: management },
  { href: "/team", label: "Команда", icon: "users", roles: management },
  {
    href: "/settings",
    label: "Настройки компании",
    icon: "settings",
    roles: management,
  },
  {
    href: "/driver",
    label: "Мой рейс",
    icon: "car",
    roles: ["driver"] as StaffRole[],
  },
  {
    href: "/notifications",
    label: "Уведомления",
    icon: "bell",
    roles: [...operations, "driver"] as StaffRole[],
  },
  {
    href: "/profile",
    label: "Профиль",
    icon: "user",
    roles: [...operations, "driver"] as StaffRole[],
  },
] as const

export function mobileNavigation(role: StaffRole) {
  return mobileDestinations.filter((item) => item.roles.includes(role))
}
export function mobileDockNavigation(role: StaffRole) {
  const hrefs =
    role === "driver"
      ? ["/driver", "/notifications", "/profile"]
      : ["/", "/trips", "/bookings", "/requests"]
  return mobileNavigation(role).filter((item) => hrefs.includes(item.href))
}
export function isMobileDestinationActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"))
}
