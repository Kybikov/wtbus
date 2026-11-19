"use client"

import * as React from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowRight, GripVertical, MapPin, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RoutePlacePicker } from "@/components/route-place-picker"
import type { RoadPoint } from "@/components/route-navigation-editor"
import { FieldSelect } from "@/components/ui/field-select"
import { HoldActionButton } from "@/components/ui/hold-action-button"
import { Input } from "@/components/ui/input"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { sessionFetch } from "@/lib/session-navigation"

type Stop = {
  city: string
  address: string
  minutes: number
  point?: RoadPoint
}
type Fare = { from: number; to: number; priceMinor: number }
type Itinerary = { stops: Stop[]; fares: Fare[] }
export type ItineraryDetails = {
  itinerary: Itinerary
  origin: string
  destination: string
  currency: string
  maxMinutes: number
  locked: boolean
  roadChanged?: boolean
  version: string
}

const moneyPattern = /^\d{1,7}(?:[.,]\d{1,2})?$/
const blankStop = { city: "", address: "", minutes: 0 }

export function TripItineraryEditor({
  id,
  entity,
}: {
  id: string
  entity: "routes" | "trips"
}) {
  return <Editor key={entity + id} id={id} entity={entity} />
}

function SortableStop({
  index,
  locked,
  city,
  children,
}: {
  index: number
  locked: boolean
  city: string
  children: React.ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: index, disabled: locked })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative min-w-0 space-y-2 rounded-xl border border-border/60 bg-card p-3 ${isDragging ? "z-10 shadow-lg" : ""}`}
    >
      {!locked ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Перетащить остановку ${city}`}
          className="cursor-grab touch-none active:cursor-grabbing"
        >
          <GripVertical />
        </Button>
      ) : null}
      {children}
    </li>
  )
}

function Editor({ id, entity }: { id: string; entity: "routes" | "trips" }) {
  const url = `/api/routes/itinerary?entity=${entity}&id=${encodeURIComponent(id)}`
  const [details, setDetails] = React.useState<ItineraryDetails>()
  const [draft, setDraft] = React.useState<Itinerary>()
  const latest = React.useRef<Itinerary | undefined>(undefined)
  const version = React.useRef("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [newStop, setNewStop] = React.useState<Stop>(blankStop)
  const [from, setFrom] = React.useState("0")
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const { commit, initialize } = useFieldAutosave<Itinerary>(async (value) => {
    setPending(true)
    try {
      const response = await sessionFetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": version.current,
        },
        body: JSON.stringify(value),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      const saved = result as ItineraryDetails
      version.current = saved.version
      setDetails(saved)
      if (saved.roadChanged)
        window.dispatchEvent(
          new CustomEvent("vivat:route-road-updated", { detail: id })
        )
      setError("")
      return saved.itinerary
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить остановки."
      )
      throw reason
    } finally {
      setPending(false)
    }
  })

  React.useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await sessionFetch(url, { signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        if (controller.signal.aborted) return
        const saved = result as ItineraryDetails
        version.current = saved.version
        initialize(saved.itinerary)
        latest.current = saved.itinerary
        setDraft(saved.itinerary)
        setDetails(saved)
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить остановки."
          )
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [url, initialize])

  if (!details || !draft) {
    return (
      <p
        role={error ? "alert" : "status"}
        className="text-sm text-muted-foreground"
      >
        {error || "Загружаем остановки…"}
      </p>
    )
  }
  const { stops, fares } = draft
  const cities = [
    details.origin,
    ...stops.map((stop) => stop.city),
    details.destination,
  ]
  const last = cities.length - 1
  const lockedReason = "Остановки уже используются в бронированиях рейса."
  const addBlocked = details.locked || stops.length >= 12
  const routePriceHint =
    entity === "routes" ? "Базовая цена маршрута" : "Базовая цена рейса"

  function persist(next: Itinerary) {
    latest.current = next
    setDraft(next)
    setError("")
    void commit(next)
  }

  function changeStop(index: number, change: Partial<Stop>) {
    const value = latest.current
    if (!value) return
    persist({
      ...value,
      stops: value.stops.map((stop, position) =>
        position === index ? { ...stop, ...change } : stop
      ),
    })
  }

  function moveStop(index: number, target: number) {
    const value = latest.current
    if (!value) return
    const order = arrayMove(
      value.stops.map((_, index) => index + 1),
      index,
      target
    )
    const list = order.map((previous, i) => ({
      ...value.stops[previous - 1],
      minutes: value.stops[i].minutes,
    }))
    function position(stop: number) {
      return stop === 0 || stop === order.length + 1
        ? stop
        : order.indexOf(stop) + 1
    }
    persist({
      stops: list,
      fares: value.fares
        .map((fare) => ({
          ...fare,
          from: position(fare.from),
          to: position(fare.to),
        }))
        .filter((fare) => fare.from < fare.to),
    })
    setFrom("0")
  }

  function removeStop(index: number) {
    const value = latest.current
    if (!value) return
    const position = index + 1
    persist({
      stops: value.stops.filter((_, i) => i !== index),
      fares: value.fares
        .filter((fare) => fare.from !== position && fare.to !== position)
        .map((fare) => ({
          ...fare,
          from: fare.from > position ? fare.from - 1 : fare.from,
          to: fare.to > position ? fare.to - 1 : fare.to,
        })),
    })
    setFrom("0")
  }

  function appendStop(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = latest.current
    if (
      !value ||
      !newStop.city.trim() ||
      !newStop.address.trim() ||
      newStop.minutes <= (value.stops.at(-1)?.minutes ?? 0)
    )
      return
    const oldLast = value.stops.length + 1
    persist({
      stops: [
        ...value.stops,
        {
          ...newStop,
          city: newStop.city.trim(),
          address: newStop.address.trim(),
        },
      ],
      fares: value.fares.map((fare) =>
        fare.to === oldLast ? { ...fare, to: oldLast + 1 } : fare
      ),
    })
    setNewStop(blankStop)
    setAdding(false)
  }

  function changeFare(start: number, end: number, text: string) {
    const value = latest.current
    if (!value) return
    const raw = text.trim()
    const priceMinor = raw ? Math.round(Number(raw.replace(",", ".")) * 100) : 0
    if (
      raw &&
      (!moneyPattern.test(raw) || priceMinor < 1 || priceMinor > 100_000_000)
    ) {
      setError("Введите цену больше нуля, до 1 000 000.")
      return
    }
    const current = value.fares.find(
      (fare) => fare.from === start && fare.to === end
    )
    if ((current?.priceMinor ?? 0) === priceMinor) return
    const next = value.fares.filter(
      (fare) => fare.from !== start || fare.to !== end
    )
    if (priceMinor) next.push({ from: start, to: end, priceMinor })
    persist({ ...value, fares: next })
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {details.locked ? (
        <p className="text-xs text-muted-foreground">
          {lockedReason} Цены можно менять.
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id && !details.locked)
            moveStop(Number(active.id), Number(over.id))
        }}
      >
        <ol className="space-y-2">
          <li className="flex items-center gap-2 text-sm font-medium">
            <MapPin className="size-4 text-primary" />
            {details.origin}
          </li>
          <SortableContext
            items={stops.map((_, index) => index)}
            strategy={verticalListSortingStrategy}
          >
            {stops.map((stop, index) => (
              <SortableStop
                key={index}
                index={index}
                locked={details.locked}
                city={stop.city}
              >
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                  <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                    Город
                    <Input
                      key={stop.city}
                      defaultValue={stop.city}
                      readOnly={details.locked}
                      maxLength={120}
                      onBlur={(event) => {
                        const city = event.target.value.trim()
                        if (city !== stop.city) changeStop(index, { city })
                      }}
                    />
                  </label>
                  <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                    Минут после выезда
                    <Input
                      key={stop.minutes}
                      type="number"
                      min={1}
                      max={details.maxMinutes - 1}
                      defaultValue={stop.minutes}
                      readOnly={details.locked}
                      onBlur={(event) => {
                        const minutes = Number(event.target.value)
                        if (minutes !== stop.minutes)
                          changeStop(index, { minutes })
                      }}
                    />
                  </label>
                  <label className="min-w-0 space-y-1 text-xs text-muted-foreground sm:col-span-2">
                    Адрес или место встречи
                    <Input
                      key={stop.address}
                      defaultValue={stop.address}
                      readOnly={details.locked}
                      maxLength={300}
                      onBlur={(event) => {
                        const address = event.target.value.trim()
                        if (address !== stop.address)
                          changeStop(index, { address })
                      }}
                    />
                  </label>
                </div>
                {!details.locked ? (
                  <RoutePlacePicker
                    title={`Точка для GPS · ${stop.city}`}
                    label={stop.point ? stop.address : undefined}
                    point={stop.point ?? null}
                    disabled={false}
                    disabledReason=""
                    onChoose={(point, address) =>
                      changeStop(index, {
                        point: point ?? undefined,
                        address: address || stop.address,
                      })
                    }
                  />
                ) : null}
                {!details.locked ? (
                  <div className="flex items-center gap-2">
                    <HoldActionButton
                      size="sm"
                      className="ml-auto"
                      onConfirm={() => removeStop(index)}
                    >
                      <Trash2 className="size-3.5" /> Удалить
                    </HoldActionButton>
                  </div>
                ) : null}
              </SortableStop>
            ))}
          </SortableContext>
          <li className="flex items-center gap-2 text-sm font-medium">
            <MapPin className="size-4 text-primary" />
            {details.destination}
          </li>
        </ol>
      </DndContext>

      {adding ? (
        <form
          onSubmit={appendStop}
          className="grid gap-2 rounded-xl border border-border/60 p-3 sm:grid-cols-2"
        >
          <label className="space-y-1 text-xs text-muted-foreground">
            Город
            <Input
              required
              maxLength={120}
              value={newStop.city}
              onChange={(event) =>
                setNewStop({ ...newStop, city: event.target.value })
              }
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Минут после выезда
            <Input
              required
              type="number"
              min={(stops.at(-1)?.minutes ?? 0) + 1}
              max={details.maxMinutes - 1}
              value={newStop.minutes || ""}
              onChange={(event) =>
                setNewStop({ ...newStop, minutes: Number(event.target.value) })
              }
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
            Адрес или место встречи
            <Input
              required
              maxLength={300}
              value={newStop.address}
              onChange={(event) =>
                setNewStop({ ...newStop, address: event.target.value })
              }
            />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button
              type="submit"
              size="sm"
              disabled={addBlocked}
              disabledReason={
                details.locked ? lockedReason : "Достигнут лимит остановок."
              }
            >
              Добавить
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={addBlocked}
          disabledReason={
            details.locked ? lockedReason : "Можно добавить до 12 остановок."
          }
          onClick={() => {
            setNewStop(blankStop)
            setAdding(true)
          }}
        >
          <Plus /> Добавить остановку
        </Button>
      )}

      {stops.length ? (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Цены по участкам</p>
            <FieldSelect
              aria-label="Город посадки для тарифов"
              value={from}
              onValueChange={setFrom}
              options={cities.slice(0, last).map((city, i) => ({
                value: String(i),
                label: city || `Остановка ${i}`,
              }))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Пустая цена закрывает продажу участка. {routePriceHint} действует на
            весь путь.
          </p>
          {cities.map((city, index) => {
            const start = Number(from)
            if (index <= start || (start === 0 && index === last)) return null
            const fare = fares.find(
              (item) => item.from === start && item.to === index
            )
            return (
              <label
                key={`${start}:${index}`}
                className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,7rem)_auto] items-center gap-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2 break-words">
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  {city}
                </span>
                <Input
                  key={fare?.priceMinor ?? "empty"}
                  aria-label={`Цена до ${city}`}
                  className="text-right tabular-nums"
                  inputMode="decimal"
                  placeholder="—"
                  defaultValue={fare ? (fare.priceMinor / 100).toFixed(2) : ""}
                  onBlur={(event) =>
                    changeFare(start, index, event.target.value)
                  }
                />
                <span className="text-xs text-muted-foreground">
                  {details.currency}
                </span>
              </label>
            )
          })}
        </div>
      ) : null}
      {pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Сохраняем…
        </p>
      ) : null}
    </div>
  )
}
