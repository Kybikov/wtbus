"use client"

import * as React from "react"
import { Clock3, KeyRound, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { ConnectionTestButton } from "@/components/connection-test-button"
import { ProviderLogo } from "@/components/provider-logo"
import { IntegrationConnectionCard } from "@/components/integration-connection-card"
import { Badge } from "@/components/ui/badge"
import { sessionFetch } from "@/lib/session-navigation"

type State = {
  monobankPreview?: string
  telegramBotPreview?: string
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
  }, [])

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

  async function test(provider: string): Promise<string> {
    const r = await sessionFetch("/api/integration-secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
      signal: AbortSignal.timeout(10_000),
    })
    const p = await r.json()
    if (!r.ok) throw Error(p.error ?? "Не удалось проверить подключение")
    return p.message
  }

  return (
    <section className="settings-panel @container">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="size-4" />
          </span>
          <div>
            <h2 className="font-semibold">Интеграции и секреты</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Подключите оплату и Telegram-бота компании.
            </p>
          </div>
        </div>
      </header>
      <div className="mt-6 grid min-w-0 gap-4 @3xl:grid-cols-2">
        <IntegrationConnectionCard
          name="monobank"
          description="Автоматическая сверка переводов на IBAN"
          icon={<ProviderLogo provider="monobank" />}
          preview={state.monobankPreview}
          test={
            <ConnectionTestButton
              name="Monobank API"
              disabled={
                disabled || loading || !!saving || !state.monobankConfigured
              }
              hint={
                !state.monobankConfigured ? "Сначала сохраните ключ" : undefined
              }
              onTest={() => test("monobank")}
            />
          }
          configured={state.monobankConfigured}
          disabled={disabled || loading || !!saving}
          saving={saving === "monobank"}
          onSave={(token) => save("monobank", { monobankToken: token })}
          onRemove={() => save("monobank", { clearMonobank: true }, true)}
        >
          {state.monobankConfigured ? (
            <div className="mt-4 space-y-2 border-t border-border pt-4">
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
                  Не удалось сверить платежи. Проверьте подключение и повторите
                  позже.
                </p>
              ) : null}
            </div>
          ) : null}
        </IntegrationConnectionCard>
        <IntegrationConnectionCard
          name="Telegram"
          description="Бронирование и уведомления через бота"
          icon={<ProviderLogo provider="telegram" />}
          preview={state.telegramBotPreview}
          test={
            <ConnectionTestButton
              name="Telegram API"
              disabled={
                disabled || loading || !!saving || !state.telegramBotConfigured
              }
              hint={
                !state.telegramBotConfigured
                  ? "Сначала сохраните ключ"
                  : undefined
              }
              onTest={() => test("telegram")}
            />
          }
          configured={state.telegramBotConfigured}
          disabled={disabled || loading || !!saving}
          saving={saving === "telegram"}
          onSave={(token) => save("telegram", { telegramBotToken: token })}
          onRemove={() => save("telegram", { clearTelegramBot: true }, true)}
        />
      </div>
    </section>
  )
}
