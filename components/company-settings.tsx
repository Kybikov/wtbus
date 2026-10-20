"use client"

import { useSettingsRole } from "@/components/settings-frame"
import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { AdminNotice } from "@/components/admin-notice"
import { CustomFieldManager } from "@/components/custom-field-manager"
import { PaymentSettings } from "@/components/payment-settings"
import { IntegrationSecretsSettings } from "@/components/integration-secrets-settings"
import { WorkflowStatusSettings } from "@/components/workflow-status-settings"
import { ActivityHistory } from "@/components/activity-history"
import { ExchangeRateSettings } from "@/components/exchange-rate-settings"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { Palette } from "lucide-react"
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

export type CompanySettingsSection =
  | "company"
  | "payments"
  | "finance"
  | "fields"
  | "integrations"
  | "activity"
  | "statuses"
export function CompanySettings({
  section = "company",
}: {
  section?: CompanySettingsSection
}) {
  const [branding, setBranding] = React.useState<Branding>(defaultBranding)
  const [loading, setLoading] = React.useState(true)
  const [refreshVersion, setRefreshVersion] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const role = useSettingsRole()
  const canManageSecrets = role === "owner" || role === "developer"
  const isSubscriptionLocked =
    branding.subscriptionStatus === "past_due" ||
    branding.subscriptionStatus === "suspended"

  const autosave = useFieldAutosave<Branding>(async (next) => {
    if (!/^#[0-9a-f]{6}$/i.test(next.primaryColor))
      throw Error("Выберите цвет в формате #RRGGBB.")
    const response = await sessionFetch("/api/branding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logoUrl: next.logoUrl ?? null,
        primaryColor: next.primaryColor,
        defaultTheme: next.defaultTheme,
        dispatcherContact: next.dispatcherContact,
      }),
    })
    const payload: unknown = await response.json().catch(() => null)
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
    window.dispatchEvent(
      new CustomEvent("vivat-branding-change", { detail: payload })
    )
    return payload
  })

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
          const payload: unknown = await response.json().catch(() => null)
          if (!response.ok || !isBranding(payload))
            throw new Error("Не удалось загрузить настройки компании.")
          setBranding(payload)
          autosave.initialize(payload)
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
  }, [refreshVersion, autosave])

  React.useEffect(() => {
    const refresh = () => setRefreshVersion((v) => v + 1)
    window.addEventListener("vivat-settings-refresh", refresh)
    return () => window.removeEventListener("vivat-settings-refresh", refresh)
  }, [])

  return (
    <div className="company-settings w-full min-w-0 space-y-4">
      <AdminNotice message={error} variant="error" />
      {section === "statuses" && (
        <WorkflowStatusSettings
          disabled={loading || !!error || isSubscriptionLocked}
        />
      )}
      {section === "activity" && <ActivityHistory role={role} />}
      {section === "company" ? (
        <section className="settings-panel" aria-label="Визуальный стиль">
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
                disabled={loading || !!error || isSubscriptionLocked}
                onValueCommit={(logoUrl) =>
                  autosave.commit({ logoUrl: logoUrl || undefined })
                }
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
                disabled={loading || !!error || isSubscriptionLocked}
                onValueCommit={(primaryColor) =>
                  autosave.commit({ primaryColor })
                }
                onValueChange={(primaryColor) =>
                  setBranding((current) => ({ ...current, primaryColor }))
                }
              />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">Тема по умолчанию</p>
              <FieldSelect
                aria-label="Тема по умолчанию"
                disabled={loading || !!error || isSubscriptionLocked}
                onValueChange={(value) => {
                  autosave.commit({
                    defaultTheme: value as Branding["defaultTheme"],
                  })
                  setBranding((current) => ({
                    ...current,
                    defaultTheme: value as Branding["defaultTheme"],
                  }))
                }}
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
                disabled={loading || !!error || isSubscriptionLocked}
                onBlur={(event) =>
                  autosave.commit({ dispatcherContact: event.target.value })
                }
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
          {isSubscriptionLocked && (
            <p className="mt-5 text-xs text-muted-foreground">
              Рабочие операции приостановлены до продления подписки.
            </p>
          )}
        </section>
      ) : null}
      {canManageSecrets && section === "payments" ? (
        <PaymentSettings
          key={`payment-${refreshVersion}`}
          disabled={loading || !!error || isSubscriptionLocked}
        />
      ) : null}
      {canManageSecrets && section === "integrations" ? (
        <IntegrationSecretsSettings
          key={`integrations-${refreshVersion}`}
          disabled={loading || !!error || isSubscriptionLocked}
        />
      ) : null}
      {canManageSecrets && section === "finance" ? (
        <ExchangeRateSettings key={`finance-${refreshVersion}`} />
      ) : null}
      {section === "fields" ? (
        <CustomFieldManager
          key={`fields-${refreshVersion}`}
          disabled={loading || !!error || isSubscriptionLocked}
        />
      ) : null}
    </div>
  )
}
