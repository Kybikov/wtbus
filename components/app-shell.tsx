"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Calendar01Icon,
  Car01Icon,
  DashboardSquare01Icon,
  Menu01Icon,
  Notification01Icon,
  Route01Icon,
  Search01Icon,
  Settings01Icon,
  Ticket01Icon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type MembershipRole = "owner" | "admin" | "dispatcher" | "driver"

type NavigationItem = {
  href: string
  icon: typeof DashboardSquare01Icon
  label: string
  roles: MembershipRole[]
}

const operationsRoles: MembershipRole[] = ["owner", "admin", "dispatcher"]
const managementRoles: MembershipRole[] = ["owner", "admin"]

const navigation: NavigationItem[] = [
  { href: "/", icon: DashboardSquare01Icon, label: "Обзор", roles: operationsRoles },
  { href: "/trips", icon: Calendar01Icon, label: "Рейсы", roles: operationsRoles },
  { href: "/routes", icon: Route01Icon, label: "Маршруты", roles: operationsRoles },
  { href: "/availability", icon: Calendar01Icon, label: "Недоступность", roles: operationsRoles },
  { href: "/fleet", icon: Car01Icon, label: "Автопарк", roles: operationsRoles },
  { href: "/customers", icon: UserGroupIcon, label: "Клиенты", roles: operationsRoles },
  { href: "/bookings", icon: Ticket01Icon, label: "Бронирования", roles: operationsRoles },
  { href: "/requests", icon: Ticket01Icon, label: "Индивидуальные заявки", roles: operationsRoles },
  { href: "/finance", icon: Wallet01Icon, label: "Финансы", roles: managementRoles },
  { href: "/team", icon: UserGroupIcon, label: "Команда", roles: managementRoles },
  { href: "/settings", icon: Settings01Icon, label: "Настройки", roles: managementRoles },
  { href: "/driver", icon: Car01Icon, label: "Мой рейс", roles: ["driver"] },
]

type AppShellProps = {
  children: React.ReactNode
  pageTitle: string
  utilities?: React.ReactNode
}

type ShellBrand = {
  logoUrl?: string
  tenantSlug: string
  tenantName: string
  userInitials: string
  role: MembershipRole
}

type SearchCustomer = {
  id: string
  fullName: string
  phone: string
}

type SearchBooking = {
  id: string
  customerName: string
  customerPhone: string
  origin: string
  destination: string
  startsAt: string
}

type TransferRequestPreview = {
  id: string
  status: "new" | "in_progress" | "closed" | "cancelled"
  passengerName: string
  origin: string
  destination: string
  createdAt: string
}

function hasItems<T>(value: unknown): value is { items: T[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

const defaultShellBrand: ShellBrand = {
  logoUrl: "/brand/vivat-bus.png",
  tenantSlug: "vivat-bus",
  tenantName: "Vivat Bus",
  userInitials: "АК",
  role: "owner",
}

function isMembershipRole(value: unknown): value is MembershipRole {
  return value === "owner" || value === "admin" || value === "dispatcher" || value === "driver"
}

function tenantNameFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}

function initials(name: string) {
  const result = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return result || "АК"
}

function BrandMark({
  brand,
  className,
}: {
  brand: ShellBrand
  className: string
}) {
  return (
    <span className={cn("relative grid place-items-center overflow-hidden rounded-xl bg-black", className)}>
      {brand.logoUrl ? (
        <Image
          alt={brand.tenantName}
          className="h-full w-full object-contain"
          fill
          sizes="44px"
          src={brand.logoUrl}
          unoptimized
        />
      ) : (
        <HugeiconsIcon className="text-primary" icon={Route01Icon} size={20} />
      )}
    </span>
  )
}

export function AppShell({ children, pageTitle, utilities }: AppShellProps) {
  const pathname = usePathname()
  const [mobileNavigationOpen, setMobileNavigationOpen] = React.useState(false)
  const [brand, setBrand] = React.useState(defaultShellBrand)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchLoading, setSearchLoading] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)
  const [customers, setCustomers] = React.useState<SearchCustomer[]>([])
  const [bookings, setBookings] = React.useState<SearchBooking[]>([])
  const [notificationsOpen, setNotificationsOpen] = React.useState(false)
  const [notificationsLoading, setNotificationsLoading] = React.useState(false)
  const [notificationError, setNotificationError] = React.useState<string | null>(null)
  const [newRequests, setNewRequests] = React.useState<TransferRequestPreview[]>([])
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      fetch("/api/branding", { signal: controller.signal }),
      fetch("/api/auth/me", { signal: controller.signal }),
    ])
      .then(async ([brandingResponse, identityResponse]) => {
        const branding: unknown = await brandingResponse.json().catch(() => null)
        const identity: unknown = await identityResponse.json().catch(() => null)
        if (controller.signal.aborted) return
        setBrand((current) => {
          const tenantSlug =
            identityResponse.ok &&
            typeof identity === "object" &&
            identity !== null &&
            "tenantSlug" in identity &&
            typeof identity.tenantSlug === "string"
              ? identity.tenantSlug
              : current.tenantSlug
          const tenantName =
            identityResponse.ok &&
            typeof identity === "object" &&
            identity !== null &&
            "tenantSlug" in identity &&
            typeof identity.tenantSlug === "string"
              ? tenantNameFromSlug(identity.tenantSlug)
              : current.tenantName
          const userInitials =
            identityResponse.ok &&
            typeof identity === "object" &&
            identity !== null &&
            "displayName" in identity &&
            typeof identity.displayName === "string"
              ? initials(identity.displayName)
              : current.userInitials
          const role =
            identityResponse.ok &&
            typeof identity === "object" &&
            identity !== null &&
            "role" in identity &&
            isMembershipRole(identity.role)
              ? identity.role
              : current.role
          const logoUrl =
            brandingResponse.ok &&
            typeof branding === "object" &&
            branding !== null &&
            "logoUrl" in branding &&
            typeof branding.logoUrl === "string"
              ? branding.logoUrl
              : tenantSlug === "vivat-bus"
                ? "/brand/vivat-bus.png"
                : undefined
          return { logoUrl, tenantSlug, tenantName, userInitials, role }
        })
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  React.useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === "Escape") {
        setSearchOpen(false)
        setNotificationsOpen(false)
      }
    }
    window.addEventListener("keydown", onShortcut)
    return () => window.removeEventListener("keydown", onShortcut)
  }, [])

  React.useEffect(() => {
    if (!searchOpen) return
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [searchOpen])

  React.useEffect(() => {
    const query = searchQuery.trim()
    if (!searchOpen || query.length < 2) {
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      setSearchError(null)
      void Promise.all([
        fetch(`/api/customers?q=${encodeURIComponent(query)}&limit=6`, {
          signal: controller.signal,
        }),
        fetch(`/api/bookings?q=${encodeURIComponent(query)}&limit=8`, {
          signal: controller.signal,
        }),
      ])
        .then(async ([customerResponse, bookingResponse]) => {
          const customerPayload: unknown = await customerResponse.json().catch(() => null)
          const bookingPayload: unknown = await bookingResponse.json().catch(() => null)
          if (controller.signal.aborted) return
          setCustomers(
            customerResponse.ok && hasItems<SearchCustomer>(customerPayload)
              ? customerPayload.items
              : []
          )
          setBookings(
            bookingResponse.ok && hasItems<SearchBooking>(bookingPayload)
              ? bookingPayload.items.filter((item) =>
                  [
                    item.customerName,
                    item.customerPhone,
                    item.origin,
                    item.destination,
                  ]
                    .join(" ")
                    .toLocaleLowerCase("ru-RU")
                    .includes(query.toLocaleLowerCase("ru-RU"))
                )
              : []
          )
          if (!customerResponse.ok && !bookingResponse.ok)
            setSearchError("Не удалось выполнить поиск. Повторите попытку.")
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setSearchError("Не удалось выполнить поиск. Проверьте соединение.")
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false)
        })
    }, 220)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [searchOpen, searchQuery])

  const loadNotifications = React.useCallback(async () => {
    setNotificationsLoading(true)
    setNotificationError(null)
    try {
      const response = await fetch(
        "/api/individual-transfer-requests?status=new&limit=5",
        { cache: "no-store" }
      )
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !hasItems<TransferRequestPreview>(payload))
        throw new Error()
      setNewRequests(payload.items)
    } catch {
      setNotificationError("Не удалось загрузить уведомления.")
    } finally {
      setNotificationsLoading(false)
    }
  }, [])

  function toggleNotifications() {
    setNotificationsOpen((current) => {
      const next = !current
      if (next) void loadNotifications()
      return next
    })
  }

  function updateSearchQuery(value: string) {
    setSearchQuery(value)
    if (value.trim().length < 2) {
      setCustomers([])
      setBookings([])
      setSearchError(null)
      setSearchLoading(false)
    }
  }

  const visibleNavigation = navigation.filter((item) =>
    item.roles.includes(brand.role)
  )

  React.useEffect(() => {
    const onBrandingChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{ logoUrl?: string | null }>
      ).detail
      if (!detail || !("logoUrl" in detail)) return
      setBrand((current) => ({
        ...current,
        logoUrl:
          typeof detail.logoUrl === "string"
            ? detail.logoUrl
            : current.tenantSlug === "vivat-bus"
              ? "/brand/vivat-bus.png"
              : undefined,
      }))
    }
    window.addEventListener("vivat-branding-change", onBrandingChange)
    return () => window.removeEventListener("vivat-branding-change", onBrandingChange)
  }, [])

  return (
    <main className="min-h-svh bg-background p-2 text-foreground sm:p-3 lg:p-4">
      <div className="app-shell-frame mx-auto flex min-h-[calc(100svh-1rem)] max-w-[1800px] gap-3 lg:min-h-[calc(100svh-2rem)]">
        <aside className="app-sidebar hidden h-[calc(100svh-2rem)] w-60 shrink-0 flex-col overflow-y-auto rounded-[var(--app-radius)] border border-sidebar-border bg-sidebar p-3 lg:sticky lg:top-4 lg:flex">
          <Link
            className="flex min-h-20 items-center gap-3 rounded-xl px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
          >
            <BrandMark brand={brand} className="size-11" />
            <span className="app-sidebar-brand-copy">
              <span className="block text-sm font-bold">{brand.tenantName}</span>
              <span className="block text-xs text-muted-foreground">
                Диспетчерская
              </span>
            </span>
          </Link>
          <nav aria-label="Основная навигация" className="mt-6 space-y-1">
            {visibleNavigation.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href)
              return (
                <Link
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <HugeiconsIcon icon={item.icon} size={18} strokeWidth={1.8} />
                  <span className="app-sidebar-nav-label">{item.label}</span>
                </Link>
              )
            })}
          </nav>
          <div className="app-sidebar-demo mt-auto rounded-2xl bg-sidebar-accent p-3">
            <p className="text-xs font-bold">Рабочее пространство</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Данные и настройки доступны только сотрудникам вашей компании.
            </p>
          </div>
        </aside>
        <section className="app-workspace flex min-w-0 flex-1 flex-col gap-3">
          <header className="app-topbar flex h-16 shrink-0 items-center justify-between rounded-[var(--app-radius)] border border-border bg-card px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                aria-label="Открыть навигацию"
                className="lg:hidden"
                onClick={() => setMobileNavigationOpen(true)}
                size="icon"
                variant="ghost"
              >
                <HugeiconsIcon icon={Menu01Icon} strokeWidth={1.8} />
              </Button>
              <Link className="shrink-0 lg:hidden" href="/">
                <BrandMark brand={brand} className="size-9" />
              </Link>
              <button
                aria-haspopup="dialog"
                className="hidden h-9 min-w-[17.5rem] items-center gap-2 rounded-xl border border-border bg-background px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:flex"
                onClick={() => setSearchOpen(true)}
                type="button"
              >
                <HugeiconsIcon icon={Search01Icon} size={16} />
                <span>Поиск рейса или клиента</span>
                <kbd className="ml-8 rounded border border-border px-1.5 py-0.5 text-xs">
                  ⌘K
                </kbd>
              </button>
              <p className="truncate font-semibold md:hidden">{pageTitle}</p>
              <Button
                aria-haspopup="dialog"
                aria-label="Поиск рейса или клиента"
                className="md:hidden"
                onClick={() => setSearchOpen(true)}
                size="icon"
                variant="ghost"
              >
                <HugeiconsIcon icon={Search01Icon} strokeWidth={1.8} />
              </Button>
            </div>
            <div className="relative flex items-center gap-1">
              <Button
                aria-expanded={notificationsOpen}
                aria-haspopup="dialog"
                aria-label="Уведомления"
                className="relative"
                onClick={toggleNotifications}
                size="icon"
                variant="ghost"
              >
                <HugeiconsIcon icon={Notification01Icon} strokeWidth={1.8} />
                {newRequests.length > 0 ? (
                  <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                ) : null}
              </Button>
              {notificationsOpen ? (
                <section
                  aria-label="Уведомления"
                  className="absolute top-11 right-0 z-40 w-[min(23rem,calc(100vw-2rem))] rounded-[calc(var(--radius)*1.2)] border border-border bg-card p-3 shadow-xl shadow-black/20"
                  role="dialog"
                >
                  <div className="flex items-center justify-between gap-3 px-1 pb-2">
                    <p className="font-semibold">Уведомления</p>
                    <button
                      className="text-xs font-semibold text-primary hover:underline"
                      onClick={() => void loadNotifications()}
                      type="button"
                    >
                      Обновить
                    </button>
                  </div>
                  {notificationsLoading ? (
                    <p className="px-1 py-4 text-sm text-muted-foreground">Загружаем…</p>
                  ) : null}
                  {notificationError ? (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {notificationError}
                    </p>
                  ) : null}
                  {!notificationsLoading && !notificationError && newRequests.length === 0 ? (
                    <p className="px-1 py-4 text-sm text-muted-foreground">
                      Новых заявок нет.
                    </p>
                  ) : null}
                  {!notificationsLoading && newRequests.length > 0 ? (
                    <div className="space-y-1">
                      {newRequests.map((request) => (
                        <Link
                          className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-muted"
                          href="/requests"
                          key={request.id}
                          onClick={() => setNotificationsOpen(false)}
                        >
                          <p className="text-sm font-semibold">Новая индивидуальная заявка</p>
                          <p className="mt-0.5 truncate text-sm text-muted-foreground">
                            {request.passengerName}: {request.origin} → {request.destination}
                          </p>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  <Link
                    className="mt-2 block border-t border-border px-1 pt-3 text-sm font-semibold text-primary hover:underline"
                    href="/requests"
                    onClick={() => setNotificationsOpen(false)}
                  >
                    Открыть все заявки
                  </Link>
                </section>
              ) : null}
              {utilities}
              <div
                aria-label={`Аккаунт ${brand.userInitials}`}
                className="ml-1 flex size-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
              >
                {brand.userInitials}
              </div>
            </div>
          </header>
          <div className="dashboard-content min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-3 sm:py-4 lg:px-4 lg:py-5">
            {children}
          </div>
        </section>
      </div>
      {mobileNavigationOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/55 p-3 backdrop-blur-sm lg:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setMobileNavigationOpen(false)
          }}
        >
          <aside
            aria-label="Мобильная навигация"
            className="flex h-full w-[min(19rem,calc(100vw-3rem))] flex-col rounded-[var(--app-radius)] border border-border bg-sidebar p-3 shadow-2xl shadow-black/35"
          >
            <div className="flex min-h-14 items-center justify-between gap-3 px-2">
              <Link
                className="flex items-center gap-3"
                href="/"
                onClick={() => setMobileNavigationOpen(false)}
              >
                <BrandMark brand={brand} className="size-10" />
                <span>
                  <span className="block text-sm font-bold">{brand.tenantName}</span>
                  <span className="block text-xs text-muted-foreground">
                    Диспетчерская
                  </span>
                </span>
              </Link>
              <Button
                aria-label="Закрыть навигацию"
                onClick={() => setMobileNavigationOpen(false)}
                size="icon"
                variant="ghost"
              >
                ×
              </Button>
            </div>
            <nav
              aria-label="Основная навигация"
              className="mt-6 space-y-1 overflow-y-auto"
            >
              {visibleNavigation.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href)
                return (
                  <Link
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold",
                      active
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
                    )}
                    href={item.href}
                    key={item.href}
                    onClick={() => setMobileNavigationOpen(false)}
                  >
                    <HugeiconsIcon
                      icon={item.icon}
                      size={18}
                      strokeWidth={1.8}
                    />
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </aside>
        </div>
      ) : null}
      {searchOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-start bg-black/55 px-3 pt-[max(1rem,8svh)] backdrop-blur-sm sm:px-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSearchOpen(false)
          }}
        >
          <section
            aria-label="Поиск"
            aria-modal="true"
            className="w-full max-w-2xl rounded-[calc(var(--radius)*1.35)] border border-border bg-card p-3 shadow-2xl shadow-black/35"
            role="dialog"
          >
            <label className="flex h-11 items-center gap-3 rounded-lg border border-border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <HugeiconsIcon className="text-muted-foreground" icon={Search01Icon} size={18} />
              <span className="sr-only">Поиск рейса, бронирования или клиента</span>
              <input
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(event) => updateSearchQuery(event.target.value)}
                placeholder="Рейс, маршрут, пассажир или телефон"
                ref={searchInputRef}
                value={searchQuery}
              />
              <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">Esc</kbd>
            </label>
            <div className="max-h-[min(32rem,70svh)] overflow-y-auto px-1 pt-3">
              {searchQuery.trim().length < 2 ? (
                <>
                  <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground">РАЗДЕЛЫ</p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {visibleNavigation.map((item) => (
                      <Link
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                        href={item.href}
                        key={item.href}
                        onClick={() => setSearchOpen(false)}
                      >
                        <HugeiconsIcon icon={item.icon} size={17} strokeWidth={1.8} />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                  <p className="px-2 pt-4 text-xs text-muted-foreground">Введите не менее двух символов для поиска клиентов и бронирований.</p>
                </>
              ) : null}
              {searchLoading ? <p className="px-2 py-5 text-sm text-muted-foreground">Ищем…</p> : null}
              {searchError ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{searchError}</p> : null}
              {!searchLoading && !searchError && searchQuery.trim().length >= 2 && customers.length + bookings.length === 0 ? (
                <p className="px-2 py-5 text-sm text-muted-foreground">Ничего не найдено. Попробуйте имя, телефон или маршрут.</p>
              ) : null}
              {customers.length > 0 ? (
                <div className="pb-3">
                  <p className="px-2 py-2 text-xs font-semibold text-muted-foreground">КЛИЕНТЫ</p>
                  {customers.map((customer) => (
                    <Link className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-muted" href="/customers" key={customer.id} onClick={() => setSearchOpen(false)}>
                      <p className="text-sm font-semibold">{customer.fullName}</p>
                      <p className="text-xs text-muted-foreground">{customer.phone}</p>
                    </Link>
                  ))}
                </div>
              ) : null}
              {bookings.length > 0 ? (
                <div className="border-t border-border pt-2">
                  <p className="px-2 py-2 text-xs font-semibold text-muted-foreground">БРОНИРОВАНИЯ И РЕЙСЫ</p>
                  {bookings.map((booking) => (
                    <Link className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-muted" href="/bookings" key={booking.id} onClick={() => setSearchOpen(false)}>
                      <p className="text-sm font-semibold">{booking.origin} → {booking.destination}</p>
                      <p className="text-xs text-muted-foreground">{booking.customerName} · {booking.customerPhone}</p>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
