"use client"

import dynamic from "next/dynamic"

export type FleetMapPosition = {
  id: string
  name: string
  latitude: number
  longitude: number
  recordedAt: string
  stale?: boolean
}

const LiveFleetLocationMap = dynamic(
  () =>
    import("@/components/fleet-location-map-live").then(
      (module) => module.LiveFleetLocationMap
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-72 place-items-center bg-muted/35 px-5 text-sm text-muted-foreground">
        Загружаем интерактивную карту…
      </div>
    ),
  }
)

function relativeTime(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} ч назад` : `${Math.floor(hours / 24)} дн назад`
}

export function FleetLocationMap({ points }: { points: FleetMapPosition[] }) {
  if (!points.length) {
    return (
      <section className="surface-card p-5">
        <h2 className="font-bold">Карта автопарка</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Машины появятся на карте после первой GPS-точки из водительского PWA.
        </p>
      </section>
    )
  }

  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-col justify-between gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-bold">Карта автопарка</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Перетаскивайте карту, масштабируйте её и открывайте маркеры машин.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          OpenStreetMap · обновление 30 с
        </p>
      </div>
      <LiveFleetLocationMap points={points} />
      <div className="flex flex-wrap gap-x-5 gap-y-2 px-5 py-3 text-xs text-muted-foreground">
        {points.map((point) => (
          <span className="inline-flex items-center gap-2" key={point.id}>
            <span className="size-2 rounded-full bg-primary" />
            {point.name} · {relativeTime(point.recordedAt)}
          </span>
        ))}
      </div>
    </section>
  )
}
