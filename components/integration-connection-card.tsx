"use client"
import { HoldActionButton } from "@/components/ui/hold-action-button"

import * as React from "react"
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

// Adapted from React Bits Pro integrations-2/3 using workspace primitives.
export function IntegrationConnectionCard({
  name,
  description,
  icon,
  configured,
  disabled,
  saving,
  onSave,
  onRemove,
  preview,
  test,
  children,
}: {
  preview?: string
  test: React.ReactNode
  children?: React.ReactNode
  name: string
  description: string
  icon: React.ReactNode
  configured: boolean
  disabled: boolean
  saving: boolean
  onSave: (token: string) => Promise<boolean>
  onRemove: () => Promise<boolean>
}) {
  const id = React.useId()
  const [token, setToken] = React.useState("")
  const [revealed, setRevealed] = React.useState(false)
  const [confirmRemove, setConfirmRemove] = React.useState(false)
  const submitting = React.useRef(false)
  async function submit() {
    const submitted = token.trim()
    if (!submitted || saving || disabled || submitting.current) return
    submitting.current = true
    try {
      if (await onSave(submitted)) {
        setToken((current) => (current.trim() === submitted ? "" : current))
        setRevealed(false)
      }
    } finally {
      submitting.current = false
    }
  }
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-background/30 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{name}</h3>
        </div>
        <Badge variant="secondary">
          {configured ? <Check /> : <KeyRound />}
          {configured ? "Ключ сохранён" : "Не настроено"}
        </Badge>
      </div>
      <p className="mt-3 min-h-10 text-sm leading-5 text-muted-foreground">
        {description}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="mt-5 flex flex-1 flex-col"
      >
        <label htmlFor={id} className="mb-2 text-sm font-medium">
          API-токен
        </label>
        <InputGroup>
          <InputGroupInput
            id={id}
            autoComplete="new-password"
            spellCheck={false}
            disabled={disabled || saving}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onBlur={(event) => {
              if (
                !(event.relatedTarget instanceof Element) ||
                event.relatedTarget
                  .closest("[data-token-reveal]")
                  ?.getAttribute("data-token-reveal") !== id
              )
                void submit()
            }}
            type={revealed ? "text" : "password"}
            placeholder={
              configured ? (preview ?? "••••••••") : "Вставьте токен"
            }
          />
          <InputGroupAddon align="inline-end">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || saving}
              aria-label={
                revealed ? `Скрыть токен ${name}` : `Показать токен ${name}`
              }
              onBlur={(event) => {
                if (
                  !(event.relatedTarget instanceof HTMLInputElement) ||
                  event.relatedTarget.id !== id
                )
                  void submit()
              }}
              data-token-reveal={id}
              aria-pressed={revealed}
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </Button>
          </InputGroupAddon>
        </InputGroup>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {configured
            ? "Для замены введите новый ключ."
            : "Добавьте ключ для подключения."}
        </p>
        {children}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
          <div inert={!!token.trim()}>{test}</div>
          <div className="flex items-center gap-2">
            {configured ? (
              <Button
                type="button"
                aria-label={`Удалить ключ ${name}`}
                size="icon"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={disabled || saving}
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 />
              </Button>
            ) : (
              <span />
            )}
          </div>
        </div>
      </form>
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить ключ {name}?</DialogTitle>
            <DialogDescription>
              Интеграция перестанет работать до добавления нового ключа.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setConfirmRemove(false)}
            >
              Отмена
            </Button>
            <HoldActionButton
              disabled={saving}
              onConfirm={() =>
                void onRemove().then((removed) => {
                  if (removed) setConfirmRemove(false)
                })
              }
            >
              {saving ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              Удалить ключ
            </HoldActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
