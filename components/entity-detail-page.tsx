"use client"
import * as React from "react"
import Link from "next/link"
import { Copy, ArrowUpRight, List } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import EntityDetailContent from "@/components/app-dialog-6"
import EntityActivityTimeline from "@/components/billing-8"
import {
  EntityRelatedRecords,
  type EntityRelatedRecord,
} from "@/components/entity-related-records"
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
  related: EntityRelatedRecord[]
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
        ref.entity in entityNames &&
        (!("meta" in ref) ||
          (typeof ref.meta === "object" &&
            ref.meta !== null &&
            !Array.isArray(ref.meta)))
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
    setLoading(true)
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
    ? Array.from(
        new Map(
          [
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
          ].map((relation) => [`${relation.entity}:${relation.id}`, relation])
        ).values()
      )
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
      {loading && !detail ? (
        <div
          className="grid gap-3 lg:grid-cols-2"
          aria-label="Загрузка деталей"
          aria-busy="true"
        >
          <Skeleton className="h-72 w-full lg:col-span-2" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : detail ? (
        <EntityDetailContent
          overview={
            <dl className="min-w-0 divide-y divide-border/70">
              {Object.entries(detail.item)
                .filter(
                  ([key]) => key !== "custom_data" && key !== "last_location"
                )
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="grid min-w-0 gap-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(8rem,0.38fr)_minmax(0,1fr)] sm:gap-5"
                  >
                    <dt className="text-xs leading-5 text-muted-foreground">
                      {entityFieldLabels[key] ??
                        (relationFields[key]
                          ? entityNames[relationFields[key]]
                          : key.replaceAll("_", " "))}
                    </dt>
                    <dd className="text-sm leading-5 font-medium [overflow-wrap:anywhere] break-words">
                      {fieldValue(key, value)}
                    </dd>
                  </div>
                ))}
              {detail.item.custom_data &&
              Object.keys(detail.item.custom_data as object).length ? (
                <div className="grid min-w-0 gap-2 py-3 first:pt-0 last:pb-0">
                  <dt className="text-xs text-muted-foreground">
                    Дополнительные данные и пассажиры
                  </dt>
                  <dd>{fieldValue("custom_data", detail.item.custom_data)}</dd>
                </div>
              ) : null}
              {detail.item.last_location ? (
                <div className="grid min-w-0 gap-2 py-3 first:pt-0 last:pb-0">
                  <dt className="text-xs text-muted-foreground">
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
            <EntityRelatedRecords
              ownerEntity={entity}
              records={relations}
              timezone={detail.timezone}
            />
          }
          activity={
            <EntityActivityTimeline
              events={detail.activity}
              timezone={detail.timezone}
            />
          }
        />
      ) : null}
    </AppShell>
  )
}
