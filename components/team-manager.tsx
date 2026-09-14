"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon } from "@hugeicons/core-free-icons"

import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"

type Role = "owner" | "admin" | "dispatcher" | "driver"

type TeamMember = {
  membershipId: string
  userId: string
  displayName: string
  email: string
  role: Role
  isActive: boolean
  createdAt: string
  lastSeenAt?: string
  driverId?: string
}

type Me = { role: Role; displayName: string; email: string }

const roleLabels: Record<Role, string> = {
  owner: "Владелец",
  admin: "Администратор",
  dispatcher: "Диспетчер",
  driver: "Водитель",
}

const roleDescriptions: Record<Role, string> = {
  owner: "Полный доступ, команда и настройки",
  admin: "Операции и настройки компании",
  dispatcher: "Рейсы, бронирования и клиенты",
  driver: "Статусы рейса и GPS с телефона",
}

function isCollection(value: unknown): value is { items: TeamMember[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

function isMe(value: unknown): value is Me {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    typeof value.role === "string" &&
    "email" in value &&
    typeof value.email === "string"
  )
}

function errorFrom(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

function humanDate(value?: string) {
  if (!value) return "Ещё не входил"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Нет данных"
    : new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
}

function manageableRoles(role: Role): Role[] {
  return role === "owner"
    ? ["owner", "admin", "dispatcher", "driver"]
    : ["dispatcher", "driver"]
}

export function TeamManager() {
  const [members, setMembers] = React.useState<TeamMember[]>([])
  const [me, setMe] = React.useState<Me | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [showForm, setShowForm] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [changingId, setChangingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({
    displayName: "",
    email: "",
    password: "",
    role: "dispatcher" as Role,
    driverPhone: "",
  })

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [teamResponse, meResponse] = await Promise.all([
        sessionFetch("/api/team", { cache: "no-store" }),
        sessionFetch("/api/auth/me", { cache: "no-store" }),
      ])
      const [teamPayload, mePayload]: [unknown, unknown] = await Promise.all([
        teamResponse.json(),
        meResponse.json(),
      ])
      if (!teamResponse.ok || !isCollection(teamPayload))
        throw new Error(errorFrom(teamPayload, "Не удалось загрузить команду."))
      if (!meResponse.ok || !isMe(mePayload))
        throw new Error("Не удалось определить ваши права.")
      setMembers(teamPayload.items)
      setMe(mePayload)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить команду."
      )
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function createMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await sessionFetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(payload, "Не удалось добавить сотрудника."))
      setForm({
        displayName: "",
        email: "",
        password: "",
        role: "dispatcher",
        driverPhone: "",
      })
      setShowForm(false)
      setNotice(
        "Сотрудник добавлен. Передайте ему ссылку на вход и пароль безопасным способом."
      )
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось добавить сотрудника."
      )
    } finally {
      setSaving(false)
    }
  }

  async function updateMember(
    member: TeamMember,
    change: { role?: Role; isActive?: boolean }
  ) {
    setChangingId(member.membershipId)
    setError(null)
    setNotice(null)
    try {
      const response = await sessionFetch(
        `/api/team?id=${encodeURIComponent(member.membershipId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(change),
        }
      )
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(payload, "Не удалось изменить доступ."))
      setNotice(
        change.isActive === false
          ? "Доступ сотрудника остановлен, его активные сессии завершены."
          : "Права сотрудника обновлены."
      )
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось изменить доступ."
      )
    } finally {
      setChangingId(null)
    }
  }

  const canManage = (member: TeamMember) => {
    if (!me) return false
    return (
      me.role === "owner" ||
      (me.role === "admin" &&
        (member.role === "dispatcher" || member.role === "driver"))
    )
  }
  const roles = me ? manageableRoles(me.role) : []

  return (
    <AppShell pageTitle="Команда" utilities={<ThemeCustomizer />}>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-[-.035em] sm:text-3xl">
              Доступы сотрудников
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Здесь выдаются роли для работы в компании. Вход и все рабочие
              данные остаются внутри пространства вашей компании.
            </p>
          </div>
          <Button
            disabled={loading || !me}
            onClick={() => {
              setError(null)
              setNotice(null)
              setShowForm((current) => !current)
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={17} />
            {showForm ? "Скрыть форму" : "Добавить сотрудника"}
          </Button>
        </div>
        {error ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
            {notice}
          </div>
        ) : null}
        {showForm ? (
          <form
            className="surface-card grid gap-4 p-5 sm:grid-cols-2"
            onSubmit={createMember}
          >
            <div className="sm:col-span-2">
              <h2 className="font-bold">Новый сотрудник</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Пароль создаёт новый локальный аккаунт. Для уже существующего
                пользователя пароль не меняется.
              </p>
            </div>
            <label className="grid gap-2 text-sm font-semibold">
              Имя
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                maxLength={120}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                required
                value={form.displayName}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Рабочий email
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                type="email"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
                value={form.email}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Временный пароль
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                minLength={12}
                type="password"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                required
                value={form.password}
              />
              <span className="text-xs font-normal text-muted-foreground">
                Не менее 12 символов.
              </span>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Роль
              <FieldSelect
                disabled={saving}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    role: value as Role,
                  }))
                }
                options={roles.map((role) => ({
                  value: role,
                  label: roleLabels[role],
                }))}
                value={form.role}
              />
              <span className="text-xs font-normal text-muted-foreground">
                {roleDescriptions[form.role]}
              </span>
            </label>
            {form.role === "driver" ? (
              <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
                Телефон водителя
                <input
                  className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  disabled={saving}
                  inputMode="tel"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      driverPhone: event.target.value,
                    }))
                  }
                  placeholder="+380501234567"
                  required
                  value={form.driverPhone}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Создаёт водительский профиль и связывает его с этим аккаунтом.
                </span>
              </label>
            ) : null}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button
                disabled={saving}
                onClick={() => setShowForm(false)}
                type="button"
                variant="ghost"
              >
                Отмена
              </Button>
              <Button disabled={saving} type="submit">
                {saving ? "Добавляем…" : "Выдать доступ"}
              </Button>
            </div>
          </form>
        ) : null}
        <section className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="font-bold">Сотрудники</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {loading
                  ? "Загружаем доступы…"
                  : `${members.filter((member) => member.isActive).length} активных из ${members.length}`}
              </p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {!loading && members.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">
                Сотрудников пока нет.
              </p>
            ) : null}
            {members.map((member) => {
              const editable = canManage(member)
              const self = me?.email === member.email
              return (
                <article
                  className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_12rem_10rem] md:items-center"
                  key={member.membershipId}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{member.displayName}</h3>
                      <span
                        className={
                          member.isActive
                            ? "rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
                            : "rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
                        }
                      >
                        {member.isActive ? "Активен" : "Отключён"}
                      </span>
                      {self ? (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                          Вы
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {member.email}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Последний вход: {humanDate(member.lastSeenAt)}
                    </p>
                  </div>
                  <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                    Роль
                    <FieldSelect
                      aria-label={`Роль ${member.displayName}`}
                      disabled={!editable || changingId === member.membershipId}
                      onValueChange={(value) =>
                        void updateMember(member, {
                          role: value as Role,
                        })
                      }
                      options={(editable ? roles : [member.role]).map(
                        (role) => ({ value: role, label: roleLabels[role] })
                      )}
                      triggerClassName="h-10 text-sm font-semibold"
                      value={member.role}
                    />
                  </label>
                  <div className="flex justify-start md:justify-end">
                    {editable ? (
                      <Button
                        disabled={
                          changingId === member.membershipId ||
                          (self && member.isActive)
                        }
                        onClick={() =>
                          void updateMember(member, {
                            isActive: !member.isActive,
                          })
                        }
                        size="sm"
                        variant={member.isActive ? "outline" : "default"}
                      >
                        {changingId === member.membershipId
                          ? "Сохраняем…"
                          : member.isActive
                            ? "Отключить"
                            : "Включить"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Нет прав на изменение
                      </span>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
