"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { toast } from "sonner"

import { Banknote } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { LogoPicker } from "@/components/ui/logo-picker"
import { DeliverySwitch } from "@/components/ui/delivery-switch"
import { useFieldAutosave } from "@/components/use-field-autosave"

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
  const [loaded, setLoaded] = React.useState(false)

  const autosave = useFieldAutosave<PaymentConfig>(async (next) => {
    const response = await sessionFetch("/api/payment-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantName: next.merchantName,
        iban: next.iban,
        edrpou: next.edrpou,
        bankName: next.bankName,
        bankMfo: next.bankMfo,
        bankEdrpou: next.bankEdrpou,
        logoUrl: next.logoUrl,
        isEnabled: next.isEnabled,
      }),
    })
    const payload: unknown = await response.json().catch(() => null)
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
    return payload
  })
  React.useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await sessionFetch("/api/payment-settings", {
          signal: controller.signal,
        })
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok || !isPaymentConfig(payload))
          throw new Error("Не удалось загрузить настройки оплаты.")
        setLoaded(true)
        setConfig(payload)
        autosave.initialize(payload)
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
  }, [autosave])

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
    <section className="settings-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 font-semibold">
            <Banknote className="size-4 text-primary" />
            Оплата на IBAN
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Сторінка бронювання і бот показують реквізити, точну суму та QR-код.
            Надходження автоматично звіряється за сумою і призначенням платежу.
          </p>
        </div>
        <Badge
          variant="secondary"
          className={
            config.isEnabled
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : ""
          }
        >
          {config.isEnabled ? "Приём оплат включён" : "Не подключено"}
        </Badge>
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        {fields.map((field) => (
          <label className="text-sm font-semibold" key={field.key}>
            {field.label}
            <Input
              className="mt-2 font-normal"
              disabled={disabled || loading || !loaded}
              onBlur={(event) =>
                autosave.commit({ [field.key]: event.target.value })
              }
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
        <div className="sm:col-span-2">
          <LogoPicker
            label="Логотип для оплаты"
            value={config.logoUrl}
            disabled={disabled || loading || !loaded}
            onValueCommit={(logoUrl) => autosave.commit({ logoUrl })}
            onValueChange={(logoUrl) =>
              setConfig((current) => ({ ...current, logoUrl }))
            }
          />
        </div>
      </div>
      <label className="mt-5 flex items-start gap-3 rounded-xl bg-control p-4 text-sm">
        <DeliverySwitch
          label="Включить оплату в Telegram-боте"
          checked={config.isEnabled}
          disabled={disabled || loading || !loaded}
          onChange={(checked) => {
            autosave.commit({ isEnabled: checked === true })
            setConfig((current) => ({
              ...current,
              isEnabled: checked === true,
            }))
          }}
        />
        <span>
          <span className="font-semibold">Включить оплату в Telegram-боте</span>
          <span className="mt-1 block leading-5 text-muted-foreground">
            Клиент сам выбирает банк для перевода по реквизитам или оплату
            наличными при посадке.
          </span>
        </span>
      </label>
    </section>
  )
}
