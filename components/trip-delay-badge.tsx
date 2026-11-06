import { Badge } from "@/components/ui/badge"
import type { TripOperations } from "@/lib/trip-operations"

export function TripDelaySummary({
  operations,
}: {
  operations?: TripOperations
}) {
  if (!operations)
    return <span className="text-muted-foreground">Нет данных</span>
  if (!operations.departureDelayed && !operations.arrivalDelayed)
    return (
      <span className="text-emerald-700 dark:text-emerald-400">
        Без задержки
      </span>
    )
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <TripDelayBadge operations={operations} />
    </span>
  )
}

export function TripDelayBadge({
  operations,
}: {
  operations?: TripOperations
}) {
  if (!operations) return null
  return (
    <>
      {operations.departureDelayed && (
        <Badge
          variant="secondary"
          className="bg-red-500/12 text-red-700 dark:text-red-400"
          title={
            operations.departedAt
              ? "Отклонение фактического выезда от расписания"
              : "Плановое время выезда прошло, фактический выезд ещё не отмечен"
          }
        >
          {operations.departedAt ? "Выехал" : "Выезд"} +
          {operations.departureDelayMinutes} мин
        </Badge>
      )}
      {operations.arrivalDelayed && (
        <Badge
          variant="secondary"
          className="bg-red-500/12 text-red-700 dark:text-red-400"
        >
          {operations.completedAt ? "Прибыл" : "Прибытие"} +
          {operations.arrivalDelayMinutes} мин
        </Badge>
      )}
    </>
  )
}
