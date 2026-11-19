"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpRight, Plus, Users } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { sessionFetch } from "@/lib/session-navigation"

type ClientWorkspace = {
  slug: string
  name: string
  members: number
  status: "trial" | "active" | "past_due" | "suspended"
  through: string | null
  lastPaidOn: string | null
}
type Client = {
  id: string
  name: string
  email: string
  members: number
  workspaces: ClientWorkspace[]
  discountMinor: number
  discountMinimum: number
  monthlyMinor: number
  due: string | null
  dueOverride: string | null
}
type Terms = { discountMinor: number; discountMinimum: number; due: string }
type Overview = { items: Client[]; unitMinor: number }
const endpoint = "/api/platform/clients"
const access = {
  trial: "Пробный период",
  active: "Активен",
  past_due: "Просрочен",
  suspended: "Приостановлен",
}
const money = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
  style: "currency",
  currency: "UAH",
})
const date = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeZone: "UTC",
})
const formatDate = (value: string | null) =>
  value ? date.format(new Date(value)) : "—"

async function request(path = "", init?: RequestInit) {
  const result = await sessionFetch(endpoint + path, {
    cache: "no-store",
    ...init,
  })
  if (result.status === 204) return null
  const json = await result.json()
  if (!result.ok)
    throw Error(json.error ?? "Не удалось загрузить клиентский портфель.")
  return json
}

function ClientDetails({
  client,
  unit,
  onSaved,
}: {
  client: Client
  unit: number
  onSaved: () => void
}) {
  const [initial] = React.useState<Terms>(() => ({
    discountMinor: client.discountMinor,
    discountMinimum: client.discountMinimum,
    due: client.dueOverride ?? "",
  }))
  const autosave = useFieldAutosave<Terms>(async (value) => {
    await request(`?owner=${encodeURIComponent(client.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    })
    onSaved()
    return value
  })
  React.useEffect(() => autosave.initialize(initial), [autosave, initial])
  const gross = unit * client.workspaces.length
  const activeDiscount = gross - client.monthlyMinor

  function commitNumber(
    event: React.FocusEvent<HTMLInputElement>,
    key: "discountMinor" | "discountMinimum",
    multiplier: number
  ) {
    const field = event.currentTarget
    if (field.reportValidity()) {
      void autosave.commit({
        [key]: Math.round(field.valueAsNumber * multiplier),
      })
    }
  }

  return (
    <section className="workspace-panel min-w-0 space-y-5 p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold break-words">{client.name}</h2>
          <p className="text-sm break-all text-muted-foreground">
            {client.email}
          </p>
        </div>
        <Link
          href={`/admin?client=${client.id}`}
          className={buttonVariants({ size: "sm" })}
        >
          <Plus /> Новая компания
        </Link>
      </header>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Компании", client.workspaces.length],
          ["Активные участники", client.members],
          ["К оплате в месяц", money.format(client.monthlyMinor / 100)],
          ["Следующая оплата", formatDate(client.due)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-xl border border-border p-3"
          >
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-2 border-b border-border pb-4 text-sm">
        <p className="text-muted-foreground">
          {client.workspaces.length} × {money.format(unit / 100)}
          {activeDiscount
            ? ` − ${money.format(activeDiscount / 100)} скидка`
            : ""}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1">
            Скидка, UAH
            <Input
              type="number"
              min={0}
              max={1000000}
              required
              step="0.01"
              defaultValue={initial.discountMinor / 100}
              onBlur={(event) => commitNumber(event, "discountMinor", 100)}
            />
          </label>
          <label className="grid gap-1">
            От скольких компаний
            <Input
              type="number"
              min={1}
              max={10000}
              required
              step="1"
              defaultValue={initial.discountMinimum}
              onBlur={(event) => commitNumber(event, "discountMinimum", 1)}
            />
          </label>
          <label className="grid gap-1">
            Дата оплаты вручную
            <Input
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              defaultValue={initial.due}
              aria-describedby="billing-due-hint"
              onBlur={(event) => {
                if (event.currentTarget.reportValidity())
                  void autosave.commit({ due: event.currentTarget.value })
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground" id="billing-due-hint">
          Если дата не указана, берётся день после ближайшего окончания доступа.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {client.workspaces.map((item) => (
          <li key={item.slug}>
            <Link
              href={`/admin?company=${encodeURIComponent(item.slug)}#workspace`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-lg px-2 py-3 text-sm hover:bg-accent sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-4"
            >
              <span className="min-w-0">
                <span className="block font-medium break-words">
                  {item.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.members} уч. · {access[item.status]}
                </span>
              </span>
              <span className="row-start-2 text-xs text-muted-foreground sm:row-start-auto">
                Доступ по {formatDate(item.through)} · Оплата{" "}
                {formatDate(item.lastPaidOn)}
              </span>
              <ArrowUpRight
                className="col-start-2 row-span-2 row-start-1 size-4 text-muted-foreground sm:col-start-auto sm:row-span-1 sm:row-start-auto"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function PlatformClients() {
  const [overview, setOverview] = React.useState<Overview>()
  const [selected, setSelected] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    void request("", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setOverview(data)
          setError("")
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
    return () => controller.abort()
  }, [revision])
  const items =
    overview?.items.filter((item) =>
      `${item.name} ${item.email}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    ) ?? []
  const current = items.find((item) => item.id === selected) ?? items[0]
  const refresh = () => setRevision((previous) => previous + 1)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-5 text-primary" /> Клиенты
        </h1>
        <Link
          href="/admin?create=1"
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          <Plus /> Новый клиент
        </Link>
      </header>
      {error && (
        <div
          className="flex items-center gap-2 text-sm text-destructive"
          role="alert"
        >
          {error}
          <Button size="sm" variant="ghost" onClick={refresh}>
            Повторить
          </Button>
        </div>
      )}
      {!overview && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Загружаем клиентов…
        </p>
      )}
      {overview && (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <section
            className="workspace-panel min-w-0 space-y-2 p-3"
            aria-label="Список клиентов"
          >
            <Input
              aria-label="Поиск клиента"
              placeholder="Имя или email"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            {items.length ? (
              <ul className="max-h-68 space-y-1 overflow-y-auto">
                {items.map((item) => (
                  <li key={item.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-pressed={current?.id === item.id}
                      onClick={() => setSelected(item.id)}
                      className="flex h-auto min-h-11 w-full justify-between gap-2 text-left whitespace-normal aria-pressed:bg-accent"
                    >
                      <span className="min-w-0 break-words">{item.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.workspaces.length} ·{" "}
                        {money.format(item.monthlyMinor / 100)}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-2 text-sm text-muted-foreground">
                Клиенты не найдены.
              </p>
            )}
          </section>
          {current && (
            <ClientDetails
              key={current.id}
              client={current}
              unit={overview.unitMinor}
              onSaved={refresh}
            />
          )}
        </div>
      )}
    </div>
  )
}
