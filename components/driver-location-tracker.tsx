"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Car01Icon, Clock01Icon, Route01Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { useDriverGPS } from "@/hooks/use-driver-gps"

type FleetTrip = {
  id: string
  status: "assigned" | "in_progress"
  origin: string
  destination: string
  startsAt: string
}

type Vehicle = {
  id: string
  name: string
  registrationNumber: string
  activeTrip?: FleetTrip
}

type FleetResponse = { items: Vehicle[] }

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
  const [vehicles, setVehicles] = React.useState<Vehicle[]>([])
  const [cashSummary, setCashSummary] =
    React.useState<DriverCashSummaryItem | null>(null)
  const [companyName, setCompanyName] = React.useState("Vivat Bus")
  const [loading, setLoading] = React.useState(true)
  const [cashLoading, setCashLoading] = React.useState(true)
  const [confirmingCash, setConfirmingCash] = React.useState(false)
  const [updatingTripStatus, setUpdatingTripStatus] = React.useState(false)
  const [identity, setIdentity] = React.useState<DriverIdentity | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const loadInFlight = React.useRef(false)
  const selectedVehicle = [...vehicles].sort(
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
        !sessionResponse.ok ||
        session?.role !== "driver" ||
        typeof session?.membershipId !== "string" ||
        typeof session?.tenantSlug !== "string"
      ) {
        if (
          sessionResponse.status === 401 ||
          sessionResponse.status === 403 ||
          (sessionResponse.ok && session?.role !== "driver")
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
      setVehicles(payload.items)
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
  }, [])

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
      void loadCashSummary()
    }, 0)
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadFleet()
        void loadCashSummary()
      }
    }
    const poll = window.setInterval(refresh, 30_000)
    window.addEventListener("online", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
      window.removeEventListener("online", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [loadCashSummary, loadFleet])

  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/branding", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok || !isDriverBranding(payload)) return
        setCompanyName(payload.companyName)
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
    if (!window.confirm(`Подтвердить: ${action} рейс?`)) return
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

  async function confirmCashReceipt() {
    if (!cashSummary || confirmingCash) return
    const amount = formatMoney(cashSummary.amountMinor, cashSummary.currency)
    if (!window.confirm(`Подтвердить получение наличных: ${amount}?`)) return
    setConfirmingCash(true)
    setError(null)
    try {
      const response = await sessionFetch("/api/driver-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: cashSummary.tripId }),
        signal: AbortSignal.timeout(12_000),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isDriverCashSummaryResponse(payload)) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Не удалось подтвердить наличные."
        throw new Error(message)
      }
      setCashSummary(payload.item)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось подтвердить наличные."
      )
    } finally {
      setConfirmingCash(false)
    }
  }

  return (
    <main className="min-h-svh bg-background px-4 py-5 text-foreground sm:px-6">
      <div className="mx-auto flex min-h-[calc(100svh-2.5rem)] max-w-md flex-col rounded-[var(--app-radius)] border border-border bg-card p-5 shadow-xl shadow-black/10">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <HugeiconsIcon icon={Car01Icon} size={22} />
          </div>
          <div>
            <p className="font-bold">{companyName}</p>
            <p className="text-xs text-muted-foreground">
              Водительское приложение
            </p>
          </div>
        </div>

        <div className="mt-10">
          <h1 className="text-3xl font-bold tracking-[-.035em]">
            Передача геолокации
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Диспетчер увидит автомобиль и свежесть GPS-сигнала. Координаты
            передаются только после вашего действия.
          </p>
        </div>

        {selectedVehicle?.activeTrip ? (
          <>
            <div className="mt-7 rounded-2xl border border-border bg-background/40 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-[.08em] text-muted-foreground uppercase">
                <HugeiconsIcon icon={Route01Icon} size={15} />
                Активный рейс
              </p>
              <p className="mt-2 font-bold">
                {selectedVehicle.activeTrip.origin} →{" "}
                {selectedVehicle.activeTrip.destination}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedVehicle.name} · {selectedVehicle.registrationNumber} ·{" "}
                {selectedVehicle.activeTrip.status === "in_progress"
                  ? "Рейс выполняется"
                  : "Рейс назначен"}
              </p>
              {selectedVehicle.activeTrip.status === "assigned" ? (
                <Button
                  className="mt-4 w-full"
                  disabled={updatingTripStatus}
                  onClick={() => void changeTripStatus("in_progress")}
                  size="lg"
                >
                  {updatingTripStatus ? "Начинаем рейс…" : "Начать рейс"}
                </Button>
              ) : (
                <Button
                  className="mt-4 w-full"
                  disabled={
                    updatingTripStatus ||
                    cashLoading ||
                    (cashSummary?.tripId === selectedVehicle.activeTrip.id &&
                      cashSummary.collectedMinor !== cashSummary.amountMinor)
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
            {cashSummary?.tripId === selectedVehicle.activeTrip.id &&
            cashSummary.amountMinor > 0 ? (
              <section className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 p-4">
                <h2 className="text-sm font-bold">Наличные к получению</h2>
                <p className="mt-1 text-3xl font-bold tracking-[-.035em] tabular-nums">
                  {formatMoney(cashSummary.amountMinor, cashSummary.currency)}
                </p>
                {cashSummary.collectedMinor === cashSummary.amountMinor ? (
                  <p className="mt-3 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    Получение подтверждено. Сумма зачислена в кассу водителя.
                  </p>
                ) : selectedVehicle.activeTrip.status === "in_progress" ? (
                  <>
                    <p className="mt-3 text-sm leading-5 text-muted-foreground">
                      Проверьте сумму перед подтверждением. Без этого рейс
                      нельзя завершить.
                    </p>
                    <Button
                      className="mt-4 w-full"
                      disabled={confirmingCash || !online}
                      onClick={() => void confirmCashReceipt()}
                      size="lg"
                    >
                      {confirmingCash ? "Подтверждаем…" : "Деньги получены"}
                    </Button>
                  </>
                ) : (
                  <p className="mt-3 text-sm leading-5 text-muted-foreground">
                    Подтверждение наличных станет доступно после начала рейса.
                  </p>
                )}
              </section>
            ) : cashLoading ? (
              <div className="mt-4 h-28 animate-pulse rounded-2xl border border-border bg-muted/40" />
            ) : null}
          </>
        ) : (
          <div className="mt-7 rounded-2xl border border-border bg-background/40 p-4 text-sm text-muted-foreground">
            <p>Нет назначенного рейса.</p>
            <p className="mt-1 text-xs">
              Назначения обновляются каждые 30 секунд, пока приложение открыто.
            </p>
            <Button
              className="mt-4"
              disabled={loading}
              onClick={() => void loadFleet()}
              size="sm"
              variant="outline"
            >
              Обновить
            </Button>
          </div>
        )}

        {error || gps.error ? (
          <div
            role="alert"
            className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error || gps.error}
            {gps.authRequired ? (
              <a className="mt-2 block underline" href="/login?next=/driver">
                Войти снова
              </a>
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

        <div className="mt-auto pt-8">
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
              onClick={tracking ? gps.stop : gps.start}
              size="lg"
            >
              {tracking ? "Остановить передачу" : "Начать передачу GPS"}
            </Button>
          </div>
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
            При активной передаче координаты отправляются не чаще одного раза в
            25 секунд. Остановить можно в любой момент. Добавьте приложение на
            главный экран телефона, чтобы открывать его как обычное приложение.
            При блокировке экрана или сворачивании GPS может приостановиться. Во
            время рейса держите приложение открытым и телефон на зарядке.
          </p>
        </div>
      </div>
    </main>
  )
}
