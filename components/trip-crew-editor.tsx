"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import { DeliverySwitch } from "@/components/ui/delivery-switch"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { HoldActionButton } from "@/components/ui/hold-action-button"
import { formatMoney, parseMoneyInput, type MoneyWallet } from "@/lib/money-v2"

type Member = {
  membershipId: string
  name: string
  role: string
  canDrive: boolean
  canCollect: boolean
  canBoard: boolean
  canManage: boolean
  canGPS: boolean
  payMinor: number
  payCurrency: string
  isPrimary: boolean
}
type Manifest = {
  items: Member[]
  eligibleMembers: { membershipId: string; name: string }[]
  canEdit: boolean
  canViewPay: boolean
  disabledReason: string
  membershipId: string
}
const roles = [
  { value: "driver", label: "Водитель" },
  { value: "manager", label: "Менеджер рейса" },
]
const currencies = ["UAH", "PLN", "EUR", "USD"].map((value) => ({
  value,
  label: value,
}))
async function patchCrew(tripId: string, patch: object) {
  const response = await fetch(
    `/api/trip-crew?tripId=${encodeURIComponent(tripId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  )
  const result = await response.json()
  if (!response.ok)
    throw new Error(result.error ?? "Не удалось изменить команду.")
  return result
}

function CrewRow({
  member,
  tripId,
  canEdit,
  own,
  disabledReason,
  refresh,
}: {
  member: Member
  tripId: string
  canEdit: boolean
  own: boolean
  disabledReason: string
  refresh: () => void
}) {
  const [draft, setDraft] = React.useState(member)
  const [payText, setPayText] = React.useState(String(member.payMinor / 100))
  const pendingWrites = React.useRef(0)
  const revision = React.useRef(0)
  // Queue field intents, rather than a stale roster snapshot. A GPS change made
  // on another member must never be overwritten by a subsequent pay-field blur.
  const autosave = useFieldAutosave<{
    revision: number
    patch: Partial<Member>
  }>(async (next) => {
    try {
      await patchCrew(tripId, {
        membershipId: member.membershipId,
        ...next.patch,
      })
      refresh()
      return next
    } finally {
      pendingWrites.current--
    }
  })
  React.useEffect(() => {
    autosave.initialize({ revision: 0, patch: {} })
  }, [autosave]) // Fresh drafts survive background reads.
  React.useEffect(() => {
    if (pendingWrites.current === 0) {
      setDraft((current) => ({ ...current, canGPS: member.canGPS }))
    }
  }, [member.canGPS])
  const change = (patch: Partial<Member>) => {
    setDraft((current) => ({ ...current, ...patch }))
    pendingWrites.current++
    void autosave.commit({ revision: ++revision.current, patch })
  }
  const reason = disabledReason
  return (
    <li className="min-w-0 space-y-3 border-b py-4 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="break-words">
          {member.name}
          {member.isPrimary ? " · Основной водитель" : ""}
        </strong>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            disabled={member.isPrimary}
            disabledReason={
              member.isPrimary
                ? "Смените основного водителя в связанных записях рейса."
                : undefined
            }
            onClick={async () => {
              if (!window.confirm(`Исключить ${member.name} из команды рейса?`))
                return
              try {
                await patchCrew(tripId, {
                  membershipId: member.membershipId,
                  remove: true,
                })
                refresh()
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Не удалось исключить сотрудника."
                )
              }
            }}
          >
            Исключить
          </Button>
        )}
      </div>
      <FieldSelect
        aria-label={`Роль ${member.name}`}
        value={draft.role}
        options={roles}
        disabled={!canEdit}
        disabledReason={reason}
        onValueChange={(role) =>
          change({
            role,
            ...(role === "manager" ? { canDrive: false, canGPS: false } : {}),
          })
        }
      />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {(
          [
            ["canDrive", "Управление автомобилем"],
            ["canCollect", "Приём оплаты"],
            ["canBoard", "Отметки пассажиров"],
            ["canManage", "Управление рейсом"],
            ["canGPS", "Передача GPS"],
          ] as const
        ).map(([key, label]) => {
          const roleBlocked =
            (key === "canDrive" || key === "canGPS") && draft.role !== "driver"
          const gpsBlocked = key === "canGPS" && !draft.canDrive
          return (
            <DeliverySwitch
              key={key}
              label={label}
              checked={draft[key]}
              disabled={!canEdit || roleBlocked || gpsBlocked}
              disabledReason={
                !canEdit
                  ? reason
                  : roleBlocked
                    ? "Выберите роль водителя."
                    : gpsBlocked
                      ? "Разрешите управление автомобилем этому водителю."
                      : undefined
              }
              onChange={(checked) =>
                change({
                  [key]: checked,
                  ...(key === "canDrive" && !checked ? { canGPS: false } : {}),
                })
              }
            />
          )
        })}
      </div>
      {(canEdit || own) && (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <label className="min-w-0 space-y-1 text-sm">
            Оплата за рейс
            <Input
              type="number"
              min="0"
              step="0.01"
              value={payText}
              disabled={!canEdit}
              data-disabled-reason={!canEdit ? reason : undefined}
              onChange={(event) => setPayText(event.target.value)}
              onBlur={() => {
                const value = /^0(?:[.,]0{1,2})?$/.test(payText.trim())
                  ? 0
                  : parseMoneyInput(payText)
                if (value === null) {
                  toast.error("Укажите неотрицательную сумму оплаты.")
                  return
                }
                change({ payMinor: value })
              }}
            />
          </label>
          <div className="self-end">
            <FieldSelect
              aria-label="Валюта оплаты сотруднику"
              value={draft.payCurrency}
              options={currencies}
              disabled={!canEdit}
              disabledReason={reason}
              onValueChange={(payCurrency) => change({ payCurrency })}
            />
          </div>
        </div>
      )}
    </li>
  )
}

function TripCrewWorkspace({
  tripId,
  onUpdated,
}: {
  tripId: string
  onUpdated?: () => void
}) {
  const [data, setData] = React.useState<Manifest | null>(null)
  const [error, setError] = React.useState("")
  const [selected, setSelected] = React.useState("")
  const [role, setRole] = React.useState("manager")
  const [adding, setAdding] = React.useState(false)
  const load = React.useCallback(async () => {
    try {
      const response = await fetch(
        `/api/trip-crew?tripId=${encodeURIComponent(tripId)}`,
        { cache: "no-store" }
      )
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось загрузить команду.")
      setData(result)
      setError("")
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Не удалось загрузить команду."
      )
    }
  }, [tripId])
  React.useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])
  const refresh = () => {
    void load()
    onUpdated?.()
  }
  if (!data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {error || "Загружаем команду рейса…"}
      </p>
    )
  const eligible = data.eligibleMembers.filter(
    (member) =>
      !data.items.some((item) => item.membershipId === member.membershipId)
  )
  return (
    <section className="min-w-0 space-y-3" aria-label="Команда рейса">
      <h3 className="font-semibold">Команда рейса</h3>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="min-w-0">
        {data.items.map((member) => (
          <CrewRow
            key={member.membershipId}
            member={member}
            tripId={tripId}
            canEdit={data.canEdit}
            own={data.canViewPay || member.membershipId === data.membershipId}
            disabledReason={data.disabledReason}
            refresh={refresh}
          />
        ))}
      </ul>
      {!data.items.length && (
        <p className="text-sm text-muted-foreground">
          Команда ещё не назначена.
        </p>
      )}
      {data.canEdit && (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <FieldSelect
            aria-label="Добавить сотрудника в рейс"
            value={selected}
            options={eligible.map((member) => ({
              value: member.membershipId,
              label: member.name,
            }))}
            placeholder="Выберите сотрудника"
            onValueChange={setSelected}
            disabled={adding || eligible.length === 0}
            disabledReason={
              adding
                ? "Добавляем сотрудника в команду."
                : "Все активные сотрудники уже добавлены. Добавьте сотрудника в разделе «Команда»."
            }
          />
          <FieldSelect
            aria-label="Роль нового сотрудника"
            value={role}
            options={roles}
            onValueChange={setRole}
            disabled={adding}
            disabledReason="Добавляем сотрудника в команду."
          />
          <Button
            className="sm:col-span-2"
            disabled={adding || !selected}
            disabledReason={
              adding
                ? "Добавляем сотрудника в команду."
                : "Выберите сотрудника для добавления."
            }
            onClick={async () => {
              setAdding(true)
              try {
                await patchCrew(tripId, {
                  membershipId: selected,
                  role,
                  canDrive: role === "driver",
                  canCollect: true,
                  canBoard: true,
                })
                setSelected("")
                refresh()
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Не удалось добавить сотрудника."
                )
              } finally {
                setAdding(false)
              }
            }}
          >
            Добавить сотрудника
          </Button>
        </div>
      )}
    </section>
  )
}

export function TripCrewEditor(props: {
  tripId: string
  onUpdated?: () => void
}) {
  return <TripCrewWorkspace key={props.tripId} {...props} />
}

type CrewAccrual = {
  id: string
  tripId: string
  name: string
  grossMinor: number
  dueMinor: number
  currency: string
}
export function CrewPayroll({
  wallets,
  onUpdated,
}: {
  wallets: MoneyWallet[]
  onUpdated?: () => void
}) {
  const [items, setItems] = React.useState<CrewAccrual[]>([])
  const [canPay, setCanPay] = React.useState(false)
  const [error, setError] = React.useState("")
  const [selected, setSelected] = React.useState("")
  const [accountId, setAccountId] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const requestId = React.useRef<string | null>(null)
  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/trip-crew?payroll=1", {
        cache: "no-store",
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось загрузить начисления.")
      setItems(result.items)
      setCanPay(result.canPay)
      setError("")
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить начисления."
      )
    }
  }, [])
  React.useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])
  const accrual = items.find((item) => item.id === selected)
  const choices = wallets.filter(
    (wallet) =>
      wallet.canSpend &&
      wallet.currency === accrual?.currency &&
      wallet.ownerType !== "system"
  )
  const wallet = choices.find((item) => item.accountId === accountId)
  const minor = parseMoneyInput(amount) ?? 0
  const reason = pending
    ? "Проводим выплату."
    : !accrual
      ? "Выберите начисление."
      : !wallet
        ? "Выберите кошелёк в валюте начисления."
        : !Number.isSafeInteger(minor) || minor <= 0
          ? "Введите положительную сумму выплаты."
          : minor > accrual.dueMinor
            ? "Сумма превышает остаток зарплаты."
            : minor > wallet.availableMinor
              ? "В кошельке недостаточно свободных денег."
              : ""
  const resetRequest = () => {
    requestId.current = null
  }
  return (
    <section
      className="min-w-0 space-y-3"
      aria-label="Оплата менеджеров рейсов"
    >
      <h3 className="font-semibold">Оплата менеджеров рейсов</h3>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!items.length && !error && (
        <p className="text-sm text-muted-foreground">
          Начислений менеджерам пока нет. Оплата начисляется после завершения
          рейса.
        </p>
      )}
      <ul className="divide-y">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <span className="min-w-0 break-words">{item.name}</span>
            <span>Осталось {formatMoney(item.dueMinor, item.currency)}</span>
          </li>
        ))}
      </ul>
      {canPay && items.some((item) => item.dueMinor > 0) && (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <FieldSelect
            aria-label="Начисление менеджеру"
            value={selected}
            options={items
              .filter((item) => item.dueMinor > 0)
              .map((item) => ({
                value: item.id,
                label: `${item.name} · ${formatMoney(item.dueMinor, item.currency)}`,
              }))}
            placeholder="Выберите начисление"
            disabled={pending}
            disabledReason="Проводим выплату."
            onValueChange={(id) => {
              setSelected(id)
              setAccountId("")
              setAmount(
                String(
                  (items.find((item) => item.id === id)?.dueMinor ?? 0) / 100
                )
              )
              resetRequest()
            }}
          />
          <FieldSelect
            aria-label="Кошелёк для выплаты"
            value={accountId}
            options={choices.map((item) => ({
              value: item.accountId,
              label: `${item.name} · ${formatMoney(item.availableMinor, item.currency)}`,
            }))}
            placeholder="Из какого кошелька"
            disabled={pending || !accrual || choices.length === 0}
            disabledReason={
              pending
                ? "Проводим выплату."
                : !accrual
                  ? "Сначала выберите начисление."
                  : "Нет доступного кошелька в валюте начисления."
            }
            onValueChange={(id) => {
              setAccountId(id)
              resetRequest()
            }}
          />
          <Input
            aria-label="Сумма выплаты менеджеру"
            inputMode="decimal"
            value={amount}
            disabled={pending}
            data-disabled-reason={pending ? "Проводим выплату." : undefined}
            onChange={(event) => {
              setAmount(event.target.value)
              resetRequest()
            }}
          />
          <HoldActionButton
            tone="archive"
            disabled={!!reason}
            disabledReason={reason}
            onConfirm={() => {
              if (reason) return
              setPending(true)
              requestId.current ??= crypto.randomUUID()
              void fetch("/api/trip-crew?payroll=1", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  accrualId: selected,
                  accountId,
                  amountMinor: minor,
                  requestId: requestId.current,
                }),
              })
                .then(async (response) => {
                  const result = await response.json()
                  if (!response.ok)
                    throw new Error(
                      result.error ?? "Не удалось провести выплату."
                    )
                  toast.success("Выплата проведена")
                  setAmount("")
                  resetRequest()
                  await load()
                  onUpdated?.()
                })
                .catch((error) =>
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Не удалось провести выплату."
                  )
                )
                .finally(() => setPending(false))
            }}
          >
            Удерживайте для выплаты
          </HoldActionButton>
        </div>
      )}
    </section>
  )
}
