"use client"
import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { FieldSelect } from "@/components/ui/field-select"
import Link from "next/link"
import {
  UserRound,
  Bell,
  Palette,
  Smartphone,
  Building2,
  CreditCard,
  Plug,
  CircleDollarSign,
  SlidersHorizontal,
  History,
  Tags,
} from "lucide-react"
import { cn } from "@/lib/utils"
const sections = [
  {
    group: "Компания",
    href: "/settings/accounting",
    label: "Финансовый учёт",
    icon: CircleDollarSign,
    roles: ["owner", "admin", "developer", "accountant"],
  },
  {
    group: "Личные настройки",
    href: "/profile",
    label: "Личные данные",
    icon: UserRound,
  },
  {
    group: "Личные настройки",
    href: "/profile/notifications",
    label: "Уведомления",
    icon: Bell,
  },
  {
    group: "Личные настройки",
    href: "/profile/personalization",
    label: "Персонализация",
    icon: Palette,
  },
  {
    group: "Личные настройки",
    href: "/profile/app",
    label: "Приложение",
    icon: Smartphone,
  },
  {
    group: "Компания",
    href: "/settings/company",
    label: "Компания и оформление",
    icon: Building2,
    roles: ["owner", "admin", "developer"],
  },
  {
    group: "Компания",
    href: "/settings/payments",
    label: "Приём оплаты",
    icon: CreditCard,
    roles: ["owner", "developer"],
  },
  {
    group: "Компания",
    href: "/settings/finance",
    label: "Курсы валют",
    icon: CircleDollarSign,
    roles: ["owner", "developer"],
  },
  {
    group: "Компания",
    href: "/settings/fields",
    label: "Дополнительные поля",
    icon: SlidersHorizontal,
    roles: ["owner", "admin", "developer"],
  },
  {
    group: "Компания",
    href: "/settings/statuses",
    label: "Статусы",
    icon: Tags,
    roles: ["owner", "admin", "developer"],
  },
  {
    group: "Компания",
    href: "/settings/activity",
    label: "Журнал действий",
    icon: History,
    roles: ["owner", "admin", "developer"],
  },
  {
    group: "Интеграции",
    href: "/settings/integrations",
    label: "Подключения и API",
    icon: Plug,
    roles: ["owner", "developer"],
  },
]
export function SettingsWorkspace({
  active,
  role,
  children,
}: {
  active: string
  role?: string
  children: ReactNode
}) {
  const router = useRouter()
  const visible = sections.filter(
    (s) => !s.roles || (!!role && s.roles.includes(role))
  )
  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="workspace-panel min-w-0 space-y-2 p-3 xl:hidden">
        <p className="text-xs text-muted-foreground">Раздел настроек</p>
        <FieldSelect
          aria-label="Раздел настроек"
          value={active}
          onValueChange={(href) => router.push(href)}
          options={visible.map((section) => ({
            value: section.href,
            label: section.label,
          }))}
          triggerClassName="h-11"
        />
      </div>
      <aside className="workspace-panel sticky top-0 hidden min-w-0 p-2 xl:block">
        <nav aria-label="Разделы настроек" className="min-w-0 space-y-1">
          {visible.map((s, i) => (
            <div key={s.href} className="shrink-0 xl:shrink">
              {i === 0 || visible[i - 1].group !== s.group ? (
                <p className="hidden px-3 pt-4 pb-2 text-xs text-muted-foreground xl:block">
                  {s.group}
                </p>
              ) : null}
              <Link
                href={s.href}
                aria-current={active === s.href ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm whitespace-nowrap transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                  active === s.href && "bg-accent font-medium"
                )}
              >
                <s.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{s.label}</span>
              </Link>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  )
}
