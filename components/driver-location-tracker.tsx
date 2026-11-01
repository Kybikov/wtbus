"use client"
import { AccountingWorkspace } from "@/components/accounting-workspace"
import { useActionConfirmation } from "@/components/action-confirmation"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { realtimeEvent } from "@/lib/realtime"
import { AppShell } from "@/components/app-shell"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Clock01Icon, Route01Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { DriverPassengerManifest } from "@/components/driver-passenger-manifest"
import { useDriverGPS } from "@/hooks/use-driver-gps"

type FleetTrip = {
  id: string
  status: "assigned" | "in_progress"
  origin: string
  destination: string
  startsAt: string
  actualStartedAt?: string
  statusPhase?: "assigned" | "in_progress"
}

type Vehicle = {
  id: string
  name: string
  registrationNumber: string
  activeTrip?: FleetTrip
}

type FleetResponse = { items: Vehicle[]; timezone?: string }

type DriverCashSummaryItem = {
  tripId: string
  amountMinor: number
  currency: string
  collectedMinor: number
}

type DriverCashSummaryResponse = { item: DriverCashSummaryItem | null }

type DriverBranding = {
  companyName: string
  primaryColor: string
}

type DriverIdentity = { tenantSlug: string; membershipId: string; role: string }

function isFleetResponse(value: unknown): value is FleetResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

function isDriverBranding(value: unknown): value is DriverBranding {
  return (
    typeof value === "object" &&
    value !== null &&
    "companyName" in value &&
    typeof value.companyName === "string" &&
    "primaryColor" in value &&
    typeof value.primaryColor === "string"
  )
}

function isDriverCashSummaryResponse(
  value: unknown
): value is DriverCashSummaryResponse {
  if (typeof value !== "object" || value === null || !("item" in value))
    return false
  if (value.item === null) return true
  return (
    typeof value.item === "object" &&
    value.item !== null &&
    "tripId" in value.item &&
    typeof value.item.tripId === "string" &&
    "amountMinor" in value.item &&
    typeof value.item.amountMinor === "number" &&
    "currency" in value.item &&
    typeof value.item.currency === "string" &&
    "collectedMinor" in value.item &&
    typeof value.item.collectedMinor === "number"
  )
}

function applyDriverBrand(primaryColor: string) {
  const root = document.documentElement
  root.style.setProperty("--primary", primaryColor)
  root.style.setProperty("--sidebar-primary", primaryColor)
  root.style.setProperty("--ring", primaryColor)
  const red = Number.parseInt(primaryColor.slice(1, 3), 16)
  const green = Number.parseInt(primaryColor.slice(3, 5), 16)
  const blue = Number.parseInt(primaryColor.slice(5, 7), 16)
  const foreground =
    (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#191914" : "#FFFFFF"
  root.style.setProperty("--primary-foreground", foreground)
  root.style.setProperty("--sidebar-primary-foreground", foreground)
}

function timeLabel(value: Date | null) {
  if (!value) return "ещё не передавалась"
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value)
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100)
}

export function DriverLocationTracker() {
  const confirm = useActionConfirmation()
  const router = useRouter()
  const [timezone, setTimezone] = React.useState<string | undefined>()
  const [vehicles, setVehicles] = React.useState<Vehicle[]>([])
  const [cashSummary, setCashSummary] =
    React.useState<DriverCashSummaryItem | null>(null)
  const [section, setSection] = React.useState("passengers")
  const [loading, setLoading] = React.useState(true)
  const [cashLoading, setCashLoading] = React.useState(true)
  const [walletRefresh, setWalletRefresh] = React.useState(0)
  const [updatingTripStatus, setUpdatingTripStatus] = React.useState(false)
  const [identity, setIdentity] = React.useState<DriverIdentity | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const loadInFlight = React.useRef(false)
  const selectedVehicle = vehicles
    .filter((vehicle) => vehicle.activeTrip)
    .sort(
      (a, b) =>
        Number(b.activeTrip?.status === "in_progress") -
          Number(a.activeTrip?.status === "in_progress") ||
        Date.parse(a.activeTrip?.startsAt ?? "") -
          Date.parse(b.activeTrip?.startsAt ?? "")
    )[0]
  const gps = useDriverGPS(
    identity && selectedVehicle?.activeTrip
      ? {
          scope: identity.tenantSlug + ":" + identity.membershipId,
          membershipId: identity.membershipId,
          vehicleId: selectedVehicle.id,
          tripId: selectedVehicle.activeTrip.id,
        }
      : null
  )
  const {
    tracking,
    locating: sending,
    lastSent,
    pending: pendingCount,
    online,
  } = gps

  const loadFleet = React.useCallback(async () => {
    if (loadInFlight.current) return
    loadInFlight.current = true
    try {
      const sessionResponse = await sessionFetch("/api/auth/me", {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      })
      const session = await sessionResponse.json().catch(() => null)
      if (
        sessionResponse.ok &&
        typeof session?.role === "string" &&
        session.role !== "driver" &&
        session.role !== "developer"
      ) {
        setIdentity(null)
        setVehicles([])
        router.replace("/")
        return
      }
      if (
        !sessionResponse.ok ||
        (session?.role !== "driver" && session?.role !== "developer") ||
        typeof session?.membershipId !== "string" ||
        typeof session?.tenantSlug !== "string"
      ) {
        if (
          sessionResponse.status === 401 ||
          sessionResponse.status === 403 ||
          (sessionResponse.ok &&
            session?.role !== "driver" &&
            session?.role !== "developer")
        ) {
          setIdentity(null)
          setVehicles([])
        }
        throw new Error(
          "Не удалось подтвердить доступ водителя. Проверьте связь или войдите снова."
        )
      }
      const response = await sessionFetch("/api/fleet", {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      })
      const payload: unknown = await response.json()
      if (!response.ok || !isFleetResponse(payload))
        throw new Error("Не удалось получить список автомобиля.")
      setVehicles(
        payload.items.map((vehicle) => ({
          ...vehicle,
          activeTrip: vehicle.activeTrip
            ? {
                ...vehicle.activeTrip,
                status:
                  vehicle.activeTrip.statusPhase ?? vehicle.activeTrip.status,
              }
            : undefined,
        }))
      )
      setTimezone(payload.timezone)
      setIdentity(session)
      setError(null)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось получить список автомобиля."
      )
    } finally {
      loadInFlight.current = false
      setLoading(false)
    }
  }, [router])

  const loadCashSummary = React.useCallback(async () => {
    setCashLoading(true)
    try {
      const response = await sessionFetch("/api/driver-cash", {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isDriverCashSummaryResponse(payload))
        throw new Error("Не удалось получить сумму наличных.")
      setCashSummary(payload.item)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось получить сумму наличных."
      )
    } finally {
      setCashLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFleet()
    }, 0)
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadFleet()
        if (identity?.role === "driver") void loadCashSummary()
      }
    }
    const poll = window.setInterval(refresh, 30_000)
    window.addEventListener("online", refresh)
    window.addEventListener(realtimeEvent, refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
      window.removeEventListener("online", refresh)
      window.removeEventListener(realtimeEvent, refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [identity?.role, loadCashSummary, loadFleet])

  React.useEffect(() => {
    if (identity?.role !== "driver") return
    const timer = window.setTimeout(() => void loadCashSummary(), 0)
    return () => window.clearTimeout(timer)
  }, [identity?.role, loadCashSummary])

  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/branding", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok || !isDriverBranding(payload)) return
        applyDriverBrand(payload.primaryColor)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  async function changeTripStatus(status: "in_progress" | "completed") {
    const tripID = selectedVehicle?.activeTrip?.id
    if (!tripID || updatingTripStatus) return
    if (
      status === "completed" &&
      cashSummary?.tripId === tripID &&
      cashSummary.collectedMinor !== cashSummary.amountMinor
    ) {
      setError("Сначала подтвердите получение наличных по этому рейсу.")
      return
    }
    const action = status === "in_progress" ? "начать" : "завершить"
    if (
      !(await confirm({
        title: `${status === "in_progress" ? "Начать" : "Завершить"} рейс?`,
        description: `Подтвердите: ${action} рейс ${selectedVehicle?.activeTrip?.origin} → ${selectedVehicle?.activeTrip?.destination}.`,
        label: status === "in_progress" ? "Начать рейс" : "Завершить рейс",
        tone: "archive",
      }))
    )
      return
    setUpdatingTripStatus(true)
    setError(null)
    try {
      if (status === "completed" && !(await gps.prepareCompletion())) {
        throw new Error(
          "Сначала отправьте сохранённые GPS-точки. Восстановите связь и повторите завершение рейса."
        )
      }
      const response = await sessionFetch(
        `/api/trips?id=${encodeURIComponent(tripID)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
          signal: AbortSignal.timeout(12_000),
        }
      )
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Не удалось изменить статус рейса."
        throw new Error(message)
      }
      await Promise.all([loadFleet(), loadCashSummary()])
      setWalletRefresh((value) => value + 1)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить статус рейса."
      )
    } finally {
      setUpdatingTripStatus(false)
    }
  }

  const refreshPassengerMoney = React.useCallback(() => {
    void loadCashSummary()
    setWalletRefresh((value) => value + 1)
  }, [loadCashSummary])

  const activeTripID = selectedVehicle?.activeTrip?.id
  React.useEffect(() => {
    if (!loading) {
      const timer = window.setTimeout(
        () => setSection(activeTripID ? "passengers" : "money"),
        0
      )
      return () => window.clearTimeout(timer)
    }
  }, [activeTripID, loading])

  return (
    <AppShell
      pageTitle="Мой рейс"
      pageDescription="Пассажиры, наличные и передача геолокации"
      onRefresh={async () => {
        await loadFleet()
        if (identity?.role === "driver") await loadCashSummary()
        setWalletRefresh((value) => value + 1)
      }}
    >
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-5 lg:rounded-3xl lg:border lg:border-border lg:bg-card lg:p-7">
        {selectedVehicle?.activeTrip ? (
          <>
            <div className="border-b border-border pb-5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-8">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold tracking-[.08em] text-muted-foreground uppercase">
                  <HugeiconsIcon icon={Route01Icon} size={15} />
                  Активный рейс
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">
                  {selectedVehicle.activeTrip.origin} →{" "}
                  {selectedVehicle.activeTrip.destination}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Отправление:{" "}
                  {new Intl.DateTimeFormat("ru-RU", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: timezone,
                  }).format(new Date(selectedVehicle.activeTrip.startsAt))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedVehicle.name} · {selectedVehicle.registrationNumber}{" "}
                  ·{" "}
                  {selectedVehicle.activeTrip.status === "in_progress"
                    ? "Рейс выполняется"
                    : "Рейс назначен"}
                </p>
                {selectedVehicle.activeTrip.actualStartedAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Фактический выезд:{" "}
                    {new Intl.DateTimeFormat("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: timezone,
                    }).format(
                      new Date(selectedVehicle.activeTrip.actualStartedAt)
                    )}
                  </p>
                ) : null}
              </div>
              <div className="lg:flex lg:items-center">
                {selectedVehicle.activeTrip.status === "assigned" ? (
                  <Button
                    className="mt-4 w-full lg:mt-0 lg:w-auto lg:min-w-48"
                    disabled={updatingTripStatus}
                    disabledReason={
                      "Статус рейса меняется. Дождитесь завершения."
                    }
                    onClick={() => void changeTripStatus("in_progress")}
                    size="lg"
                  >
                    {updatingTripStatus ? "Начинаем рейс…" : "Начать рейс"}
                  </Button>
                ) : (
                  <Button
                    className="mt-4 w-full lg:mt-0 lg:w-auto lg:min-w-48"
                    disabled={
                      updatingTripStatus ||
                      cashLoading ||
                      (cashSummary?.tripId === selectedVehicle.activeTrip.id &&
                        cashSummary.collectedMinor !== cashSummary.amountMinor)
                    }
                    disabledReason={
                      updatingTripStatus
                        ? "Статус рейса меняется. Дождитесь завершения."
                        : cashLoading
                          ? "Проверяем оплату пассажиров. Дождитесь результата."
                          : "Сначала подтвердите получение всех наличных оплат этого рейса."
                    }
                    onClick={() => void changeTripStatus("completed")}
                    size="lg"
                  >
                    {updatingTripStatus
                      ? "Завершаем рейс…"
                      : cashLoading
                        ? "Проверяем наличные…"
                        : "Завершить рейс"}
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
            <div>
              <h1 className="text-xl font-semibold">Мой рейс</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {loading
                  ? "Загружаем назначения…"
                  : "Назначенного рейса пока нет."}
              </p>
            </div>
          </div>
        )}

        <Tabs
          value={section}
          onValueChange={(value) => setSection(String(value))}
        >
          <TabsList
            className="!h-11 w-full lg:w-fit"
            aria-label="Разделы водителя"
          >
            <TabsTrigger className="lg:px-6" value="passengers">
              Пассажиры
            </TabsTrigger>
            <TabsTrigger className="lg:px-6" value="money">
              Касса
            </TabsTrigger>
            <TabsTrigger className="lg:px-6" value="gps">
              GPS
            </TabsTrigger>
          </TabsList>
          <TabsContent value="passengers" className="pt-3">
            {selectedVehicle?.activeTrip ? (
              <>
                <DriverPassengerManifest
                  key={selectedVehicle.activeTrip.id}
                  tripId={selectedVehicle.activeTrip.id}
                  onChange={refreshPassengerMoney}
                />
                {cashSummary?.tripId === selectedVehicle.activeTrip.id &&
                cashSummary.amountMinor > 0 ? (
                  <section className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <h2 className="text-sm font-bold">Наличные по рейсу</h2>
                    <p className="font-semibold tabular-nums">
                      {formatMoney(
                        cashSummary.amountMinor,
                        cashSummary.currency
                      )}
                    </p>
                    <p className="mt-2 text-sm">
                      Получено:{" "}
                      {formatMoney(
                        cashSummary.collectedMinor,
                        cashSummary.currency
                      )}
                    </p>
                  </section>
                ) : cashLoading ? (
                  <div className="mt-4 h-28 animate-pulse rounded-2xl border border-border bg-muted/40" />
                ) : null}
              </>
            ) : (
              <p className="py-6 text-sm text-muted-foreground">
                Пассажиры появятся после назначения рейса.
              </p>
            )}
          </TabsContent>
          <TabsContent value="money" className="pt-3">
            {identity ? (
              <AccountingWorkspace
                driver
                manageDriverAccess={identity.role === "developer"}
                refreshKey={walletRefresh}
              />
            ) : null}
          </TabsContent>
          <TabsContent value="gps" className="pt-3">
            {error || gps.error ? (
              <div
                role="alert"
                className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error || gps.error}
                {gps.authRequired ? (
                  <Link
                    className="mt-2 block underline"
                    href="/login?next=/driver"
                  >
                    Войти снова
                  </Link>
                ) : null}
              </div>
            ) : null}
            {!online || pendingCount > 0 ? (
              <div
                role="status"
                className="mt-4 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-foreground"
              >
                <p className="font-semibold">
                  {online
                    ? "Точки ожидают отправки"
                    : "Нет сети — точки сохраняются на телефоне"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {pendingCount > 0
                    ? `В очереди: ${pendingCount}. Они отправятся автоматически при восстановлении связи.`
                    : "Новые точки будут поставлены в очередь до появления интернета."}
                </p>
              </div>
            ) : null}

            {selectedVehicle?.activeTrip && identity?.role === "driver" ? (
              <div className="space-y-4">
                <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <span
                    className={
                      tracking &&
                      gps.fresh &&
                      online &&
                      pendingCount === 0 &&
                      !gps.error
                        ? "size-2 rounded-full bg-emerald-500"
                        : "size-2 rounded-full bg-muted-foreground/50"
                    }
                  />
                  <HugeiconsIcon icon={Clock01Icon} size={15} />
                  Последняя отправка: {timeLabel(lastSent)}
                </div>
                <div
                  className="mb-4 space-y-2 text-sm text-muted-foreground"
                  role="status"
                >
                  <p>
                    {tracking
                      ? gps.fresh
                        ? "GPS включён"
                        : "GPS включён · ожидаем свежую позицию"
                      : "GPS остановлен"}
                    {gps.accuracy !== null
                      ? ` · точность ±${Math.round(gps.accuracy)} м`
                      : ""}
                  </p>
                  {gps.notice ? <p>{gps.notice}</p> : null}
                  {tracking ? (
                    <p>
                      {gps.wakeLocked
                        ? "Экран удерживается включённым."
                        : "Держите экран включённым: браузер не разрешил удержание экрана."}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-3 [&_button]:min-h-11">
                  <Button
                    disabled={
                      loading ||
                      !identity ||
                      !selectedVehicle?.activeTrip ||
                      sending ||
                      updatingTripStatus ||
                      gps.authRequired
                    }
                    disabledReason={
                      loading
                        ? "Дождитесь загрузки рейса."
                        : !identity || gps.authRequired
                          ? "Войдите в аккаунт, чтобы передавать координаты."
                          : !selectedVehicle?.activeTrip
                            ? "Для передачи GPS нужен назначенный активный рейс."
                            : sending
                              ? "Координаты уже передаются. Дождитесь завершения."
                              : "Статус рейса меняется. Дождитесь завершения."
                    }
                    onClick={gps.sendOnce}
                    size="lg"
                    variant="outline"
                  >
                    {sending ? "Передаём координаты…" : "Передать точку сейчас"}
                  </Button>
                  <Button
                    disabled={
                      !tracking &&
                      (loading ||
                        !identity ||
                        !selectedVehicle?.activeTrip ||
                        sending ||
                        updatingTripStatus ||
                        gps.authRequired)
                    }
                    disabledReason={
                      loading
                        ? "Дождитесь загрузки рейса."
                        : !identity || gps.authRequired
                          ? "Войдите в аккаунт, чтобы передавать координаты."
                          : !selectedVehicle?.activeTrip
                            ? "Для передачи GPS нужен назначенный активный рейс."
                            : sending
                              ? "Координаты уже передаются. Дождитесь завершения."
                              : "Статус рейса меняется. Дождитесь завершения."
                    }
                    onClick={tracking ? gps.stop : gps.start}
                    size="lg"
                  >
                    {tracking ? "Остановить передачу" : "Начать передачу GPS"}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Во время рейса держите приложение открытым и экран включённым.
                </p>
              </div>
            ) : null}
            {!selectedVehicle?.activeTrip ? (
              <p className="py-6 text-sm text-muted-foreground">
                GPS будет доступен после назначения рейса.
              </p>
            ) : null}
          </TabsContent>
        </Tabs>
        {error && section !== "gps" ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </AppShell>
  )
}
