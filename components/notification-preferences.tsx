"use client"
// Adapted from React Bits Pro notifications-3: grouped delivery matrix, group
// toggles and quiet hours. All controls persist through the membership API.
import * as React from "react"
import Link from "next/link"
import {
  Bell,
  Check,
  ExternalLink,
  LoaderCircle,
  Moon,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Unplug,
} from "lucide-react"
import { toast } from "sonner"
import { ProviderLogo } from "@/components/provider-logo"
import { ConnectionTestButton } from "@/components/connection-test-button"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import { DeliverySwitch } from "@/components/ui/delivery-switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { sessionFetch } from "@/lib/session-navigation"
import {
  currentPushSubscription,
  enablePush,
  disablePush,
  pushRequest,
  syncExistingPush,
} from "@/lib/web-push"

type Channel = "push" | "telegram"
type Preferences = {
  events: Record<string, Record<Channel, boolean>>
  quietHours: {
    enabled: boolean
    days: number[]
    start: string
    end: string
    timezone: string
  }
}
type DeliveryEvent = { key: string; group: string; label: string; hint: string }
type Delivery = { preferences: Preferences; events: DeliveryEvent[] }
type Telegram = { connected: boolean; username: string; botConfigured: boolean }
const channels = [
  { key: "push", label: "Push", icon: Smartphone },
  { key: "telegram", label: "Telegram", icon: Send },
] as const
const days = [
  { value: 1, label: "Пн" },
  { value: 2, label: "Вт" },
  { value: 3, label: "Ср" },
  { value: 4, label: "Чт" },
  { value: 5, label: "Пт" },
  { value: 6, label: "Сб" },
  { value: 0, label: "Вс" },
]
async function request(resource: string, method = "GET", body?: unknown) {
  const response = await sessionFetch(
    `/api/notifications?resource=${resource}`,
    {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload)
    throw new Error(
      payload?.error ?? "Не удалось загрузить настройки уведомлений."
    )
  return payload
}
export function NotificationPreferences({
  identity,
}: {
  identity: { membershipId: string; role: string }
}) {
  const [data, setData] = React.useState<Delivery | null>(null)
  const [saved, setSaved] = React.useState("")
  const [telegram, setTelegram] = React.useState<Telegram | null>(null)
  const [link, setLink] = React.useState<{
    url: string
    expiresAt: number
  } | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [supported, setSupported] = React.useState(false)
  const [pushEnabled, setPushEnabled] = React.useState(false)
  const [permission, setPermission] =
    React.useState<NotificationPermission>("default")
  const [disconnect, setDisconnect] = React.useState(false)
  const reload = React.useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const [delivery, tg] = await Promise.all([
        request("delivery") as Promise<Delivery>,
        request("telegram") as Promise<Telegram>,
      ])
      setData(delivery)
      setSaved(JSON.stringify(delivery.preferences))
      setTelegram(tg)
    } catch (error) {
      setFailed(true)
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить настройки."
      )
    } finally {
      setLoading(false)
    }
  }, [])
  React.useEffect(() => {
    const timer = setTimeout(() => void reload(), 0)
    return () => clearTimeout(timer)
  }, [reload, identity.membershipId])
  React.useEffect(() => {
    let cancelled = false
    async function refresh() {
      const can =
        window.isSecureContext &&
        "Notification" in window &&
        "PushManager" in window &&
        "serviceWorker" in navigator
      setSupported(can)
      setPermission(
        "Notification" in window ? Notification.permission : "default"
      )
      if (!can) return
      try {
        const existing = await currentPushSubscription()
        const bound =
          existing && Notification.permission === "granted"
            ? await syncExistingPush()
            : false
        if (!cancelled) setPushEnabled(!!bound)
      } catch {
        if (!cancelled) setPushEnabled(false)
      }
    }
    void refresh()
    window.addEventListener("focus", refresh)
    return () => {
      cancelled = true
      window.removeEventListener("focus", refresh)
    }
  }, [identity.membershipId])
  const refreshTelegram = React.useCallback(async () => {
    try {
      const tg = (await request("telegram")) as Telegram
      setTelegram(tg)
      if (tg.connected) setLink(null)
    } catch {
      /* Preserve the connection summary during a transient refresh failure. */
    }
  }, [])
  React.useEffect(() => {
    if (!link) return
    const refresh = () => {
      if (Date.now() > link.expiresAt) {
        setLink(null)
        return
      }
      if (document.visibilityState === "visible") void refreshTelegram()
    }
    const timer = setInterval(refresh, 4000)
    window.addEventListener("focus", refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [link, refreshTelegram])
  async function perform(key: string, action: () => Promise<void>) {
    setBusy(key)
    try {
      await action()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить действие."
      )
    } finally {
      setBusy(null)
      if ("Notification" in window) setPermission(Notification.permission)
    }
  }
  const dirty = !!data && JSON.stringify(data.preferences) !== saved
  function change(key: string, channel: Channel, value: boolean) {
    setData((current) =>
      current
        ? {
            ...current,
            preferences: {
              ...current.preferences,
              events: {
                ...current.preferences.events,
                [key]: { ...current.preferences.events[key], [channel]: value },
              },
            },
          }
        : current
    )
  }
  function quiet(patch: Partial<Preferences["quietHours"]>) {
    setData((current) =>
      current
        ? {
            ...current,
            preferences: {
              ...current.preferences,
              quietHours: { ...current.preferences.quietHours, ...patch },
            },
          }
        : current
    )
  }
  const groups = [...new Set(data?.events.map((e) => e.group) ?? [])]
  return (
    <div className="min-w-0 space-y-4">
      <section className="settings-panel @container">
        <div className="flex items-start gap-3">
          <Bell className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 className="font-semibold">Уведомления</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Выберите события и способ доставки. Настройки действуют для вашего
              аккаунта в этой компании.
            </p>
          </div>
        </div>

        <div className="mt-5 grid min-w-0 gap-4 @3xl:grid-cols-2">
          <div className="flex min-w-0 flex-col rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <ProviderLogo provider="push" />
              <h3 className="min-w-0 flex-1 text-sm font-medium">
                Push на этом устройстве
              </h3>
              <Badge variant="secondary" className="max-w-full">
                {!supported
                  ? "Недоступен"
                  : permission === "denied"
                    ? "Заблокирован"
                    : pushEnabled
                      ? "Включён"
                      : "Выключен"}
              </Badge>
            </div>
            <p className="mt-3 flex-1 text-xs leading-5 text-muted-foreground">
              {!supported
                ? "На iPhone установите приложение через Safari и откройте с главного экрана."
                : permission === "denied"
                  ? "Разрешите уведомления в настройках браузера или телефона."
                  : "Уведомления приходят и при закрытом приложении. Включите их на каждом нужном устройстве."}
            </p>
            <div className="mt-auto grid grid-cols-1 items-center gap-2 pt-5 sm:grid-cols-2 [&_.call-chip]:w-full [&_.call-chip]:justify-center [&>button]:w-full">
              <Button
                variant="outline"
                disabled={
                  !supported || !!busy || loading || permission === "denied"
                }
                onClick={() =>
                  void perform("push", async () => {
                    if (pushEnabled) {
                      await disablePush()
                      setPushEnabled(false)
                    } else {
                      await enablePush()
                      setPushEnabled(true)
                    }
                    toast.success(
                      pushEnabled ? "Push отключён" : "Push включён"
                    )
                  })
                }
              >
                {busy === "push" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Smartphone />
                )}
                {pushEnabled ? "Отключить" : "Включить Push"}
              </Button>
              <ConnectionTestButton
                name="Push"
                disabled={!pushEnabled || !!busy || loading}
                hint={
                  !pushEnabled
                    ? "Сначала включите Push на этом устройстве"
                    : undefined
                }
                onTest={async () => {
                  const subscription = await currentPushSubscription()
                  if (!subscription) throw Error("Сначала включите Push.")
                  await pushRequest("POST", {
                    test: true,
                    subscription: subscription.toJSON(),
                  })
                  return "Проверьте уведомления на устройстве"
                }}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <ProviderLogo provider="telegram" />
              <h3 className="min-w-0 flex-1 text-sm font-medium">Telegram</h3>
              <Badge variant="secondary">
                {telegram?.connected ? (
                  <>
                    <Check />
                    Подключён
                  </>
                ) : (
                  "Не подключён"
                )}
              </Badge>
            </div>
            <p className="mt-3 flex-1 text-xs leading-5 break-words text-muted-foreground">
              {telegram?.connected && telegram.botConfigured
                ? `События приходят в личный чат с ботом компании${telegram.username ? ` · @${telegram.username}` : ""}.`
                : telegram?.botConfigured
                  ? "Откройте ссылку и нажмите «Старт» в боте. Ссылка действует 10 минут."
                  : "Сначала подключите бота компании в настройках интеграций."}
            </p>
            {link ? (
              <div className="mt-3 space-y-2 rounded-xl bg-accent p-3">
                <Button
                  nativeButton={false}
                  variant="outline"
                  render={
                    <a href={link.url} target="_blank" rel="noreferrer" />
                  }
                >
                  <ExternalLink />
                  Открыть бота
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  После нажатия «Старт» подключение обновится автоматически.
                </p>
              </div>
            ) : null}
            {!telegram?.botConfigured &&
            ["owner", "developer"].includes(identity.role) ? (
              <Link
                className="mt-3 text-xs text-primary hover:underline"
                href="/settings/integrations"
              >
                Перейти к интеграциям
              </Link>
            ) : null}
            <div className="mt-auto grid grid-cols-1 items-center gap-2 pt-5 sm:grid-cols-2 [&_.call-chip]:w-full [&_.call-chip]:justify-center [&>button]:w-full">
              {telegram?.connected ? (
                <Button
                  aria-label="Отключить Telegram"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => setDisconnect(true)}
                >
                  <Unplug />
                  Отключить
                </Button>
              ) : (
                <Button
                  variant="outline"
                  aria-label="Подключить Telegram"
                  disabled={!!busy || loading || !telegram?.botConfigured}
                  onClick={() =>
                    void perform("link", async () => {
                      const result = await request("telegram", "POST", {
                        action: "link",
                      })
                      if (
                        typeof result.url !== "string" ||
                        !/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=staff_[A-Za-z0-9_-]+$/.test(
                          result.url
                        )
                      )
                        throw Error("Не удалось создать ссылку.")
                      setLink({
                        url: result.url,
                        expiresAt: Date.now() + 600000,
                      })
                    })
                  }
                >
                  {busy === "link" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Send />
                  )}
                  Подключить
                </Button>
              )}
              <ConnectionTestButton
                name="Telegram"
                disabled={
                  !telegram?.connected ||
                  !telegram.botConfigured ||
                  !!busy ||
                  loading
                }
                hint={
                  !telegram?.connected
                    ? "Сначала подключите Telegram"
                    : undefined
                }
                onTest={async () => {
                  await request("telegram", "POST", { action: "test" })
                  return "Проверьте сообщение в Telegram"
                }}
              />
            </div>
          </div>
        </div>
      </section>
      {failed ? (
        <section className="settings-panel">
          <p className="mb-3 text-sm text-muted-foreground">
            Не удалось загрузить параметры доставки.
          </p>
          <Button variant="outline" onClick={() => void reload()}>
            <RefreshCw />
            Повторить
          </Button>
        </section>
      ) : null}
      {data ? (
        <section className="settings-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">События и доставка</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                В истории CRM события сохраняются независимо от выбранного
                канала.
              </p>
            </div>
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
          </div>
          <div className="mt-5 grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-1 px-2 pb-2 text-center text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_5rem_5rem]">
            <span className="text-left">Событие</span>
            {channels.map((c) => (
              <span key={c.key}>{c.label}</span>
            ))}
          </div>
          <div className="space-y-4">
            {groups.map((group) => {
              const events = data.events.filter((e) => e.group === group)
              return (
                <section
                  className="overflow-hidden rounded-xl border border-border"
                  key={group}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-1 bg-accent/40 px-2 py-1 sm:grid-cols-[minmax(0,1fr)_5rem_5rem]">
                    <h3 className="px-1 text-sm font-medium">{group}</h3>
                    {channels.map((c) => {
                      const all = events.every(
                        (e) => data.preferences.events[e.key][c.key]
                      )
                      return (
                        <Button
                          key={c.key}
                          size="xs"
                          variant="ghost"
                          className="justify-self-center px-2 text-xs"
                          aria-label={`${all ? "Выключить" : "Включить"} все: ${group}, ${c.label}`}
                          disabled={!!busy}
                          onClick={() =>
                            setData((current) => {
                              if (!current) return current
                              const next = { ...current.preferences.events }
                              for (const e of events)
                                next[e.key] = { ...next[e.key], [c.key]: !all }
                              return {
                                ...current,
                                preferences: {
                                  ...current.preferences,
                                  events: next,
                                },
                              }
                            })
                          }
                        >
                          {all ? "Выкл." : "Все"}
                        </Button>
                      )
                    })}
                  </div>
                  <ul className="divide-y divide-border">
                    {events.map((event) => (
                      <li
                        className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-1 px-2 py-3 sm:grid-cols-[minmax(0,1fr)_5rem_5rem]"
                        key={event.key}
                      >
                        <div className="min-w-0 px-1 sm:pr-4">
                          <p className="text-sm leading-5 font-medium">
                            {event.label}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {event.hint}
                          </p>
                        </div>
                        {channels.map((c) => (
                          <div key={c.key} className="flex justify-center">
                            <DeliverySwitch
                              label={`${event.label}: ${c.label}`}
                              disabled={!!busy}
                              checked={
                                data.preferences.events[event.key][c.key]
                              }
                              onChange={(value) =>
                                change(event.key, c.key, value)
                              }
                            />
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
          <div className="mt-5 rounded-xl border border-border p-4">
            <div className="flex items-center gap-3">
              <Moon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">Тихие часы</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Push и Telegram будут отложены до конца периода. История CRM
                  остаётся доступной.
                </p>
              </div>
              <DeliverySwitch
                label="Тихие часы"
                checked={data.preferences.quietHours.enabled}
                disabled={!!busy}
                onChange={(enabled) => quiet({ enabled })}
              />
            </div>
            {data.preferences.quietHours.enabled ? (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-1">
                  {days.map((day) => (
                    <Button
                      key={day.value}
                      size="sm"
                      variant={
                        data.preferences.quietHours.days.includes(day.value)
                          ? "secondary"
                          : "ghost"
                      }
                      aria-pressed={data.preferences.quietHours.days.includes(
                        day.value
                      )}
                      disabled={!!busy}
                      onClick={() =>
                        quiet({
                          days: data.preferences.quietHours.days.includes(
                            day.value
                          )
                            ? data.preferences.quietHours.days.filter(
                                (d) => d !== day.value
                              )
                            : [...data.preferences.quietHours.days, day.value],
                        })
                      }
                    >
                      {day.label}
                    </Button>
                  ))}
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                  <label className="min-w-0 space-y-2 text-sm">
                    С
                    <Input
                      className="mt-2"
                      type="time"
                      value={data.preferences.quietHours.start}
                      onChange={(e) => quiet({ start: e.target.value })}
                      disabled={!!busy}
                    />
                  </label>
                  <label className="min-w-0 space-y-2 text-sm">
                    До
                    <Input
                      className="mt-2"
                      type="time"
                      value={data.preferences.quietHours.end}
                      onChange={(e) => quiet({ end: e.target.value })}
                      disabled={!!busy}
                    />
                  </label>
                  <div className="min-w-0 space-y-2">
                    <p className="text-sm">Часовой пояс</p>
                    <FieldSelect
                      aria-label="Часовой пояс тихих часов"
                      value={data.preferences.quietHours.timezone}
                      disabled={!!busy}
                      onValueChange={(timezone) => quiet({ timezone })}
                      options={[
                        ...new Set([
                          data.preferences.quietHours.timezone,
                          "Europe/Warsaw",
                          "Europe/Kyiv",
                          "Europe/Berlin",
                          "Europe/London",
                          "UTC",
                        ]),
                      ].map((value) => ({ value, label: value }))}
                    />
                  </div>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Для ночного периода день относится к его началу. Например,
                  понедельник 20:00 → вторник 08:00.
                </p>
              </div>
            ) : null}
          </div>
          <footer className="settings-footer">
            <p className="text-xs text-muted-foreground" role="status">
              {dirty ? "Есть несохранённые изменения" : "Настройки сохранены"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                disabled={!dirty || !!busy}
                onClick={() =>
                  setData((current) =>
                    current
                      ? {
                          ...current,
                          preferences: JSON.parse(saved) as Preferences,
                        }
                      : current
                  )
                }
              >
                Отменить
              </Button>
              <Button
                disabled={!dirty || !!busy}
                onClick={() =>
                  void perform("save", async () => {
                    const result = (await request(
                      "delivery",
                      "PATCH",
                      data.preferences
                    )) as Delivery
                    setData(result)
                    setSaved(JSON.stringify(result.preferences))
                    toast.success("Настройки уведомлений сохранены")
                  })
                }
              >
                {busy === "save" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                Сохранить
              </Button>
            </div>
          </footer>
        </section>
      ) : loading ? (
        <section
          className="settings-panel text-sm text-muted-foreground"
          aria-busy="true"
        >
          Загружаем настройки…
        </section>
      ) : null}
      <Dialog open={disconnect} onOpenChange={setDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отключить Telegram?</DialogTitle>
            <DialogDescription>
              Новые события перестанут приходить в этот чат. Push продолжит
              работать согласно вашим настройкам.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDisconnect(false)}
              disabled={!!busy}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={!!busy}
              onClick={() =>
                void perform("disconnect", async () => {
                  setTelegram((await request("telegram", "DELETE")) as Telegram)
                  setLink(null)
                  setDisconnect(false)
                  toast.success("Telegram отключён")
                })
              }
            >
              <Unplug />
              Отключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
