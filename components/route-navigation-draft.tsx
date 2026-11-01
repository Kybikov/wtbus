"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { RoutePlacePicker } from "@/components/route-place-picker"
import { FieldSelect } from "@/components/ui/field-select"
import { Button } from "@/components/ui/button"
import type {
  RoadPoint,
  RouteNavigation,
} from "@/components/route-navigation-editor"
import { sessionFetch } from "@/lib/session-navigation"

const RoadMap = dynamic(
  () =>
    import("@/components/route-navigation-map").then(
      (m) => m.RouteNavigationMap
    ),
  { ssr: false }
)

export function RouteNavigationDraft({
  value,
  onChange,
  onBusyChange,
}: {
  value: RouteNavigation
  onChange: (value: RouteNavigation) => void
  onBusyChange: (busy: boolean) => void
}) {
  const [target, setTarget] = React.useState<"start" | "end">("start")
  const [error, setError] = React.useState<string | null>(null)
  const [retry, setRetry] = React.useState(0)
  const latest = React.useRef({ value, onChange, onBusyChange })
  React.useLayoutEffect(() => {
    latest.current = { value, onChange, onBusyChange }
  })
  const selection = JSON.stringify([
    value.start,
    value.end,
    value.startLabel,
    value.endLabel,
  ])
  React.useEffect(() => {
    const current = latest.current.value
    if (!current.start || !current.end) {
      latest.current.onBusyChange(false)
      return
    }
    const controller = new AbortController()
    let active = true
    latest.current.onBusyChange(true)
    void sessionFetch("/api/routes/navigation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        start: current.start,
        end: current.end,
        startLabel: current.startLabel,
        endLabel: current.endLabel,
      }),
    })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok)
          throw new Error(payload.error || "Не удалось построить дорогу.")
        if (active) {
          latest.current.onChange(payload.navigation)
          setError(null)
        }
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось построить дорогу."
          )
      })
      .finally(() => {
        if (active) latest.current.onBusyChange(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [selection, retry])
  function choose(
    key: "start" | "end",
    point: RoadPoint | null,
    label: string
  ) {
    setError(null)
    onChange({
      ...value,
      [key]: point,
      [key === "start" ? "startLabel" : "endLabel"]: label,
      coordinates: undefined,
      distanceMeters: undefined,
    })
  }
  return (
    <div className="min-w-0 space-y-3 md:col-span-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["start", "end"] as const).map((key) => (
          <RoutePlacePicker
            key={key}
            title={key === "start" ? "Отправление" : "Прибытие"}
            label={key === "start" ? value.startLabel : value.endLabel}
            point={value[key]}
            disabled={false}
            disabledReason=""
            onOpen={() => setTarget(key)}
            onChoose={(point, label) => choose(key, point, label)}
          />
        ))}
      </div>
      <FieldSelect
        aria-label="Точка на карте"
        value={target}
        onValueChange={(v) => setTarget(v as "start" | "end")}
        options={[
          { value: "start", label: "Поставить отправление" },
          { value: "end", label: "Поставить прибытие" },
        ]}
      />
      <div className="isolate overflow-hidden rounded-xl border">
        <RoadMap
          navigation={value}
          onChoose={(point) => choose(target, point, "Точка на карте")}
        />
      </div>
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-destructive"
        >
          {error}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRetry((n) => n + 1)}
          >
            Повторить
          </Button>
        </div>
      ) : null}
    </div>
  )
}
