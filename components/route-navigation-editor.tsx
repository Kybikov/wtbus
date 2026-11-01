"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { sessionFetch } from "@/lib/session-navigation"

export type RoadPoint = [number, number]
export type RouteNavigation = {
  start: RoadPoint | null
  end: RoadPoint | null
  coordinates?: RoadPoint[]
  distanceMeters?: number
}
const RoadMap = dynamic(
  () =>
    import("@/components/route-navigation-map").then(
      (m) => m.RouteNavigationMap
    ),
  {
    ssr: false,
    loading: () => <div className="h-64 animate-pulse rounded-xl bg-muted" />,
  }
)
const blank: RouteNavigation = { start: null, end: null }
function display(p: RoadPoint | null) {
  return p ? `${p[1].toFixed(6)}, ${p[0].toFixed(6)}` : ""
}

function parsePoint(text: string): RoadPoint | null | undefined {
  if (!text.trim()) return null
  const segments = text.trim().split(/\s*[,;]\s*/)
  const parts = segments.map(Number)
  if (
    parts.length !== 2 ||
    segments.some((part) => !/^[+-]?\d+(?:\.\d+)?$/.test(part)) ||
    !parts.every(Number.isFinite) ||
    Math.abs(parts[0]) > 85 ||
    Math.abs(parts[1]) > 180
  )
    return undefined
  return [parts[1], parts[0]]
}

type EditorProps = { routeID: string; entity?: "routes" | "trips" }
export function RouteNavigationEditor({
  routeID,
  entity = "routes",
}: EditorProps) {
  return (
    <Editor key={`${entity}:${routeID}`} routeID={routeID} entity={entity} />
  )
}
function Editor({ routeID, entity = "routes" }: EditorProps) {
  const [navigation, setNavigation] = React.useState<RouteNavigation>(blank)
  const [fields, setFields] = React.useState({ start: "", end: "" })
  const [target, setTarget] = React.useState<"start" | "end">("start")
  const [loading, setLoading] = React.useState(true)
  const [ready, setReady] = React.useState(false)
  const [pending, setPending] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const autosave = useFieldAutosave<RouteNavigation>(async (value) => {
    setPending((n) => n + 1)
    try {
      const response = await sessionFetch(
        `/api/routes/navigation?entity=${entity}&id=${encodeURIComponent(routeID)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: value.start, end: value.end }),
        }
      )
      const payload = await response.json()
      if (!response.ok)
        throw new Error(payload.error || "Не удалось сохранить точки.")
      const saved = payload.navigation as RouteNavigation
      setNavigation(saved)
      setFields((current) => ({
        start:
          current.start === display(value.start)
            ? display(saved.start)
            : current.start,
        end:
          current.end === display(value.end) ? display(saved.end) : current.end,
      }))
      setError(null)
      return saved
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось сохранить точки."
      )
      throw reason
    } finally {
      setPending((n) => n - 1)
    }
  })
  const initialize = autosave.initialize
  const load = React.useCallback(async () => {
    try {
      const response = await sessionFetch(
        `/api/routes/navigation?entity=${entity}&id=${encodeURIComponent(routeID)}`
      )
      const payload = await response.json()
      if (!response.ok)
        throw new Error(payload.error || "Не удалось загрузить точки.")
      const saved = (payload.navigation ?? blank) as RouteNavigation
      initialize(saved)
      setReady(true)
      setNavigation(saved)
      setFields({ start: display(saved.start), end: display(saved.end) })
      setError(null)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось загрузить точки."
      )
    } finally {
      setLoading(false)
    }
  }, [routeID, entity, initialize])
  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  function choose(key: "start" | "end", point: RoadPoint | null) {
    setError(null)
    setFields((current) => ({ ...current, [key]: display(point) }))
    void autosave.commit({ [key]: point })
  }
  function commit(key: "start" | "end") {
    const point = parsePoint(fields[key])
    if (point === undefined) {
      setError(
        "Введите широту и долготу через запятую, например 50.061, 19.938."
      )
      return
    }
    choose(key, point)
  }
  return (
    <div className="min-w-0 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["start", "end"] as const).map((key) => (
          <label
            key={key}
            className="min-w-0 space-y-1 text-xs text-muted-foreground"
          >
            <span>{key === "start" ? "Отправление" : "Прибытие"}</span>
            <Input
              aria-label={
                key === "start"
                  ? "Координаты отправления"
                  : "Координаты прибытия"
              }
              placeholder="Широта, долгота"
              value={fields[key]}
              disabled={!ready}
              data-disabled-reason={
                !ready
                  ? loading
                    ? "Загружаем точки маршрута."
                    : "Не удалось загрузить точки. Повторите загрузку."
                  : undefined
              }
              onChange={(event) => {
                setFields((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }}
              onBlur={() => {
                if (ready) commit(key)
              }}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <FieldSelect
          aria-label="Точка на карте"
          value={target}
          onValueChange={(value) => setTarget(value as "start" | "end")}
          options={[
            { value: "start", label: "Выбрать отправление" },
            { value: "end", label: "Выбрать прибытие" },
          ]}
        />
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {pending
            ? "Строим дорогу…"
            : navigation.distanceMeters
              ? `${(navigation.distanceMeters / 1000).toFixed(1)} км по дороге`
              : "Выберите две точки на карте"}
        </span>
      </div>
      {ready ? (
        <div className="isolate overflow-hidden rounded-xl border">
          <RoadMap
            navigation={navigation}
            onChoose={(point) => choose(target, point)}
          />
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-destructive"
        >
          {error}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!ready) {
                setLoading(true)
                void load()
              } else {
                const start = parsePoint(fields.start),
                  end = parsePoint(fields.end)
                if (start === undefined || end === undefined) {
                  setError(
                    "Укажите широту и долготу через запятую для обеих точек."
                  )
                  return
                }
                void autosave.commit({ start, end })
              }
            }}
          >
            Повторить
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          OpenStreetMap
        </a>{" "}
        ·{" "}
        <a
          href="https://www.openstreetmap.org/fixthemap"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Исправить карту
        </a>
      </p>
    </div>
  )
}
