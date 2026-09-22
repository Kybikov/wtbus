"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

type PaymentConfig = {
  provider: "internal"
  merchantName: string
  iban: string
  edrpou: string
  bankName: string
  bankMfo: string
  bankEdrpou: string
  logoUrl: string
  isEnabled: boolean
}

const initialConfig: PaymentConfig = {
  provider: "internal",
  merchantName: "",
  iban: "",
  edrpou: "",
  bankName: "",
  bankMfo: "",
  bankEdrpou: "",
  logoUrl: "",
  isEnabled: false,
}

function isPaymentConfig(value: unknown): value is PaymentConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider" in value &&
    value.provider === "internal" &&
    "merchantName" in value &&
    typeof value.merchantName === "string" &&
    "iban" in value &&
    typeof value.iban === "string" &&
    "edrpou" in value &&
    typeof value.edrpou === "string" &&
    "bankName" in value &&
    typeof value.bankName === "string" &&
    "bankMfo" in value &&
    typeof value.bankMfo === "string" &&
    "bankEdrpou" in value &&
    typeof value.bankEdrpou === "string" &&
    "logoUrl" in value &&
    typeof value.logoUrl === "string" &&
    "isEnabled" in value &&
    typeof value.isEnabled === "boolean"
  )
}

export function PaymentSettings({ disabled }: { disabled: boolean }) {
  const [config, setConfig] = React.useState<PaymentConfig>(initialConfig)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await sessionFetch("/api/payment-settings", {
          signal: controller.signal,
        })
        const payload: unknown = await response.json()
        if (!response.ok || !isPaymentConfig(payload))
          throw new Error("Не удалось загрузить настройки оплаты.")
        setConfig(payload)
      } catch (reason) {
        if (!controller.signal.aborted)
          toast.error("Не удалось загрузить настройки оплаты", {
            description: reason instanceof Error ? reason.message : undefined,
          })
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const response = await sessionFetch("/api/payment-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      const payload: unknown = await response.json()
      if (!response.ok || !isPaymentConfig(payload)) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Не удалось сохранить настройки оплаты."
        throw new Error(message)
      }
      setConfig(payload)
      toast.success("Настройки оплаты сохранены")
    } catch (reason) {
      toast.error("Не удалось сохранить настройки оплаты", {
        description: reason instanceof Error ? reason.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    {
      label: "Получатель",
      key: "merchantName" as const,
      placeholder: "ФОП / название компании",
    },
    {
      label: "IBAN",
      key: "iban" as const,
      placeholder: "UA123456789012345678901234567",
    },
    { label: "ЕГРПОУ / ИНН", key: "edrpou" as const, placeholder: "12345678" },
    { label: "Банк", key: "bankName" as const, placeholder: "Назва банку" },
    { label: "МФО", key: "bankMfo" as const, placeholder: "000000" },
    {
      label: "ЄДРПОУ банка",
      key: "bankEdrpou" as const,
      placeholder: "00000000",
    },
  ]

  return (
    <form
      className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25 p-5"
      onSubmit={save}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="font-bold">Оплата на IBAN</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Сторінка бронювання і бот показують реквізити, точну суму та QR-код.
            Надходження автоматично звіряється за сумою і призначенням платежу.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${config.isEnabled ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-border bg-background text-muted-foreground"}`}
        >
          {config.isEnabled ? "Приём оплат включён" : "Не подключено"}
        </span>
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        {fields.map((field) => (
          <label className="text-sm font-semibold" key={field.key}>
            {field.label}
            <input
              className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 font-normal ring-offset-background transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || loading}
              maxLength={field.key === "merchantName" ? 160 : 120}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  [field.key]:
                    field.key === "iban"
                      ? event.target.value.toUpperCase()
                      : event.target.value,
                }))
              }
              placeholder={field.placeholder}
              value={config[field.key]}
            />
          </label>
        ))}
        <label className="text-sm font-semibold sm:col-span-2">
          Логотип компании
          <input
            className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 font-normal ring-offset-background transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || loading}
            maxLength={2000}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                logoUrl: event.target.value,
              }))
            }
            placeholder="https://example.com/logo.png"
            type="url"
            value={config.logoUrl}
          />
        </label>
      </div>
      <label className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-background/70 p-4 text-sm">
        <input
          checked={config.isEnabled}
          className="mt-0.5 size-4 accent-primary"
          disabled={disabled || loading}
          onChange={(event) =>
            setConfig((current) => ({
              ...current,
              isEnabled: event.target.checked,
            }))
          }
          type="checkbox"
        />
        <span>
          <span className="font-semibold">Включить оплату в Telegram-боте</span>
          <span className="mt-1 block leading-5 text-muted-foreground">
            Клиент сам выбирает банк для перевода по реквизитам или оплату
            наличными при посадке.
          </span>
        </span>
      </label>
      <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">
          Гроші надходять напряму на рахунок ФОП. Для автоматичної звірки
          потрібен персональний API-токен Monobank у блоці інтеграцій.
        </p>
        <Button
          disabled={disabled || loading || saving}
          size="lg"
          type="submit"
        >
          {saving ? "Сохраняем…" : "Сохранить оплату"}
        </Button>
      </div>
    </form>
  )
}
