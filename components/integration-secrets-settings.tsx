"use client"

import * as React from "react"
import { CheckCircle2, Eye, EyeOff, KeyRound, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { sessionFetch } from "@/lib/session-navigation"

type State = {
  monobankConfigured: boolean
  telegramBotConfigured: boolean
}

const emptyState: State = {
  monobankConfigured: false,
  telegramBotConfigured: false,
}

export function IntegrationSecretsSettings({
  disabled,
}: {
  disabled: boolean
}) {
  const [state, setState] = React.useState(emptyState)
  const [monobankToken, setMonobankToken] = React.useState("")
  const [telegramBotToken, setTelegramBotToken] = React.useState("")
  const [showSecrets, setShowSecrets] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/integration-secrets", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response
          .json()
          .catch(() => null)) as State | null
        if (!response.ok || !payload) return
        setState(payload)
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  async function save(payload: Record<string, unknown>) {
    setSaving(true)
    try {
      const response = await sessionFetch("/api/integration-secrets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const next = (await response.json().catch(() => null)) as
        (State & { error?: string }) | null
      if (!response.ok || !next)
        throw new Error(next?.error ?? "Не удалось сохранить токены.")
      setState(next)
      setMonobankToken("")
      setTelegramBotToken("")
      toast.success("Токены интеграций сохранены")
    } catch (reason) {
      toast.error("Не удалось сохранить токены", {
        description: reason instanceof Error ? reason.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <KeyRound className="size-4 text-primary" /> Интеграции и секреты
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Доступно только владельцу и разработчику. Сохранённые токены никогда
            не возвращаются в браузер.
          </p>
        </div>
        <Button
          aria-label={showSecrets ? "Скрыть ввод" : "Показать ввод"}
          onClick={() => setShowSecrets((value) => !value)}
          size="icon"
          type="button"
          variant="outline"
        >
          {showSecrets ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {[
          {
            key: "monobankToken",
            label: "Токен monobank",
            value: monobankToken,
            setValue: setMonobankToken,
            configured: state.monobankConfigured,
            clear: "clearMonobank",
          },
          {
            key: "telegramBotToken",
            label: "Токен Telegram-бота",
            value: telegramBotToken,
            setValue: setTelegramBotToken,
            configured: state.telegramBotConfigured,
            clear: "clearTelegramBot",
          },
        ].map((field) => (
          <div
            className="rounded-xl border border-border bg-background/55 p-4"
            key={field.key}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="text-sm font-semibold" htmlFor={field.key}>
                {field.label}
              </label>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {field.configured ? (
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                ) : null}
                {field.configured ? "Подключено" : "Не настроено"}
              </span>
            </div>
            <Input
              autoComplete="new-password"
              disabled={disabled || loading || saving}
              id={field.key}
              onChange={(event) => field.setValue(event.target.value)}
              placeholder={
                field.configured
                  ? "Введите новый токен для замены"
                  : "Вставьте токен"
              }
              type={showSecrets ? "text" : "password"}
              value={field.value}
            />
            {field.configured ? (
              <Button
                className="mt-2 px-2 text-destructive hover:text-destructive"
                disabled={disabled || saving}
                onClick={() => void save({ [field.clear]: true })}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2 /> Удалить токен
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end border-t border-border pt-5">
        <Button
          disabled={
            disabled ||
            loading ||
            saving ||
            (!monobankToken && !telegramBotToken)
          }
          onClick={() =>
            void save({
              ...(monobankToken ? { monobankToken } : {}),
              ...(telegramBotToken ? { telegramBotToken } : {}),
            })
          }
          type="button"
        >
          {saving ? "Сохраняем…" : "Сохранить токены"}
        </Button>
      </div>
    </section>
  )
}
