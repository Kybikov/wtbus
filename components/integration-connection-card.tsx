"use client"

import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Save,
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
}: {
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
  const reduce = useReducedMotion()
  const [token, setToken] = React.useState("")
  const [revealed, setRevealed] = React.useState(false)
  const [confirmRemove, setConfirmRemove] = React.useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (await onSave(token.trim())) {
      setToken("")
      setRevealed(false)
    }
  }
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-background/30 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-control text-foreground">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{name}</h3>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-4" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={String(configured)}
            initial={reduce ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.15 }}
          >
            <Badge
              variant="secondary"
              className={
                configured
                  ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
                  : ""
              }
            >
              {configured ? <Check /> : <KeyRound />}
              {configured ? "Ключ сохранён" : "Не настроено"}
            </Badge>
          </motion.div>
        </AnimatePresence>
      </div>
      <form
        onSubmit={(event) => void submit(event)}
        className="mt-5 flex flex-1 flex-col"
      >
        <label htmlFor={id} className="mb-2 text-sm font-medium">
          {configured ? "Новый API-токен" : "API-токен"}
        </label>
        <InputGroup>
          <InputGroupInput
            id={id}
            autoComplete="new-password"
            spellCheck={false}
            disabled={disabled || saving}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            type={revealed ? "text" : "password"}
            placeholder={
              configured ? "Вставьте токен для замены" : "Вставьте токен"
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
              aria-pressed={revealed}
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </Button>
          </InputGroupAddon>
        </InputGroup>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Сохранённый ключ скрыт. Пустое поле сохраняет текущий ключ.
        </p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
          {configured ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={disabled || saving}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 />
              Удалить
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={disabled || saving || !token.trim()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {saving
              ? "Сохраняем…"
              : configured
                ? "Заменить ключ"
                : "Сохранить ключ"}
          </Button>
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
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() =>
                void onRemove().then((removed) => {
                  if (removed) setConfirmRemove(false)
                })
              }
            >
              {saving ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              Удалить ключ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
