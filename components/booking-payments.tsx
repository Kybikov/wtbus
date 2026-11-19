"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import { DatePicker } from "@/components/ui/date-picker"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { sessionFetch } from "@/lib/session-navigation"
import {
  allocatedMinor,
  datedMoneyRate,
  formatMoney,
  localMoneyDay,
  moneyCurrencies,
  moneyOperationTimestamp,
  moneyRequestIdentity,
  parseMoneyInput,
  parsePositiveRate,
  type BookingPaymentData,
  type HistoricalRate,
  type MoneyCurrency,
  type MoneyRequestIdentity,
  type MoneyWorkspaceData,
} from "@/lib/money-v2"

async function read<T>(url: string, body?: object): Promise<T> {
  const response = await sessionFetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" }
  )
  const result = await response.json()
  if (!response.ok)
    throw new Error(result.error ?? "Не удалось загрузить оплаты.")
  return result
}
function PaymentRow({
  item,
  rates,
  canSetRate,
  onReceived,
}: {
  item: BookingPaymentData
  rates: HistoricalRate[]
  canSetRate: boolean
  onReceived: () => Promise<void>
}) {
  const [editing, setEditing] = React.useState(false)
  const [history, setHistory] = React.useState(false)
  const [currency, setCurrency] = React.useState<MoneyCurrency>(item.currency)
  const [amount, setAmount] = React.useState(
    String(item.outstandingMinor / 100)
  )
  const [day, setDay] = React.useState(() => localMoneyDay())
  const [manualRate, setManualRate] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const requestIdentity = React.useRef<MoneyRequestIdentity | null>(null)
  const timestamp = React.useRef({ day, at: moneyOperationTimestamp(day) })
  const automaticRate = datedMoneyRate(currency, item.currency, day, rates)
  const rate =
    currency === item.currency ? "1" : manualRate || automaticRate || ""
  const amountMinor = parseMoneyInput(amount)
  const applied =
    amountMinor === null ? null : allocatedMinor(amountMinor, rate)
  const manual =
    currency !== item.currency &&
    (!automaticRate || (!!manualRate && manualRate !== automaticRate))
  const reason = busy
    ? "Оплата записывается. Дождитесь результата."
    : !item.canReceive
      ? item.disabledReason || "У вас нет права принимать оплату этой брони."
      : item.outstandingMinor <= 0
        ? "Бронирование полностью оплачено."
        : amountMinor === null
          ? "Укажите положительную сумму с точностью до копеек."
          : manual && !canSetRate
            ? "За выбранную дату нужен согласованный курс. Обратитесь к сотруднику с правом финансового управления."
            : !parsePositiveRate(rate)
              ? "Укажите курс для выбранной валюты и даты."
              : !moneyOperationTimestamp(day)
                ? "Выберите дату получения денег, не позднее сегодняшней."
                : manual && !description.trim()
                  ? "Укажите причину выбранного курса."
                  : applied === null || applied <= 0
                    ? "Сумма после пересчёта должна быть больше нуля."
                    : applied > item.outstandingMinor
                      ? "Сумма превышает остаток долга. Укажите оплату без выдаваемой сдачи."
                      : ""
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (reason || amountMinor === null) return
    if (timestamp.current.day !== day)
      timestamp.current = { day, at: moneyOperationTimestamp(day) }
    const payload = {
      action: "receive",
      bookingId: item.bookingId,
      amountMinor,
      currency,
      ...(manual ? { rate: rate.trim().replace(",", ".") } : {}),
      occurredAt: timestamp.current.at,
      description: description.trim(),
    }
    requestIdentity.current = moneyRequestIdentity(
      requestIdentity.current,
      payload,
      () => crypto.randomUUID()
    )
    setBusy(true)
    setError("")
    try {
      await read("/api/money", {
        ...payload,
        requestId: requestIdentity.current.requestId,
      })
      requestIdentity.current = null
      setEditing(false)
      await onReceived()
      toast.success("Оплата записана")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось записать оплату.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="min-w-0 space-y-3 border-b py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold break-words">
            {item.passengerName || item.recordNumber || "Бронирование"}
          </p>
          {item.recordNumber && item.passengerName ? (
            <p className="text-xs text-muted-foreground">{item.recordNumber}</p>
          ) : null}
        </div>
        <Badge variant="secondary">
          {item.outstandingMinor <= 0
            ? "Оплачено"
            : item.settledMinor > 0
              ? "Частичная оплата"
              : "Ожидает оплату"}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Стоимость</dt>
        <dd className="text-right font-medium">
          {formatMoney(item.priceMinor, item.currency)}
        </dd>
        <dt className="text-muted-foreground">Оплачено</dt>
        <dd className="text-right">
          {formatMoney(item.settledMinor, item.currency)}
        </dd>
        <dt className="text-muted-foreground">Осталось</dt>
        <dd className="text-right font-semibold">
          {formatMoney(item.outstandingMinor, item.currency)}
        </dd>
      </dl>
      {!editing && item.outstandingMinor > 0 ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!item.canReceive}
          disabledReason={
            item.disabledReason ||
            "У вас нет права принимать оплату этой брони."
          }
          onClick={() => setEditing(true)}
        >
          Принять оплату
        </Button>
      ) : null}
      {editing ? (
        <form onSubmit={submit} className="grid min-w-0 gap-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1.5 text-sm">
              Получено
              <Input
                aria-label={`Получено ${item.recordNumber ?? item.bookingId}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-sm">
              Валюта оплаты
              <FieldSelect
                aria-label={`Валюта оплаты ${item.recordNumber ?? item.bookingId}`}
                value={currency}
                onValueChange={(value) => {
                  setCurrency(value as MoneyCurrency)
                  setManualRate("")
                }}
                options={moneyCurrencies.map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </label>
          </div>
          <div className="grid min-w-0 gap-1.5 text-sm">
            <span>Дата получения</span>
            <DatePicker
              label={`Дата получения ${item.recordNumber ?? item.bookingId}`}
              value={day}
              max={localMoneyDay()}
              onValueChange={(value) => {
                setDay(value)
                setManualRate("")
              }}
            />
          </div>
          {currency !== item.currency ? (
            <>
              <label className="grid min-w-0 gap-1.5 text-sm">
                Курс: 1 {currency} в {item.currency}
                <Input
                  aria-label={`Курс оплаты ${item.recordNumber ?? item.bookingId}`}
                  inputMode="decimal"
                  value={manualRate || automaticRate || ""}
                  onChange={(e) => setManualRate(e.target.value)}
                />
              </label>
              {!automaticRate ? (
                <p className="text-xs text-muted-foreground">
                  За эту дату курса нет. Укажите согласованный курс и причину.
                </p>
              ) : null}
            </>
          ) : null}
          <label className="grid min-w-0 gap-1.5 text-sm">
            {manual ? "Причина курса" : "Комментарий"}
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {applied !== null ? (
            <p className="text-sm">
              В счёт брони:{" "}
              <strong>{formatMoney(applied, item.currency)}</strong>
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              disabledReason="Дождитесь результата приёма оплаты."
              onClick={() => setEditing(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={!!reason} disabledReason={reason}>
              Принять оплату
            </Button>
          </div>
        </form>
      ) : null}
      {!!item.receipts?.length ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setHistory((value) => !value)}
          >
            Полученные оплаты{history ? <ChevronUp /> : <ChevronDown />}
          </Button>
          {history ? (
            <ul className="space-y-2">
              {item.receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t pt-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {formatMoney(receipt.amountMinor, receipt.currency)}
                      {receipt.reversed ? (
                        <Badge variant="secondary" className="ml-2">
                          Сторнировано
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs break-words text-muted-foreground">
                      {receipt.collectorName} ·{" "}
                      {new Intl.DateTimeFormat("ru-RU", {
                        dateStyle: "short",
                      }).format(new Date(receipt.occurredAt))}
                    </p>
                  </div>
                  <span className="text-right text-xs text-muted-foreground">
                    {formatMoney(receipt.settledMinor, item.currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </article>
  )
}
export function BookingPayments({
  tripId,
  bookingId,
  onUpdated,
  inline = false,
}: {
  tripId?: string
  bookingId?: string
  onUpdated?: () => void
  inline?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [items, setItems] = React.useState<BookingPaymentData[]>([])
  const [rates, setRates] = React.useState<HistoricalRate[]>([])
  const [canSetRate, setCanSetRate] = React.useState(false)
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const load = React.useCallback(async () => {
    if (!bookingId && !tripId) return
    setLoading(true)
    setError("")
    try {
      const search = new URLSearchParams({
        view: "booking",
        ...(bookingId ? { bookingId } : { tripId: tripId! }),
      })
      const [bookings, workspace] = await Promise.all([
        read<BookingPaymentData | { items: BookingPaymentData[] }>(
          `/api/money?${search}`
        ),
        read<MoneyWorkspaceData>("/api/money"),
      ])
      setItems("items" in bookings ? bookings.items : [bookings])
      setRates(workspace.rates ?? [])
      setCanSetRate(workspace.canManage)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить оплаты.")
    } finally {
      setLoading(false)
    }
  }, [tripId, bookingId])
  React.useEffect(() => {
    if (inline) {
      const frame = requestAnimationFrame(() => void load())
      return () => cancelAnimationFrame(frame)
    }
  }, [inline, load])
  const content = (
    <>
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Повторить
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p className="py-4 text-sm text-muted-foreground">Загружаем оплаты…</p>
      ) : null}
      {!loading && !error
        ? items.map((item) => (
            <PaymentRow
              key={`${item.bookingId}:${item.settledMinor}`}
              item={item}
              rates={rates}
              canSetRate={canSetRate}
              onReceived={async () => {
                await load()
                onUpdated?.()
              }}
            />
          ))
        : null}
      {!loading && !error && !items.length ? (
        <p className="py-4 text-sm text-muted-foreground">
          Нет бронирований для оплаты.
        </p>
      ) : null}
    </>
  )
  if (inline)
    return (
      <section aria-label="Оплаты пассажиров" className="min-w-0 space-y-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <Wallet className="size-4" />
          Оплаты пассажиров
        </h3>
        {content}
      </section>
    )
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!bookingId && !tripId}
        disabledReason="Выберите рейс для приёма оплаты."
        onClick={() => {
          setOpen(true)
          void load()
        }}
      >
        {bookingId ? "Оплата брони" : "Оплаты рейса"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[min(85dvh,var(--mobile-viewport-height,85dvh))] min-w-0 overflow-y-auto">
          <DialogHeader className="pr-10">
            <DialogTitle>
              {bookingId ? "Оплата брони" : "Оплаты рейса"}
            </DialogTitle>
            <DialogDescription>
              Полученные деньги поступят в вашу кассу в выбранной валюте.
            </DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    </>
  )
}
