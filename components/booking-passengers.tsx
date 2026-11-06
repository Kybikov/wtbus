"use client"
import * as React from "react"
import { UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { calendarDayKey } from "@/lib/calendar-grid"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { toast } from "sonner"

type Passenger = {
  firstName: string
  lastName: string
  phone: string
  birthDate: string
}
type Manifest = {
  items: Passenger[]
  seats: number
  availableSeats: number
  priceMinor: number
  nextPriceMinor: number
  currency: string
  addDisabledReason: string
}
const empty: Passenger = {
  firstName: "",
  lastName: "",
  phone: "",
  birthDate: "",
}
const fields = [
  { key: "firstName", label: "Имя", type: "text" },
  { key: "lastName", label: "Фамилия", type: "text" },
  { key: "phone", label: "Телефон", type: "tel" },
  { key: "birthDate", label: "Дата рождения", type: "date" },
] as const
function flatten(items: Passenger[]) {
  return Object.fromEntries(
    items.flatMap((p, i) =>
      fields.map((f) => [`${i}.${f.key}`, p[f.key] ?? ""])
    )
  )
}
async function request(
  id: string,
  method = "GET",
  body?: unknown
): Promise<Manifest> {
  const response = await fetch(
    `/api/booking-passengers?id=${encodeURIComponent(id)}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  )
  const result = await response.json()
  if (!response.ok)
    throw new Error(result.error ?? "Не удалось изменить пассажиров.")
  return result
}
export function BookingPassengers({
  id,
  open,
  onOpenChange,
  onUpdated,
}: {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void
}) {
  const [manifest, setManifest] = React.useState<Manifest | null>(null)
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState("")
  const [adding, setAdding] = React.useState(false)
  const [pending, setPending] = React.useState(0)
  const [writeError, setWriteError] = React.useState("")
  const [person, setPerson] = React.useState<Passenger>({ ...empty })
  const today = calendarDayKey(new Date())
  const acknowledged = React.useRef<Record<string, string>>({})
  const autosave = useFieldAutosave<Record<string, string>>(async (next) => {
    const patch = Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) => acknowledged.current[key] !== value
      )
    )
    let result: Manifest
    try {
      result = await request(id, "PATCH", { fields: patch })
      setWriteError("")
    } catch (e) {
      setWriteError(
        e instanceof Error ? e.message : "Не удалось сохранить пассажира."
      )
      throw e
    }
    acknowledged.current = flatten(result.items)
    setDraft((current) =>
      Object.fromEntries(
        Object.entries(acknowledged.current).map(([key, value]) => [
          key,
          current[key] === next[key] ? value : (current[key] ?? value),
        ])
      )
    )
    setManifest(result)
    onUpdated()
    return acknowledged.current
  })
  const load = React.useCallback(async () => {
    try {
      const result = await request(id)
      const value = flatten(result.items)
      setManifest(result)
      setDraft(value)
      acknowledged.current = value
      autosave.initialize(value)
      setError("")
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить пассажиров."
      )
    }
  }, [id, autosave])
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => void load())
    return () => cancelAnimationFrame(frame)
  }, [load])
  const commit = (key: string, value: string) => {
    setPending((n) => n + 1)
    void autosave
      .commit({ [key]: value })
      .finally(() => setPending((n) => n - 1))
  }
  const money = (value: number) =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: manifest?.currency ?? "EUR",
    }).format(value / 100)
  const addReason = adding
    ? "Добавляем пассажира…"
    : pending
      ? "Дождитесь сохранения данных пассажиров."
      : writeError
        ? "Исправьте несохранённые данные пассажира и выйдите из поля, чтобы повторить сохранение."
        : !manifest
          ? error || "Дождитесь загрузки пассажиров."
          : manifest.addDisabledReason ||
            (!person.firstName.trim() ? "Укажите имя пассажира." : "")
  return (
    <>
      <section
        aria-label="Пассажиры бронирования"
        className="mt-5 space-y-3 border-t pt-4"
      >
        {writeError ? (
          <p role="alert" className="text-sm text-destructive">
            {writeError}
          </p>
        ) : null}
        <h3 className="flex items-center gap-2 font-semibold">
          <UserRound className="size-4" />
          Пассажиры{manifest ? ` · ${manifest.seats}` : ""}
        </h3>
        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            {error}
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        ) : null}
        {!manifest && !error ? (
          <p className="text-sm text-muted-foreground">Загружаем пассажиров…</p>
        ) : null}
        {manifest?.items.map((_, index) => (
          <article key={index} className="min-w-0 rounded-xl border p-3 sm:p-4">
            <h4 className="mb-3 text-sm font-semibold">Пассажир {index + 1}</h4>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {fields.map((field) => {
                const key = `${index}.${field.key}`
                if (field.key === "birthDate")
                  return (
                    <div
                      key={key}
                      className="grid min-w-0 gap-1.5 text-xs text-muted-foreground"
                    >
                      <span>{field.label}</span>
                      <DatePicker
                        label={`Дата рождения, пассажир ${index + 1}`}
                        value={draft[key] ?? ""}
                        max={today}
                        onValueChange={(value) => {
                          setDraft((current) => ({ ...current, [key]: value }))
                          commit(key, value)
                        }}
                      />
                    </div>
                  )
                return (
                  <label
                    key={key}
                    className="grid min-w-0 gap-1.5 text-xs text-muted-foreground"
                  >
                    {field.label}
                    <Input
                      aria-label={`${field.label}, пассажир ${index + 1}`}
                      type={field.type}
                      className="min-w-0 text-foreground"
                      value={draft[key] ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      onBlur={() => {
                        commit(key, draft[key] ?? "")
                      }}
                    />
                  </label>
                )
              })}
            </div>
          </article>
        ))}
      </section>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[min(85dvh,var(--mobile-viewport-height,85dvh))] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Добавить пассажира</DialogTitle>
            <DialogDescription>
              {manifest
                ? `Свободных мест: ${manifest.availableSeats}`
                : "Загружаем места…"}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid min-w-0 gap-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (addReason || !manifest) return
              setAdding(true)
              try {
                await request(id, "POST", {
                  passenger: person,
                  expectedSeats: manifest.seats,
                })
                await load()
                setPerson({ ...empty })
                onOpenChange(false)
                onUpdated()
                toast.success("Пассажир добавлен")
              } catch (e) {
                toast.error(
                  e instanceof Error
                    ? e.message
                    : "Не удалось добавить пассажира."
                )
              } finally {
                setAdding(false)
              }
            }}
          >
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {fields.map((field) =>
                field.key === "birthDate" ? (
                  <div key={field.key} className="grid min-w-0 gap-1.5 text-sm">
                    <span>{field.label}</span>
                    <DatePicker
                      label="Дата рождения нового пассажира"
                      value={person.birthDate}
                      max={today}
                      onValueChange={(value) =>
                        setPerson((p) => ({ ...p, birthDate: value }))
                      }
                    />
                  </div>
                ) : (
                  <label
                    key={field.key}
                    className="grid min-w-0 gap-1.5 text-sm"
                  >
                    {field.label}
                    <Input
                      type={field.type}
                      value={person[field.key]}
                      onChange={(event) =>
                        setPerson((p) => ({
                          ...p,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  </label>
                )
              )}
            </div>
            {manifest ? (
              <p className="text-sm">
                Сумма бронирования:{" "}
                <strong>{money(manifest.priceMinor)}</strong> →{" "}
                <strong>{money(manifest.nextPriceMinor)}</strong>
              </p>
            ) : null}
            {manifest?.addDisabledReason ? (
              <p role="status" className="text-sm text-muted-foreground">
                {manifest.addDisabledReason}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={!!addReason}
                disabledReason={addReason}
              >
                Добавить пассажира
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
