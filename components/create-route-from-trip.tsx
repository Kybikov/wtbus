"use client"
import * as React from "react"
import { Route } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { sessionFetch } from "@/lib/session-navigation"
import { useRouter } from "next/navigation"

export function CreateRouteFromTrip({
  tripId,
  origin,
  destination,
  pricingMode,
  status,
  busy,
  onCreated,
}: {
  tripId: string
  origin: string
  destination: string
  pricingMode: string
  status: string
  busy: boolean
  onCreated: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false),
    [name, setName] = React.useState(""),
    [saving, setSaving] = React.useState(false),
    [error, setError] = React.useState("")
  const editable = !["in_progress", "completed", "cancelled"].includes(status)
  async function create() {
    if (saving || !name.trim()) return
    setSaving(true)
    setError("")
    try {
      const response = await sessionFetch(
        `/api/trips/route-from-trip?${new URLSearchParams({ tripId })}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        }
      )
      const data = await response.json()
      if (!response.ok || !data.routeId)
        throw Error(data.error ?? "Не удалось создать маршрут.")
      setOpen(false)
      onCreated()
      router.refresh()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось создать маршрут."
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !editable}
        disabledReason={
          busy
            ? "Дождитесь сохранения рейса."
            : "Маршрут можно создать до начала рейса."
        }
        onClick={() => {
          setName(`${origin} — ${destination}`)
          setError("")
          setOpen(true)
        }}
      >
        <Route />
        Создать маршрут
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Маршрут из рейса</DialogTitle>
            <DialogDescription>
              Рейс станет регулярным. Точки, цена и зарплата сохранятся в
              маршруте.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm">
            Название
            <Input
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {pricingMode !== "per_passenger" ? (
            <p className="text-sm text-muted-foreground">
              Для онлайн-бронирования выберите в рейсе цену за пассажира.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              disabledReason="Маршрут создаётся. Дождитесь результата."
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button
              disabled={saving || !name.trim()}
              disabledReason={
                saving
                  ? "Маршрут создаётся. Дождитесь результата."
                  : "Введите название маршрута."
              }
              onClick={() => void create()}
            >
              {saving ? "Создаём…" : "Создать маршрут"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
