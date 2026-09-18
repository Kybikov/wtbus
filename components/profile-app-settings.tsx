"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { SettingsFormSection } from "@/components/settings-form-1"
import { installPWA, usePWAInstall } from "@/lib/pwa-install"
import {
  currentPushSubscription,
  defaultPushPreferences,
  disablePush,
  enablePush,
  pushRequest,
  syncExistingPush,
  type PushPreferences,
} from "@/lib/web-push"

type Identity = { tenantSlug: string; membershipId: string; role: string }
const categories: { key: keyof PushPreferences; label: string }[] = [
  { key: "newRequests", label: "Новые индивидуальные заявки" },
  { key: "newBookings", label: "Бронирования и изменения их статуса" },
  { key: "payments", label: "Платежи и подтверждение оплаты" },
  { key: "trips", label: "Назначения и изменения рейсов" },
]
export function ProfileAppSettings({ identity }: { identity: Identity }) {
  const install = usePWAInstall()
  const [instructions, setInstructions] = React.useState(false)
  const [installing, setInstalling] = React.useState(false)
  const [supported, setSupported] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [permission, setPermission] =
    React.useState<NotificationPermission>("default")
  const [preferences, setPreferences] = React.useState<PushPreferences>(
    defaultPushPreferences
  )
  const [busy, setBusy] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    async function refresh() {
      const canPush =
        window.isSecureContext &&
        "Notification" in window &&
        "PushManager" in window &&
        "serviceWorker" in navigator
      if (!cancelled) {
        setSupported(canPush)
        setPermission(
          "Notification" in window ? Notification.permission : "default"
        )
      }
      try {
        const [config, subscription] = await Promise.all([
          pushRequest(),
          currentPushSubscription(),
        ])
        const bound =
          subscription && canPush
            ? await syncExistingPush(config.publicKey)
            : false
        if (!cancelled) {
          if (
            config?.preferences &&
            categories.every(
              ({ key }) => typeof config.preferences[key] === "boolean"
            )
          )
            setPreferences(config.preferences)
          setEnabled(
            Boolean(bound) && canPush && Notification.permission === "granted"
          )
          setLoaded(true)
        }
      } catch (error) {
        if (!cancelled)
          setMessage(
            error instanceof Error
              ? error.message
              : "Не удалось загрузить настройки."
          )
      }
    }
    void refresh()
    window.addEventListener("focus", refresh)
    return () => {
      cancelled = true
      window.removeEventListener("focus", refresh)
    }
  }, [identity.membershipId])
  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось настроить уведомления."
      )
    } finally {
      setBusy(false)
      if ("Notification" in window) setPermission(Notification.permission)
    }
  }
  async function savePreference(key: keyof PushPreferences, checked: boolean) {
    await perform(async () => {
      const next = { ...preferences, [key]: checked }
      await pushRequest("PATCH", next)
      setPreferences(next)
      setMessage("Настройки сохранены.")
    })
  }
  async function togglePush() {
    await perform(async () => {
      if (enabled) {
        await disablePush()
        setEnabled(false)
        setMessage("Push на этом устройстве выключен.")
      } else {
        await enablePush()
        setEnabled(true)
        setMessage("Фоновые push-уведомления включены.")
      }
    })
  }
  async function testNotification() {
    await perform(async () => {
      const subscription = await currentPushSubscription()
      if (!subscription)
        throw new Error("Сначала включите push на этом устройстве.")
      await pushRequest("POST", {
        test: true,
        subscription: subscription.toJSON(),
      })
      setMessage(
        "Проверка поставлена в очередь. Ожидайте системное уведомление на этом устройстве."
      )
    })
  }
  async function installApp() {
    if (!install.prompt) {
      setInstructions(true)
      return
    }
    setInstalling(true)
    try {
      if ((await installPWA()) === "dismissed") setInstructions(true)
    } catch {
      setInstructions(true)
    } finally {
      setInstalling(false)
    }
  }
  const visibleCategories = categories.filter(({ key }) => {
    if (identity.role === "driver")
      return key === "trips" || key === "newBookings"
    return (
      key !== "payments" ||
      ["owner", "admin", "developer"].includes(identity.role)
    )
  })
  return (
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
      <SettingsFormSection
        title="Уведомления"
        description="Выберите события для push. Уведомления приходят и при закрытом приложении."
      >
        <div className="space-y-4">
          <Badge variant="secondary">
            {!supported
              ? "Push недоступен в этом браузере"
              : permission === "denied"
                ? "Заблокированы браузером"
                : enabled
                  ? "Push включён"
                  : "Push выключен"}
          </Badge>
          {supported ? (
            <Button
              disabled={busy || !loaded}
              variant={enabled ? "outline" : "default"}
              onClick={() => void togglePush()}
            >
              {busy
                ? "Подождите…"
                : enabled
                  ? "Отключить на этом устройстве"
                  : "Включить push-уведомления"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Откройте сайт через HTTPS. На iPhone установите приложение на
              главный экран и откройте его оттуда.
            </p>
          )}
          {permission === "denied" ? (
            <p className="text-sm text-muted-foreground">
              Разрешите уведомления в настройках браузера или телефона. Это не
              ограничивает доступ к CRM.
            </p>
          ) : null}
          <div className="space-y-2">
            {visibleCategories.map(({ key, label }) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-3 rounded-lg bg-muted/35 p-3 text-sm"
              >
                <Checkbox
                  aria-label={label}
                  checked={preferences[key]}
                  disabled={busy || !loaded}
                  onCheckedChange={(checked) =>
                    void savePreference(key, checked === true)
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {enabled ? (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void testNotification()}
            >
              Проверить push
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            История событий доступна в CRM независимо от разрешения на push.
            Системные уведомления не содержат персональных данных клиентов.
          </p>
          {message ? (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          ) : null}
        </div>
      </SettingsFormSection>
      <SettingsFormSection
        title="Приложение Vivat Bus"
        description="Установите приложение на телефон или компьютер."
      >
        <div className="space-y-4">
          {install.standalone ? (
            <Badge variant="secondary">Приложение установлено</Badge>
          ) : (
            <Button
              disabled={!install.ready || installing}
              onClick={() => void installApp()}
            >
              {installing ? "Открываем установку…" : "Установить приложение"}
            </Button>
          )}
          {!install.standalone && (instructions || install.ios) ? (
            <div
              className="rounded-lg bg-muted/35 p-3 text-sm leading-6 text-muted-foreground"
              role="status"
            >
              {install.ios
                ? "Откройте сайт в Safari, нажмите «Поделиться», затем «На экран Домой» → «Добавить»."
                : "В меню браузера выберите «Установить приложение» или «Добавить на главный экран». Если пункта нет, откройте сайт в Chrome или Edge."}
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Приложение доступно всем сотрудникам. Геолокация нужна только
            водителю при передаче GPS.
          </p>
        </div>
      </SettingsFormSection>
    </div>
  )
}
