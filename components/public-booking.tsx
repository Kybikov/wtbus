"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { ArrowLeftRight, ArrowRight, Bus, CheckCircle2, Loader2, Search, Ticket } from "lucide-react"
import Filtering8 from "@/components/filtering-8"
import Wizard2 from "@/components/wizard-2"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { publicBookingFetch, travelDay, travelDate, travelMoney, travelTime, type PublicCatalog, type PublicConfirmation, type PublicTrip } from "@/lib/public-booking"

type SearchCriteria = { origin: string; destination: string; date: string; seats: number }
const errorMessage = (error: unknown) => error instanceof Error && !["TimeoutError", "AbortError", "TypeError"].includes(error.name) ? error.message : "Не вдалося з’єднатися із сервісом. Перевірте інтернет і спробуйте ще раз."

export function PublicBooking({ slug }: { slug: string }) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null)
  const [catalogError, setCatalogError] = useState("")
  const [retry, setRetry] = useState(0)
  const [criteria, setCriteria] = useState<SearchCriteria>({ origin: "", destination: "", date: "", seats: 1 })
  const [result, setResult] = useState<{ trips: PublicTrip[]; criteria: SearchCriteria } | null>(null)
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
      const data = await publicBookingFetch<{ items: PublicTrip[] }>(slug, `trips?${new URLSearchParams({ origin: snapshot.origin, destination: snapshot.destination, date: snapshot.date, seats: String(snapshot.seats) })}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      if (!controller.signal.aborted) setResult({ trips: data.items, criteria: snapshot })
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
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Куди поїдемо?</h1><p className="max-w-sm text-sm leading-relaxed text-muted-foreground">Оберіть рейс. Забронюйте місця.<br />Оплатіть готівкою при посадці.</p></div>
        {catalogError ? <div role="alert" className="rounded-xl border border-destructive/40 p-5"><p>{catalogError}</p><Button className="mt-4" onClick={() => { setCatalogError(""); setRetry(retry + 1) }}>Спробувати ще раз</Button></div> : !catalog ? <div aria-label="Завантаження маршрутів" aria-busy="true" className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : <>
          <form onSubmit={search} aria-label="Пошук автобусних рейсів" aria-busy={searching} className="mb-8 rounded-[var(--rb-r-lg)] bg-primary p-5 text-primary-foreground sm:p-6">
            <div className="grid min-w-0 items-end gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(150px,.65fr)_minmax(140px,.5fr)_auto]">
              <div className="min-w-0"><label id="origin-label" className="mb-2 block text-xs font-semibold">Звідки</label><FieldSelect aria-label="Місто відправлення" value={criteria.origin} onValueChange={(origin) => setCriteria({ ...criteria, origin, destination: "" })} disabled={searching || !origins.length} placeholder="Оберіть місто" triggerClassName="data-[size=default]:h-11 bg-background text-foreground" options={origins.map((city) => ({ value: city, label: city }))} /></div>
              <Button type="button" variant="outline" size="icon" className="hidden h-11 w-11 border-primary-foreground/20 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 lg:flex" disabled={searching || !reverseAvailable} aria-label="Поміняти міста місцями" onClick={() => setCriteria({ ...criteria, origin: criteria.destination, destination: criteria.origin })}><ArrowLeftRight /></Button>
              <div className="min-w-0"><label className="mb-2 block text-xs font-semibold">Куди</label><FieldSelect aria-label="Місто прибуття" value={criteria.destination} onValueChange={(destination) => setCriteria({ ...criteria, destination })} disabled={searching || !criteria.origin} placeholder="Оберіть місто" triggerClassName="data-[size=default]:h-11 bg-background text-foreground" options={destinations.map((city) => ({ value: city, label: city }))} /></div>
              <div className="min-w-0"><label htmlFor="travel-date" className="mb-2 block text-xs font-semibold">Дата поїздки</label><Input id="travel-date" type="date" required min={travelDay(new Date(), catalog.timezone)} value={criteria.date} disabled={searching} onChange={(event) => setCriteria({ ...criteria, date: event.target.value })} className="h-11 min-w-0 bg-background text-foreground" /></div>
              <div className="min-w-0"><label className="mb-2 block text-xs font-semibold">Пасажири</label><FieldSelect aria-label="Кількість пасажирів" value={String(criteria.seats)} onValueChange={(seats) => setCriteria({ ...criteria, seats: Number(seats) })} disabled={searching} triggerClassName="data-[size=default]:h-11 bg-background text-foreground" options={Array.from({ length: 20 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} /></div>
              <Button type="submit" disabled={searching || !criteria.origin || !criteria.destination || !criteria.date} className="h-11 bg-primary-foreground px-6 text-primary hover:bg-primary-foreground/90 sm:col-span-2 lg:col-span-1">{searching ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Search />}Знайти рейс</Button>
            </div>
          </form>
          {!catalog.routes.length && <p className="mb-8 text-muted-foreground">Перевізник ще не опублікував маршрути. Перевірте пізніше.</p>}
          {searchError && <p role="alert" className="mb-5 rounded-xl border border-destructive/40 p-4 text-destructive">{searchError}</p>}
          {searching ? <div aria-label="Шукаємо рейси" className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-36" /></div> : result ? <div><h2 className="mb-1 break-words text-xl font-semibold">{result.criteria.origin} → {result.criteria.destination}</h2><p className="mb-6 text-sm text-muted-foreground">{travelDate(`${result.criteria.date}T12:00:00Z`, catalog.timezone)} · Пасажирів: {result.criteria.seats}</p><Filtering8 key={JSON.stringify(result.criteria)} trips={result.trips} timezone={catalog.timezone} seats={result.criteria.seats} onSelect={(trip) => { setSelected(trip); window.scrollTo({ top: 0 }) }} /></div> : catalog.routes.length > 0 ? <section aria-label="Наші напрямки"><h2 className="mb-5 text-xl font-semibold">Наші напрямки</h2><div className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">{catalog.routes.map((route) => <Button key={`${route.origin}\0${route.destination}`} variant="ghost" className="h-auto min-h-14 justify-between whitespace-normal rounded-none border-0 border-b border-border px-0 py-4 text-left hover:bg-transparent hover:text-primary" onClick={() => { setCriteria({ ...criteria, ...route }); document.getElementById("travel-date")?.focus() }}><span className="break-words">{route.origin} → {route.destination}</span><ArrowRight className="shrink-0" /></Button>)}</div><p className="mt-6 text-xs text-muted-foreground">Наявність рейсів і вільних місць залежить від обраної дати.</p></section> : null}
        </>}
      </>}
    </main>
    <footer className="mx-auto mt-6 flex w-full max-w-screen-2xl flex-wrap justify-between gap-3 border-t border-border px-4 py-6 text-xs text-muted-foreground sm:px-8 lg:px-12"><span>{catalog?.name ?? "Vivat Bus"}</span><span>Бронювання без реєстрації · Оплата при посадці</span></footer>
  </div>
}

function PassengerCheckout({ slug, trip, seats, catalog, onBack }: { slug: string; trip: PublicTrip; seats: number; catalog: PublicCatalog; onBack: () => void }) {
  const [step, setStep] = useState(1)
  const [passenger, setPassenger] = useState({ name: "", phone: "", birthDate: "" })
  const [custom, setCustom] = useState<Record<string, string | number | boolean>>({})
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [confirmation, setConfirmation] = useState<PublicConfirmation | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const request = useRef<{ fingerprint: string; key: string } | null>(null)
  const inFlight = useRef(false)
  const submissionStarted = useRef(false)
  const total = confirmation?.priceMinor ?? trip.priceMinor * seats
  const today = travelDay(new Date(), "UTC")
  function review() {
    if (!form.current?.reportValidity()) return
    if (catalog.fields.some((field) => custom[field.key] === undefined || custom[field.key] === "")) { setError("Заповніть додаткові обов’язкові поля."); return }
    setError(""); setStep(2); window.scrollTo({ top: 0 })
  }
  async function submit() {
    if (!consent || inFlight.current) return
    inFlight.current = true
    submissionStarted.current = true
    setBusy(true); setError("")
    const data = { tripId: trip.id, quotedPriceMinor: trip.priceMinor, seats, passengerName: passenger.name.trim(), passengerPhone: passenger.phone.trim(), passengerBirthDate: passenger.birthDate, customData: custom, consent }
    const fingerprint = JSON.stringify(data)
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() }
    try {
      const response = await publicBookingFetch<{ item: PublicConfirmation }>(slug, "bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, requestKey: request.current.key }) })
      setConfirmation(response.item); setStep(3); window.scrollTo({ top: 0 })
    } catch (failure) { setError(errorMessage(failure)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  // Prevent losing the receipt if a slow checkout response is interrupted.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (submissionStarted.current && !confirmation) event.preventDefault() }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [confirmation])
  const summary = <><div className="mb-5 flex items-center gap-2 text-sm font-semibold"><Ticket className="size-4 text-primary" />Ваш рейс</div><h2 className="break-words text-xl font-semibold">{trip.origin} → {trip.destination}</h2><p className="mt-3 text-sm text-muted-foreground">{travelDate(trip.startsAt, catalog.timezone)}{travelDate(trip.startsAt, catalog.timezone) !== travelDate(trip.endsAt, catalog.timezone) ? ` — ${travelDate(trip.endsAt, catalog.timezone)}` : ""}</p><p className="mt-2 text-lg font-semibold tabular-nums">{travelTime(trip.startsAt, catalog.timezone)} — {travelTime(trip.endsAt, catalog.timezone)}</p><p className="mt-2 text-xs text-muted-foreground">Часовий пояс: {catalog.timezone}</p><Separator className="my-6" /><div className="flex justify-between gap-3 text-sm"><span>Місць</span><strong>{seats}</strong></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm">До сплати</span><strong className="text-2xl tabular-nums text-primary">{travelMoney(total, confirmation?.currency ?? trip.currency)}</strong></div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">Готівкою при посадці. Онлайн-оплата не потрібна.</p></>
  return <Wizard2 step={step} title={step === 3 ? "Бронювання створено" : "Оформлення поїздки"} summary={summary} busy={busy} disabled={step === 2 && !consent} nextLabel={step === 1 ? "Перевірити дані" : step === 2 ? "Забронювати місця" : "Знайти інший рейс"} onNext={step === 1 ? review : step === 2 ? () => void submit() : onBack} onBack={() => { if (step === 2) { setStep(1); setError("") } else onBack() }}>
    {error && <p role="alert" className="mb-6 rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{error}</p>}
    {step === 1 ? <form ref={form} onSubmit={(event) => { event.preventDefault(); review() }} className="space-y-6"><div><h2 className="text-xl font-semibold">Дані пасажира</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Для зв’язку щодо рейсу та списку посадки. Якщо їдете разом, вкажіть контакт відповідального пасажира.</p></div><div className="grid min-w-0 gap-5 sm:grid-cols-2"><div className="sm:col-span-2"><label htmlFor="passenger-name" className="mb-2 block text-sm font-medium">Ім’я та прізвище</label><Input id="passenger-name" required autoComplete="name" maxLength={160} value={passenger.name} onChange={(event) => setPassenger({ ...passenger, name: event.target.value })} pattern={".*\\S.*"} placeholder="Як у документі" className="h-11" /></div><div><label htmlFor="passenger-phone" className="mb-2 block text-sm font-medium">Телефон</label><Input id="passenger-phone" type="tel" required autoComplete="tel" pattern={"\\+[0-9\\s\\(\\)\\-]{7,22}"} maxLength={23} value={passenger.phone} onChange={(event) => setPassenger({ ...passenger, phone: event.target.value })} placeholder="+380… або +48…" className="h-11" /><p className="mt-2 text-xs text-muted-foreground">Міжнародний формат із + та кодом країни.</p></div><div className="min-w-0"><label htmlFor="passenger-birth" className="mb-2 block text-sm font-medium">Дата народження</label><Input id="passenger-birth" type="date" required autoComplete="bday" max={today} value={passenger.birthDate} onChange={(event) => setPassenger({ ...passenger, birthDate: event.target.value })} className="h-11 min-w-0" /></div></div>
      {catalog.fields.map((field) => <div key={field.key}><label htmlFor={`booking-${field.key}`} className="mb-2 block text-sm font-medium">{field.label}</label>{field.type === "select" ? <FieldSelect aria-label={field.label} value={String(custom[field.key] ?? "")} onValueChange={(value) => setCustom({ ...custom, [field.key]: value })} options={field.options.map((option) => ({ value: option, label: option }))} placeholder="Оберіть значення" /> : field.type === "boolean" ? <FieldSelect aria-label={field.label} value={custom[field.key] === undefined ? "" : String(custom[field.key])} onValueChange={(value) => setCustom({ ...custom, [field.key]: value === "true" })} options={[{ value: "true", label: "Так" }, { value: "false", label: "Ні" }]} placeholder="Оберіть значення" /> : <Input id={`booking-${field.key}`} required type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} step={field.type === "number" ? "any" : undefined} maxLength={4000} value={String(custom[field.key] ?? "")} onChange={(event) => setCustom({ ...custom, [field.key]: field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value })} className="h-11" />}</div>)}<button type="submit" className="sr-only" tabIndex={-1}>Перевірити дані</button></form> : step === 2 ? <div><h2 className="mb-6 text-xl font-semibold">Перевірте перед бронюванням</h2><dl className="space-y-5 text-sm"><div><dt className="text-muted-foreground">Пасажир</dt><dd className="mt-1 break-words font-semibold">{passenger.name}</dd></div><div><dt className="text-muted-foreground">Телефон</dt><dd className="mt-1 font-semibold">{passenger.phone}</dd></div><div><dt className="text-muted-foreground">Дата народження</dt><dd className="mt-1 font-semibold">{passenger.birthDate}</dd></div>{catalog.fields.map((field) => <div key={field.key}><dt className="text-muted-foreground">{field.label}</dt><dd className="mt-1 break-words font-semibold">{typeof custom[field.key] === "boolean" ? custom[field.key] ? "Так" : "Ні" : String(custom[field.key])}</dd></div>)}</dl><Separator className="my-7" /><label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed"><Checkbox checked={consent} onCheckedChange={setConsent} className="mt-1" /><span>Підтверджую правильність даних і погоджуюся на їх обробку перевізником для оформлення та виконання цієї поїздки.</span></label><p className="mt-4 text-xs leading-relaxed text-muted-foreground">Після підтвердження місця будуть зарезервовані. Оплатіть поїздку готівкою при посадці.</p></div> : confirmation ? <div role="status"><CheckCircle2 className="mb-5 size-12 text-primary" /><h2 className="text-2xl font-bold">{confirmation.status === "cash_on_boarding" ? "Місця заброньовано!" : "Бронювання знайдено"}</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Збережіть номер бронювання та покажіть його під час посадки. Дані вже передано перевізнику.</p><p className="mt-6 text-xs text-muted-foreground">Номер бронювання</p><p className="mt-2 break-all font-mono text-sm font-semibold select-all">{confirmation.reference}</p><Button variant="outline" className="mt-6" onClick={() => window.print()}>Зберегти / роздрукувати</Button><p className="mt-5 text-sm text-muted-foreground">{confirmation.status === "cash_on_boarding" ? "Оплата очікується готівкою при посадці." : `Поточний статус: ${confirmation.status}`}</p></div> : null}
  </Wizard2>
}
