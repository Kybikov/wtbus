"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useActionConfirmation } from "@/components/action-confirmation"
import { sessionFetch } from "@/lib/session-navigation"
import type { TripOperations } from "@/lib/trip-operations"

export function TripEarlyDeparture({
  tripId,
  operations,
  busy,
  onUpdated,
  onError,
}: {
  tripId: string
  operations?: TripOperations
  busy: boolean
  onUpdated: () => void
  onError: (message: string) => void
}) {
  const [approving, setApproving] = useState(false)
  const confirm = useActionConfirmation()
  if (operations?.earlyDepartureApproved)
    return (
      <Badge className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
        Ранний выезд разрешён
      </Badge>
    )
  if (!operations?.canApproveEarlyDeparture) return null
  async function approve() {
    if (
      !(await confirm({
        title: "Разрешить ранний выезд?",
        description: `В рейсе забронировано мест: ${operations?.activeSeats ?? 0}. Разрешение позволит водителю выехать до расписания, даже если не все пассажиры на месте. После изменения автомобиля, водителя, времени выезда или бронирований его нужно подтвердить заново.`,
        label: "Разрешить выезд",
        tone: "archive",
      }))
    )
      return
    setApproving(true)
    try {
      const response = await sessionFetch(
        `/api/trips?id=${encodeURIComponent(tripId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve_early_departure" }),
        }
      )
      const data = await response.json()
      if (!response.ok)
        throw Error(data.error ?? "Не удалось разрешить ранний выезд.")
      onUpdated()
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Не удалось разрешить ранний выезд."
      )
    } finally {
      setApproving(false)
    }
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void approve()}
      disabled={busy || approving}
      disabledReason={
        busy
          ? "Дождитесь сохранения изменений рейса."
          : "Разрешение сохраняется. Дождитесь завершения."
      }
    >
      Разрешить ранний выезд
    </Button>
  )
}
