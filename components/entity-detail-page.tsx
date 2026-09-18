"use client"
import * as React from "react"
import Link from "next/link"
import { Copy, ArrowUpRight, List } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import EntityDetailContent from "@/components/app-dialog-6"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { sessionFetch } from "@/lib/session-navigation"
import {
  entityDetailHref,
  entityNames,
  entityFieldLabels,
  relationFields,
  valueLabels,
} from "@/lib/entity-details"
import { formatEntityDate, statusToneClass } from "@/lib/entity-columns"
import type { EntityCollection } from "@/lib/entity-views"

type Detail = {
  item: Record<string, unknown>
  timezone: string
  related: { id: string; entity: EntityCollection; label: string }[]
  activity: { action: string; actor: string; kind: string; createdAt: string }[]
}
function isDetail(value: unknown): value is Detail {
  if (typeof value !== "object" || value === null) return false
  const d = value as Partial<Detail>
  return (
    typeof d.item === "object" &&
    d.item !== null &&
    !Array.isArray(d.item) &&
    typeof d.timezone === "string" &&
    Array.isArray(d.related) &&
    d.related.every(
      (ref) =>
        typeof ref.id === "string" &&
        typeof ref.label === "string" &&
        ref.entity in entityNames
    ) &&
    Array.isArray(d.activity) &&
    d.activity.every(
      (event) =>
        typeof event.action === "string" &&
        typeof event.actor === "string" &&
        typeof event.kind === "string" &&
        typeof event.createdAt === "string"
    )
  )
}
export function EntityDetailPage({
  entity,
  id,
}: {
  entity: EntityCollection
  id: string
}) {
  const requestController = React.useRef<AbortController | null>(null)
  const [detail, setDetail] = React.useState<Detail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const load = React.useCallback(async () => {
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setDetail(null)
    setLoading(true)
    setCopied(false)
    setError(null)
    try {
      const response = await sessionFetch(
        `/api/entity-details/${entity}/${encodeURIComponent(id)}`,
        { cache: "no-store", signal: controller.signal }
      )
      const payload = await response.json()
      if (!response.ok || !isDetail(payload))
        throw new Error(payload.error ?? "Не удалось загрузить запись.")
      if (!controller.signal.aborted) setDetail(payload)
    } catch (reason) {
      if (controller.signal.aborted) return
      setDetail(null)
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить запись."
      )
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [entity, id])
  React.useEffect(() => {
    const timer = setTimeout(() => void load(), 0)
    return () => {
      clearTimeout(timer)
      requestController.current?.abort()
    }
  }, [load])
  const item = detail?.item
  const title = item
    ? String(
        item.name ??
          item.full_name ??
          item.display_name ??
          item.passenger_name ??
          item.customer_name ??
          (item.origin_name
            ? `${item.origin_name} → ${item.destination_name}`
            : entityNames[entity])
      )
    : entityNames[entity]
  function fieldValue(key: string, value: unknown): React.ReactNode {
    if (value === null || value === undefined || value === "")
      return <span className="text-muted-foreground">—</span>
    if (relationFields[key] && typeof value === "string")
      return (
        <Link
          className="inline-flex items-center gap-1 text-primary hover:underline"
          href={entityDetailHref(relationFields[key], value)}
        >
          {entityNames[relationFields[key]]}
          <ArrowUpRight className="size-3" />
        </Link>
      )
    if (typeof value === "boolean")
      return (
        <Badge
          variant="secondary"
          className={statusToneClass(value ? "success" : "neutral")}
        >
          {value ? "Да" : "Нет"}
        </Badge>
      )
    if (key.endsWith("_minor") && typeof value === "number")
      return new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: String(item?.currency ?? "EUR"),
      }).format(value / 100)
    if (key.endsWith("_at") || key.endsWith("_date"))
      return formatEntityDate(String(value), detail?.timezone)
    if (Array.isArray(value))
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {value.map((entry, index) => (
            <div key={index} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-semibold">Пассажир {index + 1}</p>
              {fieldValue("passenger", entry)}
            </div>
          ))}
        </div>
      )
    if (typeof value === "object")
      return (
        <dl className="grid gap-3">
          {Object.entries(value).map(([field, entry]) => (
            <div key={field} className="min-w-0">
              <dt className="mb-1 text-xs text-muted-foreground">
                {entityFieldLabels[field] ?? field.replaceAll("_", " ")}
              </dt>
              <dd className="text-sm break-words">
                {fieldValue(field, entry)}
              </dd>
            </div>
          ))}
        </dl>
      )
    if (key === "status" || key === "payment_status" || key === "role")
      return (
        <Badge
          variant="secondary"
          className={statusToneClass(
            ["confirmed", "completed", "paid", "closed"].includes(String(value))
              ? "success"
              : ["cancelled", "failed", "expired"].includes(String(value))
                ? "danger"
                : "info"
          )}
        >
          {valueLabels[String(value)] ?? String(value)}
        </Badge>
      )
    return [
      "kind",
      "source",
      "payment_method",
      "pricing_mode",
      "default_pricing_mode",
    ].includes(key)
      ? (valueLabels[String(value)] ?? String(value))
      : String(value)
  }
  const relations = detail
    ? [
        ...Object.entries(relationFields).flatMap(([key, collection]) =>
          typeof item?.[key] === "string"
            ? [
                {
                  id: String(item[key]),
                  entity: collection,
                  label: entityNames[collection],
                },
              ]
            : []
        ),
        ...detail.related,
      ]
    : []
  return (
    <AppShell
      pageTitle={title}
      pageDescription={`${entityNames[entity]} · данные, связанные записи и история`}
      onRefresh={load}
      refreshing={loading}
      pageActions={
        <>
          <Button
            variant="outline"
            size="sm"
            aria-label="Открыть раздел"
            render={<Link href={`/${entity}`} />}
          >
            <List className="size-4" />В раздел
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!item}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  String(item?.reference ?? id)
                )
                setCopied(true)
              } catch {
                setError("Не удалось скопировать ID.")
              }
            }}
          >
            <Copy className="size-4" />
            {copied ? "Скопировано" : "Копировать ID"}
          </Button>
        </>
      }
    >
      {error ? (
        <div role="alert" className="workspace-panel mb-3 p-4 text-destructive">
          {error}
          <Button
            variant="outline"
            className="ml-3"
            onClick={() => void load()}
          >
            Повторить
          </Button>
        </div>
      ) : null}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : detail ? (
        <EntityDetailContent
          overview={
            <dl className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(detail.item)
                .filter(
                  ([key]) => key !== "custom_data" && key !== "last_location"
                )
                .map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="mb-1 text-xs text-muted-foreground">
                      {entityFieldLabels[key] ??
                        (relationFields[key]
                          ? entityNames[relationFields[key]]
                          : key.replaceAll("_", " "))}
                    </dt>
                    <dd className="text-sm font-medium [overflow-wrap:anywhere] break-words">
                      {fieldValue(key, value)}
                    </dd>
                  </div>
                ))}
              {detail.item.custom_data &&
              Object.keys(detail.item.custom_data as object).length ? (
                <div className="col-span-full">
                  <dt className="mb-2 text-sm font-semibold">
                    Дополнительные данные и пассажиры
                  </dt>
                  <dd>{fieldValue("custom_data", detail.item.custom_data)}</dd>
                </div>
              ) : null}
              {detail.item.last_location ? (
                <div className="col-span-full">
                  <dt className="mb-2 text-sm font-semibold">
                    Последняя GPS-точка
                  </dt>
                  <dd>
                    {fieldValue("last_location", detail.item.last_location)}
                    <Button
                      variant="link"
                      render={
                        <a
                          target="_blank"
                          rel="noopener noreferrer"
                          href={`https://www.google.com/maps/search/?api=1&query=${(detail.item.last_location as Record<string, unknown>).latitude},${(detail.item.last_location as Record<string, unknown>).longitude}`}
                        />
                      }
                    >
                      Открыть Google Maps
                      <ArrowUpRight />
                    </Button>
                  </dd>
                </div>
              ) : null}
            </dl>
          }
          related={
            <div className="space-y-2">
              {relations.length ? (
                relations.map((ref, index) => (
                  <Button
                    key={`${ref.entity}:${ref.id}:${index}`}
                    variant="outline"
                    className="h-auto min-h-9 w-full justify-between text-left whitespace-normal"
                    render={
                      <Link href={entityDetailHref(ref.entity, ref.id)} />
                    }
                  >
                    {ref.label}
                    <ArrowUpRight className="size-4 shrink-0" />
                  </Button>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Связанных записей пока нет.
                </p>
              )}
            </div>
          }
          activity={
            <ol className="space-y-4">
              {detail.activity.length ? (
                detail.activity.map((event, index) => (
                  <li key={index} className="border-l-2 border-border pl-4">
                    <p className="text-sm font-medium">
                      {event.action === "public_booking_created"
                        ? "Бронирование создано на сайте"
                        : event.action.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {event.actor} ·{" "}
                      {event.kind === "system" ? "Автоматизация · " : ""}
                      {formatEntityDate(event.createdAt, detail.timezone)}
                    </p>
                  </li>
                ))
              ) : (
                <li className="text-sm text-muted-foreground">
                  Действий пока не зарегистрировано.
                </li>
              )}
            </ol>
          }
        />
      ) : null}
    </AppShell>
  )
}
