"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Plus,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { sessionFetch } from "@/lib/session-navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { InfiniteSentinel } from "@/components/infinite-sentinel"

export const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(
    minor / 100
  )
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
export async function accountingRequest<T>(
  view: string,
  body?: object,
  method = "POST"
): Promise<T> {
  const response = await sessionFetch(
    `/api/accounting?view=${view}`,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" }
  )
  const payload = await response.json()
  if (!response.ok)
    throw new Error(payload.error ?? "Не удалось выполнить операцию.")
  return payload as T
}
type Balance = {
  driverId: string
  driverName: string
  connected: boolean
  currency: string
  cashMinor: number
  pendingMinor: number
  grossMinor: number
  withheldMinor: number
  employerMinor: number
  paidMinor: number
  taxDueMinor?: { income: number; levy: number; employer: number }
  payableMinor: number
}
type Handover = {
  id: string
  driverName: string
  driverId: string
  amountMinor: number
  currency: string
  status: string
  createdAt: string
}
type Snapshot = {
  currency?: string
  balances: Balance[]
  handovers: Handover[]
  driverId: string
  drivers?: { id: string; name: string; connected: boolean }[]
  companyCash?: { currency: string; balanceMinor: number }[]
  bank?: {
    lastSync: string | null
    balanceMinor: number | null
    balanceAt: string | null
    lastError: string
  } | null
}
type LedgerEntry = {
  id: string
  kind: string
  category: string
  amountMinor: number
  currency: string
  occurredAt: string
  description: string
  driverName: string
  actorName: string
  tripId?: string
  reviewed: boolean
  note: string
  isHold: boolean
}
const kinds: Record<string, string> = {
  bank_credit: "Поступление на ФОП",
  bank_debit: "Списание со счёта",
  booking_payment: "Оплата брони",
  driver_cash_received: "Наличные у водителя",
  cash_handed_in: "Сдано в кассу",
  cash_income: "Доход в кассу",
  cash_funding: "Пополнение кассы",
  payroll_accrual: "Начисление зарплаты",
  payroll_payout: "Выплата зарплаты",
  expense: "Расход",
  tax_payment: "Уплата налога",
}
const categories = [
  { value: "fuel", label: "Топливо" },
  { value: "taxes", label: "Налоги" },
  { value: "amortization", label: "Обслуживание и амортизация" },
  { value: "marketing", label: "Маркетинг" },
  { value: "other", label: "Прочее" },
]
const handoverLabels: Record<string, string> = {
  pending: "Ожидает кассира",
  accepted: "Принято в кассу",
  rejected: "Отклонено",
  cancelled: "Отменено",
}

function ReviewEntry({ entry }: { entry: LedgerEntry }) {
  const [draft, setDraft] = React.useState({
    reviewed: entry.reviewed,
    note: entry.note,
  })
  const { initialize, commit } = useFieldAutosave<typeof draft>(
    async (value) => {
      await accountingRequest("review", { id: entry.id, ...value }, "PATCH")
      return value
    }
  )
  React.useEffect(() => {
    initialize({ reviewed: entry.reviewed, note: entry.note })
  }, [initialize, entry.id, entry.reviewed, entry.note])
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        size="icon"
        variant={draft.reviewed ? "secondary" : "ghost"}
        aria-label={
          draft.reviewed ? "Снять отметку проверки" : "Отметить проверенным"
        }
        aria-pressed={draft.reviewed}
        onClick={() => {
          const reviewed = !draft.reviewed
          setDraft((v) => ({ ...v, reviewed }))
          commit({ reviewed })
        }}
      >
        <Check
          className={
            draft.reviewed ? "text-emerald-500" : "text-muted-foreground/40"
          }
        />
      </Button>
      <Input
        className="min-w-0"
        aria-label="Примечание бухгалтера"
        placeholder="Примечание"
        maxLength={1000}
        value={draft.note}
        onChange={(e) => setDraft((v) => ({ ...v, note: e.target.value }))}
        onBlur={() => commit({ note: draft.note })}
      />
    </div>
  )
}

export function AccountingWorkspace({
  driver = false,
  from,
  to,
  refreshKey = 0,
  onChanged,
}: {
  driver?: boolean
  from?: string
  to?: string
  refreshKey?: number
  onChanged?: () => void
}) {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null)
  const [entries, setEntries] = React.useState<LedgerEntry[]>([])
  const [cursor, setCursor] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [searchTerm, setSearchTerm] = React.useState("")
  React.useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(search), 250)
    return () => clearTimeout(timer)
  }, [search])
  const [kind, setKind] = React.useState("all")
  const [currency, setCurrency] = React.useState("all")
  const [tab, setTab] = React.useState("ledger")
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [action, setAction] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [handoverLimit, setHandoverLimit] = React.useState(20)
  const [form, setForm] = React.useState({
    driverId: "",
    amount: "",
    currency: "UAH",
    paymentSource: "cash",
    description: "",
    category: "income",
  })
  const requestId = React.useRef("")
  const nextRef = React.useRef<HTMLDivElement>(null)
  const generation = React.useRef(0)
  const loadingMore = React.useRef(false)
  const loadSnapshot = React.useCallback(async () => {
    try {
      const value = await accountingRequest<Snapshot>(
        driver ? "wallet" : "snapshot"
      )
      setSnapshot(value)
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить остатки.")
    }
  }, [driver])
  React.useEffect(() => {
    const initial = setTimeout(() => void loadSnapshot(), 0)
    const timer = setInterval(() => void loadSnapshot(), 30_000)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [loadSnapshot, refreshKey])
  const ledgerQuery = React.useMemo(
    () =>
      new URLSearchParams({
        from: from ?? "",
        to: to ?? "",
        search: searchTerm,
        kind: kind === "all" ? "" : kind,
        currency: currency === "all" ? "" : currency,
      }).toString(),
    [from, to, kind, currency, searchTerm]
  )
  const loadLedger = React.useCallback(
    async (next = "") => {
      if (driver || !from || !to) return
      const current = generation.current
      if (next && loadingMore.current) return
      loadingMore.current = true
      setLoading(true)
      try {
        const response = await sessionFetch(
          `/api/accounting?view=ledger&${ledgerQuery}&cursor=${encodeURIComponent(next)}`,
          { cache: "no-store" }
        )
        const payload = await response.json()
        if (!response.ok)
          throw new Error(payload.error ?? "Не удалось загрузить операции.")
        if (current !== generation.current) return
        setEntries((old) =>
          next
            ? [
                ...old,
                ...payload.items.filter(
                  (item: LedgerEntry) => !old.some((e) => e.id === item.id)
                ),
              ]
            : payload.items
        )
        setCursor(payload.nextCursor)
        setError("")
      } catch (e) {
        if (current === generation.current)
          setError(e instanceof Error ? e.message : "Ошибка загрузки.")
      } finally {
        if (current === generation.current) {
          loadingMore.current = false
          setLoading(false)
        }
      }
    },
    [driver, from, to, ledgerQuery]
  )
  React.useEffect(() => {
    generation.current++
    loadingMore.current = false
    const initial = setTimeout(() => {
      setEntries([])
      setCursor("")
      void loadLedger()
    }, 0)
    return () => {
      clearTimeout(initial)
    }
  }, [loadLedger, refreshKey])
  React.useEffect(() => {
    const element = nextRef.current
    if (!element || !cursor || loading || error) return
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((i) => i.isIntersecting)) void loadLedger(cursor)
      },
      { rootMargin: "240px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [cursor, loading, loadLedger, error, tab])
  function open(next: string, balance?: Balance) {
    requestId.current = crypto.randomUUID()
    setForm({
      driverId: balance?.driverId ?? snapshot?.driverId ?? "",
      amount: "",
      currency: balance?.currency ?? "UAH",
      paymentSource: "cash",
      description: "",
      category: next === "expense" ? "fuel" : "income",
    })
    setAction(next)
  }
  async function changed() {
    await loadSnapshot()
    await loadLedger()
    onChanged?.()
  }
  async function resolve(item: Handover, next: string) {
    setBusy(true)
    try {
      await accountingRequest(driver ? "handovers" : "operations", {
        action: next,
        id: item.id,
      })
      await changed()
      toast.success("Передача обновлена")
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось обработать передачу."
      )
    } finally {
      setBusy(false)
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = form.amount.trim().replace(",", ".")
    if (!/^\d+(\.\d{1,2})?$/.test(parsed)) {
      toast.error("Укажите сумму с точностью до копейки.")
      return
    }
    setBusy(true)
    try {
      await accountingRequest(driver ? "handovers" : "operations", {
        action,
        requestId: requestId.current,
        driverId: form.driverId,
        amountMinor: Math.round(Number(parsed) * 100),
        currency: form.currency,
        paymentSource: form.paymentSource,
        description: form.description,
        category: form.category,
      })
      setAction("")
      await changed()
      toast.success("Операция записана")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Операция не записана.")
    } finally {
      setBusy(false)
    }
  }
  const pending =
    snapshot?.handovers.filter((h) => h.status === "pending") ?? []
  const title = driver ? "Мои деньги" : "Касса и расчёты"
  return (
    <section className="workspace-panel min-w-0 space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Wallet className="size-4 text-primary" />
          {title}
        </h2>
        {!driver ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => open("receipt")}>
              <Plus />
              Поступление
            </Button>
            <Button variant="outline" onClick={() => open("expense")}>
              Расход
            </Button>
            <Link
              className="self-center px-2 text-sm text-muted-foreground hover:text-foreground"
              href="/settings/accounting"
            >
              Ставки
            </Link>
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!snapshot && !error ? (
        <p className="text-sm text-muted-foreground">Загружаем остатки…</p>
      ) : null}
      {!driver && snapshot ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">
              Касса · текущий остаток
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {snapshot.companyCash
                ?.filter(
                  (v) =>
                    v.balanceMinor !== 0 ||
                    v.currency === (snapshot.currency ?? "UAH")
                )
                .map((v) => (
                  <span className="font-semibold tabular-nums" key={v.currency}>
                    {money(v.balanceMinor, v.currency)}
                  </span>
                ))}
            </div>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">Счёт ФОП · Monobank</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold tabular-nums">
                {snapshot.bank?.balanceMinor != null
                  ? money(snapshot.bank.balanceMinor, "UAH")
                  : "Выписка ещё не получена"}
              </span>
              <Badge variant="secondary">
                {snapshot.bank?.lastError
                  ? "Ошибка синхронизации"
                  : snapshot.bank?.lastSync
                    ? "Синхронизировано"
                    : "Ожидает подключения"}
              </Badge>
            </div>
            {snapshot.bank?.lastSync ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Обновлено {date(snapshot.bank.lastSync)}
              </p>
            ) : null}
            {snapshot.bank?.lastError ? (
              <p className="mt-1 text-xs text-destructive">
                {snapshot.bank.lastError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {!driver ? (
        <div className="flex flex-wrap gap-1 border-b pb-3">
          {[
            ["ledger", "Операции"],
            ["drivers", "Водители и зарплата"],
            [
              "handovers",
              `Передачи в кассу${pending.length ? ` · ${pending.length}` : ""}`,
            ],
          ].map(([id, label]) => (
            <Button
              key={id}
              variant={tab === id ? "secondary" : "ghost"}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}
      {driver || tab === "drivers" ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Текущие остатки за всю историю
          </p>
          {snapshot?.balances.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              Операций пока нет
            </p>
          ) : null}
          {snapshot?.balances.map((balance) => (
            <div
              key={`${balance.driverId}:${balance.currency}`}
              className="rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {driver ? balance.currency : balance.driverName}
                </span>
                <Badge variant="secondary">{balance.currency}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-4">
                {[
                  ["Наличные на руках", balance.cashMinor],
                  ["Передано, ожидает кассира", balance.pendingMinor],
                  ["Зарплата к выплате", balance.payableMinor],
                  ["Уже выплачено", balance.paidMinor],
                  ["Начислено", balance.grossMinor],
                  ["Удержания", balance.withheldMinor],
                  ["Начисления компании", balance.employerMinor],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-medium tabular-nums">
                      {money(value as number, balance.currency)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={balance.cashMinor <= balance.pendingMinor || busy}
                  disabledReason={
                    busy
                      ? "Операция выполняется."
                      : "Свободных наличных нет. Дождитесь подтверждения кассира или получите оплату."
                  }
                  onClick={() => open("request_handover", balance)}
                >
                  Передать в кассу
                </Button>
                {!driver ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => open("accrual", balance)}
                    >
                      Начислить зарплату
                    </Button>
                    <Button
                      variant="outline"
                      disabled={balance.payableMinor <= 0 || busy}
                      disabledReason={
                        busy
                          ? "Операция выполняется."
                          : "Нет начисленной зарплаты к выплате."
                      }
                      onClick={() => open("payout", balance)}
                    >
                      Выплатить
                    </Button>
                    {balance.taxDueMinor &&
                    Object.values(balance.taxDueMinor).some((v) => v > 0) ? (
                      <Button
                        variant="outline"
                        onClick={() => open("tax_payment", balance)}
                      >
                        Перечислить удержания и начисления
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          ))}
          {!driver ? (
            <Button variant="outline" onClick={() => open("accrual")}>
              Начисление водителю
            </Button>
          ) : null}
        </div>
      ) : null}
      {driver || tab === "handovers" ? (
        <div className="divide-y rounded-xl border">
          {snapshot?.handovers.length === 0 ? (
            <p className="p-5 text-center text-sm text-muted-foreground">
              Передач в кассу пока нет
            </p>
          ) : null}
          {snapshot?.handovers.slice(0, handoverLimit).map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {driver ? "Передача в кассу" : item.driverName} ·{" "}
                  {money(item.amountMinor, item.currency)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {date(item.createdAt)} · {handoverLabels[item.status]}
                </p>
              </div>
              {item.status === "pending" ? (
                <div className="flex gap-2">
                  {!driver ? (
                    <Button
                      disabled={busy}
                      disabledReason="Операция выполняется."
                      onClick={() => void resolve(item, "accept_handover")}
                    >
                      Принять деньги
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    disabled={busy}
                    disabledReason="Операция выполняется."
                    onClick={() =>
                      void resolve(
                        item,
                        driver ? "cancel_handover" : "reject_handover"
                      )
                    }
                  >
                    {driver ? "Отменить" : "Отклонить"}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {(driver || tab === "handovers") && snapshot ? (
        <InfiniteSentinel
          hasMore={snapshot.handovers.length > handoverLimit}
          version={handoverLimit}
          onMore={() => setHandoverLimit((v) => v + 20)}
        />
      ) : null}
      {!driver && tab === "ledger" ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)_8rem]">
            <Input
              aria-label="Поиск по операциям"
              placeholder="Назначение или водитель…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={120}
            />
            <FieldSelect
              aria-label="Вид операции"
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "all", label: "Все операции" },
                ...Object.entries(kinds).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
            <FieldSelect
              aria-label="Валюта операций"
              value={currency}
              onValueChange={setCurrency}
              options={[
                { value: "all", label: "Все валюты" },
                ...["UAH", "EUR", "USD", "PLN"].map((value) => ({
                  value,
                  label: value,
                })),
              ]}
            />
          </div>
          <div className="divide-y rounded-xl border">
            {entries.map((entry) => (
              <article
                className="grid min-w-0 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_11rem_minmax(12rem,18rem)] lg:items-center"
                key={entry.id}
              >
                <div className="flex min-w-0 gap-3">
                  <span className="mt-1 shrink-0 text-muted-foreground">
                    {entry.amountMinor < 0 ? (
                      <ArrowUpRight className="size-4 text-rose-400" />
                    ) : (
                      <ArrowDownLeft className="size-4 text-emerald-500" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {kinds[entry.kind] ?? entry.kind}
                      {entry.isHold ? " · В обработке" : ""}
                    </p>
                    <p className="mt-1 text-sm break-words text-muted-foreground">
                      {entry.description || entry.driverName || "—"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {date(entry.occurredAt)} · {entry.actorName}
                      {entry.driverName ? ` · ${entry.driverName}` : ""}
                    </p>
                    {entry.tripId ? (
                      <Link
                        className="text-xs text-primary"
                        href={`/trips/${entry.tripId}`}
                      >
                        Открыть рейс
                      </Link>
                    ) : null}
                  </div>
                </div>
                <p className="text-sm font-semibold tabular-nums lg:text-right">
                  {money(entry.amountMinor, entry.currency)}
                </p>
                <ReviewEntry entry={entry} />
              </article>
            ))}
            {!entries.length && !loading ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                За этот период операций нет
              </p>
            ) : null}
          </div>
          <div ref={nextRef} className="flex min-h-10 justify-center">
            {loading ? (
              <p className="text-xs text-muted-foreground">
                Загружаем операции…
              </p>
            ) : cursor ? (
              <Button variant="ghost" onClick={() => void loadLedger(cursor)}>
                Загрузить ещё
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction("")
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {{
                receipt: "Поступление в кассу",
                expense: "Новый расход",
                accrual: "Начисление зарплаты",
                payout: "Выплата зарплаты",
                tax_payment: "Перечисление начислений",
                request_handover: "Передача наличных",
              }[action] ?? "Операция"}
            </DialogTitle>
            <DialogDescription>
              {action === "payout"
                ? "Запишите выплату, которую уже передали водителю."
                : action === "request_handover"
                  ? "Остаток уменьшится после подтверждения кассиром."
                  : action === "receipt"
                    ? "Наличные водителей принимайте в разделе «Передачи в кассу»."
                    : action === "accrual"
                      ? "Удержания рассчитаются по ставкам компании."
                      : action === "tax_payment"
                        ? "Запишите уже перечисленные удержания и начисления. Повторного расхода не будет."
                        : "Укажите назначение и счёт списания."}
            </DialogDescription>
          </DialogHeader>
          <form
            id="accounting-operation"
            onSubmit={submit}
            className="grid gap-4"
          >
            {["accrual", "payout", "tax_payment", "request_handover"].includes(
              action
            ) && !driver ? (
              <label className="grid gap-2 text-sm">
                Водитель
                <FieldSelect
                  value={form.driverId}
                  onValueChange={(driverId) =>
                    setForm((v) => ({ ...v, driverId }))
                  }
                  options={(snapshot?.drivers ?? []).map((d) => ({
                    value: d.id,
                    label: d.name,
                  }))}
                />
              </label>
            ) : null}
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
              <label className="grid gap-2 text-sm">
                Сумма
                <Input
                  required
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, amount: e.target.value }))
                  }
                />
              </label>
              <label className="grid gap-2 text-sm">
                Валюта
                <FieldSelect
                  value={form.currency}
                  onValueChange={(currency) =>
                    setForm((v) => ({ ...v, currency }))
                  }
                  options={["UAH", "EUR", "USD", "PLN"].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </label>
            </div>
            {action === "receipt" || action === "expense" ? (
              <label className="grid gap-2 text-sm">
                {action === "receipt" ? "Вид поступления" : "Категория"}
                <FieldSelect
                  value={form.category}
                  onValueChange={(category) =>
                    setForm((v) => ({ ...v, category }))
                  }
                  options={
                    action === "receipt"
                      ? [
                          { value: "income", label: "Доход от услуги" },
                          {
                            value: "funding",
                            label: "Пополнение кассы · не доход",
                          },
                        ]
                      : categories
                  }
                />
              </label>
            ) : null}
            {action === "tax_payment" ? (
              <label className="grid gap-2 text-sm">
                Вид начисления
                <FieldSelect
                  value={form.category}
                  onValueChange={(category) =>
                    setForm((v) => ({ ...v, category }))
                  }
                  options={[
                    { value: "income", label: "Удержание из зарплаты" },
                    { value: "levy", label: "Дополнительное удержание" },
                    { value: "employer", label: "Начисление компании" },
                  ]}
                />
              </label>
            ) : null}
            {action === "expense" ||
            action === "payout" ||
            action === "tax_payment" ? (
              <label className="grid gap-2 text-sm">
                Списать с
                <FieldSelect
                  value={form.paymentSource}
                  onValueChange={(paymentSource) =>
                    setForm((v) => ({ ...v, paymentSource }))
                  }
                  options={[
                    { value: "cash", label: "Касса" },
                    {
                      value: "bank",
                      label: "Банковский счёт · выплата уже выполнена",
                    },
                  ]}
                />
              </label>
            ) : null}
            <label className="grid gap-2 text-sm">
              Назначение
              <Input
                required={action === "receipt" || action === "expense"}
                maxLength={500}
                value={form.description}
                onChange={(e) =>
                  setForm((v) => ({ ...v, description: e.target.value }))
                }
              />
            </label>
          </form>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              disabledReason="Операция записывается."
              onClick={() => setAction("")}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              form="accounting-operation"
              disabled={busy}
              disabledReason="Операция записывается. Дождитесь завершения."
            >
              {busy ? <Clock3 /> : <Check />}Подтвердить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
