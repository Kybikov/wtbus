"use client"

export function RouteDistanceField({
  meters,
  pending = false,
}: {
  meters?: number
  pending?: boolean
}) {
  return (
    <dl className="grid min-w-0 grid-cols-[minmax(0,.7fr)_minmax(0,1fr)] items-center gap-3 border-y border-border/50 py-3">
      <dt className="text-xs text-muted-foreground">Расстояние по дороге</dt>
      <dd className="text-sm font-medium">
        <output aria-label="Расстояние по дороге" aria-live="polite">
          {pending
            ? "Рассчитываем…"
            : typeof meters === "number" && Number.isFinite(meters)
              ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(meters / 1000)} км`
              : "—"}
        </output>
      </dd>
    </dl>
  )
}
