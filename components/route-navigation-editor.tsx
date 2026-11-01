"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { FieldSelect } from "@/components/ui/field-select"
import { Button } from "@/components/ui/button"
import { RoutePlacePicker } from "@/components/route-place-picker"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { sessionFetch } from "@/lib/session-navigation"

export type RoadPoint = [number, number]
export type RouteNavigation = {
  start: RoadPoint | null
  end: RoadPoint | null
  startLabel?: string
  endLabel?: string
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
function sameSelection(a: RouteNavigation, b: RouteNavigation) {
  return (
    JSON.stringify([a.start, a.end, a.startLabel ?? "", a.endLabel ?? ""]) ===
    JSON.stringify([b.start, b.end, b.startLabel ?? "", b.endLabel ?? ""])
  )
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
  const draft = React.useRef<RouteNavigation>(blank)
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
          body: JSON.stringify({
            start: value.start,
            end: value.end,
            startLabel: value.startLabel ?? "",
            endLabel: value.endLabel ?? "",
          }),
        }
      )
      const payload = await response.json()
      if (!response.ok)
        throw new Error(payload.error || "Не удалось сохранить место.")
      const saved = payload.navigation as RouteNavigation
      if (sameSelection(draft.current, saved)) {
        draft.current = saved
        setNavigation(saved)
      }
      setError(null)
      return saved
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось сохранить место."
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
        throw new Error(payload.error || "Не удалось загрузить места.")
      const saved = (payload.navigation ?? blank) as RouteNavigation
      initialize(saved)
      draft.current = saved
      setReady(true)
      setNavigation(saved)
      setError(null)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось загрузить места."
      )
    } finally {
      setLoading(false)
    }
  }, [routeID, entity, initialize])
  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  function choose(
    key: "start" | "end",
    point: RoadPoint | null,
    label: string
  ) {
    const patch =
      key === "start"
        ? { start: point, startLabel: label }
        : { end: point, endLabel: label }
    const next = { ...draft.current, ...patch }
    draft.current = next
    setError(null)
    setNavigation((current) => {
      const next = { ...current, ...patch }
      return sameSelection(current, next)
        ? current
        : { ...next, coordinates: undefined, distanceMeters: undefined }
    })
    void autosave.commit({
      start: next.start,
      end: next.end,
      startLabel: next.startLabel ?? "",
      endLabel: next.endLabel ?? "",
    })
  }
  return (
    <div className="min-w-0 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["start", "end"] as const).map((key) => (
          <RoutePlacePicker
            key={key}
            title={key === "start" ? "Отправление" : "Прибытие"}
            label={
              key === "start" ? navigation.startLabel : navigation.endLabel
            }
            point={navigation[key]}
            disabled={!ready}
            disabledReason={
              loading
                ? "Загружаем места маршрута."
                : "Не удалось загрузить места. Повторите загрузку."
            }
            onOpen={() => setTarget(key)}
            onChoose={(point, label) => choose(key, point, label)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <FieldSelect
          aria-label="Точка на карте"
          value={target}
          onValueChange={(value) => setTarget(value as "start" | "end")}
          options={[
            { value: "start", label: "Поставить отправление" },
            { value: "end", label: "Поставить прибытие" },
          ]}
        />
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {pending
            ? "Строим дорогу…"
            : navigation.distanceMeters
              ? `${(navigation.distanceMeters / 1000).toFixed(1)} км`
              : null}
        </span>
      </div>
      {ready ? (
        <div className="isolate overflow-hidden rounded-xl border">
          <RoadMap
            navigation={navigation}
            onChoose={(point) => choose(target, point, "Точка на карте")}
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
              } else
                void autosave.commit({
                  start: navigation.start,
                  end: navigation.end,
                  startLabel: navigation.startLabel ?? "",
                  endLabel: navigation.endLabel ?? "",
                })
            }}
          >
            Повторить
          </Button>
        </div>
      ) : null}
    </div>
  )
}
