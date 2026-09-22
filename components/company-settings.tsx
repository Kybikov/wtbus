"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { AdminNotice } from "@/components/admin-notice"
import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { CustomFieldManager } from "@/components/custom-field-manager"
import { PaymentSettings } from "@/components/payment-settings"
import { IntegrationSecretsSettings } from "@/components/integration-secrets-settings"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"

type Branding = {
  logoUrl?: string
  primaryColor: string
  defaultTheme: "light" | "dark" | "system"
  dispatcherContact: string
  subscriptionStatus: "trial" | "active" | "past_due" | "suspended"
}

const defaultBranding: Branding = {
  primaryColor: "#E9B74D",
  defaultTheme: "dark",
  dispatcherContact: "",
  subscriptionStatus: "trial",
}

function isBranding(value: unknown): value is Branding {
  return (
    typeof value === "object" &&
    value !== null &&
    "primaryColor" in value &&
    typeof value.primaryColor === "string" &&
    "defaultTheme" in value &&
    typeof value.defaultTheme === "string" &&
    "dispatcherContact" in value &&
    typeof value.dispatcherContact === "string" &&
    "subscriptionStatus" in value &&
    typeof value.subscriptionStatus === "string"
  )
}

function subscriptionLabel(status: Branding["subscriptionStatus"]) {
  return {
    trial: "Пробный период",
    active: "Активна",
    past_due: "Требуется оплата",
    suspended: "Приостановлена",
  }[status]
}

function applyBrandColor(color: string) {
  const root = document.documentElement
  root.style.setProperty("--primary", color)
  root.style.setProperty("--sidebar-primary", color)
  root.style.setProperty("--ring", color)
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  const ink =
    (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#191914" : "#FFFFFF"
  root.style.setProperty("--primary-foreground", ink)
  root.style.setProperty("--sidebar-primary-foreground", ink)
}

export function CompanySettings() {
  const [branding, setBranding] = React.useState<Branding>(defaultBranding)
  const [loading, setLoading] = React.useState(true)
  const [refreshVersion, setRefreshVersion] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [canManageSecrets, setCanManageSecrets] = React.useState(false)
  const isSubscriptionLocked =
    branding.subscriptionStatus === "past_due" ||
    branding.subscriptionStatus === "suspended"

  React.useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true)
        setError(null)
        try {
          const response = await sessionFetch("/api/branding", {
            signal: controller.signal,
          })
          const payload: unknown = await response.json()
          if (!response.ok || !isBranding(payload))
            throw new Error("Не удалось загрузить настройки компании.")
          setBranding(payload)
          applyBrandColor(payload.primaryColor)
        } catch (reason) {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error
                ? reason.message
                : "Не удалось загрузить настройки компании."
            )
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      })()
    }, 0)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [refreshVersion])

  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/auth/me", { signal: controller.signal })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("role" in payload)
        )
          return
        setCanManageSecrets(
          payload.role === "owner" || payload.role === "developer"
        )
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await sessionFetch("/api/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(branding),
      })
      const payload: unknown = await response.json()
      if (!response.ok || !isBranding(payload)) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Не удалось сохранить настройки компании."
        throw new Error(message)
      }
      setBranding(payload)
      applyBrandColor(payload.primaryColor)
      window.dispatchEvent(
        new CustomEvent("vivat-branding-change", {
          detail: {
            primaryColor: payload.primaryColor,
            defaultTheme: payload.defaultTheme,
            logoUrl: payload.logoUrl ?? null,
          },
        })
      )
      setNotice("Бренд компании сохранён.")
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить настройки компании."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell
      onRefresh={() => setRefreshVersion((version) => version + 1)}
      refreshing={loading}
      pageDescription="Бренд, реквизиты и подписка компании"
      pageTitle="Настройки компании"
      utilities={<ThemeCustomizer />}
    >
      <div className="w-full min-w-0 space-y-5">
        {error ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <AdminNotice message={notice} />
        <form
          className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25 p-5"
          onSubmit={save}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-bold">Визуальный стиль</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Основной цвет используется для главных действий и рабочего
                акцента.
              </p>
            </div>
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold">
              {subscriptionLabel(branding.subscriptionStatus)}
            </span>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Основной цвет
              <div className="mt-2 flex h-11 overflow-hidden rounded-xl border border-border bg-background">
                <input
                  aria-label="Выбрать основной цвет"
                  className="h-full w-12 border-0 bg-transparent p-1"
                  disabled={loading || isSubscriptionLocked}
                  onChange={(event) =>
                    setBranding((current) => ({
                      ...current,
                      primaryColor: event.target.value.toUpperCase(),
                    }))
                  }
                  type="color"
                  value={branding.primaryColor}
                />
                <input
                  className="min-w-0 flex-1 bg-transparent px-3 font-medium uppercase outline-none"
                  disabled={loading || isSubscriptionLocked}
                  maxLength={7}
                  onChange={(event) =>
                    setBranding((current) => ({
                      ...current,
                      primaryColor: event.target.value.toUpperCase(),
                    }))
                  }
                  pattern="^#[0-9A-Fa-f]{6}$"
                  value={branding.primaryColor}
                />
              </div>
            </label>
            <label className="text-sm font-semibold">
              Тема по умолчанию
              <FieldSelect
                disabled={loading || isSubscriptionLocked}
                onValueChange={(value) =>
                  setBranding((current) => ({
                    ...current,
                    defaultTheme: value as Branding["defaultTheme"],
                  }))
                }
                options={[
                  { value: "dark", label: "Тёмная" },
                  { value: "light", label: "Светлая" },
                  { value: "system", label: "Как в системе" },
                ]}
                triggerClassName="mt-2"
                value={branding.defaultTheme}
              />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Логотип (HTTPS URL или путь)
              <input
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 font-normal"
                disabled={loading || isSubscriptionLocked}
                onChange={(event) =>
                  setBranding((current) => ({
                    ...current,
                    logoUrl: event.target.value || undefined,
                  }))
                }
                placeholder="/brand/vivat-bus.png"
                value={branding.logoUrl ?? ""}
              />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Контакт диспетчера для Telegram-бота
              <input
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 font-normal"
                disabled={loading || isSubscriptionLocked}
                maxLength={160}
                onChange={(event) =>
                  setBranding((current) => ({
                    ...current,
                    dispatcherContact: event.target.value,
                  }))
                }
                placeholder="@vivat_bus або +380…"
                value={branding.dispatcherContact}
              />
            </label>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">
              {isSubscriptionLocked
                ? "Рабочие операции заблокированы до продления. Статус изменяет центральная SaaS-платформа."
                : "Статус подписки передаётся центральной SaaS-платформой. Приостановка блокирует новые рабочие операции."}
            </p>
            <Button
              disabled={loading || saving || isSubscriptionLocked}
              size="lg"
              type="submit"
            >
              {saving ? "Сохраняем…" : "Сохранить бренд"}
            </Button>
          </div>
        </form>
        <PaymentSettings
          key={`payment-${refreshVersion}`}
          disabled={loading || isSubscriptionLocked}
        />
        {canManageSecrets ? (
          <IntegrationSecretsSettings
            key={`integrations-${refreshVersion}`}
            disabled={loading || isSubscriptionLocked}
          />
        ) : null}
        <CustomFieldManager
          key={`fields-${refreshVersion}`}
          disabled={loading || isSubscriptionLocked}
        />
      </div>
    </AppShell>
  )
}
