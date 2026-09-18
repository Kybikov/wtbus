"use client"

// Licensed React Bits Pro filtering-8: responsive facet rail and journey cards,
// adapted from its installed source to real bus inventory and shadcn controls.
import { useMemo, useState, type ReactNode } from "react"
import { ArrowRight, Bus, Clock3, RotateCcw, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { departureMinute, travelDate, travelMoney, travelTime, type PublicTrip } from "@/lib/public-booking"

export default function Filtering8({ trips, timezone, seats, onSelect, alternatives, compact = false }: { trips: PublicTrip[]; timezone: string; seats: number; onSelect: (trip: PublicTrip) => void; alternatives?: ReactNode; compact?: boolean }) {
  const [departure, setDeparture] = useState<number[]>([0, 1440])
  const [duration, setDuration] = useState<number[] | null>(null)
  const [sort, setSort] = useState("departure")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const maxDuration = Math.max(60, ...trips.map((trip) => Math.ceil((Date.parse(trip.endsAt) - Date.parse(trip.startsAt)) / 3_600_000) * 60))
  const durationRange = duration ?? [0, maxDuration]
  const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
  const hours = (minutes: number) => `${Math.floor(minutes / 60)} год${minutes % 60 ? ` ${Math.round(minutes % 60)} хв` : ""}`
  const filtered = useMemo(() => trips.filter((trip) => {
    const minute = departureMinute(trip, timezone)
    const length = (Date.parse(trip.endsAt) - Date.parse(trip.startsAt)) / 60_000
    return minute >= departure[0] && minute <= departure[1] && (!duration || (length >= duration[0] && length <= duration[1]))
  }).sort((a, b) => compact ? 0 : sort === "price" ? a.currency.localeCompare(b.currency) || a.priceMinor - b.priceMinor : sort === "duration" ? (Date.parse(a.endsAt) - Date.parse(a.startsAt)) - (Date.parse(b.endsAt) - Date.parse(b.startsAt)) : Date.parse(a.startsAt) - Date.parse(b.startsAt)), [trips, timezone, departure, duration, sort, compact])
  function reset() { setDeparture([0, 1440]); setDuration(null) }

  return <section aria-label="Результати пошуку" className="min-w-0">
    {!compact && <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <p aria-live="polite" className="text-sm text-muted-foreground">Знайдено рейсів: <strong className="text-foreground">{filtered.length}</strong></p>
      {!!trips.length && <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="lg:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal />Фільтри</Button>
        <FieldSelect aria-label="Сортування рейсів" value={sort} onValueChange={setSort} triggerClassName="data-[size=default]:h-11 w-full sm:w-64" options={[{ value: "departure", label: "За часом відправлення" }, { value: "duration", label: "Найкоротша поїздка" }, { value: "price", label: "Ціна (у межах валюти)" }]} />
      </div>}
    </div>}
    <div className={`grid min-w-0 items-start gap-6 ${trips.length && !compact ? "lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10" : ""}`}>
      {!!trips.length && !compact && <aside aria-label="Фільтри рейсів" className={`${filtersOpen ? "block" : "hidden"} space-y-6 rounded-[var(--rb-r-lg)] border border-border bg-card p-5 lg:block`}>
        <div className="flex items-center justify-between"><h2 className="font-semibold">Фільтри</h2><Button variant="ghost" size="icon-sm" aria-label="Скинути фільтри" onClick={reset}><RotateCcw /></Button></div>
        <div><h3 className="mb-2 text-sm font-medium">Час відправлення</h3><p className="mb-4 text-xs tabular-nums text-muted-foreground">{time(departure[0])} — {time(departure[1])}</p>
          <Slider min={0} max={1440} step={15} value={departure} onValueChange={(value) => setDeparture(Array.isArray(value) ? value : [value, 1440])} aria-label="Час відправлення" />
        </div><Separator />
        <div><h3 className="mb-2 text-sm font-medium">Тривалість поїздки</h3><p className="mb-4 text-xs text-muted-foreground">{hours(durationRange[0])} — {hours(durationRange[1])}</p>
          <Slider min={0} max={maxDuration} step={15} value={durationRange} onValueChange={(value) => setDuration(Array.isArray(value) ? value : [value, maxDuration])} aria-label="Тривалість поїздки" />
        </div><Separator /><p className="text-xs leading-relaxed text-muted-foreground">Час указано за часовим поясом перевізника: {timezone}. Ціна — за одного пасажира.</p>
      </aside>}
      <div className="min-w-0">
        {!filtered.length ? <div className="rounded-[var(--rb-r-lg)] border border-dashed border-border p-8 text-center sm:p-12"><Bus className="mx-auto mb-4 size-8 text-primary" /><h2 className="text-xl font-semibold">{trips.length ? "Немає рейсів за цими фільтрами" : "На обрану дату рейсів немає"}</h2><p className="mt-2 text-sm text-muted-foreground">{trips.length ? "Скиньте фільтри, щоб побачити всі рейси на цю дату." : "Перегляньте найближчі доступні поїздки або оберіть іншу дату."}</p>{!!trips.length && <Button variant="outline" className="mt-5" onClick={reset}>Скинути фільтри</Button>}</div> : <ul className="space-y-3">
          {filtered.map((trip) => <li key={trip.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"><article className="flex min-w-0 flex-col gap-5 rounded-[var(--rb-r-lg)] border border-border bg-card p-5 transition-colors hover:border-primary/40 sm:p-6 xl:flex-row xl:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-4"><div className="hidden rounded-xl bg-primary/10 p-3 text-primary sm:block"><Bus aria-hidden="true" className="size-5" /></div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-3 text-xl font-bold tabular-nums sm:text-2xl"><time dateTime={trip.startsAt}>{travelTime(trip.startsAt, timezone)}</time><ArrowRight className="size-4 shrink-0 text-muted-foreground" /><time dateTime={trip.endsAt}>{travelTime(trip.endsAt, timezone)}</time></div>
                <p className="mt-2 break-words text-sm font-medium">{trip.origin} → {trip.destination}</p><p className="mt-1 text-xs text-muted-foreground">{travelDate(trip.startsAt, timezone)}{travelDate(trip.startsAt, timezone) !== travelDate(trip.endsAt, timezone) ? ` — ${travelDate(trip.endsAt, timezone)}` : ""}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground xl:block xl:space-y-2"><p className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{hours((Date.parse(trip.endsAt) - Date.parse(trip.startsAt)) / 60_000)}</p><p>{trip.availableSeats === 0 ? <strong className="text-destructive">Розпродано</strong> : <>Вільних місць: <span className="font-semibold text-foreground">{trip.availableSeats}</span>{trip.availableSeats < seats && <span className="block text-destructive">Недостатньо для {seats} пасажирів</span>}</>}</p></div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-4 xl:min-w-52 xl:border-0 xl:pt-0"><div><p className="text-xl font-bold tabular-nums text-primary">{travelMoney(trip.priceMinor, trip.currency)}</p><p className="mt-1 text-xs text-muted-foreground">{seats > 1 ? `${travelMoney(trip.priceMinor * seats, trip.currency)} за ${seats} місця` : "Оплата при посадці"}</p></div><Button className="h-11 px-4" disabled={trip.availableSeats < seats} onClick={() => onSelect(trip)}>{trip.availableSeats === 0 ? "Розпродано" : trip.availableSeats < seats ? "Мало місць" : "Обрати"}{trip.availableSeats >= seats && <ArrowRight />}</Button></div>
          </article></li>)}
        </ul>}
        {alternatives}
      </div>
    </div>
  </section>
}
