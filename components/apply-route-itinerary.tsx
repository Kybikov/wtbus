"use client"

import * as React from "react"
import { CalendarSync } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { sessionFetch } from "@/lib/session-navigation"

type Preview = {
  token: string
  templateVersion: string
  ready: number
  unchanged: number
  skipped: Record<string, number>
}

const reasons: Record<string, string> = {
  bookings: "Забронированы другие остановки",
  settings: "Другой маршрут, валюта или тип тарифа",
  schedule: "Остановки выходят за время рейса",
  navigation: "Особые точки на карте рейса",
}

export function ApplyRouteItinerary({
  url,
  templateVersion,
  disabledReason,
}: {
  url: string
  templateVersion: string
  disabledReason?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [busy, setBusy] = React.useState<"loading" | "saving" | null>(null)
  const [error, setError] = React.useState("")
  const endpoint = `${url}&apply=1`
  const changed = preview && preview.templateVersion !== templateVersion
  const actionReason =
    busy === "loading"
      ? "Загружаем список рейсов."
      : busy === "saving"
        ? "Изменения применяются к рейсам."
        : disabledReason ||
          (changed
            ? "Шаблон изменился. Обновите страницу и проверьте остановки и цены."
            : !preview?.ready
              ? "Нет рейсов для обновления."
              : undefined)

  async function load() {
    setPreview(null)
    setError("")
    setBusy("loading")
    try {
      const response = await sessionFetch(endpoint)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setPreview(data)
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : "Не удалось загрузить рейсы."
      )
    } finally {
      setBusy(null)
    }
  }

  async function apply() {
    if (!preview || actionReason) return
    setBusy("saving")
    setError("")
    try {
      const response = await sessionFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: preview.token }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (data.preview) setPreview(data.preview)
        throw new Error(data.error)
      }
      setOpen(false)
      toast.success(`Обновлено рейсов: ${data.updated}`)
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : "Не удалось применить изменения."
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={Boolean(disabledReason)}
        disabledReason={disabledReason}
        onClick={() => {
          setOpen(true)
          void load()
        }}
      >
        <CalendarSync />
        Применить к будущим рейсам
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle className="pr-7">Обновить будущие рейсы</DialogTitle>
            <DialogDescription>
              Сохранённый шаблон заменит остановки и тарифы по участкам в
              подходящих рейсах. Цены оформленных броней зафиксированы.
            </DialogDescription>
          </DialogHeader>
          {busy === "loading" ? <p role="status">Проверяем рейсы…</p> : null}
          {preview ? (
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
              <dt className="font-medium">Будут обновлены</dt>
              <dd className="font-semibold tabular-nums">{preview.ready}</dd>
              <dt>Уже совпадают с шаблоном</dt>
              <dd className="tabular-nums">{preview.unchanged}</dd>
              {Object.entries(preview.skipped).map(([key, count]) => (
                <React.Fragment key={key}>
                  <dt className="text-muted-foreground">
                    {reasons[key] ?? "Пропущены"}
                  </dt>
                  <dd className="tabular-nums">{count}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            {(error || changed) && !busy ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (changed) window.location.reload()
                  else void load()
                }}
              >
                {changed ? "Обновить страницу" : "Обновить список"}
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={Boolean(actionReason)}
              disabledReason={actionReason}
              onClick={() => void apply()}
            >
              {busy === "saving" ? "Применяем…" : "Применить изменения"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
