"use client"
import { useEffect, useRef, type ReactNode } from "react"
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
} from "lucide-react"
import { cn } from "@/lib/utils"
const sections = [
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
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navRef.current
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (nav && selected && nav.scrollWidth > nav.clientWidth)
      nav.scrollTo({
        left:
          nav.scrollLeft +
          selected.getBoundingClientRect().left -
          nav.getBoundingClientRect().left -
          (nav.clientWidth - selected.clientWidth) / 2,
      })
  }, [active])
  const visible = sections.filter(
    (s) => !s.roles || (!!role && s.roles.includes(role))
  )
  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="workspace-panel min-w-0 p-2 xl:sticky xl:top-0">
        <nav
          ref={navRef}
          aria-label="Разделы настроек"
          className="flex min-w-0 gap-1 overflow-x-auto xl:block xl:space-y-1"
        >
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
