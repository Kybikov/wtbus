"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { AdminNotice } from "@/components/admin-notice"
import { AppShell } from "@/components/app-shell"
import { SettingsWorkspace } from "@/components/settings-workspace"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { CustomFieldManager } from "@/components/custom-field-manager"
import { PaymentSettings } from "@/components/payment-settings"
import { IntegrationSecretsSettings } from "@/components/integration-secrets-settings"
import { ExchangeRateSettings } from "@/components/exchange-rate-settings"
import { Button } from "@/components/ui/button"
import { Palette, Save, LoaderCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ColorPicker } from "@/components/ui/color-picker"
import { LogoPicker } from "@/components/ui/logo-picker"
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

export type CompanySettingsSection =
  "company" | "payments" | "finance" | "fields" | "integrations"
export function CompanySettings({
  section = "company",
}: {
  section?: CompanySettingsSection
}) {
  const [branding, setBranding] = React.useState<Branding>(defaultBranding)
  const [loading, setLoading] = React.useState(true)
  const [refreshVersion, setRefreshVersion] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [canManageSecrets, setCanManageSecrets] = React.useState(false)
  const [role, setRole] = React.useState<string>()
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
        if (typeof payload.role === "string") setRole(payload.role)
        setCanManageSecrets(
          payload.role === "owner" || payload.role === "developer"
        )
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^#[0-9a-f]{6}$/i.test(branding.primaryColor)) {
      setError("Выберите цвет в формате #RRGGBB.")
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await sessionFetch("/api/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoUrl: branding.logoUrl ?? null,
          primaryColor: branding.primaryColor,
          defaultTheme: branding.defaultTheme,
          dispatcherContact: branding.dispatcherContact,
        }),
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
      pageDescription="Бренд, реквизиты и интеграции компании"
      pageTitle="Настройки компании"
      utilities={<ThemeCustomizer />}
    >
      <SettingsWorkspace active={`/settings/${section}`} role={role}>
        <div className="company-settings w-full min-w-0 space-y-4">
          <AdminNotice message={error} variant="error" />
          <AdminNotice message={notice} />
          {section === "company" ? (
            <form
              className="settings-panel"
              onSubmit={save}
              aria-label="Визуальный стиль"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Palette className="size-4" />
                  </span>
                  <div>
                    <h2 className="font-semibold">Визуальный стиль</h2>
                    <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                      Логотип, цвет и тема компании во всех разделах.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-6 grid min-w-0 gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <LogoPicker
                    value={branding.logoUrl ?? ""}
                    disabled={loading || saving || isSubscriptionLocked}
                    onValueChange={(logoUrl) =>
                      setBranding((current) => ({
                        ...current,
                        logoUrl: logoUrl || undefined,
                      }))
                    }
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <label
                    htmlFor="brand-color"
                    className="block text-sm font-medium"
                  >
                    Основной цвет
                  </label>
                  <ColorPicker
                    id="brand-color"
                    value={branding.primaryColor}
                    disabled={loading || saving || isSubscriptionLocked}
                    onValueChange={(primaryColor) =>
                      setBranding((current) => ({ ...current, primaryColor }))
                    }
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium">Тема по умолчанию</p>
                  <FieldSelect
                    aria-label="Тема по умолчанию"
                    disabled={loading || saving || isSubscriptionLocked}
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
                    value={branding.defaultTheme}
                  />
                </div>
                <label className="min-w-0 space-y-2 text-sm font-medium sm:col-span-2">
                  Контакт диспетчера для Telegram-бота
                  <Input
                    className="mt-2 font-normal"
                    disabled={loading || saving || isSubscriptionLocked}
                    maxLength={160}
                    onChange={(event) =>
                      setBranding((current) => ({
                        ...current,
                        dispatcherContact: event.target.value,
                      }))
                    }
                    placeholder="@vivat_bus или +380…"
                    value={branding.dispatcherContact}
                  />
                </label>
              </div>
              <div className="settings-footer">
                <p className="text-xs leading-5 text-muted-foreground">
                  {isSubscriptionLocked
                    ? "Рабочие операции приостановлены до продления подписки."
                    : "Изменения применятся ко всей компании после сохранения."}
                </p>
                <Button
                  disabled={loading || saving || isSubscriptionLocked}
                  type="submit"
                >
                  {saving ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Save />
                  )}
                  {saving ? "Сохраняем…" : "Сохранить изменения"}
                </Button>
              </div>
            </form>
          ) : null}
          {canManageSecrets && section === "payments" ? (
            <PaymentSettings
              key={`payment-${refreshVersion}`}
              disabled={loading || saving || isSubscriptionLocked}
            />
          ) : null}
          {canManageSecrets && section === "integrations" ? (
            <IntegrationSecretsSettings
              key={`integrations-${refreshVersion}`}
              disabled={loading || saving || isSubscriptionLocked}
            />
          ) : null}
          {canManageSecrets && section === "finance" ? (
            <ExchangeRateSettings
              disabled={loading || saving || isSubscriptionLocked}
            />
          ) : null}
          {section === "fields" ? (
            <CustomFieldManager
              key={`fields-${refreshVersion}`}
              disabled={loading || saving || isSubscriptionLocked}
            />
          ) : null}
        </div>
      </SettingsWorkspace>
    </AppShell>
  )
}
