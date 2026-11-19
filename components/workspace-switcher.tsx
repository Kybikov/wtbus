"use client"

import * as React from "react"
import { Building2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { openWorkspace, sessionFetch } from "@/lib/session-navigation"

type Choice = { slug: string; name: string; role: string }
type Workspaces = { current: string; items: Choice[] }

export function WorkspaceSwitcher({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [data, setData] = React.useState<Workspaces>()
  const [error, setError] = React.useState("")
  const [switching, setSwitching] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    async function load() {
      try {
        const response = await sessionFetch("/api/auth/workspaces", {
          signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok) throw Error(payload.error)
        if (!controller.signal.aborted) setData(payload)
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить компании."
          )
      }
    }
    void load()
    return () => controller.abort()
  }, [open])

  async function switchTo(slug: string) {
    if (switching) return
    setSwitching(true)
    setError("")
    try {
      await openWorkspace(slug)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сменить компанию."
      )
      setSwitching(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (switching) return
        if (!value) {
          setData(undefined)
          setError("")
        }
        onOpenChange(value)
      }}
    >
      <DialogContent showCloseButton={!switching}>
        <DialogHeader>
          <DialogTitle className="pr-8">Рабочие пространства</DialogTitle>
          <DialogDescription>
            Выберите компанию, в которой хотите работать.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {!data && !error ? <p role="status">Загружаем компании…</p> : null}
        <div className="max-h-[50dvh] space-y-1 overflow-y-auto">
          {data?.items.map((item) => (
            <Button
              key={item.slug}
              type="button"
              variant="ghost"
              className="h-auto min-h-10 w-full justify-start text-left"
              disabled={switching || item.slug === data.current}
              disabledReason={
                switching
                  ? "Выполняется переключение."
                  : "Это текущая компания."
              }
              onClick={() => void switchTo(item.slug)}
            >
              <Building2 className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words whitespace-normal">
                {item.name}
              </span>
              {item.slug === data.current ? (
                <Check className="text-emerald-500" />
              ) : null}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
