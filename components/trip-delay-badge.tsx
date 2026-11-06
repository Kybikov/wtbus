import { Badge } from "@/components/ui/badge"
import type { TripOperations } from "@/lib/trip-operations"

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
