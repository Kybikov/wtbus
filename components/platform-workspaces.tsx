"use client"

import * as React from "react"
import { ArrowUpRight, Building2, Plus, Receipt } from "lucide-react"
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
import { openWorkspace, sessionFetch } from "@/lib/session-navigation"

type Workspace = {
  slug: string
  name: string
  status: string
  members: number
  trips: number
  bookings: number
  through: string | null
}
type Trend = { month: string; collectedMinor: number; bookings: number }
type Overview = {
  items: Workspace[]
  monthlyMinor: number
  collectedMinor: number
  trend: Trend[]
}
type Payment = {
  amountMinor: number
  paidOn: string
  source: string
  reference: string
  actor: string
}
type Event = {
  at: string
  action: string
  actor: string
  previous: string
  next: string
  reason: string
  previousThrough: string | null
  nextThrough: string | null
}
type Access = { status: string; through: string | null }
type Details = Access & {
  payments: Payment[]
  events: Event[]
  ownerEmail: string
}

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
const accessDate = (value: string | null) =>
  value ? day.format(new Date(value)) : "Без срока"
const monthLabel = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  timeZone: "UTC",
})
const count = new Intl.NumberFormat("ru-RU")
const canEdit = (status: string) => status === "active" || status === "trial"

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
  if (response.status === 204) return undefined as T
  const data = await response.json()
  if (!response.ok) throw Error(data.error || "Не удалось выполнить действие.")
  return data
}

function formatEvent(event: Event) {
  if (event.action === "created") return "Создано рабочее пространство"
  if (event.action === "payment") return "Учтена оплата подписки"
  if (event.action === "entered") return "Вход администратора платформы"
  return (
    [
      event.previous === event.next
        ? null
        : `${statuses[event.previous] ?? event.previous} → ${statuses[event.next] ?? event.next}`,
      event.previousThrough === event.nextThrough
        ? null
        : `${accessDate(event.previousThrough)} → ${accessDate(event.nextThrough)}`,
    ]
      .filter(Boolean)
      .join(" · ") || "Доступ обновлён"
  )
}

function TrendChart({
  title,
  data,
  metric,
}: {
  title: string
  data: Trend[]
  metric: "collectedMinor" | "bookings"
}) {
  const maximum = Math.max(1, ...data.map((point) => point[metric]))
  const format = metric === "collectedMinor" ? money : count.format
  return (
    <section className="workspace-panel min-w-0 p-4 sm:p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="mt-3 grid grid-cols-6 gap-1 sm:gap-2">
        {data.map((point) => {
          const value = point[metric]
          const month = monthLabel.format(new Date(`${point.month}-01`))
          return (
            <li
              key={point.month}
              tabIndex={0}
              aria-label={`${month} · ${format(value)}`}
              className="group relative flex min-w-0 flex-col items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="pointer-events-none absolute -top-1 z-10 rounded bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-sm group-hover:opacity-100 group-focus-visible:opacity-100">
                {format(value)}
              </span>
              <div
                className="flex h-28 w-full items-end justify-center border-b border-border"
                aria-hidden
              >
                <div
                  className={`w-3/4 max-w-12 rounded-t ${metric === "collectedMinor" ? "bg-primary/75" : "bg-emerald-500/65"}`}
                  style={{
                    height: value === 0 ? 2 : `${(value / maximum) * 100}%`,
                  }}
                />
              </div>
              <span className="text-xs text-muted-foreground" aria-hidden>
                {month}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function PlatformWorkspaces({
  initialSlug,
  newOwner,
  openCreate,
}: {
  initialSlug?: string
  newOwner?: { name: string; email: string }
  openCreate?: boolean
}) {
  const [overview, setOverview] = React.useState<Overview>()
  const [selected, setSelected] = React.useState(initialSlug ?? "")
  const [details, setDetails] = React.useState<{
    slug: string
    data: Details
  }>()
  const [revision, setRevision] = React.useState(0)
  const [error, setError] = React.useState("")
  const [detailError, setDetailError] = React.useState("")
  const [statusBusy, setStatusBusy] = React.useState(false)
  const [switching, setSwitching] = React.useState(false)
  const [dateRevision, setDateRevision] = React.useState(0)
  const [dialog, setDialog] = React.useState<
    "create" | "payment" | "owner" | null
  >(openCreate ? "create" : null)
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

  async function enterWorkspace() {
    if (!slug || switching) return
    setSwitching(true)
    setDetailError("")
    try {
      await openWorkspace(slug, true)
    } catch (reason) {
      setSwitching(false)
      setDetailError(errorText(reason))
    }
  }

  async function updateAccess(patch: Partial<Access>) {
    if (!detail || statusBusy || switching) return
    setStatusBusy(true)
    setDetailError("")
    try {
      const access = await request<Access>(address, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      setDetails((value) =>
        value && value.slug === slug
          ? { ...value, data: { ...value.data, ...access } }
          : value
      )
      setRevision((value) => value + 1)
      toast.success("Доступ обновлён")
    } catch (reason) {
      setDateRevision((value) => value + 1)
      setDetailError(errorText(reason))
    } finally {
      setStatusBusy(false)
    }
  }

  function openDialog(mode: "create" | "payment" | "owner") {
    setDialogError("")
    setDialog(mode)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !dialog) return
    const fields = Object.fromEntries(new FormData(event.currentTarget))
    const endpoint = dialog === "create" ? url : `${address}&${dialog}=1`
    const payload =
      dialog === "create"
        ? { ...fields, baseCurrency: "UAH", subscriptionStatus: "trial" }
        : dialog === "owner"
          ? { email: fields.ownerEmail }
          : {
              paidOn: fields.paidOn,
              reference: fields.reference,
              amountMinor: Math.round(Number(fields.amount) * 100),
            }
    setSaving(true)
    setDialogError("")
    try {
      const result = await request<{ slug?: string } | undefined>(endpoint, {
        method: dialog === "owner" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (result?.slug) setSelected(result.slug)
      setRevision((value) => value + 1)
      setDialog(null)
      toast.success(
        dialog === "create"
          ? "Рабочее пространство создано"
          : dialog === "owner"
            ? "Владелец назначен"
            : "Оплата учтена"
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
              [
                "Только просмотр",
                overview.items.filter((item) => !canEdit(item.status)).length,
              ],
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

      {overview ? (
        <>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <TrendChart
              title="Платежи за подписки · 6 месяцев"
              data={overview.trend}
              metric="collectedMinor"
            />
            <TrendChart
              title="Создано бронирований · 6 месяцев"
              data={overview.trend}
              metric="bookings"
            />
          </div>
          <section
            className="workspace-panel min-w-0 p-4 sm:p-5"
            aria-label="Список компаний"
          >
            <h2 className="mb-2 text-sm font-semibold">Доступ компаний</h2>
            <ul className="divide-y divide-border">
              {overview.items.map((item) => (
                <li key={item.slug}>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-pressed={item.slug === slug}
                    className="grid h-auto min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center justify-items-start gap-x-3 gap-y-1 px-2 py-2 text-left sm:grid-cols-[minmax(0,1fr)_9rem_7rem]"
                    disabled={statusBusy || switching}
                    disabledReason={
                      switching
                        ? "Открываем рабочее пространство."
                        : "Сохраняем параметры доступа."
                    }
                    onClick={() => {
                      setSelected(item.slug)
                      setDetailError("")
                    }}
                  >
                    <span className="min-w-0 break-words whitespace-normal">
                      {item.name}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${canEdit(item.status) ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive"}`}
                    >
                      {statuses[item.status] ?? item.status}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {accessDate(item.through)}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {current ? (
        <>
          <section
            id="workspace"
            className="workspace-panel grid gap-4 p-4 sm:grid-cols-2 sm:p-5"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
              <div className="min-w-0">
                <h2 className="text-base font-semibold break-words">
                  {current.name}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {canEdit(current.status)
                    ? "Редактирование доступно"
                    : "Только просмотр"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={switching || statusBusy}
                disabledReason={
                  switching
                    ? "Открываем рабочее пространство."
                    : "Сохраняем параметры доступа."
                }
                onClick={() => void enterWorkspace()}
              >
                <ArrowUpRight /> Войти в компанию
              </Button>
            </header>
            <label className="grid gap-1 text-sm">
              Статус подписки
              <FieldSelect
                aria-label="Статус подписки"
                value={detail?.status ?? current.status}
                onValueChange={(status) => {
                  if (status !== detail?.status) void updateAccess({ status })
                }}
                disabled={statusBusy || switching || !detail}
                disabledReason={
                  statusBusy
                    ? "Сохраняем параметры доступа."
                    : switching
                      ? "Открываем рабочее пространство."
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
            <label className="grid gap-1 text-sm">
              Доступ по (включительно)
              <Input
                type="date"
                required
                min="2000-01-01"
                max="2100-12-31"
                key={`${slug}:${detail?.through}:${dateRevision}`}
                defaultValue={detail?.through ?? ""}
                readOnly={statusBusy || switching || !detail}
                onBlur={(event) => {
                  const input = event.currentTarget
                  if (
                    (input.value || detail?.through) &&
                    !input.validity.valid
                  ) {
                    setDetailError("Укажите корректную дату окончания доступа.")
                    setDateRevision((value) => value + 1)
                  } else if (input.value && input.value !== detail?.through) {
                    void updateAccess({ through: input.value })
                  }
                }}
              />
            </label>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 sm:col-span-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  Владелец и плательщик
                </p>
                <p className="text-sm break-all">
                  {detail?.ownerEmail ||
                    (detail ? "Не назначен" : "Загружаем…")}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDialog("owner")}
              >
                Назначить владельца
              </Button>
            </div>
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
                          {payment.actor ? ` · ${payment.actor}` : ""}
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
                : dialog === "owner"
                  ? "Назначить владельца"
                  : "Учесть оплату"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "create"
                ? newOwner
                  ? `Новая компания для ${newOwner.name}`
                  : "Укажите владельца и дату доступа."
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
                  Пробный доступ по (включительно)
                  <Input
                    required
                    name="subscriptionThrough"
                    type="date"
                    min="2000-01-01"
                    max="2100-12-31"
                  />
                </label>
                <label className="grid gap-1">
                  Имя владельца
                  <Input
                    required
                    minLength={2}
                    name="ownerDisplayName"
                    defaultValue={newOwner?.name}
                    readOnly={!!newOwner}
                  />
                </label>
                <label className="grid gap-1">
                  Email владельца
                  <Input
                    required
                    name="ownerEmail"
                    type="email"
                    defaultValue={newOwner?.email}
                    readOnly={!!newOwner}
                  />
                </label>
                {!newOwner && (
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
                )}
              </>
            ) : dialog === "owner" ? (
              <label className="grid gap-1 text-sm">
                Email существующего аккаунта
                <Input
                  name="ownerEmail"
                  required
                  type="email"
                  maxLength={254}
                  defaultValue={detail?.ownerEmail}
                />
              </label>
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
                    : dialog === "owner"
                      ? "Назначить"
                      : "Учесть оплату"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
