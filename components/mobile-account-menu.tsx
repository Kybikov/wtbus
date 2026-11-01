"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MobileDockSettings } from "@/components/mobile-dock-settings"
import { settingsSections } from "@/components/settings-workspace"
import { ThemeToggle } from "@/components/theme-toggle"
import { InterfaceScaleControl } from "@/components/interface-preferences"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Bell,
  ChevronRight,
  LogOut,
  Settings,
  User,
  Smartphone,
  X,
  ZoomIn,
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        keepMounted
        side="right"
        showCloseButton={false}
        finalFocus={trigger}
        className="mobile-account-menu w-[min(92vw,23rem)]! max-w-none! gap-0 overflow-hidden rounded-l-3xl border-border bg-card motion-reduce:transition-none"
      >
        <SheetHeader className="mobile-account-header relative shrink-0 gap-0 border-b border-border/70 bg-card/80 px-3 pt-[calc(.75rem+env(safe-area-inset-top))] pb-3 backdrop-blur-xl">
          <SheetTitle className="sr-only">Профиль и разделы</SheetTitle>
          <div className="flex min-w-0 items-center gap-2 pr-10">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
            >
              {account?.initials ?? ""}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p
                  title={account?.name}
                  className="min-w-0 truncate text-sm font-semibold"
                >
                  {account?.name || "Ваш профиль"}
                </p>
                <span className="shrink-0 rounded-md bg-control px-1.5 py-1 text-[10px] text-muted-foreground">
                  {roleNames[role]}
                </span>
              </div>
              <SheetDescription className="mt-0.5 truncate text-xs">
                {account?.company}
              </SheetDescription>
            </div>
          </div>
          <SheetClose
            render={
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-[calc(.5rem+env(safe-area-inset-top))] right-2 size-9 rounded-full"
                aria-label="Закрыть правое меню"
              />
            }
          >
            <X className="size-4" />
          </SheetClose>
          <nav
            aria-label="Действия профиля"
            className="mt-3 grid grid-cols-7 items-center gap-0.5 [&_button]:w-full [&_button]:min-w-0! [&>span]:scale-90"
          >
            <Button
              nativeButton={false}
              render={<Link href="/profile" onClick={close} />}
              variant="ghost"
              size="icon"
              aria-label="Личный профиль"
              title="Личный профиль"
            >
              <User className="size-5" />
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/notifications" onClick={close} />}
              variant="ghost"
              size="icon"
              aria-label={`Уведомления${unread ? `: ${unread} непрочитанных` : ""}`}
              title="Уведомления"
              className="relative"
            >
              <Bell className="size-5" />
              {unread > 0 && (
                <span className="absolute top-0 right-0 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Button>
            {["developer", "owner", "admin", "accountant"].includes(role) && (
              <Button
                nativeButton={false}
                render={<Link href="/settings" onClick={close} />}
                variant="ghost"
                size="icon"
                aria-label="Настройки компании"
                title="Настройки компании"
              >
                <Settings className="size-5" />
              </Button>
            )}
            <Button
              nativeButton={false}
              render={<Link href="/profile/app" onClick={close} />}
              variant="ghost"
              size="icon"
              aria-label="Приложение"
              title="Приложение"
            >
              <Smartphone className="size-5" />
            </Button>
            <ThemeToggle compact />
            <Dialog>
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Масштаб интерфейса"
                    title="Масштаб интерфейса"
                  />
                }
              >
                <ZoomIn className="size-5" />
              </DialogTrigger>
              <DialogContent className="rounded-3xl">
                <DialogHeader>
                  <DialogTitle>Масштаб интерфейса</DialogTitle>
                  <DialogDescription>
                    Подберите удобный размер элементов.
                  </DialogDescription>
                </DialogHeader>
                <InterfaceScaleControl />
              </DialogContent>
            </Dialog>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Выйти"
              title="Выйти"
              disabled={leaving}
              disabledReason="Выход из аккаунта уже выполняется."
              onClick={() => void signOut()}
              className="text-destructive"
            >
              <LogOut className="size-5" />
            </Button>
          </nav>
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
            <MobileDockSettings
              role={role}
              hrefs={dockHrefs}
              onChange={onDockChange}
            />
          </nav>
        </div>
      </SheetContent>
    </Sheet>
  )
}
