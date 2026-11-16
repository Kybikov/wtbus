"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CircleDollarSign,
  Plus,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import { DatePicker } from "@/components/ui/date-picker"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { HoldActionButton } from "@/components/ui/hold-action-button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { BookingPayments } from "@/components/booking-payments"
import { sessionFetch } from "@/lib/session-navigation"
import {
  formatMoney,
  localMoneyDay,
  moneyCurrencies,
  moneyOperationTimestamp,
  moneyRequestIdentity,
  parseMoneyInput,
  parsePositiveRate,
  type MoneyRequestIdentity,
  type MoneyWallet,
  type MoneyWorkspaceData,
  type TripProfit,
} from "@/lib/money-v2"

type Action =
  "expense" | "exchange" | "transfer" | "deposit" | "reverse" | "rate"
type Command = { action: Action; id?: string }
const titles: Record<Action, string> = {
  expense: "Добавить расход",
  exchange: "Обменять валюту",
  transfer: "Передать деньги",
  deposit: "Внести в кассу",
  reverse: "Сторнировать операцию",
  rate: "Добавить курс за дату",
}
const categoryNames: Record<string, string> = {
  fuel: "Топливо",
  tolls: "Дороги и парковка",
  wash: "Мойка",
  maintenance: "Обслуживание",
  supplies: "Хозяйственные расходы",
  staff_pay: "Оплата персоналу",
  other: "Прочее",
}
const statusNames: Record<string, string> = {
  pending: "Ожидает подтверждения",
  accepted: "Подтверждено",
  rejected: "Отклонено",
  cancelled: "Отменено",
}
const date = (value: string) => {
  const day = new Date(value)
  return Number.isFinite(day.getTime())
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" }).format(day)
    : "—"
}
async function request<T>(
  view = "workspace",
  body?: object,
  query?: Record<string, string>
): Promise<T> {
  const search = new URLSearchParams({ view, ...query })
  const response = await sessionFetch(
    `/api/money?${search}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" }
  )
  const payload = await response.json()
  if (!response.ok)
    throw new Error(payload.error ?? "Не удалось выполнить операцию.")
  return payload
}
function walletLabel(wallet: MoneyWallet) {
  return `${wallet.name} · ${wallet.currency} · ${formatMoney(wallet.availableMinor, wallet.currency)}`
}
function canSpend(wallet: MoneyWallet, data: MoneyWorkspaceData) {
  return (
    wallet.canSpend ??
    (wallet.ownerType === "member"
      ? wallet.ownerId === data.membershipId
      : wallet.ownerType === "company" && data.canManage)
  )
}
function CommandDialog({
  command,
  data,
  onClose,
  onUpdated,
  tripId,
}: {
  command: Command
  data: MoneyWorkspaceData
  onClose: () => void
  onUpdated: () => Promise<void>
  tripId?: string
}) {
  const spendable = data.wallets.filter(
    (wallet) => canSpend(wallet, data) && wallet.ownerType !== "system"
  )
  const eligible =
    command.action === "deposit"
      ? spendable.filter(
          (wallet) =>
            wallet.ownerType === "member" &&
            wallet.ownerId === data.membershipId
        )
      : spendable
  const [accountId, setAccountId] = React.useState(eligible[0]?.accountId ?? "")
  const [amount, setAmount] = React.useState("")
  const [targetAmount, setTargetAmount] = React.useState("")
  const [currency, setCurrency] = React.useState("EUR")
  const [targetCurrency, setTargetCurrency] = React.useState("UAH")
  const [targetKind, setTargetKind] = React.useState("company")
  const [targetMember, setTargetMember] = React.useState("")
  const [selectedTrip, setSelectedTrip] = React.useState(tripId ?? "")
  const [category, setCategory] = React.useState("other")
  const [day, setDay] = React.useState(() => localMoneyDay())
  const [rate, setRate] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const identity = React.useRef<MoneyRequestIdentity | null>(null)
  const occurred = React.useRef({ day, at: moneyOperationTimestamp(day) })
  const account = eligible.find((wallet) => wallet.accountId === accountId)
  const minor = parseMoneyInput(amount),
    targetMinor = parseMoneyInput(targetAmount)
  const needsWallet = command.action !== "rate" && command.action !== "reverse"
  const reason = busy
    ? "Операция проводится. Дождитесь результата."
    : needsWallet && !account
      ? "Нет доступной кассы для этой операции."
      : needsWallet && minor === null
        ? "Укажите положительную сумму с точностью до копеек."
        : needsWallet && minor! > account!.availableMinor
          ? "Сумма превышает доступный остаток с учётом ожидающих передач."
          : command.action === "exchange" &&
              targetCurrency === account?.currency
            ? "Выберите другую валюту обмена."
            : command.action === "exchange" && targetMinor === null
              ? "Укажите фактически полученную сумму второй валюты."
              : command.action === "transfer" &&
                  targetKind === "member" &&
                  !targetMember
                ? "Выберите получателя денег."
                : command.action === "transfer" &&
                    targetKind === "member" &&
                    targetMember === data.membershipId
                  ? "Для передачи выберите другого сотрудника."
                  : command.action === "deposit" && !data.isOwner
                    ? "Немедленно внести свои деньги в кассу может владелец компании."
                    : command.action === "rate" && !data.canManage
                      ? "Добавлять исторический курс может финансовый сотрудник компании."
                      : command.action === "rate" && !parsePositiveRate(rate)
                        ? "Укажите положительный курс гривны за одну единицу валюты."
                        : (command.action === "reverse" ||
                              command.action === "rate") &&
                            !description.trim()
                          ? "Укажите причину операции."
                          : !moneyOperationTimestamp(day)
                            ? "Выберите корректную дату, не позднее сегодняшней."
                            : ""
  async function submit() {
    if (reason) return
    if (occurred.current.day !== day)
      occurred.current = { day, at: moneyOperationTimestamp(day) }
    const common = {
      action: command.action,
      description: description.trim(),
      occurredAt: occurred.current.at,
    }
    const payload =
      command.action === "rate"
        ? {
            ...common,
            date: day,
            currency,
            rateToUAH: rate.trim().replace(",", "."),
          }
        : command.action === "reverse"
          ? { ...common, id: command.id }
          : {
              ...common,
              accountId,
              currency: account!.currency,
              amountMinor: minor,
              ...(command.action === "expense"
                ? { tripId: selectedTrip || undefined, category }
                : {}),
              ...(command.action === "exchange"
                ? { targetCurrency, targetAmountMinor: targetMinor }
                : {}),
              ...(command.action === "transfer"
                ? {
                    targetKind,
                    targetMembershipId:
                      targetKind === "member" ? targetMember : undefined,
                  }
                : {}),
              ...(command.action === "deposit"
                ? { targetKind: "company" }
                : {}),
            }
    identity.current = moneyRequestIdentity(identity.current, payload, () =>
      crypto.randomUUID()
    )
    setBusy(true)
    setError("")
    try {
      await request("workspace", {
        ...payload,
        requestId: identity.current.requestId,
      })
      await onUpdated()
      toast.success("Операция проведена")
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Операция не проведена.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[min(85dvh,var(--mobile-viewport-height,85dvh))] min-w-0 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titles[command.action]}</DialogTitle>
          <DialogDescription>
            {command.action === "transfer"
              ? "Сумма будет зарезервирована до подтверждения получателя."
              : command.action === "exchange"
                ? "Укажите суммы, которые фактически отдали и получили."
                : command.action === "reverse"
                  ? "Будет создана обратная операция. Исходная запись останется в истории."
                  : command.action === "deposit"
                    ? "Ваши наличные перейдут в кассу компании."
                    : command.action === "rate"
                      ? "Курс применяется к операциям выбранной даты. Проведённые суммы сохраняются."
                      : "Расход спишется из выбранной кассы."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="grid min-w-0 gap-4"
        >
          {needsWallet ? (
            <>
              <label className="grid min-w-0 gap-1.5 text-sm">
                Из кассы
                <FieldSelect
                  aria-label="Из кассы"
                  value={accountId}
                  onValueChange={(value) => setAccountId(value)}
                  options={eligible.map((wallet) => ({
                    value: wallet.accountId,
                    label: walletLabel(wallet),
                  }))}
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm">
                {command.action === "exchange" ? "Отдали" : "Сумма"} ·{" "}
                {account?.currency ?? ""}
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </>
          ) : null}
          {command.action === "expense" ? (
            <>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1.5 text-sm">
                  Категория
                  <FieldSelect
                    value={category}
                    onValueChange={setCategory}
                    options={Object.entries(categoryNames).map(
                      ([value, label]) => ({ value, label })
                    )}
                  />
                </label>
                <label className="grid min-w-0 gap-1.5 text-sm">
                  Рейс
                  <FieldSelect
                    value={selectedTrip}
                    onValueChange={setSelectedTrip}
                    options={[
                      { value: "", label: "Общие расходы" },
                      ...data.trips.map((trip) => ({
                        value: trip.id,
                        label: trip.label,
                      })),
                    ]}
                  />
                </label>
              </div>
            </>
          ) : null}
          {command.action === "exchange" ? (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1.5 text-sm">
                Получили
                <Input
                  inputMode="decimal"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm">
                Валюта получения
                <FieldSelect
                  value={targetCurrency}
                  onValueChange={setTargetCurrency}
                  options={moneyCurrencies
                    .filter((value) => value !== account?.currency)
                    .map((value) => ({ value, label: value }))}
                />
              </label>
            </div>
          ) : null}
          {command.action === "transfer" ? (
            <>
              <label className="grid min-w-0 gap-1.5 text-sm">
                Кому передаёте
                <FieldSelect
                  value={targetKind}
                  onValueChange={setTargetKind}
                  options={[
                    { value: "company", label: "В кассу компании" },
                    { value: "member", label: "Сотруднику" },
                  ]}
                />
              </label>
              {targetKind === "member" ? (
                <label className="grid min-w-0 gap-1.5 text-sm">
                  Получатель
                  <FieldSelect
                    value={targetMember}
                    onValueChange={setTargetMember}
                    options={data.members
                      .filter((member) => member.id !== data.membershipId)
                      .map((member) => ({
                        value: member.id,
                        label: member.name,
                      }))}
                  />
                </label>
              ) : null}
            </>
          ) : null}
          {command.action === "rate" ? (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1.5 text-sm">
                Валюта
                <FieldSelect
                  value={currency}
                  onValueChange={setCurrency}
                  options={moneyCurrencies
                    .filter((value) => value !== "UAH")
                    .map((value) => ({ value, label: value }))}
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm">
                Гривен за 1 {currency}
                <Input
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          {command.action !== "reverse" ? (
            <div className="grid min-w-0 gap-1.5 text-sm">
              <span>
                {command.action === "rate" ? "Дата курса" : "Дата операции"}
              </span>
              <DatePicker
                label={
                  command.action === "rate" ? "Дата курса" : "Дата операции"
                }
                value={day}
                max={localMoneyDay()}
                onValueChange={setDay}
              />
            </div>
          ) : null}
          <label className="grid min-w-0 gap-1.5 text-sm">
            {command.action === "reverse" || command.action === "rate"
              ? "Причина"
              : "Комментарий"}
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {account ? (
            <p className="text-sm text-muted-foreground">
              Доступно: {formatMoney(account.availableMinor, account.currency)}
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
              disabledReason="Дождитесь результата операции."
              onClick={onClose}
            >
              Отмена
            </Button>
            {command.action === "reverse" ? (
              <HoldActionButton
                disabled={!!reason}
                disabledReason={reason}
                onConfirm={() => void submit()}
              >
                Сторнировать
              </HoldActionButton>
            ) : (
              <Button type="submit" disabled={!!reason} disabledReason={reason}>
                {titles[command.action]}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MoneyWorkspace({ tripId }: { tripId?: string }) {
  const [data, setData] = React.useState<MoneyWorkspaceData | null>(null)
  const [profits, setProfits] = React.useState<TripProfit[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [command, setCommand] = React.useState<Command | null>(null)
  const [tab, setTab] = React.useState("transfers")
  const [currency, setCurrency] = React.useState("")
  const [trip, setTrip] = React.useState(tripId ?? "")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [category, setCategory] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [resolution, setResolution] = React.useState<{
    action: "accept" | "reject" | "cancel"
    id: string
    title: string
  } | null>(null)
  const [resolutionReason, setResolutionReason] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const identities = React.useRef(new Map<string, MoneyRequestIdentity>())
  const load = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [workspace, report] = await Promise.all([
        request<MoneyWorkspaceData>(),
        request<{ items: TripProfit[] }>(
          "profits",
          undefined,
          tripId ? { tripId } : undefined
        ),
      ])
      setData(workspace)
      setProfits(report.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить кассы.")
    } finally {
      setLoading(false)
    }
  }, [tripId])
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => void load())
    return () => cancelAnimationFrame(frame)
  }, [load])
  const match = (row: {
    currency: string
    tripId?: string
    occurredAt: string
  }) =>
    (!currency || row.currency === currency) &&
    (!trip || row.tripId === trip) &&
    (!from || localMoneyDay(new Date(row.occurredAt)) >= from) &&
    (!to || localMoneyDay(new Date(row.occurredAt)) <= to)
  async function resolve() {
    if (!resolution || busy) return
    const payload = {
      action: resolution.action,
      id: resolution.id,
      description: resolutionReason.trim(),
    }
    const key = `${resolution.action}:${resolution.id}`
    const identity = moneyRequestIdentity(
      identities.current.get(key) ?? null,
      payload,
      () => crypto.randomUUID()
    )
    identities.current.set(key, identity)
    setBusy(true)
    try {
      await request("workspace", { ...payload, requestId: identity.requestId })
      setResolution(null)
      setResolutionReason("")
      await load()
      toast.success("Передача обновлена")
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось обновить передачу."
      )
    } finally {
      setBusy(false)
    }
  }
  if (!data)
    return (
      <section
        className="surface-card min-w-0 space-y-3 p-4"
        aria-label="Кассы и расчёты"
      >
        <h2 className="font-semibold">Кассы и расчёты</h2>
        {error ? (
          <>
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button variant="outline" onClick={() => void load()}>
              Повторить
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Загружаем кассы…</p>
        )}
      </section>
    )
  const wallets = data.wallets.filter((wallet) => wallet.ownerType !== "system")
  const mine = wallets.filter(
    (wallet) =>
      (wallet.ownerType === "member" && wallet.ownerId === data.membershipId) ||
      (wallet.ownerType === "driver" && wallet.canSpend)
  )
  const ownBalances = moneyCurrencies.map((code) => ({
    currency: code,
    balance: mine
      .filter((wallet) => wallet.currency === code)
      .reduce((sum, wallet) => sum + wallet.balanceMinor, 0),
    reserved: mine
      .filter((wallet) => wallet.currency === code)
      .reduce((sum, wallet) => sum + wallet.reservedMinor, 0),
    available: mine
      .filter((wallet) => wallet.currency === code)
      .reduce((sum, wallet) => sum + wallet.availableMinor, 0),
  }))
  const hasWallet = wallets.some((wallet) => canSpend(wallet, data))
  const pendingReason = busy
    ? "Дождитесь результата текущей операции."
    : loading
      ? "Дождитесь обновления касс."
      : !hasWallet
        ? "У вас нет доступной кассы для этой операции."
        : ""
  const empty = (text: string) => (
    <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>
  )
  return (
    <section className="min-w-0 space-y-4" aria-label="Кассы и расчёты">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Wallet className="size-4" />
          Кассы и расчёты
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!!pendingReason}
            disabledReason={pendingReason}
            onClick={() => setCommand({ action: "expense" })}
          >
            <Plus />
            Расход
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!pendingReason}
            disabledReason={pendingReason}
            onClick={() => setCommand({ action: "transfer" })}
          >
            <ArrowUpRight />
            Передать
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!pendingReason}
            disabledReason={pendingReason}
            onClick={() => setCommand({ action: "exchange" })}
          >
            <ArrowLeftRight />
            Обменять
          </Button>
          {data.isOwner ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!!pendingReason || !mine.length}
              disabledReason={
                pendingReason ||
                "На руках пока нет средств для внесения в кассу."
              }
              onClick={() => setCommand({ action: "deposit" })}
            >
              <ArrowDownLeft />
              Внести в кассу
            </Button>
          ) : null}
          {data.canManage ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCommand({ action: "rate" })}
            >
              Курс за дату
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
        {ownBalances.map((balance) => (
          <article
            key={balance.currency}
            className="surface-card min-w-0 space-y-2 p-3 sm:p-4"
          >
            <h3 className="text-sm font-medium text-muted-foreground">
              У меня · {balance.currency}
            </h3>
            <p className="text-lg font-semibold tabular-nums sm:text-xl">
              {formatMoney(balance.balance, balance.currency)}
            </p>
            <dl className="space-y-1 text-xs">
              <div className="flex flex-wrap justify-between gap-1">
                <dt className="text-muted-foreground">В передаче</dt>
                <dd>{formatMoney(balance.reserved, balance.currency)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-1">
                <dt className="text-muted-foreground">Доступно</dt>
                <dd>{formatMoney(balance.available, balance.currency)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <div className="surface-card min-w-0 space-y-3 p-3 sm:p-4">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
            Валюта
            <FieldSelect
              value={currency}
              onValueChange={setCurrency}
              options={[
                { value: "", label: "Все валюты" },
                ...moneyCurrencies.map((value) => ({ value, label: value })),
              ]}
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
            Рейс
            <FieldSelect
              value={trip}
              onValueChange={setTrip}
              options={[
                { value: "", label: "Все рейсы" },
                ...data.trips.map((row) => ({
                  value: row.id,
                  label: row.label,
                })),
              ]}
            />
          </label>
          <div className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
            <span>С даты</span>
            <DatePicker
              label="Начало периода операций"
              value={from}
              max={to || localMoneyDay()}
              onValueChange={setFrom}
            />
          </div>
          <div className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
            <span>По дату</span>
            <DatePicker
              label="Конец периода операций"
              value={to}
              min={from || undefined}
              max={localMoneyDay()}
              onValueChange={setTo}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCurrency("")
              setTrip(tripId ?? "")
              setFrom("")
              setTo("")
              setCategory("")
              setStatus("")
            }}
          >
            Сбросить фильтры
          </Button>
          {trip ? (
            <BookingPayments tripId={trip} onUpdated={() => void load()} />
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled
              disabledReason="Выберите рейс в фильтре, чтобы принять оплату пассажира."
            >
              Оплаты рейса
            </Button>
          )}
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        className="min-w-0 gap-3"
      >
        <TabsList className="grid h-auto! w-full grid-cols-3 gap-1 sm:flex sm:w-auto">
          <TabsTrigger value="transfers">Передачи</TabsTrigger>
          <TabsTrigger value="receipts">Оплаты</TabsTrigger>
          <TabsTrigger value="expenses">Расходы</TabsTrigger>
          <TabsTrigger value="wallets">Все кассы</TabsTrigger>
          <TabsTrigger value="trips">Рейсы</TabsTrigger>
        </TabsList>
        <TabsContent value="transfers">
          <div className="surface-card min-w-0 p-3 sm:p-4">
            <div className="mb-3 max-w-sm">
              <FieldSelect
                aria-label="Статус передачи"
                value={status}
                onValueChange={setStatus}
                options={[
                  { value: "", label: "Все статусы" },
                  ...Object.entries(statusNames).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            </div>
            <div className="divide-y">
              {data.transfers
                .filter(
                  (row) =>
                    match({
                      ...row,
                      occurredAt: row.occurredAt || row.createdAt,
                    }) &&
                    (!status || row.status === status)
                )
                .map((row) => (
                  <article
                    key={row.id}
                    className="grid min-w-0 gap-3 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium break-words">
                        {row.fromName} → {row.toName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {date(row.occurredAt || row.createdAt)}
                      </p>
                      {row.description ? (
                        <p className="text-sm break-words">{row.description}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <strong className="text-sm tabular-nums">
                        {formatMoney(row.amountMinor, row.currency)}
                      </strong>
                      <Badge variant="secondary">
                        {statusNames[row.status] ?? row.status}
                      </Badge>
                      {row.canAccept ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          disabledReason="Дождитесь результата текущей передачи."
                          onClick={() =>
                            setResolution({
                              action: "accept",
                              id: row.id,
                              title: `Подтвердить получение ${formatMoney(row.amountMinor, row.currency)}`,
                            })
                          }
                        >
                          Получено
                        </Button>
                      ) : null}
                      {row.canReject ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          disabledReason="Дождитесь результата текущей передачи."
                          onClick={() =>
                            setResolution({
                              action: "reject",
                              id: row.id,
                              title: "Отклонить передачу",
                            })
                          }
                        >
                          Отклонить
                        </Button>
                      ) : null}
                      {row.canCancel ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          disabledReason="Дождитесь результата текущей передачи."
                          onClick={() =>
                            setResolution({
                              action: "cancel",
                              id: row.id,
                              title: "Отменить передачу",
                            })
                          }
                        >
                          Отменить
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              {!data.transfers.some(
                (row) =>
                  match({
                    ...row,
                    occurredAt: row.occurredAt || row.createdAt,
                  }) &&
                  (!status || row.status === status)
              )
                ? empty("Передач по выбранным фильтрам нет.")
                : null}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="receipts">
          <div className="surface-card min-w-0 divide-y p-3 sm:p-4">
            {data.receipts.filter(match).map((row) => (
              <article
                key={row.id}
                className="grid min-w-0 gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words">{row.collectorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {date(row.occurredAt)} · В счёт брони{" "}
                    {formatMoney(
                      row.settledMinor,
                      row.bookingCurrency ?? row.currency
                    )}
                  </p>
                  <Link
                    href={`/bookings/${encodeURIComponent(row.bookingId)}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Открыть бронь
                  </Link>
                  {row.description ? (
                    <p className="mt-1 text-sm break-words">
                      {row.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <strong className="text-sm tabular-nums">
                    {formatMoney(row.amountMinor, row.currency)}
                  </strong>
                  {row.reversed ? (
                    <Badge variant="secondary">Сторнировано</Badge>
                  ) : null}
                  {row.canReverse ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setCommand({ action: "reverse", id: row.id })
                      }
                    >
                      Сторнировать
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
            {!data.receipts.some(match)
              ? empty("Оплат по выбранным фильтрам нет.")
              : null}
          </div>
        </TabsContent>
        <TabsContent value="expenses">
          <div className="surface-card min-w-0 p-3 sm:p-4">
            <div className="mb-3 max-w-sm">
              <FieldSelect
                aria-label="Категория расхода"
                value={category}
                onValueChange={setCategory}
                options={[
                  { value: "", label: "Все категории" },
                  ...Object.entries(categoryNames).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            </div>
            <div className="divide-y">
              {data.expenses
                .filter(
                  (row) =>
                    match(row) && (!category || row.category === category)
                )
                .map((row) => (
                  <article
                    key={row.id}
                    className="grid min-w-0 gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">
                        {categoryNames[row.category] ?? row.category}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {date(row.occurredAt)} · {row.actorName}
                        {row.tripName ? ` · ${row.tripName}` : ""}
                      </p>
                      {row.description ? (
                        <p className="text-sm break-words">{row.description}</p>
                      ) : null}
                      {row.tripId ? (
                        <Link
                          href={`/trips/${encodeURIComponent(row.tripId)}`}
                          className="text-xs text-primary hover:underline"
                        >
                          Открыть рейс
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <strong className="text-sm tabular-nums">
                        {formatMoney(row.amountMinor, row.currency)}
                      </strong>
                      {row.reversed ? (
                        <Badge variant="secondary">Сторнировано</Badge>
                      ) : null}
                      {row.canReverse ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setCommand({ action: "reverse", id: row.id })
                          }
                        >
                          Сторнировать
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              {!data.expenses.some(
                (row) => match(row) && (!category || row.category === category)
              )
                ? empty("Расходов по выбранным фильтрам нет.")
                : null}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="wallets">
          <div className="surface-card min-w-0 divide-y p-3 sm:p-4">
            {wallets
              .filter((wallet) => !currency || wallet.currency === currency)
              .map((wallet) => (
                <article
                  key={wallet.accountId}
                  className="grid min-w-0 gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words">{wallet.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {wallet.ownerType === "company"
                        ? "Касса компании"
                        : "На руках"}{" "}
                      · В передаче{" "}
                      {formatMoney(wallet.reservedMinor, wallet.currency)}
                    </p>
                  </div>
                  <div className="text-sm sm:text-right">
                    <strong>
                      {formatMoney(wallet.balanceMinor, wallet.currency)}
                    </strong>
                    <p className="text-xs text-muted-foreground">
                      Доступно{" "}
                      {formatMoney(wallet.availableMinor, wallet.currency)}
                    </p>
                  </div>
                </article>
              ))}
            {!wallets.length ? empty("Кассы пока пусты.") : null}
          </div>
        </TabsContent>
        <TabsContent value="trips">
          <div className="surface-card min-w-0 divide-y p-3 sm:p-4">
            {profits
              .filter(
                (row) =>
                  (!trip || row.tripId === trip) &&
                  (!currency || row.currency === currency)
              )
              .map((row) => (
                <article
                  key={row.tripId}
                  className="grid min-w-0 gap-3 py-3 first:pt-0 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,.6fr))]"
                >
                  <Link
                    href={`/trips/${encodeURIComponent(row.tripId)}`}
                    className="font-medium hover:text-primary"
                  >
                    {data.trips.find((item) => item.id === row.tripId)?.label ??
                      "Рейс"}
                  </Link>
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground">Получено</p>
                    {row.rateMissing
                      ? "—"
                      : formatMoney(row.revenueMinor, row.currency)}
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground">Расходы</p>
                    {row.rateMissing
                      ? "—"
                      : formatMoney(row.expenseMinor, row.currency)}
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground">Результат</p>
                    <strong
                      className={
                        row.rateMissing
                          ? "text-muted-foreground"
                          : row.profitMinor < 0
                            ? "text-destructive"
                            : "text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      {row.rateMissing
                        ? "Нужен курс за дату"
                        : formatMoney(row.profitMinor, row.currency)}
                    </strong>
                    <p className="text-xs text-muted-foreground">
                      Долг {formatMoney(row.outstandingMinor, row.currency)}
                    </p>
                  </div>
                </article>
              ))}
            {!profits.some(
              (row) =>
                (!trip || row.tripId === trip) &&
                (!currency || row.currency === currency)
            )
              ? empty("Рейсов по выбранным фильтрам нет.")
              : null}
          </div>
        </TabsContent>
      </Tabs>
      {command ? (
        <CommandDialog
          command={command}
          data={data}
          tripId={trip || undefined}
          onClose={() => setCommand(null)}
          onUpdated={load}
        />
      ) : null}
      <Dialog
        open={!!resolution}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setResolution(null)
            setResolutionReason("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{resolution?.title}</DialogTitle>
            <DialogDescription>
              {resolution?.action === "accept"
                ? "Подтверждайте только деньги, которые фактически получили."
                : "Зарезервированная сумма снова станет доступной отправителю."}
            </DialogDescription>
          </DialogHeader>
          <label className="grid min-w-0 gap-1.5 text-sm">
            Комментарий
            <Input
              value={resolutionReason}
              onChange={(e) => setResolutionReason(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              disabledReason="Дождитесь результата передачи."
              onClick={() => setResolution(null)}
            >
              Закрыть
            </Button>
            <HoldActionButton
              tone={resolution?.action === "accept" ? "archive" : "danger"}
              disabled={busy}
              disabledReason="Передача обновляется. Дождитесь результата."
              onConfirm={() => void resolve()}
            >
              {resolution?.action === "accept"
                ? "Подтвердить получение"
                : resolution?.action === "reject"
                  ? "Отклонить"
                  : "Отменить передачу"}
            </HoldActionButton>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export function TripMoneySummary({ tripId }: { tripId: string }) {
  const [item, setItem] = React.useState<TripProfit | null>(null),
    [error, setError] = React.useState("")
  React.useEffect(() => {
    let active = true
    void request<{ items: TripProfit[] }>("profits", undefined, { tripId })
      .then((result) => {
        if (active) setItem(result.items[0] ?? null)
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Не удалось загрузить результат рейса."
          )
      })
    return () => {
      active = false
    }
  }, [tripId])
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  if (!item)
    return (
      <p className="text-sm text-muted-foreground">Загружаем расчёт рейса…</p>
    )
  return (
    <section
      aria-label="Результат рейса"
      className="grid min-w-0 grid-cols-2 gap-3 border-t py-4"
    >
      <h3 className="col-span-2 flex items-center gap-2 font-semibold">
        <CircleDollarSign className="size-4" />
        Результат рейса · {item.currency}
      </h3>
      {[
        { label: "Получено", value: item.revenueMinor },
        { label: "Расходы", value: item.expenseMinor },
        { label: "Чистый результат", value: item.profitMinor },
        { label: "Не оплачено", value: item.outstandingMinor },
      ].map((row, index) => (
        <div key={row.label} className="min-w-0">
          <p className="text-xs text-muted-foreground">{row.label}</p>
          <p
            className={`text-sm font-semibold tabular-nums ${index === 2 ? (item.profitMinor < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400") : ""}`}
          >
            {item.rateMissing && index < 3
              ? "—"
              : formatMoney(row.value, item.currency)}
          </p>
        </div>
      ))}
      {item.rateMissing ? (
        <p className="col-span-2 text-sm text-muted-foreground">
          Для расчёта не хватает курса на дату операции.
        </p>
      ) : null}
    </section>
  )
}
