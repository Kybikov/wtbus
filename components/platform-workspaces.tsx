"use client"

import * as React from "react"
import { Building2, Plus, Receipt } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { sessionFetch } from "@/lib/session-navigation"

type Workspace = {
  slug: string
  name: string
  status: string
  members: number
  trips: number
  bookings: number
}
type Overview = {
  items: Workspace[]
  monthlyMinor: number
  collectedMinor: number
}
type Payment = {
  amountMinor: number
  paidOn: string
  source: string
  reference: string
}
type Event = {
  at: string
  action: string
  actor: string
  previous: string
  next: string
  reason: string
}
type Details = { status: string; payments: Payment[]; events: Event[] }

const url = "/api/platform/workspaces"
const statuses: Record<string, string> = {
  trial: "Пробный период",
  active: "Активна",
  past_due: "Просрочена",
  suspended: "Приостановлена",
}
const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "UAH",
})
const money = (minor: number) => currency.format(minor / 100)
const day = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeZone: "UTC",
})
const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
})
const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : "Повторите попытку."

async function request<T>(address: string, options?: RequestInit): Promise<T> {
  const response = await sessionFetch(address, {
    cache: "no-store",
    ...options,
  })
  const data = await response.json()
  if (!response.ok) throw Error(data.error || "Не удалось выполнить действие.")
  return data
}

function formatEvent(event: Event) {
  if (event.action === "created") return "Создано рабочее пространство"
  if (event.action === "payment") return "Учтена оплата подписки"
  return `${statuses[event.previous] ?? event.previous} → ${statuses[event.next] ?? event.next}`
}

export function PlatformWorkspaces() {
  const [overview, setOverview] = React.useState<Overview>()
  const [selected, setSelected] = React.useState("")
  const [details, setDetails] = React.useState<{
    slug: string
    data: Details
  }>()
  const [revision, setRevision] = React.useState(0)
  const [error, setError] = React.useState("")
  const [detailError, setDetailError] = React.useState("")
  const [statusBusy, setStatusBusy] = React.useState(false)
  const [dialog, setDialog] = React.useState<"create" | "payment" | null>(null)
  const [dialogError, setDialogError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const current =
    overview?.items.find((item) => item.slug === selected) ?? overview?.items[0]
  const slug = current?.slug
  const address = slug ? `${url}?slug=${encodeURIComponent(slug)}` : ""
  const detail = details?.slug === slug ? details?.data : undefined

  React.useEffect(() => {
    const controller = new AbortController()
    void request<Overview>(url, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setOverview(data)
          setError("")
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorText(reason))
      })
    return () => controller.abort()
  }, [revision])

  React.useEffect(() => {
    if (!slug) return
    const controller = new AbortController()
    void request<Details>(address, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setDetails({ slug, data })
          setDetailError("")
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setDetailError(errorText(reason))
      })
    return () => controller.abort()
  }, [address, revision, slug])

  async function setStatus(status: string) {
    if (!detail || detail.status === status || statusBusy) return
    setStatusBusy(true)
    setDetailError("")
    try {
      await request(address, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      setDetails((value) =>
        value && value.slug === slug
          ? { ...value, data: { ...value.data, status } }
          : value
      )
      setRevision((value) => value + 1)
      toast.success("Статус подписки обновлён")
    } catch (reason) {
      setDetailError(errorText(reason))
    } finally {
      setStatusBusy(false)
    }
  }

  function openDialog(mode: "create" | "payment") {
    setDialogError("")
    setDialog(mode)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !dialog) return
    const fields = Object.fromEntries(new FormData(event.currentTarget))
    const endpoint = dialog === "create" ? url : `${address}&payment=1`
    const payload =
      dialog === "create"
        ? { ...fields, baseCurrency: "UAH", subscriptionStatus: "trial" }
        : {
            paidOn: fields.paidOn,
            reference: fields.reference,
            amountMinor: Math.round(Number(fields.amount) * 100),
          }
    setSaving(true)
    setDialogError("")
    try {
      const result = await request<{ slug?: string }>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (result.slug) setSelected(result.slug)
      setRevision((value) => value + 1)
      setDialog(null)
      toast.success(
        dialog === "create" ? "Рабочее пространство создано" : "Оплата учтена"
      )
    } catch (reason) {
      setDialogError(errorText(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <section className="workspace-panel space-y-4 p-4 sm:p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <Building2 className="size-4 text-primary" />
            Рабочие пространства
          </h1>
          <Button size="sm" onClick={() => openDialog("create")}>
            <Plus /> Создать
          </Button>
        </header>
        {error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm text-destructive"
          >
            {error}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRevision((value) => value + 1)}
            >
              Повторить
            </Button>
          </div>
        ) : null}
        {!overview && !error ? (
          <p role="status" className="text-sm text-muted-foreground">
            Загружаем рабочие пространства…
          </p>
        ) : null}
        {overview ? (
          <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              ["Компании", overview.items.length],
              [
                "Активные подписки",
                overview.items.filter((item) => item.status === "active")
                  .length,
              ],
              ["Получено в этом месяце", money(overview.collectedMinor)],
              ["Тариф за месяц", money(overview.monthlyMinor)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="min-w-0 rounded-xl border border-border/60 p-3"
              >
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {current ? (
        <>
          <section className="workspace-panel grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <label className="grid gap-1 text-sm">
              Компания
              <FieldSelect
                aria-label="Компания"
                value={current.slug}
                onValueChange={(value) => {
                  setSelected(value)
                  setDetailError("")
                }}
                disabled={statusBusy}
                disabledReason="Статус подписки сохраняется."
                options={
                  overview?.items.map((item) => ({
                    value: item.slug,
                    label: item.name,
                  })) ?? []
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Статус подписки
              <FieldSelect
                aria-label="Статус подписки"
                value={detail?.status ?? current.status}
                onValueChange={(status) => void setStatus(status)}
                disabled={statusBusy || !detail}
                disabledReason={
                  statusBusy
                    ? "Сохраняем статус подписки."
                    : detailError
                      ? "Повторите загрузку данных компании."
                      : "Загружаем данные компании."
                }
                options={Object.entries(statuses).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </label>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground sm:col-span-2">
              <div className="flex gap-1">
                <dt>Сотрудники</dt>
                <dd className="font-medium text-foreground">
                  {current.members}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt>Рейсы</dt>
                <dd className="font-medium text-foreground">{current.trips}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Бронирования</dt>
                <dd className="font-medium text-foreground">
                  {current.bookings}
                </dd>
              </div>
            </dl>
            {detailError ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 text-sm text-destructive sm:col-span-2"
              >
                {detailError}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Повторить
                </Button>
              </div>
            ) : null}
          </section>

          <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
            <section className="workspace-panel min-w-0 space-y-3 p-4 sm:p-5">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Оплаты подписки</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openDialog("payment")}
                >
                  <Receipt /> Учесть оплату
                </Button>
              </header>
              {!detail && !detailError ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Загружаем оплаты…
                </p>
              ) : null}
              {detail?.payments.length ? (
                <ul className="divide-y divide-border">
                  {detail.payments.map((payment) => (
                    <li
                      key={payment.source + ":" + payment.reference}
                      className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">
                          {money(payment.amountMinor)}
                        </div>
                        <div className="text-xs break-all text-muted-foreground">
                          {payment.reference} ·{" "}
                          {payment.source === "manual"
                            ? "Вручную"
                            : "WTBackend"}
                        </div>
                      </div>
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={payment.paidOn}
                      >
                        {day.format(new Date(payment.paidOn))}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : detail ? (
                <p className="text-sm text-muted-foreground">Оплат пока нет.</p>
              ) : null}
            </section>

            <section className="workspace-panel min-w-0 space-y-3 p-4 sm:p-5">
              <h2 className="text-sm font-semibold">История действий</h2>
              {!detail && !detailError ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Загружаем историю…
                </p>
              ) : null}
              {detail?.events.length ? (
                <ul className="divide-y divide-border">
                  {detail.events.map((event, index) => (
                    <li
                      key={event.at + index}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium break-words">
                          {formatEvent(event)}
                        </div>
                        <div className="text-xs break-words text-muted-foreground">
                          {[event.actor, event.reason]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <time
                        className="text-right text-xs text-muted-foreground"
                        dateTime={event.at}
                      >
                        {dateTime.format(new Date(event.at))}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : detail ? (
                <p className="text-sm text-muted-foreground">
                  Действий пока нет.
                </p>
              ) : null}
            </section>
          </div>
        </>
      ) : null}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setDialog(null)
        }}
      >
        <DialogContent
          showCloseButton={!saving}
          className="max-h-[90dvh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>
              {dialog === "create"
                ? "Новое рабочее пространство"
                : "Учесть оплату"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "create"
                ? "Компания начнёт с пробного периода."
                : current?.name}
            </DialogDescription>
          </DialogHeader>
          <form key={dialog} className="grid gap-3" onSubmit={submit}>
            {dialog === "create" ? (
              <>
                <label className="grid gap-1">
                  Название компании
                  <Input required minLength={2} maxLength={160} name="name" />
                </label>
                <label className="grid gap-1">
                  Адрес компании
                  <Input
                    required
                    name="slug"
                    pattern={"[a-z0-9\\-]{3,63}"}
                    placeholder="company-name"
                    autoCapitalize="off"
                  />
                </label>
                <label className="grid gap-1">
                  Часовой пояс
                  <Input required name="timezone" defaultValue="Europe/Kyiv" />
                </label>
                <label className="grid gap-1">
                  Имя владельца
                  <Input required minLength={2} name="ownerDisplayName" />
                </label>
                <label className="grid gap-1">
                  Email владельца
                  <Input required name="ownerEmail" type="email" />
                </label>
                <label className="grid gap-1">
                  Пароль для нового аккаунта
                  <Input
                    name="ownerPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={72}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="grid gap-1">
                  Сумма, UAH
                  <Input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1000000"
                    required
                    defaultValue={(overview?.monthlyMinor ?? 300000) / 100}
                  />
                </label>
                <label className="grid gap-1">
                  Дата получения
                  <Input name="paidOn" type="date" required />
                </label>
                <label className="grid gap-1">
                  Номер платежа
                  <Input name="reference" required maxLength={160} />
                </label>
              </>
            )}
            {dialogError ? (
              <p role="alert" className="text-destructive">
                {dialogError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="submit"
                disabled={saving}
                disabledReason="Дождитесь сохранения."
              >
                {saving
                  ? "Сохраняем…"
                  : dialog === "create"
                    ? "Создать компанию"
                    : "Учесть оплату"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
