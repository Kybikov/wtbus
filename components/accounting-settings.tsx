"use client"

import * as React from "react"
import { accountingRequest } from "@/components/accounting-workspace"
import { Input } from "@/components/ui/input"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { toast } from "sonner"

type Rates = {
  turnoverTaxBps: number
  incomeTaxBps: number
  levyTaxBps: number
  employerTaxBps: number
}
const fields: { key: keyof Rates; label: string; hint: string }[] = [
  {
    key: "turnoverTaxBps",
    label: "Налог с выручки",
    hint: "Прогноз в статистике. Фактическую уплату внесите расходом в категории «Налоги».",
  },
  {
    key: "incomeTaxBps",
    label: "Удержание из зарплаты",
    hint: "Уменьшает сумму к выплате водителю.",
  },
  {
    key: "levyTaxBps",
    label: "Дополнительное удержание",
    hint: "Также вычитается из начисленной зарплаты.",
  },
  {
    key: "employerTaxBps",
    label: "Начисление компании на зарплату",
    hint: "Отдельный расход сверх зарплаты водителя.",
  },
]
export function AccountingSettings() {
  const [rates, setRates] = React.useState<Rates | null>(null)
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(0)
  const [saveError, setSaveError] = React.useState("")
  const { initialize, commit } = useFieldAutosave<Rates>(async (value) => {
    try {
      await accountingRequest("settings", value, "PATCH")
      return value
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Повторите попытку.")
      throw e
    }
  })
  const saving = pending > 0
  function commitRate(patch: Partial<Rates>) {
    setPending((v) => v + 1)
    setSaveError("")
    void commit(patch).finally(() => setPending((v) => Math.max(0, v - 1)))
  }
  React.useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await accountingRequest<{ item: Rates }>("settings")
        if (active) {
          setRates(result.item)
          initialize(result.item)
          setError("")
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить ставки."
          )
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [initialize])
  return (
    <section className="workspace-panel space-y-5 p-5">
      <div>
        <h1 className="font-semibold">Финансовый учёт</h1>
        <p
          role="status"
          className={
            saveError
              ? "mt-1 text-xs text-destructive"
              : "mt-1 text-xs text-muted-foreground"
          }
        >
          {saveError
            ? "Не сохранено: " + saveError
            : saving
              ? "Сохраняем изменения…"
              : rates
                ? "Сохранено"
                : ""}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Внутренние ставки компании. Изменения применяются к новым начислениям.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {!rates && !error ? (
        <p className="text-sm text-muted-foreground">Загружаем настройки…</p>
      ) : null}
      {fields.map((field) => (
        <div
          className="grid items-center gap-3 rounded-xl bg-muted/30 p-4 sm:grid-cols-[minmax(0,1fr)_8rem]"
          key={field.key}
        >
          <div>
            <label htmlFor={field.key} className="text-sm font-medium">
              {field.label}
            </label>
            <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id={field.key}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              disabled={!rates}
              value={rates ? rates[field.key] / 100 : ""}
              onChange={(e) => {
                if (!rates) return
                setRates({
                  ...rates,
                  [field.key]: Math.round(Number(e.target.value) * 100),
                })
              }}
              onBlur={() => {
                if (!rates) return
                if (rates.incomeTaxBps + rates.levyTaxBps > 10000) {
                  toast.error("Сумма удержаний не может превышать 100%.")
                  return
                }
                commitRate({ [field.key]: rates[field.key] })
              }}
            />
            <span className="text-muted-foreground">%</span>
          </div>
        </div>
      ))}
    </section>
  )
}
