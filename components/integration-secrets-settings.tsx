"use client"

import * as React from "react"
import { KeyRound } from "lucide-react"
import { toast } from "sonner"
import { ConnectionTestButton } from "@/components/connection-test-button"
import { ProviderLogo } from "@/components/provider-logo"
import { IntegrationConnectionCard } from "@/components/integration-connection-card"
import { realtimeEvent, type RealtimeMessage } from "@/lib/realtime"
import { sessionFetch } from "@/lib/session-navigation"

type Health = { status: string; checkedAt?: string; lastSuccessAt?: string }
type State = {
  monobankHealth?: Health
  telegramHealth?: Health
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
export function IntegrationSecretsSettings({
  disabled,
}: {
  disabled: boolean
}) {
  const [state, setState] = React.useState(emptyState)
  const [available, setAvailable] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState<string | null>(null)
  const revision = React.useRef(0)
  const writing = React.useRef(false)
  const reload = React.useCallback(async (signal?: AbortSignal) => {
    if (writing.current) return
    const current = ++revision.current
    const response = await sessionFetch("/api/integration-secrets", {
      signal,
      cache: "no-store",
    })
    const next = (await response.json().catch(() => null)) as
      (State & { error?: string }) | null
    if (!response.ok || !next)
      throw Error(next?.error ?? "Не удалось загрузить интеграции.")
    if (current === revision.current && !signal?.aborted) {
      setState(next)
      setAvailable(true)
    }
  }, [])
  React.useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (document.visibilityState === "visible")
          void reload(controller.signal).catch(() => {})
      }, 350)
    }
    const realtime = (event: Event) => {
      const message = (event as CustomEvent<RealtimeMessage>).detail
      if (
        message?.type === "ready" ||
        ["integration_health", "tenant_integration_secrets"].includes(
          message?.entity ?? ""
        )
      )
        refresh()
    }
    void reload(controller.signal)
      .catch(() => {
        if (!controller.signal.aborted)
          toast.error("Не удалось загрузить интеграции.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    const interval = setInterval(refresh, 60_000)
    window.addEventListener(realtimeEvent, realtime)
    window.addEventListener("focus", refresh)
    return () => {
      controller.abort()
      clearTimeout(timer)
      clearInterval(interval)
      window.removeEventListener(realtimeEvent, realtime)
      window.removeEventListener("focus", refresh)
    }
  }, [reload])

  async function save(
    provider: string,
    payload: Record<string, unknown>,
    removed = false
  ) {
    writing.current = true
    ++revision.current
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
      writing.current = false
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
    const p = await r.json().catch(() => null)
    await reload().catch(() => {})
    if (!r.ok || !p) {
      const error = Object.assign(
        new Error(
          p?.error ??
            "Подключение временно недоступно. Повторите проверку позже."
        ),
        { retryLater: r.status === 429 }
      )
      throw error
    }
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
              disabledReason={
                disabled
                  ? "Настройки интеграций сейчас недоступны."
                  : loading
                    ? "Дождитесь загрузки интеграций."
                    : saving
                      ? "Дождитесь сохранения ключа."
                      : "Сначала подключите Monobank в настройках компании."
              }
              hint={
                !state.monobankConfigured ? "Сначала сохраните ключ" : undefined
              }
              onTest={() => test("monobank")}
            />
          }
          health={state.monobankHealth}
          configured={state.monobankConfigured}
          disabled={disabled || loading || !available || !!saving}
          saving={saving === "monobank"}
          onSave={(token) => save("monobank", { monobankToken: token })}
          onRemove={() => save("monobank", { clearMonobank: true }, true)}
        />
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
              disabledReason={
                disabled
                  ? "Настройки интеграций сейчас недоступны."
                  : loading
                    ? "Дождитесь загрузки интеграций."
                    : saving
                      ? "Дождитесь сохранения ключа."
                      : "Сначала подключите Telegram-бота в настройках компании."
              }
              hint={
                !state.telegramBotConfigured
                  ? "Сначала сохраните ключ"
                  : undefined
              }
              onTest={() => test("telegram")}
            />
          }
          health={state.telegramHealth}
          configured={state.telegramBotConfigured}
          disabled={disabled || loading || !available || !!saving}
          saving={saving === "telegram"}
          onSave={(token) => save("telegram", { telegramBotToken: token })}
          onRemove={() => save("telegram", { clearTelegramBot: true }, true)}
        />
      </div>
    </section>
  )
}
