"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Copy, Plus, Ticket, Trash2 } from "lucide-react"
import { formatPhoneNumberIntl } from "react-phone-number-input"
import Wizard2 from "@/components/wizard-2"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { PhoneInput } from "@/components/ui/phone-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { validateCheckout, type CheckoutErrors, type CheckoutPassenger } from "@/lib/booking-checkout"
import { publicBookingFetch, travelDay, travelDate, travelMoney, travelTime, type PublicCatalog, type PublicConfirmation, type PublicTrip } from "@/lib/public-booking"

const fieldClass = "h-11! w-full rounded-xl border-border bg-background px-3 font-normal text-foreground"
const blankPassenger = (): CheckoutPassenger => ({ firstName: "", lastName: "", birthDate: "" })
const paymentLabel = "Готівка при посадці"

function CheckoutSelect({ id, label, value, options, onChange, error }: { id: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; error?: string }) {
  return <Select value={value} onValueChange={(next) => onChange(next ?? "")}>
    <SelectTrigger id={id} aria-label={label} aria-required="true" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className={fieldClass}>
      <SelectValue>{options.find((option) => option.value === value)?.label ?? "Оберіть значення"}</SelectValue>
    </SelectTrigger>
    <SelectContent alignItemWithTrigger={false}>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}

export function PassengerCheckout({ slug, trip, seats, catalog, onBack }: { slug: string; trip: PublicTrip; seats: number; catalog: PublicCatalog; onBack: () => void }) {
  const [step, setStep] = useState(1)
  const [passengers, setPassengers] = useState<(CheckoutPassenger & { key: string })[]>([{ ...blankPassenger(), key: "lead" }])
  const [phone, setPhone] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("")
  const [custom, setCustom] = useState<Record<string, string | number | boolean>>({})
  const [errors, setErrors] = useState<CheckoutErrors>({})
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [confirmation, setConfirmation] = useState<PublicConfirmation | null>(null)
  const request = useRef<{ fingerprint: string; key: string } | null>(null)
  const inFlight = useRef(false)
  const submissionStarted = useRef(false)
  const today = travelDay(new Date(), "UTC")
  const oldest = `${Number(today.slice(0, 4)) - 125}${today.slice(4)}`
  const total = confirmation?.priceMinor ?? trip.priceMinor * seats

  function clearError(id: string) { setErrors((current) => { const next = { ...current }; delete next[id]; return next }) }
  function updatePerson(index: number, field: keyof CheckoutPassenger, value: string) {
    setPassengers((current) => current.map((person, position) => position === index ? { ...person, [field]: value } : person))
    clearError(`passenger-${index}-${field}`)
  }
  function review() {
    const next = validateCheckout({ passengers, seats, phone, paymentMethod, fields: catalog.fields, custom, today })
    setErrors(next)
    const first = Object.keys(next)[0]
    if (first) { document.getElementById(first)?.focus(); return }
    setError(""); setStep(2); window.scrollTo({ top: 0 })
  }
  async function submit() {
    if (!consent || inFlight.current) return
    inFlight.current = true; submissionStarted.current = true
    setBusy(true); setError("")
    const data = { tripId: trip.id, quotedPriceMinor: trip.priceMinor, seats, passengers: passengers.map(({ firstName, lastName, birthDate }) => ({ firstName: firstName.trim(), lastName: lastName.trim(), birthDate })), passengerPhone: phone, paymentMethod, customData: custom, consent }
    const fingerprint = JSON.stringify(data)
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() }
    try {
      const response = await publicBookingFetch<{ item: PublicConfirmation }>(slug, "bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, requestKey: request.current.key }) })
      setConfirmation(response.item); setStep(3); window.scrollTo({ top: 0 })
    } catch (failure) { setError(failure instanceof Error && !["TimeoutError", "AbortError", "TypeError"].includes(failure.name) ? failure.message : "Не вдалося з’єднатися із сервісом. Спробуйте ще раз.") }
    finally { inFlight.current = false; setBusy(false) }
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (submissionStarted.current && !confirmation) event.preventDefault() }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [confirmation])
  function fieldError(id: string) { return errors[id] ? <p id={`${id}-error`} className="mt-2 text-xs text-destructive">{errors[id]}</p> : null }
  const summary = <>
    <div className="mb-4 flex items-center gap-2 text-sm font-semibold"><Ticket className="size-4 text-primary" />Ваш рейс</div>
    <h2 className="break-words text-lg font-semibold">{trip.origin} → {trip.destination}</h2>
    <p className="mt-3 text-sm text-muted-foreground">{travelDate(trip.startsAt, catalog.timezone)}{travelDate(trip.startsAt, catalog.timezone) !== travelDate(trip.endsAt, catalog.timezone) ? ` — ${travelDate(trip.endsAt, catalog.timezone)}` : ""}</p>
    <p className="mt-2 font-semibold tabular-nums">{travelTime(trip.startsAt, catalog.timezone)} — {travelTime(trip.endsAt, catalog.timezone)}</p>
    <p className="mt-2 text-xs text-muted-foreground">Часовий пояс: {catalog.timezone}</p>
    <Separator className="my-5" />
    <dl className="space-y-4 text-sm">
      <div className="flex justify-between gap-3"><dt>Місць</dt><dd className="font-semibold">{seats}</dd></div>
      <div><dt className="text-muted-foreground">Спосіб оплати</dt><dd className={`mt-1 ${paymentMethod ? "font-medium" : "text-muted-foreground"}`}>{paymentMethod ? paymentLabel : "Не вибрано"}</dd></div>
      <div><dt>До сплати</dt><dd className="mt-1 text-2xl font-bold tabular-nums text-primary">{travelMoney(total, confirmation?.currency ?? trip.currency)}</dd></div>
    </dl>
  </>
  return <Wizard2 step={step} title={step === 3 ? "Бронювання створено" : "Оформлення поїздки"} summary={summary} busy={busy} disabled={step === 2 && !consent} nextLabel={step === 1 ? "Перевірити дані" : step === 2 ? "Забронювати місця" : "Знайти інший рейс"} onNext={step === 1 ? review : step === 2 ? () => void submit() : onBack} onBack={() => { if (step === 2) { setStep(1); setConsent(false); setError("") } else onBack() }}>
    {error && <p role="alert" className="mb-6 rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{error}</p>}
    {step === 1 ? <form noValidate onSubmit={(event) => { event.preventDefault(); review() }} className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Пасажири <span className="ml-1 text-sm font-normal text-muted-foreground">{passengers.length} із {seats}</span></h2><Button type="button" variant="ghost" className="h-11 px-2 text-xs text-muted-foreground" onClick={onBack}>Змінити кількість місць</Button></div>
      <p className="-mt-4 text-sm leading-relaxed text-muted-foreground">Ім’я та прізвище латиницею, як у документі. Контактний телефон — спільний для бронювання.</p>
      {passengers.map((person, index) => <fieldset key={person.key} className="min-w-0 space-y-4 border-0 p-0">
        <legend className="mb-3 flex w-full items-center justify-between gap-2 text-sm font-semibold">Пасажир {index + 1}{index === 0 && <span className="ml-auto text-xs font-normal text-muted-foreground">Контактна особа</span>}{index > 0 && <Button type="button" variant="ghost" size="icon" className="size-11 text-muted-foreground" aria-label={`Видалити пасажира ${index + 1}`} onClick={() => { setPassengers((current) => current.filter((item) => item.key !== person.key)); setErrors({}) }}><Trash2 className="size-4" /></Button>}</legend>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {(["firstName", "lastName"] as const).map((field) => { const id = `passenger-${index}-${field}`; const label = field === "firstName" ? "Ім’я" : "Прізвище"; return <div key={field}><label htmlFor={id} className="mb-2 block text-sm font-medium">{label}</label><Input id={id} required aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `${id}-error` : undefined} autoComplete={`section-passenger${index} ${field === "firstName" ? "given-name" : "family-name"}`} maxLength={80} value={person[field]} onChange={(event) => updatePerson(index, field, event.target.value)} placeholder={field === "firstName" ? "IVAN" : "PETRENKO"} className={fieldClass} />{fieldError(id)}</div> })}
          <div className="min-w-0"><label htmlFor={`passenger-${index}-birthDate`} className="mb-2 block text-sm font-medium">Дата народження</label><DatePicker id={`passenger-${index}-birthDate`} label={`Дата народження пасажира ${index + 1}`} required min={oldest} max={today} value={person.birthDate} onValueChange={(value) => updatePerson(index, "birthDate", value)} invalid={!!errors[`passenger-${index}-birthDate`]} describedBy={errors[`passenger-${index}-birthDate`] ? `passenger-${index}-birthDate-error` : undefined} className={fieldClass} />{fieldError(`passenger-${index}-birthDate`)}</div>
        </div>
        {index < passengers.length - 1 && <Separator className="mt-6" />}
      </fieldset>)}
      {passengers.length < seats && <div><Button id="passengers" type="button" variant="outline" className="h-11 px-4" aria-describedby={errors.passengers ? "passengers-error" : undefined} onClick={() => { setPassengers((current) => [...current, { ...blankPassenger(), key: crypto.randomUUID() }]); clearError("passengers") }}><Plus />Додати пасажира</Button>{fieldError("passengers")}</div>}
      <Separator />
      <div><label htmlFor="passenger-phone" className="mb-2 block text-sm font-medium">Контактний телефон</label><PhoneInput id="passenger-phone" required value={phone || undefined} onChange={(value) => { setPhone(value ?? ""); clearError("passenger-phone") }} aria-invalid={!!errors["passenger-phone"]} aria-describedby={errors["passenger-phone"] ? "passenger-phone-error" : "phone-hint"} autoComplete="tel" placeholder="Номер телефону" />{fieldError("passenger-phone")}<p id="phone-hint" className="mt-2 text-xs text-muted-foreground">Для зв’язку щодо рейсу.</p></div>
      {catalog.fields.map((field) => { const id = `booking-${field.key}`; return <div key={field.key}><label htmlFor={id} className="mb-2 block text-sm font-medium">{field.label}</label>{field.type === "select" || field.type === "boolean" ? <CheckoutSelect id={id} label={field.label} value={String(custom[field.key] ?? "")} onChange={(value) => { setCustom({ ...custom, [field.key]: field.type === "boolean" ? value === "true" : value }); clearError(id) }} options={field.type === "boolean" ? [{ value: "true", label: "Так" }, { value: "false", label: "Ні" }] : field.options.map((option) => ({ value: option, label: option }))} error={errors[id]} /> : field.type === "date" ? <DatePicker id={id} label={field.label} required value={String(custom[field.key] ?? "")} onValueChange={(value) => { setCustom({ ...custom, [field.key]: value }); clearError(id) }} invalid={!!errors[id]} describedBy={errors[id] ? `${id}-error` : undefined} className={fieldClass} /> : <Input id={id} required aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `${id}-error` : undefined} type={field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} maxLength={4000} value={String(custom[field.key] ?? "")} onChange={(event) => { setCustom({ ...custom, [field.key]: field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value }); clearError(id) }} className={fieldClass} />}{fieldError(id)}</div> })}
      <div><label htmlFor="payment-method" className="mb-2 block text-sm font-medium">Спосіб оплати</label><CheckoutSelect id="payment-method" label="Спосіб оплати" value={paymentMethod} onChange={(value) => { setPaymentMethod(value); clearError("payment-method") }} options={[{ value: "cash_on_boarding", label: paymentLabel }]} error={errors["payment-method"]} />{fieldError("payment-method")}</div>
      <button type="submit" className="sr-only" tabIndex={-1}>Перевірити дані</button>
      {Object.keys(errors).length > 0 && <p role="alert" className="text-sm text-destructive">Перевірте позначені поля перед продовженням.</p>}
    </form> : step === 2 ? <div>
      <h2 className="mb-5 text-lg font-semibold">Перевірте перед бронюванням</h2>
      <ul className="space-y-4">{passengers.map((person, index) => <li key={person.key} className="border-b border-border pb-4 text-sm"><p className="text-xs text-muted-foreground">Пасажир {index + 1}</p><p className="mt-1 break-words font-semibold">{person.firstName.trim()} {person.lastName.trim()}</p><p className="mt-1 text-muted-foreground">{person.birthDate.split("-").reverse().join(".")}</p></li>)}</ul>
      <dl className="mt-5 space-y-4 text-sm"><div><dt className="text-muted-foreground">Контактний телефон</dt><dd className="mt-1 font-medium">{formatPhoneNumberIntl(phone)}</dd></div><div><dt className="text-muted-foreground">Спосіб оплати</dt><dd className="mt-1 font-medium">{paymentLabel}</dd></div>{catalog.fields.map((field) => <div key={field.key}><dt className="text-muted-foreground">{field.label}</dt><dd className="mt-1 break-words font-medium">{typeof custom[field.key] === "boolean" ? custom[field.key] ? "Так" : "Ні" : String(custom[field.key])}</dd></div>)}</dl>
      <Separator className="my-6" /><label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed"><Checkbox checked={consent} onCheckedChange={setConsent} className="mt-1" /><span>Підтверджую правильність даних усіх пасажирів і погоджуюся на їх обробку перевізником для цієї поїздки.</span></label>
    </div> : confirmation ? <div>
      <div role="status"><CheckCircle2 className="mb-4 size-10 text-primary" /><h2 className="text-2xl font-bold">{["cash_on_boarding", "confirmed"].includes(confirmation.status) ? "Місця заброньовано!" : "Бронювання знайдено"}</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Збережіть ID бронювання та покажіть його під час посадки.</p></div>
      <div className="mt-6 rounded-xl border border-border bg-background p-4"><p className="text-sm font-medium">ID бронювання</p><p data-booking-reference className="mt-2 break-all font-mono text-base font-semibold text-primary select-all">{confirmation.reference}</p><Button type="button" variant="ghost" className="mt-2 h-11 px-2" onClick={() => void navigator.clipboard.writeText(confirmation.reference).then(() => setCopied(true)).catch(() => setError("Не вдалося скопіювати. Виділіть ID і скопіюйте вручну."))}><Copy />{copied ? "Скопійовано" : "Копіювати ID"}</Button></div>
      <ul aria-label="Пасажири бронювання" className="mt-5 space-y-1 text-sm">{passengers.map((person) => <li key={person.key}>{person.firstName.trim()} {person.lastName.trim()}</li>)}</ul>
      <Button variant="outline" className="mt-5 h-11 px-4" onClick={() => window.print()}>Зберегти / роздрукувати</Button><p className="mt-5 text-sm text-muted-foreground">{confirmation.status === "cash_on_boarding" ? "Оплата очікується готівкою при посадці." : `Поточний статус: ${confirmation.status}`}</p>
    </div> : null}
  </Wizard2>
}
