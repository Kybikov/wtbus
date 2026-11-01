"use client"
import * as React from "react"
import { sessionFetch } from "@/lib/session-navigation"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { AdminNotice } from "@/components/admin-notice"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import { entityNames } from "@/lib/entity-details"
import type { EntityCollection } from "@/lib/entity-views"

type Format = { entity: string; prefix: string; suffix: string; digits: number }
function NumberFormat({
  initial,
  disabled,
}: {
  initial: Format
  disabled: boolean
}) {
  const label =
    initial.entity === "drivers"
      ? "Водитель"
      : entityNames[initial.entity as EntityCollection]
  const [draft, setDraft] = React.useState(initial)
  const autosave = useFieldAutosave<Format>(async (next) => {
    const response = await sessionFetch("/api/record-number-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    })
    const payload = await response.json()
    if (!response.ok || !payload.item)
      throw Error(payload.error ?? "Не удалось сохранить формат номера.")
    return payload.item
  })
  React.useEffect(() => {
    autosave.initialize(initial)
  }, [initial, autosave])
  return (
    <div className="grid min-w-0 gap-3 border-b border-border py-4 last:border-0 sm:grid-cols-[minmax(7rem,1fr)_minmax(0,3fr)]">
      <div>
        <h3 className="text-sm font-medium">
          {initial.entity === "drivers"
            ? "Водитель"
            : entityNames[initial.entity as EntityCollection]}
        </h3>
        <p className="mt-1 text-xs break-all text-muted-foreground">
          {draft.prefix}
          {"1".padStart(draft.digits, "0")}
          {draft.suffix}
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] gap-2">
        <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
          Префикс
          <Input
            aria-label={`Префикс: ${label}`}
            disabled={disabled}
            value={draft.prefix}
            maxLength={16}
            onChange={(e) => setDraft({ ...draft, prefix: e.target.value })}
            onBlur={(e) => autosave.commit({ prefix: e.target.value })}
          />
        </label>
        <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
          <span>Цифры</span>
          <FieldSelect
            aria-label={`Цифры: ${label}`}
            disabled={disabled}
            value={String(draft.digits)}
            options={Array.from({ length: 12 }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1),
            }))}
            onValueChange={(value) => {
              setDraft({ ...draft, digits: Number(value) })
              autosave.commit({ digits: Number(value) })
            }}
          />
        </div>
        <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
          Суффикс
          <Input
            aria-label={`Суффикс: ${label}`}
            disabled={disabled}
            value={draft.suffix}
            maxLength={16}
            onChange={(e) => setDraft({ ...draft, suffix: e.target.value })}
            onBlur={(e) => autosave.commit({ suffix: e.target.value })}
          />
        </label>
      </div>
    </div>
  )
}
export function RecordNumberSettings({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const [items, setItems] = React.useState<Format[]>([])
  const [error, setError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    sessionFetch("/api/record-number-settings", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok || !Array.isArray(payload.items))
          throw Error(payload.error ?? "Не удалось загрузить нумерацию.")
        setItems(payload.items)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
    return () => controller.abort()
  }, [])
  return (
    <section className="settings-panel" aria-label="Нумерация записей">
      <h2 className="text-base font-semibold">Нумерация записей</h2>
      <p className="mt-1 mb-2 text-sm text-muted-foreground">
        Префикс, порядковый номер и суффикс. Новый формат применяется к новым
        записям; выданные номера сохраняются.
      </p>
      <AdminNotice message={error} variant="error" />
      {items.map((item) => (
        <NumberFormat key={item.entity} initial={item} disabled={disabled} />
      ))}
    </section>
  )
}
