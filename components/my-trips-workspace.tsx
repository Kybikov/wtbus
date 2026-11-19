"use client"

import * as React from "react"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  DriverPassengerManifest,
  type ManifestBooking,
} from "@/components/driver-passenger-manifest"
import { BookingPayments } from "@/components/booking-payments"
import { MoneyWorkspace } from "@/components/money-workspace"
import { useActionConfirmation } from "@/components/action-confirmation"
import { useDriverGPS } from "@/hooks/use-driver-gps"
import { sessionFetch } from "@/lib/session-navigation"
import { realtimeEvent } from "@/lib/realtime"
import { valueLabels } from "@/lib/entity-details"

type CrewTrip = {
  id: string
  origin: string
  destination: string
  startsAt: string
  endsAt: string
  status: string
  statusPhase: string
  vehicleId: string
  vehicle: string
  canManage: boolean
  canBoard: boolean
  canCollect: boolean
  canGPS: boolean
}
async function request(url: string, body?: object) {
  const response = await sessionFetch(url, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw Error(
      data?.error ?? "Не удалось выполнить действие. Повторите попытку."
    )
  return data
}
export function MyTripsWorkspace({
  initialTab = "passengers",
}: {
  initialTab?: "passengers" | "money"
}) {
  const confirm = useActionConfirmation()
  const [trips, setTrips] = React.useState<CrewTrip[]>([])
  const [selected, setSelected] = React.useState("")
  const [identity, setIdentity] = React.useState({
    membershipId: "",
    tenantSlug: "",
  })
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [revision, setRevision] = React.useState(0)
  const trip = trips.find((t) => t.id === selected) ?? trips[0]
  const terminal =
    trip?.statusPhase === "completed" || trip?.statusPhase === "cancelled"
  const gps = useDriverGPS(
    trip?.canGPS && trip.vehicleId && !terminal && identity.membershipId
      ? {
          scope: identity.tenantSlug + ":" + identity.membershipId,
          membershipId: identity.membershipId,
          vehicleId: trip.vehicleId,
          tripId: trip.id,
        }
      : null
  )
  const load = React.useCallback(async () => {
    try {
      const [data, me] = await Promise.all([
        request("/api/my-trips"),
        request("/api/auth/me"),
      ])
      setTrips(data.items)
      setIdentity(me)
      setError("")
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить назначения."
      )
    } finally {
      setLoading(false)
    }
  }, [])
  React.useEffect(() => {
    const initial = setTimeout(() => void load(), 0)
    const refresh = () => {
      if (document.visibilityState === "visible") void load()
    }
    const timer = setInterval(refresh, 30000)
    window.addEventListener(realtimeEvent, refresh)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
      window.removeEventListener(realtimeEvent, refresh)
    }
  }, [load])
  async function changeStatus(status: string) {
    if (!trip || busy) return
    setBusy(true)
    setError("")
    try {
      const waiting: {
        bookingId: string
        passengerIndex: number
        name: string
      }[] = []
      if (status === "in_progress") {
        const manifest = await request(
          `/api/driver-passengers?tripId=${trip.id}`
        )
        for (const booking of manifest.items as ManifestBooking[]) {
          if (
            booking.paymentMethod !== "cash_on_boarding" &&
            booking.paymentStatus !== "paid"
          )
            continue
          for (let index = 0; index < booking.seats; index++) {
            if (
              ["boarded", "absent"].includes(
                booking.boarding[String(index)] ?? "waiting"
              )
            )
              continue
            const person = booking.passengers[index]
            waiting.push({
              bookingId: booking.id,
              passengerIndex: index,
              name: person
                ? `${person.firstName} ${person.lastName}`
                : `${booking.name} · ${index + 1}`,
            })
          }
        }
      }
      if (
        !(await confirm({
          title:
            status === "completed"
              ? "Завершить рейс?"
              : status === "boarding"
                ? "Начать посадку?"
                : "Начать рейс?",
          description: waiting.length
            ? `Не пришли: ${waiting.map((p) => p.name).join(", ")}. Подтвердите неявку. Позже можно отметить их посадку.`
            : `${trip.origin} → ${trip.destination}. ${status === "completed" ? "Неоплаченные брони останутся в списке долгов." : ""}`,
          label: waiting.length ? "Подтвердить неявку и выезд" : "Подтвердить",
          tone: "archive",
        }))
      )
        return
      for (const person of waiting)
        await request("/api/driver-passengers", {
          tripId: trip.id,
          ...person,
          name: undefined,
          boarding: "absent",
          expectedBoarding: "waiting",
        })
      if (
        status === "completed" &&
        trip.canGPS &&
        !(await gps.prepareCompletion())
      )
        throw Error("Отправьте сохранённые GPS-точки перед завершением рейса.")
      const response = await sessionFetch(`/api/trips?id=${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const data = await response.json()
      if (!response.ok) throw Error(data.error ?? "Не удалось изменить статус.")
      await load()
      setRevision((v) => v + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить рейс.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <AppShell pageTitle="Мои рейсы" onRefresh={load} refreshing={loading}>
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-5">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {trips.length ? (
          <FieldSelect
            aria-label="Рейс"
            value={trip?.id ?? ""}
            onValueChange={setSelected}
            options={trips.map((t) => ({
              value: t.id,
              label: `${t.origin} → ${t.destination} · ${new Date(t.startsAt).toLocaleDateString("ru-RU")} · ${valueLabels[t.status] ?? t.status}`,
            }))}
          />
        ) : (
          <p className="text-muted-foreground">
            {loading ? "Загружаем назначения…" : "Назначенных рейсов пока нет."}
          </p>
        )}
        {trip ? (
          <section className="workspace-panel flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold break-words">
                {trip.origin} → {trip.destination}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {trip.vehicle || "Автомобиль не назначен"} ·{" "}
                {valueLabels[trip.status] ?? trip.status}
              </p>
            </div>
            {trip.canManage && !terminal ? (
              <div className="flex flex-wrap gap-2">
                {trip.statusPhase !== "in_progress" ? (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      disabledReason="Меняем статус рейса. Дождитесь завершения."
                      onClick={() => void changeStatus("boarding")}
                    >
                      Посадка
                    </Button>
                    <Button
                      disabled={busy}
                      disabledReason="Меняем статус рейса. Дождитесь завершения."
                      onClick={() => void changeStatus("in_progress")}
                    >
                      Начать рейс
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={busy}
                    disabledReason="Меняем статус рейса. Дождитесь завершения."
                    onClick={() => void changeStatus("completed")}
                  >
                    Завершить рейс
                  </Button>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
        <Tabs defaultValue={initialTab}>
          <TabsList className="w-full">
            <TabsTrigger value="passengers">Пассажиры</TabsTrigger>
            <TabsTrigger value="money">Касса</TabsTrigger>
            <TabsTrigger value="gps">GPS</TabsTrigger>
          </TabsList>
          <TabsContent value="passengers" className="min-w-0 space-y-4 pt-4">
            {trip ? (
              <>
                <DriverPassengerManifest
                  key={`${trip.id}:${revision}`}
                  tripId={trip.id}
                  canBoard={trip.canBoard && !terminal}
                  payments={false}
                />
                {trip.canCollect ? (
                  <BookingPayments
                    key={`payments:${trip.id}:${revision}`}
                    tripId={trip.id}
                    inline
                    onUpdated={() => setRevision((v) => v + 1)}
                  />
                ) : null}
              </>
            ) : null}
          </TabsContent>
          <TabsContent value="money" className="min-w-0 pt-4">
            <MoneyWorkspace showTripReports={false} />
          </TabsContent>
          <TabsContent value="gps" className="space-y-3 pt-4">
            {trip?.canGPS && !terminal ? (
              <>
                <p className="text-sm">
                  {gps.tracking
                    ? "Геолокация передаётся"
                    : "Передавайте геолокацию во время рейса."}
                </p>
                {gps.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {gps.error}
                  </p>
                ) : null}
                <Button
                  onClick={() => (gps.tracking ? gps.stop() : gps.start())}
                >
                  {gps.tracking ? "Остановить передачу" : "Включить GPS"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                GPS передаёт назначенный ответственный участник активного рейса.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  )
}
