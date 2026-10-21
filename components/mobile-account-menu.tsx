"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import {
  Bell,
  CalendarDays,
  Car,
  ChevronRight,
  ExternalLink,
  House,
  Inbox,
  LogOut,
  Moon,
  Palette,
  Route,
  Settings,
  Sun,
  Ticket,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import {
  mobileNavigation,
  isMobileDestinationActive,
} from "@/lib/mobile-navigation"
import type { StaffRole } from "@/lib/admin-actions"
import { sessionFetch } from "@/lib/session-navigation"
import { cn } from "@/lib/utils"

export type MobileAccount = {
  name: string
  initials: string
  company: string
  tenantSlug: string
}
const icons = {
  home: House,
  calendar: CalendarDays,
  ticket: Ticket,
  inbox: Inbox,
  route: Route,
  car: Car,
  users: Users,
  wallet: Wallet,
  settings: Settings,
  bell: Bell,
  user: User,
}
const roleNames: Record<StaffRole, string> = {
  developer: "Разработчик",
  owner: "Владелец",
  admin: "Администратор",
  dispatcher: "Диспетчер",
  driver: "Водитель",
}
const companyPages = new Set([
  "/finance",
  "/team",
  "/settings",
  "/availability",
])

export function MobileAccountMenu({
  role,
  account,
  open,
  onOpenChange,
  trigger,
}: {
  role: StaffRole
  account?: MobileAccount
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.RefObject<HTMLElement | null>
}) {
  const pathname = usePathname()
  const { resolvedTheme, setTheme } = useTheme()
  const [leaving, setLeaving] = React.useState(false)
  const close = () => onOpenChange(false)
  const pages = mobileNavigation(role).filter(
    (page) => page.href !== "/profile" && page.href !== "/notifications"
  )
  async function signOut() {
    if (leaving) return
    setLeaving(true)
    try {
      const response = await sessionFetch("/api/auth/logout", {
        method: "POST",
      })
      if (!response.ok)
        throw Error("Не удалось выйти. Проверьте связь и повторите попытку.")
      window.location.replace("/login")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выйти.")
      setLeaving(false)
    }
  }
  const personal = [
    { href: "/profile", label: "Личный профиль", icon: User },
    {
      href: "/profile/notifications",
      label: "Настройки уведомлений",
      icon: Bell,
    },
    {
      href: "/profile/personalization",
      label: "Персонализация",
      icon: Palette,
    },
    { href: "/profile/app", label: "Приложение", icon: Settings },
  ]
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        finalFocus={trigger}
        className="mobile-account-menu w-[min(92vw,23rem)]! max-w-none! gap-0 overflow-hidden rounded-l-3xl border-border bg-card motion-reduce:transition-none"
      >
        <SheetHeader className="mobile-account-header relative shrink-0 border-b border-border/70 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pr-16 pb-5">
          <SheetTitle className="sr-only">Профиль и разделы</SheetTitle>
          <div
            className="mb-3 grid size-12 place-items-center rounded-2xl bg-primary text-lg font-semibold text-primary-foreground"
            aria-hidden
          >
            {account?.initials ?? ""}
          </div>
          <p className="text-lg leading-snug font-semibold break-words">
            {account?.name || "Ваш профиль"}
          </p>
          <SheetDescription className="mt-1 text-sm break-words">
            {account?.company}
          </SheetDescription>
          <span className="mt-2 w-fit rounded-md bg-control px-2 py-1 text-xs text-muted-foreground">
            {roleNames[role]}
          </span>
          <SheetClose
            render={
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-[max(1rem,env(safe-area-inset-top))] right-3 size-11 rounded-full"
                aria-label="Закрыть правое меню"
              />
            }
          >
            <X />
          </SheetClose>
        </SheetHeader>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
          data-mobile-menu-scroll
        >
          <nav aria-label="Разделы правого меню" className="space-y-4">
            {[
              {
                label: "Работа",
                items: pages.filter((page) => !companyPages.has(page.href)),
              },
              {
                label: "Компания",
                items: pages.filter((page) => companyPages.has(page.href)),
              },
            ].map((group) =>
              group.items.length ? (
                <div key={group.label}>
                  <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </p>
                  {group.items.map((page) => {
                    const Icon = icons[page.icon],
                      active = isMobileDestinationActive(pathname, page.href)
                    return (
                      <Link
                        key={page.href}
                        href={page.href}
                        onClick={close}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-control focus-visible:outline-2 focus-visible:outline-ring",
                          active && "bg-control font-semibold text-primary"
                        )}
                      >
                        <Icon className="size-5 shrink-0" />
                        <span className="min-w-0 flex-1 break-words">
                          {page.label}
                        </span>
                        {active && (
                          <span
                            aria-hidden
                            className="size-1.5 shrink-0 rounded-full bg-primary"
                          />
                        )}
                      </Link>
                    )
                  })}
                </div>
              ) : null
            )}
            <div className="border-t border-border/70 pt-3">
              <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                Личные настройки
              </p>
              {personal.map((page) => (
                <Link
                  key={page.href}
                  href={page.href}
                  onClick={close}
                  aria-current={pathname === page.href ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-control focus-visible:outline-2 focus-visible:outline-ring",
                    pathname === page.href &&
                      "bg-control font-semibold text-primary"
                  )}
                >
                  <page.icon className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1">{page.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              ))}
              <Link
                href="/notifications"
                onClick={close}
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-control"
              >
                <Bell className="size-5" />
                История уведомлений
              </Link>
            </div>
            {account?.tenantSlug && (
              <Link
                href={`/book/${encodeURIComponent(account.tenantSlug)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm hover:bg-control"
              >
                <Ticket className="size-5" />
                <span className="flex-1">Страница бронирования</span>
                <ExternalLink className="size-4 text-muted-foreground" />
              </Link>
            )}
          </nav>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border/70 bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            variant="outline"
            className="h-11"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            {resolvedTheme === "dark" ? "Светлая тема" : "Тёмная тема"}
          </Button>
          <Button
            variant="ghost"
            className="h-11 text-destructive hover:text-destructive"
            disabled={leaving}
            disabledReason="Выход из аккаунта уже выполняется."
            onClick={() => void signOut()}
          >
            <LogOut />
            {leaving ? "Выходим…" : "Выйти"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
