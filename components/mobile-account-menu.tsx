"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { DeliverySwitch } from "@/components/ui/delivery-switch"
import { settingsSections } from "@/components/settings-workspace"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Bell,
  ChevronRight,
  ExternalLink,
  LogOut,
  Settings,
  Ticket,
  User,
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
import { mobileNavigation } from "@/lib/mobile-navigation"
import type { StaffRole } from "@/lib/admin-actions"
import { sessionFetch } from "@/lib/session-navigation"
import { cn } from "@/lib/utils"

export type MobileAccount = {
  name: string
  initials: string
  company: string
  tenantSlug: string
  membershipId?: string
}
const roleNames: Record<StaffRole, string> = {
  accountant: "Бухгалтер",
  developer: "Разработчик",
  owner: "Владелец",
  admin: "Администратор",
  dispatcher: "Диспетчер",
  driver: "Водитель",
}

export function MobileAccountMenu({
  role,
  account,
  open,
  onOpenChange,
  trigger,
  dockHrefs,
  onDockChange,
  pageMenu,
  pageTools,
  unread = 0,
}: {
  role: StaffRole
  dockHrefs: string[]
  onDockChange: (hrefs: string[]) => void
  pageTools?: React.ReactNode
  pageMenu?: React.ReactNode
  unread?: number
  account?: MobileAccount
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.RefObject<HTMLElement | null>
}) {
  const pathname = usePathname()
  const [leaving, setLeaving] = React.useState(false)
  const close = () => onOpenChange(false)
  const pages = mobileNavigation(role)
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
    { href: "/profile/app", label: "Приложение", icon: Settings },
  ]
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        keepMounted
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
          <nav
            aria-label="Разделы правого меню"
            className="space-y-4"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a[href]")) close()
            }}
          >
            {pageMenu && (
              <section
                aria-label="Управление страницей"
                className="space-y-3 rounded-2xl border border-border p-3"
              >
                {pageMenu}
              </section>
            )}
            {pageTools}
            {(pathname.startsWith("/settings") ||
              pathname.startsWith("/profile")) && (
              <section aria-label="Подразделы страницы" className="space-y-1">
                {settingsSections
                  .filter(
                    (section) =>
                      section.href.startsWith(
                        pathname.startsWith("/settings")
                          ? "/settings"
                          : "/profile"
                      ) &&
                      (!section.roles || section.roles.includes(role))
                  )
                  .map((section) => (
                    <Link
                      key={section.href}
                      href={section.href}
                      onClick={close}
                      aria-current={
                        pathname === section.href ? "page" : undefined
                      }
                      className={cn(
                        "flex min-h-12 items-center gap-3 rounded-2xl px-3 py-3 text-sm hover:bg-control",
                        pathname === section.href &&
                          "bg-control font-semibold text-primary"
                      )}
                    >
                      <section.icon className="size-5" />
                      <span className="min-w-0 flex-1">{section.label}</span>
                      <ChevronRight className="size-4" />
                    </Link>
                  ))}
              </section>
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
                Уведомления{" "}
                {unread > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-2 text-xs text-primary-foreground">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            </div>
            {(role === "developer" ||
              role === "owner" ||
              role === "admin" ||
              role === "accountant") && (
              <Link
                href="/settings"
                onClick={close}
                className="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-sm hover:bg-control"
              >
                <Settings className="size-5" />
                Настройки компании
                <ChevronRight className="ml-auto size-4" />
              </Link>
            )}
            <section
              aria-label="Нижняя навигация"
              className="rounded-2xl border border-border p-3"
            >
              <h3 className="text-sm font-semibold">Нижняя навигация</h3>
              <p className="mt-1 mb-2 text-xs text-muted-foreground">
                {dockHrefs.length >= 3
                  ? "Выбрано три раздела. Уберите один, чтобы добавить другой."
                  : dockHrefs.length === 1
                    ? "Оставьте хотя бы один раздел. Можно выбрать до трёх."
                    : "Выберите до трёх разделов."}
              </p>
              {pages.map((page) => {
                const checked = dockHrefs.includes(page.href)
                const reason =
                  checked && dockHrefs.length === 1
                    ? "Оставьте хотя бы один раздел."
                    : !checked && dockHrefs.length >= 3
                      ? "Уберите один из выбранных разделов, чтобы добавить другой."
                      : undefined
                return (
                  <div
                    key={page.href}
                    className="border-b border-border/50 py-1 last:border-0"
                  >
                    <div className="flex min-h-12 items-center justify-between gap-3">
                      <span className="min-w-0 text-sm">{page.label}</span>
                      <DeliverySwitch
                        label={page.label + " в нижней навигации"}
                        checked={checked}
                        disabled={!!reason}
                        disabledReason={reason}
                        onChange={(value) =>
                          onDockChange(
                            value
                              ? [...dockHrefs, page.href]
                              : dockHrefs.filter((href) => href !== page.href)
                          )
                        }
                      />
                    </div>
                  </div>
                )
              })}
            </section>
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
          <ThemeToggle />
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
