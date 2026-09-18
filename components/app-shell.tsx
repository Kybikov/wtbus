"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { useLayoutPreferences } from "@/components/layout-preferences-provider"
import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Calendar01Icon,
  Car01Icon,
  DashboardSquare01Icon,
  Notification01Icon,
  Route01Icon,
  Search01Icon,
  Ticket01Icon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type MembershipRole = "owner" | "admin" | "dispatcher" | "driver"
type NavigationItem = {
  href: string
  icon: typeof DashboardSquare01Icon
  label: string
  roles: MembershipRole[]
}
type AppShellProps = {
  children: React.ReactNode
  pageTitle: string
  pageDescription?: string
  localSearch?: {
    value: string
    onChange: (value: string) => void
    placeholder: string
    label?: string
  }
  utilities?: React.ReactNode
  pageActions?: React.ReactNode
}
type ShellBrand = {
  logoUrl?: string
  tenantSlug: string
  tenantName: string
  userInitials: string
  role: MembershipRole
}
type SearchCustomer = { id: string; fullName: string; phone: string }
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
type SidebarVariant = "default" | "inset" | "floating"

const operationsRoles: MembershipRole[] = ["owner", "admin", "dispatcher"]
const managementRoles: MembershipRole[] = ["owner", "admin"]
const navigation: NavigationItem[] = [
  {
    href: "/",
    icon: DashboardSquare01Icon,
    label: "Обзор",
    roles: operationsRoles,
  },
  {
    href: "/trips",
    icon: Calendar01Icon,
    label: "Рейсы",
    roles: operationsRoles,
  },
  {
    href: "/routes",
    icon: Route01Icon,
    label: "Маршруты",
    roles: operationsRoles,
  },
  {
    href: "/availability",
    icon: Calendar01Icon,
    label: "Недоступность",
    roles: operationsRoles,
  },
  {
    href: "/fleet",
    icon: Car01Icon,
    label: "Автопарк",
    roles: operationsRoles,
  },
  {
    href: "/customers",
    icon: UserGroupIcon,
    label: "Клиенты",
    roles: operationsRoles,
  },
  {
    href: "/bookings",
    icon: Ticket01Icon,
    label: "Бронирования",
    roles: operationsRoles,
  },
  {
    href: "/requests",
    icon: Ticket01Icon,
    label: "Индивидуальные заявки",
    roles: operationsRoles,
  },
  {
    href: "/finance",
    icon: Wallet01Icon,
    label: "Финансы",
    roles: managementRoles,
  },
  {
    href: "/team",
    icon: UserGroupIcon,
    label: "Команда",
    roles: managementRoles,
  },
  { href: "/driver", icon: Car01Icon, label: "Мой рейс", roles: ["driver"] },
]
const defaultShellBrand: ShellBrand = {
  logoUrl: "/brand/vivat-bus.png",
  tenantSlug: "vivat-bus",
  tenantName: "Vivat Bus",
  userInitials: "АК",
  role: "owner",
}
const pageDescriptions: Record<string, string> = {
  Обзор: "Оперативная картина на сегодня",
  Рейсы: "Планирование и контроль выездов",
  Маршруты: "Шаблоны регулярных направлений",
  Недоступность: "Периоды недоступности ресурсов",
  Автопарк: "Транспорт и состояние машин",
  Клиенты: "Пассажиры и история обращений",
  Бронирования: "Заявки, оплаты и статусы",
  "Индивидуальные заявки": "Запросы на поездки точка — точка",
  Финансы: "Доходы, расходы и наличные",
  Команда: "Сотрудники и роли доступа",
  Настройки: "Настройки компании и реквизиты",
  "Мой рейс": "Рабочий рейс водителя",
}
const hasItems = <T,>(value: unknown): value is { items: T[] } =>
  typeof value === "object" &&
  value !== null &&
  "items" in value &&
  Array.isArray(value.items)
const isMembershipRole = (value: unknown): value is MembershipRole =>
  value === "owner" ||
  value === "admin" ||
  value === "dispatcher" ||
  value === "driver"
const tenantNameFromSlug = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "АК"

function BrandMark({
  brand,
  className,
}: {
  brand: ShellBrand
  className: string
}) {
  return (
    <span
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-xl bg-black p-1",
        className
      )}
    >
      {brand.logoUrl ? (
        <Image
          alt={brand.tenantName}
          className="object-contain p-1"
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

function AppNavigation({
  items,
  pathname,
}: {
  items: NavigationItem[]
  pathname: string
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenu>
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              isActive={active}
              onClick={() => {
                if (isMobile) setOpenMobile(false)
              }}
              render={<Link href={item.href} />}
              tooltip={item.label}
            >
              <HugeiconsIcon icon={item.icon} strokeWidth={1.8} />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

function VivatSidebar({
  brand,
  items,
  pathname,
  variant,
}: {
  brand: ShellBrand
  items: NavigationItem[]
  pathname: string
  variant: SidebarVariant
}) {
  return (
    <Sidebar
      collapsible="icon"
      className="app-sidebar"
      variant={variant === "default" ? "floating" : variant}
    >
      <SidebarHeader className="h-16 justify-center p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/" />}
              size="lg"
              tooltip="Vivat Bus"
            >
              <BrandMark brand={brand} className="size-10 shrink-0" />
              <span className="flex min-w-0 flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
                <span className="truncate font-bold">{brand.tenantName}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  Диспетчерская
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <ScrollArea className="h-full">
          <SidebarGroup className="pt-2">
            <AppNavigation items={items} pathname={pathname} />
          </SidebarGroup>
        </ScrollArea>
      </SidebarContent>
      <SidebarFooter>
        <div className="h-2 group-data-[collapsible=icon]:hidden" />
      </SidebarFooter>
    </Sidebar>
  )
}

export function AppShell({
  children,
  pageTitle,
  pageDescription,
  localSearch,
  utilities,
  pageActions,
}: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const {
    preferences,
    override: sidebarOverride,
    setSidebarOverride,
  } = useLayoutPreferences()
  const sidebarOpen =
    sidebarOverride?.mode === preferences.sidebarMode
      ? sidebarOverride.open
      : preferences.sidebarMode !== "icon"
  const setSidebarOpen = React.useCallback(
    (open: boolean) => {
      const next = { mode: preferences.sidebarMode, open }
      setSidebarOverride(next)
    },
    [preferences.sidebarMode, setSidebarOverride]
  )
  const [brand, setBrand] = React.useState(defaultShellBrand)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [localSearchMobileOpen, setLocalSearchMobileOpen] =
    React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchLoading, setSearchLoading] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)
  const [customers, setCustomers] = React.useState<SearchCustomer[]>([])
  const [bookings, setBookings] = React.useState<SearchBooking[]>([])
  const [notificationsOpen, setNotificationsOpen] = React.useState(false)
  const [notificationsLoading, setNotificationsLoading] = React.useState(false)
  const [notificationError, setNotificationError] = React.useState<
    string | null
  >(null)
  const [newRequests, setNewRequests] = React.useState<
    TransferRequestPreview[]
  >([])

  React.useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      sessionFetch("/api/branding", { signal: controller.signal }),
      sessionFetch("/api/auth/me", { signal: controller.signal }),
    ])
      .then(async ([brandingResponse, identityResponse]) => {
        const branding: unknown = await brandingResponse
          .json()
          .catch(() => null)
        const identity: unknown = await identityResponse
          .json()
          .catch(() => null)
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
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [])
  React.useEffect(() => {
    const query = searchQuery.trim()
    if (!searchOpen || query.length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      setSearchError(null)
      void Promise.all([
        sessionFetch(`/api/customers?q=${encodeURIComponent(query)}&limit=6`, {
          signal: controller.signal,
        }),
        sessionFetch(`/api/bookings?q=${encodeURIComponent(query)}&limit=8`, {
          signal: controller.signal,
        }),
      ])
        .then(async ([customerResponse, bookingResponse]) => {
          const customerPayload: unknown = await customerResponse
            .json()
            .catch(() => null)
          const bookingPayload: unknown = await bookingResponse
            .json()
            .catch(() => null)
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
  React.useEffect(() => {
    const change = (event: Event) => {
      const detail = (event as CustomEvent<{ logoUrl?: string | null }>).detail
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
    window.addEventListener("vivat-branding-change", change)
    return () => window.removeEventListener("vivat-branding-change", change)
  }, [])
  const loadNotifications = React.useCallback(async () => {
    setNotificationsLoading(true)
    setNotificationError(null)
    try {
      const response = await sessionFetch(
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
  const updateSearchQuery = React.useCallback((value: string) => {
    setSearchQuery(value)
    if (value.trim().length >= 2) return
    setCustomers([])
    setBookings([])
    setSearchError(null)
    setSearchLoading(false)
  }, [])
  const visibleNavigation = navigation.filter((item) =>
    item.roles.includes(brand.role)
  )
  const sidebarWidth = preferences.sidebarMode === "full" ? "18rem" : "15rem"
  const canShowSearchResults =
    searchQuery.trim().length >= 2 && !searchLoading && !searchError
  const navigate = (href: string) => {
    setSearchOpen(false)
    router.push(href)
  }
  const openInterfaceSettings = () => {
    window.dispatchEvent(new Event("vivat-open-interface-settings"))
  }
  const signOut = async () => {
    await sessionFetch("/api/auth/logout", { method: "POST" }).catch(
      () => undefined
    )
    window.location.replace("/login")
  }

  return (
    <SidebarProvider
      className="app-shell-frame min-h-svh gap-2 bg-background p-2 text-foreground"
      onOpenChange={setSidebarOpen}
      open={sidebarOpen}
      style={
        {
          "--sidebar-width": sidebarWidth,
          "--sidebar-width-icon": "3.5rem",
        } as React.CSSProperties
      }
    >
      <VivatSidebar
        brand={brand}
        items={visibleNavigation}
        pathname={pathname}
        variant={preferences.sidebarVariant}
      />
      <SidebarInset className="app-workspace min-w-0 overflow-hidden bg-transparent shadow-none">
        <header className="app-topbar relative flex h-16 shrink-0 items-center justify-between gap-3 rounded-[var(--app-radius)] border border-border bg-card px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <SidebarTrigger
              aria-label="Открыть навигацию"
              className="inline-flex size-9 rounded-lg"
            />
            <div className="hidden min-w-0 border-r border-border pr-3 md:block">
              <p className="truncate text-sm font-semibold">{pageTitle}</p>
              <p className="truncate text-xs text-muted-foreground">
                {pageDescription ?? pageDescriptions[pageTitle] ?? pageTitle}
              </p>
            </div>
            {localSearch ? (
              <label className="hidden h-9 w-44 min-w-0 items-center gap-2 rounded-xl border border-input bg-input/40 px-3 md:flex">
                <HugeiconsIcon
                  className="shrink-0 text-muted-foreground"
                  icon={Search01Icon}
                  size={16}
                />
                <span className="sr-only">
                  {localSearch.label ?? "Поиск на странице"}
                </span>
                <Input
                  aria-label={localSearch.label ?? "Поиск на странице"}
                  className="h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  onChange={(event) => localSearch.onChange(event.target.value)}
                  placeholder={localSearch.placeholder}
                  type="search"
                  value={localSearch.value}
                />
              </label>
            ) : null}
            {!localSearch ? (
              <Button
                aria-haspopup="dialog"
                aria-label="Глобальный поиск"
                className="hidden h-9 justify-start rounded-xl text-muted-foreground md:inline-flex"
                onClick={() => setSearchOpen(true)}
                variant="outline"
              >
                <HugeiconsIcon icon={Search01Icon} size={16} />
                <span className="hidden xl:inline">Глобальный поиск</span>
                <kbd className="rounded-md border border-border px-1.5 py-0.5 text-xs">
                  ⌘K
                </kbd>
              </Button>
            ) : null}
            <p className="max-w-24 truncate text-sm font-semibold md:hidden">
              {pageTitle}
            </p>
            {localSearch ? (
              <Button
                aria-expanded={localSearchMobileOpen}
                aria-label="Поиск на странице"
                className="md:hidden"
                onClick={() => setLocalSearchMobileOpen((open) => !open)}
                size="icon"
                variant="ghost"
              >
                <HugeiconsIcon icon={Search01Icon} strokeWidth={1.8} />
              </Button>
            ) : null}
            {!localSearch ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="Поиск рейса или клиента"
                      className="md:hidden"
                      onClick={() => setSearchOpen(true)}
                      size="icon"
                      variant="ghost"
                    />
                  }
                >
                  <HugeiconsIcon icon={Search01Icon} strokeWidth={1.8} />
                </TooltipTrigger>
                <TooltipContent>Поиск</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {pageActions ? (
              <div className="flex items-center gap-2 max-sm:[&_a]:size-9 max-sm:[&_a]:overflow-hidden max-sm:[&_a]:px-0 max-sm:[&_a]:text-[0px] max-sm:[&_button]:size-9 max-sm:[&_button]:overflow-hidden max-sm:[&_button]:px-0 max-sm:[&_button]:text-[0px] max-sm:[&_svg]:size-4">
                {pageActions}
              </div>
            ) : null}
            <DropdownMenu
              onOpenChange={(open) => {
                setNotificationsOpen(open)
                if (open) void loadNotifications()
              }}
              open={notificationsOpen}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          aria-label="Уведомления"
                          className="relative size-9 rounded-lg"
                          size="icon-lg"
                          variant="ghost"
                        />
                      }
                    />
                  }
                >
                  <HugeiconsIcon icon={Notification01Icon} strokeWidth={1.8} />
                  {newRequests.length > 0 ? (
                    <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                  ) : null}
                </TooltipTrigger>
                <TooltipContent>Уведомления</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="end"
                className="w-[min(23rem,calc(100vw-2rem))] p-2"
              >
                <div className="flex items-center justify-between gap-3 px-2 py-1">
                  <p className="p-0 text-sm font-semibold">Уведомления</p>
                  <Button
                    onClick={() => void loadNotifications()}
                    size="xs"
                    variant="ghost"
                  >
                    Обновить
                  </Button>
                </div>
                <DropdownMenuSeparator />
                {notificationsLoading ? (
                  <p className="px-2 py-4 text-sm text-muted-foreground">
                    Загружаем…
                  </p>
                ) : null}
                {notificationError ? (
                  <p className="mx-1 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {notificationError}
                  </p>
                ) : null}
                {!notificationsLoading &&
                !notificationError &&
                newRequests.length === 0 ? (
                  <p className="px-2 py-4 text-sm text-muted-foreground">
                    Новых заявок нет.
                  </p>
                ) : null}
                {!notificationsLoading && newRequests.length > 0
                  ? newRequests.map((request) => (
                      <DropdownMenuItem
                        key={request.id}
                        render={<Link href="/requests" />}
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold">
                            Новая индивидуальная заявка
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {request.passengerName}: {request.origin} →{" "}
                            {request.destination}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))
                  : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/requests" />}>
                  <span className="font-semibold text-primary">
                    Открыть все заявки
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="Открыть меню профиля"
                    className="ml-0.5 size-9 rounded-full"
                    size="icon-lg"
                    variant="secondary"
                  />
                }
              >
                <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {brand.userInitials}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 p-2">
                <div className="px-2 py-2">
                  <span className="block text-sm font-semibold text-foreground">
                    {brand.tenantName}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    Рабочий профиль
                  </span>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openInterfaceSettings}>
                  Интерфейс
                </DropdownMenuItem>
                {brand.role === "owner" || brand.role === "admin" ? (
                  <DropdownMenuItem render={<Link href="/settings" />}>
                    Настройки компании
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => void signOut()}
                  variant="destructive"
                >
                  Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {localSearch && localSearchMobileOpen ? (
            <div className="absolute top-[calc(100%+.5rem)] right-0 left-0 z-40 rounded-[var(--app-radius)] border border-border bg-popover p-2 shadow-xl md:hidden">
              <div className="flex items-center gap-2 rounded-xl border border-input bg-input/40 px-3">
                <HugeiconsIcon
                  className="shrink-0 text-muted-foreground"
                  icon={Search01Icon}
                  size={16}
                />
                <Input
                  aria-label={localSearch.label ?? "Поиск на странице"}
                  autoFocus
                  className="h-10 rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  onChange={(event) => localSearch.onChange(event.target.value)}
                  placeholder={localSearch.placeholder}
                  type="search"
                  value={localSearch.value}
                />
              </div>
            </div>
          ) : null}
        </header>
        {utilities ? <div className="hidden">{utilities}</div> : null}
        <ScrollArea className="dashboard-content min-h-0 flex-1">
          <div className="px-2 py-3 sm:px-3 sm:py-4">{children}</div>
        </ScrollArea>
      </SidebarInset>
      <CommandDialog
        description="Найдите раздел, рейс, бронирование или клиента."
        onOpenChange={setSearchOpen}
        open={searchOpen}
        title="Поиск"
      >
        <Command onValueChange={updateSearchQuery} value={searchQuery}>
          <CommandInput
            autoFocus
            placeholder="Рейс, маршрут, пассажир или телефон"
          />
          <CommandList className="max-h-[min(32rem,70svh)]">
            {searchQuery.trim().length < 2 ? (
              <CommandGroup heading="РАЗДЕЛЫ">
                {visibleNavigation.map((item) => (
                  <CommandItem
                    key={item.href}
                    onSelect={() => navigate(item.href)}
                    value={item.label}
                  >
                    <HugeiconsIcon
                      icon={item.icon}
                      size={17}
                      strokeWidth={1.8}
                    />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {searchLoading ? (
              <p className="px-3 py-5 text-sm text-muted-foreground">Ищем…</p>
            ) : null}
            {searchError ? (
              <p className="m-1 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {searchError}
              </p>
            ) : null}
            {canShowSearchResults &&
            customers.length + bookings.length === 0 ? (
              <CommandEmpty>
                Ничего не найдено. Попробуйте имя, телефон или маршрут.
              </CommandEmpty>
            ) : null}
            {customers.length > 0 ? (
              <CommandGroup heading="КЛИЕНТЫ">
                {customers.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    onSelect={() => navigate("/customers")}
                    value={`${customer.fullName} ${customer.phone}`}
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {customer.fullName}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {customer.phone}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {bookings.length > 0 ? (
              <CommandGroup heading="БРОНИРОВАНИЯ И РЕЙСЫ">
                {bookings.map((booking) => (
                  <CommandItem
                    key={booking.id}
                    onSelect={() => navigate("/bookings")}
                    value={`${booking.origin} ${booking.destination} ${booking.customerName} ${booking.customerPhone}`}
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {booking.origin} → {booking.destination}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {booking.customerName} · {booking.customerPhone}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </SidebarProvider>
  )
}
