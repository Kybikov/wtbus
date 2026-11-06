"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { sessionFetch } from "@/lib/session-navigation"
import type { ManifestBooking } from "@/components/driver-passenger-manifest"
const money = (v: number, c: string) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: c }).format(
    v / 100
  )
function CashRow({
  item,
  tripId,
  onReceived,
}: {
  item: ManifestBooking
  tripId: string
  onReceived: () => Promise<void>
}) {
  const remaining = Math.max(0, item.amountMinor - item.cashMinor)
  const [amount, setAmount] = useState(String(remaining / 100))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const bank = item.paymentMethod === "bank_transfer"
  async function receive() {
    const text = amount.trim().replace(",", ".")
    const delta = /^\d+(\.\d{1,2})?$/.test(text)
      ? Math.round(Number(text) * 100)
      : 0
    if (delta <= 0 || delta > remaining) {
      setError("Укажите сумму не больше остатка по брони.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const response = await sessionFetch("/api/booking-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          bookingId: item.id,
          cashMinor: item.cashMinor + delta,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw Error(data.error ?? "Оплата не записана.")
      await onReceived()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Оплата не записана.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 border-b py-4 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {item.name}{" "}
          <span className="text-xs text-muted-foreground">
            {item.recordNumber}
          </span>
        </span>
        <Badge variant="secondary">
          {bank ? "Банковский перевод" : remaining ? "Наличные" : "Оплачено"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Стоимость {money(item.amountMinor, item.currency)} · Получено{" "}
        {money(item.cashMinor, item.currency)}
      </p>
      {!bank && remaining > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-xs">
            Принято наличными · {item.currency}
            <Input
              aria-label={`Сумма оплаты ${item.recordNumber}`}
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <Button
            disabled={busy}
            disabledReason="Оплата записывается. Дождитесь результата."
            onClick={() => void receive()}
          >
            Принять оплату
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
export function OwnerBookingCash({
  tripId,
  bookingId,
  onUpdated,
}: {
  tripId: string
  bookingId?: string
  onUpdated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ManifestBooking[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  async function load() {
    setLoading(true)
    setError("")
    try {
      const response = await sessionFetch(
        `/api/booking-cash?tripId=${encodeURIComponent(tripId)}`,
        { cache: "no-store" }
      )
      const data = await response.json()
      if (!response.ok)
        throw Error(data.error ?? "Не удалось загрузить оплаты.")
      setItems(
        data.items.filter(
          (b: ManifestBooking) => !bookingId || b.id === bookingId
        )
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить оплаты.")
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true)
          void load()
        }}
      >
        {bookingId ? "Оплата брони" : "Оплаты рейса"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Оплата наличными</DialogTitle>
            <DialogDescription>
              Полученные деньги учитываются у вас на руках. Передать их в кассу
              можно в разделе «Финансы».
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div role="alert" className="text-sm text-destructive">
              {error}
              <Button variant="ghost" onClick={() => void load()}>
                Повторить
              </Button>
            </div>
          ) : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">Загружаем оплаты…</p>
          ) : (
            items.map((item) => (
              <CashRow
                key={`${item.id}:${item.cashMinor}`}
                item={item}
                tripId={tripId}
                onReceived={async () => {
                  await load()
                  onUpdated()
                }}
              />
            ))
          )}
          {!loading && !error && !items.length ? (
            <p className="text-sm text-muted-foreground">
              Нет активных бронирований для оплаты.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
