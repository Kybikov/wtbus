"use client"

import * as React from "react"
import { toast } from "sonner"
import { LoaderCircle, RefreshCw } from "lucide-react"
import { sessionFetch } from "@/lib/session-navigation"
import type { EntityCollection } from "@/lib/entity-views"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { HoldActionButton } from "@/components/ui/hold-action-button"
import { AdminNotice } from "@/components/admin-notice"

const removable = new Set<EntityCollection>([
  "customers",
  "bookings",
  "trips",
  "routes",
  "fleet",
  "requests",
  "availability",
  "team",
])
type Preview = {
  token: string
  effects: { label: string; count: number; operation: "delete" | "unlink" }[]
}

export function useRecordDeletion(
  entity: EntityCollection,
  onDeleted: (id: string) => void
) {
  const [developer, setDeveloper] = React.useState(false)
  const [target, setTarget] = React.useState<{
    id: string
    label: string
  } | null>(null)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [revision, setRevision] = React.useState(0)
  const pending = React.useRef(false)
  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/auth/me", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const identity = await response.json()
        if (!controller.signal.aborted)
          setDeveloper(response.ok && identity.role === "developer")
      })
      .catch(() => {
        /* Fail closed; the server independently enforces the role. */
      })
    return () => controller.abort()
  }, [])
  React.useEffect(() => {
    if (!target) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      setPreview(null)
      setError(null)
      if (entity === "team") {
        setPreview({
          token: "team",
          effects: [
            {
              label: "Доступ сотрудника к компании",
              count: 1,
              operation: "delete",
            },
          ],
        })
        setLoading(false)
        return
      }
      void sessionFetch(
        `/api/entity-details/${entity}/${encodeURIComponent(target.id)}/deletion`,
        { cache: "no-store", signal: controller.signal }
      )
        .then(async (response) => {
          const payload = await response.json()
          if (!response.ok)
            throw Error(
              payload.error ?? "Не удалось проверить связанные записи."
            )
          if (!controller.signal.aborted) setPreview(payload)
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error
                ? reason.message
                : "Не удалось проверить состав удаления."
            )
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 0)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [entity, target, revision])
  async function remove() {
    if (!target || !preview || loading || pending.current) return
    pending.current = true
    setDeleting(true)
    setError(null)
    try {
      const response = await sessionFetch(
        entity === "team"
          ? `/api/team?id=${encodeURIComponent(target.id)}`
          : `/api/entity-details/${entity}/${encodeURIComponent(target.id)}/deletion`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: preview.token }),
        }
      )
      const payload = await response.json()
      if (!response.ok)
        throw Error(payload.error ?? "Не удалось удалить запись.")
      const id = target.id
      setTarget(null)
      toast.success("Запись удалена")
      window.dispatchEvent(
        new CustomEvent("vivat-record-deleted", { detail: { entity, id } })
      )
      onDeleted(id)
    } catch (reason) {
      setPreview(null)
      setError(
        reason instanceof Error ? reason.message : "Не удалось удалить запись."
      )
    } finally {
      pending.current = false
      setDeleting(false)
    }
  }
  const available = developer && removable.has(entity)
  return {
    available,
    open(id: string, label: string) {
      if (!available || pending.current) return
      setPreview(null)
      setError(null)
      setLoading(true)
      setTarget({ id, label })
    },
    dialog: (
      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !pending.current) setTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить запись?</DialogTitle>
            <DialogDescription>
              {target?.label}. Удаление необратимо. Проверьте связанные записи
              перед подтверждением.
            </DialogDescription>
          </DialogHeader>
          <AdminNotice message={error} variant="error" />
          {loading ? (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              Проверяем связанные записи…
            </p>
          ) : preview ? (
            <>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {preview.effects.map((effect, index) => (
                  <li
                    key={index}
                    className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm"
                  >
                    <span
                      className={
                        effect.operation === "delete"
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {effect.label}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {effect.count}
                    </span>
                  </li>
                ))}
              </ul>
              {preview.effects.some(
                (effect) => effect.label === "Платёжные записи в CRM"
              ) && (
                <p className="text-sm text-muted-foreground">
                  Платёжные записи удалятся из CRM. Банковские переводы не
                  отменяются, деньги не возвращаются.
                </p>
              )}
              {entity === "trips" && (
                <p className="text-sm text-muted-foreground">
                  Денежные операции водителя, расходы и история GPS сохранятся.
                </p>
              )}
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw />
              Обновить состав удаления
            </Button>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              disabledReason="Запись удаляется. Дождитесь завершения."
              onClick={() => setTarget(null)}
            >
              Отмена
            </Button>
            <HoldActionButton
              key={preview?.token ?? "waiting"}
              disabled={loading || deleting || !preview}
              disabledReason={
                deleting
                  ? "Запись удаляется. Дождитесь завершения."
                  : loading
                    ? "Дождитесь проверки связанных записей."
                    : "Обновите состав удаления перед подтверждением."
              }
              onConfirm={() => void remove()}
            >
              {deleting ? "Удаляем…" : "Удалить"}
            </HoldActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  }
}
