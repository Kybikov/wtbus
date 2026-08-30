"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import Link from "next/link"
import {
  ArrowUpRight01Icon,
  Add01Icon,
  Car01Icon,
  ChartIncreaseIcon,
  Clock01Icon,
  Route01Icon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons"
import { useTheme } from "next-themes"

import { AppShell } from "@/components/app-shell"
import { Button, buttonVariants } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

type ThemePreset = "company" | "gold" | "ocean" | "emerald" | "violet"
type Radius = "sm" | "md" | "lg"
type Scale = "sm" | "md" | "lg"
type SidebarVariant = "default" | "inset" | "floating"
type SidebarMode = "default" | "icon" | "full"

type UIPreferences = {
  configured?: boolean
  theme: "light" | "dark" | "system"
  accent: ThemePreset
  density: "comfortable" | "compact"
  radius: Radius
  scale: Scale
  sidebarVariant: SidebarVariant
  sidebarMode: SidebarMode
}

const presets: Record<
  Exclude<ThemePreset, "company">,
  { label: string; primary: string; foreground: string }
> = {
  gold: {
    label: "Vivat Gold",
    primary: "oklch(0.78 0.15 82)",
    foreground: "oklch(0.18 0.015 80)",
  },
  ocean: {
    label: "Ocean",
    primary: "oklch(0.72 0.13 230)",
    foreground: "oklch(0.18 0.02 230)",
  },
  emerald: {
    label: "Emerald",
    primary: "oklch(0.73 0.15 157)",
    foreground: "oklch(0.18 0.02 157)",
  },
  violet: {
    label: "Violet",
    primary: "oklch(0.7 0.16 295)",
    foreground: "oklch(0.2 0.025 295)",
  },
}

type DashboardTrip = {
  id: string
  origin: string
  destination: string
  startsAt: string
  status: string
  vehicle: string
  driver: string
  capacity: number
  bookedSeats: number
}

type DashboardVehicle = {
  id: string
  name: string
  route: string
  tripStatus?: string
  capacity: number
  bookedSeats: number
  occupancyPercent: number
}

type Dashboard = {
  date: string
  timezone: string
  currency: string
  tripCount: number
  passengerCount: number
  vehiclesOnLine: number
  activeVehicleCount: number
  expectedRevenueMinor: number
  trips: DashboardTrip[]
  vehicles: DashboardVehicle[]
}

const tripStatusMeta: Record<
  string,
  { label: string; tone: "sky" | "gold" | "slate" | "violet" }
> = {
  draft: { label: "Черновик", tone: "slate" },
  new: { label: "Новый", tone: "slate" },
  assigned: { label: "Назначен", tone: "violet" },
  in_progress: { label: "В пути", tone: "sky" },
  completed: { label: "Завершен", tone: "gold" },
}

function isUIPreferences(value: unknown): value is UIPreferences {
  return (
    typeof value === "object" &&
    value !== null &&
    "theme" in value &&
    (value.theme === "light" ||
      value.theme === "dark" ||
      value.theme === "system") &&
    "accent" in value &&
    (value.accent === "company" ||
      (typeof value.accent === "string" && value.accent in presets)) &&
    "density" in value &&
    (value.density === "comfortable" || value.density === "compact") &&
    "radius" in value &&
    (value.radius === "sm" || value.radius === "md" || value.radius === "lg") &&
    "scale" in value &&
    (value.scale === "sm" || value.scale === "md" || value.scale === "lg") &&
    "sidebarVariant" in value &&
    (value.sidebarVariant === "default" ||
      value.sidebarVariant === "inset" ||
      value.sidebarVariant === "floating") &&
    "sidebarMode" in value &&
    (value.sidebarMode === "default" ||
      value.sidebarMode === "icon" ||
      value.sidebarMode === "full")
  )
}

function isDashboard(value: unknown): value is Dashboard {
  return (
    typeof value === "object" &&
    value !== null &&
    "date" in value &&
    typeof value.date === "string" &&
    "currency" in value &&
    typeof value.currency === "string" &&
    "trips" in value &&
    Array.isArray(value.trips) &&
    "vehicles" in value &&
    Array.isArray(value.vehicles)
  )
}

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100)
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value))
}

function formatDashboardDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date(`${value}T12:00:00Z`))
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
}) {
  return (
    <ToggleGroup
      className="grid w-full grid-flow-col auto-cols-fr rounded-xl border border-border bg-background/40 p-1"
      onValueChange={(next) => {
        const value = next[0]
        if (value) onChange(value as T)
      }}
      spacing={0}
      value={[value]}
    >
      {options.map((option) => (
        <ToggleGroupItem
          className={cn(
            "w-full rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
            value === option.value
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function ThemeCustomizer() {
  const { resolvedTheme, setTheme, theme } = useTheme()
  const [open, setOpen] = React.useState(false)
  const [preset, setPreset] = React.useState<ThemePreset>("company")
  const [companyAccent, setCompanyAccent] = React.useState("#E9B74D")
  const [radius, setRadius] = React.useState<Radius>("lg")
  const [compact, setCompact] = React.useState(false)
  const [scale, setScale] = React.useState<Scale>("md")
  const [sidebarVariant, setSidebarVariant] =
    React.useState<SidebarVariant>("default")
  const [sidebarMode, setSidebarMode] = React.useState<SidebarMode>("default")
  const [preferencesReady, setPreferencesReady] = React.useState(false)
  const hasLoadedPreferences = React.useRef(false)
  const hasPersonalThemePreference = React.useRef(false)

  React.useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener("vivat-open-interface-settings", show)
    return () => window.removeEventListener("vivat-open-interface-settings", show)
  }, [])

  React.useEffect(() => {
    if (hasLoadedPreferences.current) return

    hasLoadedPreferences.current = true
    const controller = new AbortController()
    let localPreferences: UIPreferences | null = null
    const saved = window.localStorage.getItem("vivat-ui-preferences")
    if (saved) {
      try {
        const preferences = JSON.parse(saved) as Partial<{
          preset: ThemePreset
          radius: Radius
          compact: boolean
          scale: Scale
          sidebarVariant: SidebarVariant
          sidebarMode: SidebarMode
          theme: "light" | "dark" | "system"
        }>
        if (
          preferences.preset &&
          preferences.radius &&
          typeof preferences.compact === "boolean" &&
          preferences.scale &&
          preferences.sidebarVariant &&
          preferences.sidebarMode &&
          preferences.theme &&
          (preferences.preset === "company" || presets[preferences.preset])
        ) {
          localPreferences = {
            theme: preferences.theme,
            accent: preferences.preset,
            density: preferences.compact ? "compact" : "comfortable",
            radius: preferences.radius,
            scale: preferences.scale,
            sidebarVariant: preferences.sidebarVariant,
            sidebarMode: preferences.sidebarMode,
          }
        }
      } catch {
        window.localStorage.removeItem("vivat-ui-preferences")
      }
    }

    function applyPreferences(preferences: UIPreferences) {
      React.startTransition(() => {
        setPreset(preferences.accent)
        setRadius(preferences.radius)
        setCompact(preferences.density === "compact")
        setScale(preferences.scale)
        setSidebarVariant(preferences.sidebarVariant)
        setSidebarMode(preferences.sidebarMode)
        hasPersonalThemePreference.current = true
        setTheme(preferences.theme)
      })
    }

    void (async () => {
      try {
        const response = await fetch("/api/preferences", {
          signal: controller.signal,
        })
        const payload: unknown = await response.json().catch(() => null)
        if (response.ok && isUIPreferences(payload) && payload.configured) {
          applyPreferences(payload)
        } else if (localPreferences) {
          applyPreferences(localPreferences)
        }
      } catch {
        if (!controller.signal.aborted && localPreferences)
          applyPreferences(localPreferences)
      } finally {
        if (!controller.signal.aborted)
          React.startTransition(() => setPreferencesReady(true))
      }
    })()

    return () => controller.abort()
  }, [setTheme])

  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/branding", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json()
        if (
          response.ok &&
          typeof payload === "object" &&
          payload !== null &&
          "primaryColor" in payload &&
          typeof payload.primaryColor === "string" &&
          "defaultTheme" in payload &&
          (payload.defaultTheme === "light" ||
            payload.defaultTheme === "dark" ||
            payload.defaultTheme === "system")
        ) {
          setCompanyAccent(payload.primaryColor)
          if (!hasPersonalThemePreference.current)
            setTheme(payload.defaultTheme)
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [setTheme])

  React.useEffect(() => {
    const onBrandingChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          primaryColor?: string
          defaultTheme?: "light" | "dark" | "system"
        }>
      ).detail
      const primaryColor = detail?.primaryColor
      if (typeof primaryColor === "string") setCompanyAccent(primaryColor)
      if (
        !hasPersonalThemePreference.current &&
        (detail?.defaultTheme === "light" ||
          detail?.defaultTheme === "dark" ||
          detail?.defaultTheme === "system")
      )
        setTheme(detail.defaultTheme)
    }
    window.addEventListener("vivat-branding-change", onBrandingChange)
    return () =>
      window.removeEventListener("vivat-branding-change", onBrandingChange)
  }, [setTheme])

  React.useEffect(() => {
    const root = document.documentElement
    const current =
      preset === "company"
        ? { primary: companyAccent, foreground: colorInk(companyAccent) }
        : presets[preset]
    root.style.setProperty("--primary", current.primary)
    root.style.setProperty("--primary-foreground", current.foreground)
    root.style.setProperty("--sidebar-primary", current.primary)
    root.style.setProperty("--sidebar-primary-foreground", current.foreground)
    root.style.setProperty("--ring", current.primary)
    root.dataset.radius = radius
    root.dataset.density = compact ? "compact" : "comfortable"
    root.dataset.scale = scale
    root.dataset.sidebarVariant = sidebarVariant
    root.dataset.sidebarMode = sidebarMode
  }, [
    compact,
    companyAccent,
    preset,
    radius,
    scale,
    sidebarMode,
    sidebarVariant,
  ])

  React.useEffect(() => {
    if (!preferencesReady) return

    const preferences: UIPreferences = {
      theme:
        theme === "system"
          ? "system"
          : resolvedTheme === "light"
            ? "light"
            : "dark",
      accent: preset,
      density: compact ? "compact" : "comfortable",
      radius,
      scale,
      sidebarVariant,
      sidebarMode,
    }
    window.localStorage.setItem(
      "vivat-ui-preferences",
      JSON.stringify({
        preset,
        radius,
        compact,
        scale,
        sidebarVariant,
        sidebarMode,
        theme: preferences.theme,
      })
    )
    const timer = window.setTimeout(() => {
      void fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [
    compact,
    preferencesReady,
    preset,
    radius,
    resolvedTheme,
    scale,
    sidebarMode,
    sidebarVariant,
    theme,
  ])

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="max-h-[min(46rem,calc(100svh-2rem))] max-w-[min(28rem,calc(100vw-2rem))] gap-0 overflow-y-auto p-5 sm:max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>Интерфейс</DialogTitle>
          <DialogDescription>
            Настройте отображение рабочего пространства.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-xs font-bold">Цветовой акцент</span>
              <FieldSelect
                onValueChange={(value) => setPreset(value as ThemePreset)}
                options={[
                  { value: "company", label: "Цвет компании" },
                  ...Object.entries(presets).map(([value, option]) => ({
                    value,
                    label: option.label,
                  })),
                ]}
                triggerClassName="h-9 text-sm"
                value={preset}
              />
            </label>
            <div className="space-y-2">
              <span className="block text-xs font-bold">Режим</span>
              <SegmentedControl
                value={
                  theme === "system"
                    ? "system"
                    : resolvedTheme === "light"
                      ? "light"
                      : "dark"
                }
                onChange={setTheme}
                options={[
                  { value: "light", label: "Светлый" },
                  { value: "dark", label: "Тёмный" },
                  { value: "system", label: "Система" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <span className="block text-xs font-bold">Скругление</span>
              <SegmentedControl
                value={radius}
                onChange={setRadius}
                options={[
                  { value: "sm", label: "S" },
                  { value: "md", label: "M" },
                  { value: "lg", label: "L" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <span className="block text-xs font-bold">Плотность</span>
              <SegmentedControl
                value={compact ? "compact" : "full"}
                onChange={(value) => setCompact(value === "compact")}
                options={[
                  { value: "compact", label: "Компактно" },
                  { value: "full", label: "Свободно" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <span className="block text-xs font-bold">Масштаб</span>
              <SegmentedControl
                value={scale}
                onChange={setScale}
                options={[
                  { value: "sm", label: "S" },
                  { value: "md", label: "M" },
                  { value: "lg", label: "L" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <span className="block text-xs font-bold">Вид sidebar</span>
              <SegmentedControl
                value={sidebarVariant}
                onChange={setSidebarVariant}
                options={[
                  { value: "default", label: "Обычный" },
                  { value: "inset", label: "Вставка" },
                  { value: "floating", label: "Плавающий" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <span className="block text-xs font-bold">Режим sidebar</span>
              <SegmentedControl
                value={sidebarMode}
                onChange={setSidebarMode}
                options={[
                  { value: "default", label: "Обычный" },
                  { value: "icon", label: "Иконки" },
                  { value: "full", label: "Широкий" },
                ]}
              />
            </div>
          </div>
          <p className="mt-5 border-t border-border pt-3 text-xs leading-4 text-muted-foreground">
            Настройки сохраняются в профиле и синхронизируются между устройствами.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function colorInk(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance > 150 ? "#191914" : "#FFFFFF"
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  trend,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Car01Icon
  trend?: string
}) {
  return (
    <article className="metric-card surface-card flex min-h-36 flex-col justify-between p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
        <span className="grid size-9 place-items-center rounded-xl bg-primary/12 text-primary">
          <HugeiconsIcon icon={Icon} size={18} strokeWidth={1.8} />
        </span>
      </div>
      <div>
        <p className="text-3xl font-bold tracking-[-0.04em] tabular-nums">
          {value}
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {trend ? (
            <span className="font-bold text-emerald-500">{trend}</span>
          ) : null}
          {detail}
        </p>
      </div>
    </article>
  )
}

export function OperationsDashboard() {
  const [dashboard, setDashboard] = React.useState<Dashboard | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [nowMillis, setNowMillis] = React.useState(0)

  React.useEffect(() => {
    function updateNow() {
      setNowMillis(Date.now())
    }
    updateNow()
    const timer = window.setInterval(updateNow, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  React.useEffect(() => {
    let disposed = false

    async function loadDashboard() {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" })
        const payload: unknown = await response.json()
        if (!response.ok || !isDashboard(payload)) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : "Не удалось загрузить оперативную сводку."
          throw new Error(message)
        }
        if (disposed) return
        setDashboard(payload)
        setLoadError(null)
      } catch (error: unknown) {
        if (disposed) return
        setLoadError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить оперативную сводку."
        )
      } finally {
        if (!disposed) setIsLoading(false)
      }
    }

    void loadDashboard()
    const timer = window.setInterval(() => void loadDashboard(), 30_000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  const upcomingTrip =
    nowMillis > 0
      ? dashboard?.trips.find(
          (trip) => new Date(trip.startsAt).getTime() >= nowMillis
        )
      : undefined

  return (
    <AppShell
      pageActions={
        <Link className={buttonVariants({ size: "lg" })} href="/trips">
          <HugeiconsIcon icon={Add01Icon} size={16} />
          Создать рейс
        </Link>
      }
      pageTitle="Обзор"
      utilities={<ThemeCustomizer />}
    >
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.035em] sm:text-3xl">
              Оперативная сводка
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Контролируйте рейсы, загрузку и команду в течение дня.
            </p>
          </div>
        </div>
        {loadError ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            <span>{loadError}</span>
            <Link
              className="font-semibold underline underline-offset-4"
              href="/trips"
            >
              Открыть рейсы
            </Link>
          </div>
        ) : null}
        <section
          aria-label="Ключевые показатели"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <Metric
            detail={
              dashboard
                ? `на ${formatDashboardDate(dashboard.date, dashboard.timezone)}`
                : "загружаем данные"
            }
            icon={Route01Icon}
            label="Рейсов"
            value={dashboard ? String(dashboard.tripCount) : "—"}
          />
          <Metric
            detail="мест забронировано на сегодня"
            icon={UserGroupIcon}
            label="Пассажиров"
            value={dashboard ? String(dashboard.passengerCount) : "—"}
          />
          <Metric
            detail="активных машин на линии"
            icon={Car01Icon}
            label="Автопарк"
            value={
              dashboard
                ? `${dashboard.vehiclesOnLine} / ${dashboard.activeVehicleCount}`
                : "—"
            }
          />
          <Metric
            detail="включая ожидающие и наличные брони"
            icon={Wallet01Icon}
            label="Ожидаемая выручка"
            value={
              dashboard
                ? formatMoney(
                    dashboard.expectedRevenueMinor,
                    dashboard.currency
                  )
                : "—"
            }
          />
        </section>
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(19rem,0.8fr)]">
          <article className="surface-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-bold">Ближайшие рейсы</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dashboard
                    ? `Расписание на ${formatDashboardDate(dashboard.date, dashboard.timezone)}`
                    : "Загружаем расписание…"}
                </p>
              </div>
              <Link
                className={buttonVariants({ size: "sm", variant: "ghost" })}
                href="/trips"
              >
                Все рейсы
              </Link>
            </div>
            <div className="divide-y divide-border">
              {isLoading ? (
                <p className="px-5 py-7 text-sm text-muted-foreground">
                  Загружаем рейсы…
                </p>
              ) : null}
              {!isLoading && dashboard?.trips.length === 0 ? (
                <div className="px-5 py-7">
                  <p className="text-sm font-semibold">На сегодня рейсов нет</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Создайте регулярный или индивидуальный рейс в планировщике.
                  </p>
                </div>
              ) : null}
              {dashboard?.trips.map((trip) => {
                const meta = tripStatusMeta[trip.status] ?? {
                  label: trip.status,
                  tone: "slate" as const,
                }
                return (
                  <div
                    className="trip-row grid grid-cols-[3rem_minmax(8rem,1fr)_auto] items-center gap-3 px-5 py-4 sm:grid-cols-[4rem_minmax(10rem,1.3fr)_minmax(8rem,1fr)_minmax(7rem,1fr)_auto]"
                    key={trip.id}
                  >
                    <div className="text-sm font-bold tabular-nums">
                      {formatTime(trip.startsAt, dashboard.timezone)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {trip.origin} → {trip.destination}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                        {trip.vehicle || "Транспорт не назначен"} ·{" "}
                        {trip.bookedSeats}/{trip.capacity} мест
                      </p>
                    </div>
                    <p className="hidden text-sm text-muted-foreground sm:block">
                      {trip.vehicle || "Не назначен"}
                    </p>
                    <p className="hidden text-sm text-muted-foreground sm:block">
                      {trip.driver ||
                        `${trip.bookedSeats}/${trip.capacity} мест`}
                    </p>
                    <span
                      className={cn(
                        "justify-self-end rounded-full px-2.5 py-1 text-xs font-bold",
                        `status-${meta.tone}`
                      )}
                    >
                      {meta.label}
                    </span>
                  </div>
                )
              })}
            </div>
            <Link
              className="flex w-full items-center justify-center gap-2 border-t border-border px-5 py-3 text-sm font-bold text-primary hover:bg-muted"
              href="/trips"
            >
              Открыть календарь{" "}
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} />
            </Link>
          </article>
          <article className="surface-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold">Загрузка автопарка</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Бронь и план рейсов на сегодня
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-bold text-primary">
                <span className="size-2 rounded-full bg-primary" />
                {dashboard?.vehiclesOnLine ? "На линии" : "Нет рейсов"}
              </span>
            </div>
            <div className="mt-7 space-y-5">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">
                  Загружаем автопарк…
                </p>
              ) : null}
              {!isLoading && dashboard?.vehicles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Активного транспорта пока нет.
                </p>
              ) : null}
              {dashboard?.vehicles.map((vehicle) => (
                <div key={vehicle.id}>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{vehicle.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {vehicle.route || "Свободен сегодня"}
                      </p>
                    </div>
                    <span className="text-sm font-bold tabular-nums">
                      {vehicle.bookedSeats}/{vehicle.capacity}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${vehicle.occupancyPercent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-7 flex items-center justify-between rounded-2xl bg-secondary p-3">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-xl bg-background text-primary">
                  <HugeiconsIcon icon={Clock01Icon} size={16} />
                </span>
                <div>
                  <p className="text-xs font-bold">Ближайший выезд</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {upcomingTrip && dashboard
                      ? `${formatTime(upcomingTrip.startsAt, dashboard.timezone)} · ${upcomingTrip.origin} → ${upcomingTrip.destination}`
                      : "На сегодня новых выездов нет"}
                  </p>
                </div>
              </div>
              <HugeiconsIcon
                className="text-primary"
                icon={ChartIncreaseIcon}
                size={18}
              />
            </div>
          </article>
        </section>
      </div>
    </AppShell>
  )
}
