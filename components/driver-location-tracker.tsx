"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Car01Icon, Clock01Icon, Route01Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"

type FleetTrip = {
  id: string
  status: "assigned" | "in_progress"
  origin: string
  destination: string
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

type PendingGPSPoint = {
  vehicleId: string
  tripId: string
  latitude: number
  longitude: number
  accuracyMeters: number
  recordedAt: string
}

const pendingPointsKey = "vivat.pending-gps-points.v1"
const maxPendingPoints = 120

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

function readPendingPoints(): PendingGPSPoint[] {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(pendingPointsKey) ?? "[]"
    )
    if (!Array.isArray(value)) return []
    return value
      .filter(
        (point): point is PendingGPSPoint =>
          typeof point === "object" &&
          point !== null &&
          "vehicleId" in point &&
          typeof point.vehicleId === "string" &&
          "tripId" in point &&
          typeof point.tripId === "string" &&
          "latitude" in point &&
          typeof point.latitude === "number" &&
          "longitude" in point &&
          typeof point.longitude === "number" &&
          "accuracyMeters" in point &&
          typeof point.accuracyMeters === "number" &&
          "recordedAt" in point &&
          typeof point.recordedAt === "string"
      )
      .slice(-maxPendingPoints)
  } catch {
    return []
  }
}

function writePendingPoints(points: PendingGPSPoint[]) {
  try {
    window.localStorage.setItem(
      pendingPointsKey,
      JSON.stringify(points.slice(-maxPendingPoints))
    )
  } catch {
    // Some private browsing modes disable local storage; GPS transmission still works while online.
  }
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
  const [tracking, setTracking] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [lastSent, setLastSent] = React.useState<Date | null>(null)
  const [pendingCount, setPendingCount] = React.useState(0)
  const [online, setOnline] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const watchID = React.useRef<number | null>(null)
  const lastTransmitAt = React.useRef(0)

  const selectedVehicle = vehicles[0]

  const loadFleet = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/fleet", { cache: "no-store" })
      const payload: unknown = await response.json()
      if (!response.ok || !isFleetResponse(payload))
        throw new Error("Не удалось получить список автомобиля.")
      setVehicles(payload.items)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось получить список автомобиля."
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCashSummary = React.useCallback(async () => {
    setCashLoading(true)
    try {
      const response = await fetch("/api/driver-cash", { cache: "no-store" })
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
    return () => window.clearTimeout(timer)
  }, [loadCashSummary, loadFleet])

  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/branding", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok || !isDriverBranding(payload)) return
        setCompanyName(payload.companyName)
        applyDriverBrand(payload.primaryColor)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const transmitPoint = React.useCallback(async (point: PendingGPSPoint) => {
    const response = await fetch("/api/gps-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(point),
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Не удалось передать геолокацию."
      throw new Error(message)
    }
  }, [])

  const flushPendingPoints = React.useCallback(async () => {
    if (!navigator.onLine || loading) return
    const pending = readPendingPoints()
    const currentTripID = selectedVehicle?.activeTrip?.id
    const eligible = currentTripID
      ? pending.filter(
          (point) =>
            point.vehicleId === selectedVehicle.id &&
            point.tripId === currentTripID
        )
      : []

    if (eligible.length !== pending.length) writePendingPoints(eligible)
    setPendingCount(eligible.length)
    if (eligible.length === 0) return

    let sent = 0
    for (const point of eligible) {
      try {
        await transmitPoint(point)
        sent += 1
      } catch {
        break
      }
    }
    const remaining = eligible.slice(sent)
    writePendingPoints(remaining)
    setPendingCount(remaining.length)
    if (sent > 0) setLastSent(new Date())
  }, [loading, selectedVehicle, transmitPoint])

  React.useEffect(() => {
    const initialization = window.setTimeout(() => {
      setOnline(navigator.onLine)
      void flushPendingPoints()
    }, 0)

    function handleOnline() {
      setOnline(true)
      setError(null)
      void flushPendingPoints()
    }
    function handleOffline() {
      setOnline(false)
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.clearTimeout(initialization)
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [flushPendingPoints])

  const sendPosition = React.useCallback(
    async (position: GeolocationPosition) => {
      if (!selectedVehicle?.id || !selectedVehicle.activeTrip?.id) return
      setSending(true)
      setError(null)
      const point: PendingGPSPoint = {
        vehicleId: selectedVehicle.id,
        tripId: selectedVehicle.activeTrip.id,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        recordedAt: new Date(position.timestamp).toISOString(),
      }
      try {
        await transmitPoint(point)
        lastTransmitAt.current = Date.now()
        setLastSent(new Date())
      } catch (reason) {
        if (!navigator.onLine || reason instanceof TypeError) {
          const pending = [...readPendingPoints(), point]
          writePendingPoints(pending)
          setPendingCount(Math.min(pending.length, maxPendingPoints))
          setOnline(false)
        } else {
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось передать геолокацию."
          )
        }
      } finally {
        setSending(false)
      }
    },
    [selectedVehicle, transmitPoint]
  )

  const onPosition = React.useCallback(
    (position: GeolocationPosition) => {
      if (Date.now() - lastTransmitAt.current >= 25_000)
        void sendPosition(position)
    },
    [sendPosition]
  )

  function locationError(positionError: GeolocationPositionError) {
    setError(
      positionError.code === positionError.PERMISSION_DENIED
        ? "Доступ к геолокации выключен. Разрешите его в настройках браузера и повторите."
        : "Не удалось определить координаты. Проверьте GPS и интернет."
    )
    setTracking(false)
  }

  function sendOnce() {
    if (!navigator.geolocation) {
      setError("Этот браузер не поддерживает геолокацию.")
      return
    }
    navigator.geolocation.getCurrentPosition(onPosition, locationError, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 5_000,
    })
  }

  function toggleTracking() {
    if (!navigator.geolocation) {
      setError("Этот браузер не поддерживает геолокацию.")
      return
    }
    if (tracking) {
      if (watchID.current !== null)
        navigator.geolocation.clearWatch(watchID.current)
      watchID.current = null
      setTracking(false)
      return
    }
    lastTransmitAt.current = 0
    watchID.current = navigator.geolocation.watchPosition(
      onPosition,
      locationError,
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 }
    )
    setTracking(true)
  }

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
      const response = await fetch(`/api/trips?id=${encodeURIComponent(tripID)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
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
      const response = await fetch("/api/driver-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: cashSummary.tripId }),
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

  React.useEffect(
    () => () => {
      if (watchID.current !== null)
        navigator.geolocation.clearWatch(watchID.current)
    },
    []
  )

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
                      Проверьте сумму перед подтверждением. Без этого рейс нельзя завершить.
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
              Когда диспетчер назначит вас на рейс, он появится здесь
              автоматически.
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

        {error ? (
          <div className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {!online || pendingCount > 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-foreground">
            <p className="font-semibold">
              {online
                ? "Отправляем сохранённые точки"
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
                tracking
                  ? "size-2 rounded-full bg-emerald-500"
                  : "size-2 rounded-full bg-muted-foreground/50"
              }
            />
            <HugeiconsIcon icon={Clock01Icon} size={15} />
            Последняя отправка: {timeLabel(lastSent)}
          </div>
          <div className="grid gap-3">
            <Button
              disabled={loading || !selectedVehicle?.activeTrip || sending}
              onClick={sendOnce}
              size="lg"
              variant="outline"
            >
              {sending ? "Передаём координаты…" : "Передать точку сейчас"}
            </Button>
            <Button
              disabled={loading || !selectedVehicle?.activeTrip}
              onClick={toggleTracking}
              size="lg"
            >
              {tracking ? "Остановить передачу" : "Начать передачу GPS"}
            </Button>
          </div>
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
            При активной передаче координаты отправляются не чаще одного раза в
            25 секунд. Остановить можно в любой момент. Добавьте приложение на
            главный экран телефона, чтобы открывать его как обычное приложение.
          </p>
        </div>
      </div>
    </main>
  )
}
