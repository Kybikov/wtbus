"use client"

// Licensed React Bits Pro filtering-8: responsive facet rail and journey cards,
// adapted from its installed source to real bus inventory and shadcn controls.
import { useMemo, useState } from "react"
import { ArrowRight, Bus, Clock3, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Skeleton } from "@/components/ui/skeleton"
import { departureMinute, travelDate, travelMoney, travelTime, type PublicTrip } from "@/lib/public-booking"

export default function Filtering8({ trips, timezone, seats, onSelect, nearest, loading = false }: { trips: PublicTrip[]; timezone: string; seats: number; onSelect: (trip: PublicTrip) => void; nearest?: PublicTrip[]; loading?: boolean }) {
  const [departure, setDeparture] = useState<number[]>([0, 1440])
  const [duration, setDuration] = useState<number[] | null>(null)
  const [sort, setSort] = useState("departure")
  const maxDuration = Math.max(60, ...[...trips, ...(nearest ?? [])].map((trip) => Math.ceil((Date.parse(trip.endsAt) - Date.parse(trip.startsAt)) / 3_600_000) * 60))
  const durationRange = duration ?? [0, maxDuration]
  const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
  const hours = (minutes: number) => `${Math.floor(minutes / 60)} год${minutes % 60 ? ` ${Math.round(minutes % 60)} хв` : ""}`
  const filtered = useMemo(() => {
    const filter = (items: PublicTrip[]) => items.filter((trip) => {
      const minute = departureMinute(trip, timezone)
      const length = (Date.parse(trip.endsAt) - Date.parse(trip.startsAt)) / 60_000
      return minute >= departure[0] && minute <= departure[1] && (!duration || (length >= duration[0] && length <= duration[1]))
    }).sort((a, b) => sort === "price" ? a.currency.localeCompare(b.currency) || a.priceMinor - b.priceMinor : sort === "duration" ? (Date.parse(a.endsAt) - Date.parse(a.startsAt)) - (Date.parse(b.endsAt) - Date.parse(b.startsAt)) : Date.parse(a.startsAt) - Date.parse(b.startsAt))
    return { trips: filter(trips), nearest: filter(nearest ?? []) }
  }, [trips, nearest, timezone, departure, duration, sort])
  function reset() { setDeparture([0, 1440]); setDuration(null) }

  function tripList(items: PublicTrip[]) {
    return <ul className="space-y-3">
          {items.map((trip) => <li key={trip.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"><article className="flex min-w-0 flex-col gap-5 rounded-[var(--rb-r-lg)] border border-border bg-card p-5 transition-colors hover:border-primary/40 sm:p-6 xl:flex-row xl:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-4"><div className="hidden rounded-xl bg-primary/10 p-3 text-primary sm:block"><Bus aria-hidden="true" className="size-5" /></div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-3 text-xl font-bold tabular-nums sm:text-2xl"><time dateTime={trip.startsAt}>{travelTime(trip.startsAt, timezone)}</time><ArrowRight className="size-4 shrink-0 text-muted-foreground" /><time dateTime={trip.endsAt}>{travelTime(trip.endsAt, timezone)}</time></div>
                <p className="mt-2 break-words text-sm font-medium">{trip.origin} → {trip.destination}</p><p className="mt-1 text-xs text-muted-foreground">{travelDate(trip.startsAt, timezone)}{travelDate(trip.startsAt, timezone) !== travelDate(trip.endsAt, timezone) ? ` — ${travelDate(trip.endsAt, timezone)}` : ""}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground xl:block xl:space-y-2"><p className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{hours((Date.parse(trip.endsAt) - Date.parse(trip.startsAt)) / 60_000)}</p><p>{trip.availableSeats === 0 ? <strong className="text-destructive">Розпродано</strong> : <>Вільних місць: <span className="font-semibold text-foreground">{trip.availableSeats}</span>{trip.availableSeats < seats && <span className="block text-destructive">Недостатньо для {seats} пасажирів</span>}</>}</p></div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-4 xl:min-w-52 xl:border-0 xl:pt-0"><div><p className="text-xl font-bold tabular-nums text-primary">{travelMoney(trip.priceMinor, trip.currency)}</p><p className="mt-1 text-xs text-muted-foreground">{seats > 1 ? `${travelMoney(trip.priceMinor * seats, trip.currency)} за ${seats} місця` : "Оплата при посадці"}</p></div><Button className="h-11 px-4" disabled={trip.availableSeats < seats} onClick={() => onSelect(trip)}>{trip.availableSeats === 0 ? "Розпродано" : trip.availableSeats < seats ? "Мало місць" : "Обрати"}{trip.availableSeats >= seats && <ArrowRight />}</Button></div>
          </article></li>)}
        </ul>
  }

  return <section aria-label="Результати пошуку" aria-busy={loading} className="min-w-0">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <p aria-live="polite" className="text-sm text-muted-foreground">Знайдено рейсів: <strong className="text-foreground">{filtered.trips.length}</strong></p>
      <div className="flex flex-wrap items-center gap-2">
        <FieldSelect aria-label="Сортування рейсів" value={sort} onValueChange={setSort} triggerClassName="data-[size=default]:h-11 w-full sm:w-64" options={[{ value: "departure", label: "За часом відправлення" }, { value: "duration", label: "Найкоротша поїздка" }, { value: "price", label: "Ціна (у межах валюти)" }]} />
      </div>
    </div>
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <aside aria-label="Фільтри рейсів" className="grid grid-cols-2 gap-5 rounded-[var(--rb-r-lg)] border border-border bg-card p-5 lg:block lg:space-y-6">
        <div className="col-span-2 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Фільтри</h2><Button variant="outline" className="h-11 px-3 text-xs" onClick={reset}><RotateCcw />Скинути фільтри</Button></div>
        <div><h3 className="mb-2 text-sm font-medium">Час відправлення</h3><p className="mb-4 text-xs tabular-nums text-muted-foreground">{time(departure[0])} — {time(departure[1])}</p>
          <Slider min={0} max={1440} step={15} value={departure} onValueChange={(value) => setDeparture(Array.isArray(value) ? value : [value, 1440])} aria-label="Час відправлення" />
        </div><Separator className="hidden lg:block" />
        <div><h3 className="mb-2 text-sm font-medium">Тривалість поїздки</h3><p className="mb-4 text-xs text-muted-foreground">{hours(durationRange[0])} — {hours(durationRange[1])}</p>
          <Slider min={0} max={maxDuration} step={15} value={durationRange} onValueChange={(value) => setDuration(Array.isArray(value) ? value : [value, maxDuration])} aria-label="Тривалість поїздки" />
        </div><Separator className="hidden lg:block" /><p className="col-span-2 text-xs leading-relaxed text-muted-foreground">Час указано за часовим поясом перевізника: {timezone}. Ціна — за одного пасажира.</p>
      </aside>
      <div className="min-w-0">
        {loading ? <div aria-label="Шукаємо рейси" className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-36" /></div> : filtered.trips.length ? tripList(filtered.trips) : <p role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{trips.length ? "Немає рейсів за цими фільтрами." : "На обрану дату рейсів немає."}</p>}
        {!loading && nearest !== undefined && <section aria-label="Найближчі тури" className="mt-7 space-y-4">
          <h2 className="text-xl font-semibold">Найближчі тури</h2>
          {filtered.nearest.length ? tripList(filtered.nearest) : <p role="status" className="text-sm text-muted-foreground">{nearest.length ? "За цими фільтрами турів немає." : "Доступних турів поки немає."}</p>}
        </section>}
      </div>
    </div>
  </section>
}
