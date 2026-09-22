"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { ArrowLeftRight, ArrowRight, Bus, Loader2, Search } from "lucide-react"
import Filtering8 from "@/components/filtering-8"
import { PassengerCheckout } from "@/components/passenger-checkout"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import { DatePicker } from "@/components/ui/date-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { publicBookingFetch, travelDay, travelDate, type PublicCatalog, type PublicTrip } from "@/lib/public-booking"

type SearchCriteria = { origin: string; destination: string; date: string; seats: number }
type SearchResults = { items: PublicTrip[]; before: PublicTrip[]; after: PublicTrip[] }
const errorMessage = (error: unknown) => error instanceof Error && !["TimeoutError", "AbortError", "TypeError"].includes(error.name) ? error.message : "Не вдалося з’єднатися із сервісом. Перевірте інтернет і спробуйте ще раз."

export function PublicBooking({ slug }: { slug: string }) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null)
  const [catalogError, setCatalogError] = useState("")
  const [retry, setRetry] = useState(0)
  const [criteria, setCriteria] = useState<SearchCriteria>({ origin: "", destination: "", date: "", seats: 1 })
  const [result, setResult] = useState<{ trips: PublicTrip[]; before: PublicTrip[]; after: PublicTrip[]; criteria: SearchCriteria } | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [selected, setSelected] = useState<PublicTrip | null>(null)
  const searchController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    publicBookingFetch<PublicCatalog>(slug, "catalog", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }).then((data) => {
      setCatalog(data)
      setCatalogError("")
      setCriteria((current) => ({ ...current, date: current.date || travelDay(new Date(), data.timezone) }))
    }).catch((error) => { if (!controller.signal.aborted) setCatalogError(errorMessage(error)) })
    return () => { controller.abort(); searchController.current?.abort() }
  }, [slug, retry])

  const origins = Array.from(new Set(catalog?.routes.map((route) => route.origin) ?? [])).sort((a, b) => a.localeCompare(b, "uk"))
  const destinations = Array.from(new Set(catalog?.routes.filter((route) => route.origin === criteria.origin).map((route) => route.destination) ?? [])).sort((a, b) => a.localeCompare(b, "uk"))
  const reverseAvailable = catalog?.routes.some((route) => route.origin === criteria.destination && route.destination === criteria.origin)
  async function search(event: FormEvent) {
    event.preventDefault()
    if (!criteria.origin || !criteria.destination || !criteria.date) return
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    const snapshot = { ...criteria }
    setSearching(true); setSearchError("")
    try {
      const data = await publicBookingFetch<SearchResults>(slug, `trips?${new URLSearchParams({ origin: snapshot.origin, destination: snapshot.destination, date: snapshot.date, seats: String(snapshot.seats) })}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      if (!controller.signal.aborted) setResult({ trips: data.items, before: data.before ?? [], after: data.after ?? [], criteria: snapshot })
    } catch (error) { if (!controller.signal.aborted) setSearchError(errorMessage(error)) }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }
  function returnToSearch() { setSelected(null); window.scrollTo({ top: 0 }) }

  return <div lang="uk" data-public-booking className="flex min-h-svh flex-col bg-background text-foreground">
    <a href="#booking-main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">Перейти до пошуку</a>
    <header className="border-b border-border bg-card"><div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-4 px-4 py-4 sm:px-8 lg:px-12">
      <Link href={`/book/${slug}`} className="flex min-w-0 items-center gap-3" aria-label="На головну бронювання">{slug === "vivat-bus" ? <Image src="/brand/vivat-bus.png" width={40} height={40} alt="" className="size-10 shrink-0 rounded-xl object-contain" /> : <Bus className="size-8 shrink-0 text-primary" />}<span className="truncate font-bold">{catalog?.name ?? "Vivat Bus"}</span></Link>
      <Link href="/login" className="shrink-0 rounded-lg px-2 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary sm:text-sm">Вхід для команди<ArrowRight aria-hidden="true" className="ml-1 inline size-3.5" /></Link>
    </div></header>
    <main id="booking-main" className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-7 sm:px-8 sm:py-10 lg:px-12">
      {selected && result && catalog ? <PassengerCheckout key={selected.id} slug={slug} trip={selected} seats={result.criteria.seats} catalog={catalog} onBack={returnToSearch} /> : <>
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Куди поїдемо?</h1><p className="max-w-sm text-sm leading-relaxed text-muted-foreground">Оберіть рейс. Забронюйте місця.<br />Оплатіть на IBAN або при посадці.</p></div>
        {catalogError ? <div role="alert" className="rounded-xl border border-destructive/40 p-5"><p>{catalogError}</p><Button className="mt-4" onClick={() => { setCatalogError(""); setRetry(retry + 1) }}>Спробувати ще раз</Button></div> : !catalog ? <div aria-label="Завантаження маршрутів" aria-busy="true" className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : <>
          <form onSubmit={search} aria-label="Пошук автобусних рейсів" aria-busy={searching} className="mb-8 rounded-[var(--rb-r-lg)] bg-primary p-5 text-primary-foreground sm:p-6">
            <div className="grid min-w-0 items-end gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(150px,.65fr)_minmax(140px,.5fr)_auto]">
              <div className="min-w-0"><label id="origin-label" className="mb-2 block text-xs font-semibold">Звідки</label><FieldSelect aria-label="Місто відправлення" value={criteria.origin} onValueChange={(origin) => setCriteria({ ...criteria, origin, destination: "" })} disabled={searching || !origins.length} placeholder="Оберіть місто" triggerClassName="data-[size=default]:h-11 bg-background text-foreground" options={origins.map((city) => ({ value: city, label: city }))} /></div>
              <Button type="button" variant="outline" size="icon" className="hidden h-11 w-11 border-primary-foreground/20 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 lg:flex" disabled={searching || !reverseAvailable} aria-label="Поміняти міста місцями" onClick={() => setCriteria({ ...criteria, origin: criteria.destination, destination: criteria.origin })}><ArrowLeftRight /></Button>
              <div className="min-w-0"><label className="mb-2 block text-xs font-semibold">Куди</label><FieldSelect aria-label="Місто прибуття" value={criteria.destination} onValueChange={(destination) => setCriteria({ ...criteria, destination })} disabled={searching || !criteria.origin} placeholder="Оберіть місто" triggerClassName="data-[size=default]:h-11 bg-background text-foreground" options={destinations.map((city) => ({ value: city, label: city }))} /></div>
              <div className="min-w-0"><label htmlFor="travel-date" className="mb-2 block text-xs font-semibold">Дата поїздки</label><DatePicker id="travel-date" label="Дата поїздки" required min={travelDay(new Date(), catalog.timezone)} value={criteria.date} disabled={searching} onValueChange={(date) => setCriteria({ ...criteria, date })} /></div>
              <div className="min-w-0"><label className="mb-2 block text-xs font-semibold">Пасажири</label><FieldSelect aria-label="Кількість пасажирів" value={String(criteria.seats)} onValueChange={(seats) => setCriteria({ ...criteria, seats: Number(seats) })} disabled={searching} triggerClassName="data-[size=default]:h-11 bg-background text-foreground" options={Array.from({ length: 20 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} /></div>
              <Button type="submit" disabled={searching || !criteria.origin || !criteria.destination || !criteria.date} className="h-11 bg-primary-foreground px-6 text-primary hover:bg-primary-foreground/90 sm:col-span-2 lg:col-span-1">{searching ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Search />}Знайти рейс</Button>
            </div>
          </form>
          {!catalog.routes.length && <p className="mb-8 text-muted-foreground">Перевізник ще не опублікував маршрути. Перевірте пізніше.</p>}
          {searchError && <p role="alert" className="mb-5 rounded-xl border border-destructive/40 p-4 text-destructive">{searchError}</p>}
          {searching && !result ? <Filtering8 loading trips={[]} timezone={catalog.timezone} seats={criteria.seats} onSelect={() => {}} /> : result ? <div><h2 className="mb-1 break-words text-xl font-semibold">{result.criteria.origin} → {result.criteria.destination}</h2><p className="mb-6 text-sm text-muted-foreground">{travelDate(`${result.criteria.date}T12:00:00Z`, catalog.timezone)} · Пасажирів: {result.criteria.seats}</p><Filtering8 loading={searching} key={JSON.stringify(result.criteria)} trips={result.trips} timezone={catalog.timezone} seats={result.criteria.seats} onSelect={(trip) => { setSelected(trip); window.scrollTo({ top: 0 }) }} nearest={!result.trips.some((trip) => trip.availableSeats >= result.criteria.seats) ? [...result.before, ...result.after] : undefined} /></div> : catalog.routes.length > 0 ? <section aria-label="Наші напрямки"><h2 className="mb-5 text-xl font-semibold">Наші напрямки</h2><div className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">{catalog.routes.map((route) => <Button key={`${route.origin}\0${route.destination}`} variant="ghost" className="h-auto min-h-14 justify-between whitespace-normal rounded-none border-0 border-b border-border px-0 py-4 text-left hover:bg-transparent hover:text-primary" onClick={() => { setCriteria({ ...criteria, ...route }); document.getElementById("travel-date")?.focus() }}><span className="break-words">{route.origin} → {route.destination}</span><ArrowRight className="shrink-0" /></Button>)}</div><p className="mt-6 text-xs text-muted-foreground">Наявність рейсів і вільних місць залежить від обраної дати.</p></section> : null}
        </>}
      </>}
    </main>
    <footer className="mx-auto mt-6 flex w-full max-w-screen-2xl flex-wrap justify-between gap-3 border-t border-border px-4 py-6 text-xs text-muted-foreground sm:px-8 lg:px-12"><span>{catalog?.name ?? "Vivat Bus"}</span><span>Бронювання без реєстрації · Оплата при посадці</span></footer>
  </div>
}
