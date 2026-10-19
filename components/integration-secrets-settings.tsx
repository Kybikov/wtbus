"use client"

import * as React from "react"
import { Clock3, KeyRound, RefreshCw, Send, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { IntegrationConnectionCard } from "@/components/integration-connection-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { sessionFetch } from "@/lib/session-navigation"

type State = {
  monobankConfigured: boolean
  telegramBotConfigured: boolean
  monobankLastAttemptAt?: string
  monobankLastSuccessAt?: string
  monobankLastError?: string
}
const emptyState: State = {
  monobankConfigured: false,
  telegramBotConfigured: false,
}
const dateLabel = (value?: string) =>
  value ? new Date(value).toLocaleString("uk-UA") : "ещё не выполнялась"

export function IntegrationSecretsSettings({
  disabled,
}: {
  disabled: boolean
}) {
  const [state, setState] = React.useState(emptyState)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/integration-secrets", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          (State & { error?: string }) | null
        if (!response.ok || !payload)
          throw new Error(payload?.error ?? "Не удалось загрузить интеграции.")
        setState(payload)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          toast.error("Не удалось загрузить интеграции", {
            description: reason instanceof Error ? reason.message : undefined,
          })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [refreshVersion])

  async function save(
    provider: string,
    payload: Record<string, unknown>,
    removed = false
  ) {
    setSaving(provider)
    try {
      const response = await sessionFetch("/api/integration-secrets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const next = (await response.json().catch(() => null)) as
        (State & { error?: string }) | null
      if (!response.ok || !next)
        throw new Error(next?.error ?? "Не удалось сохранить ключ.")
      setState(next)
      toast.success(removed ? "Ключ удалён" : "Ключ сохранён")
      return true
    } catch (reason) {
      toast.error(
        removed ? "Не удалось удалить ключ" : "Не удалось сохранить ключ",
        { description: reason instanceof Error ? reason.message : undefined }
      )
      return false
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="settings-panel">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="size-4" />
          </span>
          <div>
            <h2 className="font-semibold">Интеграции и секреты</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Подключения платежей и Telegram. Доступно владельцу и
              разработчику.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Обновить статус интеграций"
          disabled={loading || !!saving}
          onClick={() => {
            setLoading(true)
            setRefreshVersion((version) => version + 1)
          }}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
      </header>
      <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-2">
        <IntegrationConnectionCard
          name="monobank"
          description="Автоматическая сверка переводов на IBAN"
          icon={
            <span className="text-xl font-bold" aria-hidden="true">
              m
            </span>
          }
          configured={state.monobankConfigured}
          disabled={disabled || loading || !!saving}
          saving={saving === "monobank"}
          onSave={(token) => save("monobank", { monobankToken: token })}
          onRemove={() => save("monobank", { clearMonobank: true }, true)}
        />
        <IntegrationConnectionCard
          name="Telegram"
          description="Бронирование и уведомления через бота"
          icon={<Send className="size-5" />}
          configured={state.telegramBotConfigured}
          disabled={disabled || loading || !!saving}
          saving={saving === "telegram"}
          onSave={(token) => save("telegram", { telegramBotToken: token })}
          onRemove={() => save("telegram", { clearTelegramBot: true }, true)}
        />
      </div>
      {state.monobankConfigured ? (
        <div className="mt-4 rounded-2xl bg-control p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Сверка Monobank</h3>
            <Badge
              variant="secondary"
              className={
                state.monobankLastError
                  ? "bg-amber-500/12 text-amber-700 dark:text-amber-400"
                  : ""
              }
            >
              {state.monobankLastError
                ? "Требует внимания"
                : state.monobankLastSuccessAt
                  ? "Проверка выполнена"
                  : "Ожидает первой проверки"}
            </Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Платёж подтверждается по точной сумме и уникальному назначению.
          </p>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Clock3 className="size-3.5" />
                Последняя проверка
              </dt>
              <dd className="mt-1 tabular-nums">
                {dateLabel(state.monobankLastAttemptAt)}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                Последняя успешная сверка
              </dt>
              <dd className="mt-1 tabular-nums">
                {dateLabel(state.monobankLastSuccessAt)}
              </dd>
            </div>
          </dl>
          {state.monobankLastError ? (
            <p className="mt-3 text-sm break-words text-destructive">
              {state.monobankLastError}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        Сохранённые токены не возвращаются в браузер. Результат проверки
        подключения отображается в блоке сверки.
      </p>
    </section>
  )
}
