"use client"

import * as React from "react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { AppShell } from "@/components/app-shell"
import {
  EntityDataView,
  type EntityAction,
  type EntityColumn,
} from "@/components/entity-data-view"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
import { sessionFetch } from "@/lib/session-navigation"

type Role = "developer" | "owner" | "admin" | "dispatcher" | "driver"

type TeamMember = {
  membershipId: string
  userId: string
  displayName: string
  email: string
  role: Role
  isActive: boolean
  isSystem: boolean
  createdAt: string
  lastSeenAt?: string
  driverId?: string
  actionCount: number
  lastActionAt?: string
}

type Me = {
  membershipId: string
  role: Role
  displayName: string
  email: string
}

const roleLabels: Record<Role, string> = {
  developer: "Разработчик",
  owner: "Владелец",
  admin: "Администратор",
  dispatcher: "Диспетчер",
  driver: "Водитель",
}

const allRoles = Object.keys(roleLabels) as Role[]

function isRole(value: string): value is Role {
  return allRoles.includes(value as Role)
}

const roleDescriptions: Record<Role, string> = {
  developer: "Полный доступ ко всем разделам и управлению доступами",
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
    "membershipId" in value &&
    typeof value.membershipId === "string" &&
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

function humanDate(value?: string, empty = "Ещё не входил") {
  if (!value) return empty
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Нет данных"
    : new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
}

function manageableRoles(role: Role): Role[] {
  if (role === "developer") return allRoles
  return role === "owner"
    ? ["owner", "admin", "dispatcher", "driver"]
    : ["dispatcher", "driver"]
}

const emptyForm = {
  displayName: "",
  email: "",
  password: "",
  role: "dispatcher" as Role,
  driverPhone: "",
}

export function TeamManager() {
  const [members, setMembers] = React.useState<TeamMember[]>([])
  const [me, setMe] = React.useState<Me | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [showForm, setShowForm] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [changingId, setChangingId] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<TeamMember | null>(
    null
  )
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [query, setQuery] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [form, setForm] = React.useState(emptyForm)

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

  const canManage = React.useCallback(
    (member: TeamMember) =>
      Boolean(
        me &&
        !member.isSystem &&
        (me.role === "developer" ||
          (me.role === "owner" && member.role !== "developer") ||
          (me.role === "admin" &&
            (member.role === "dispatcher" || member.role === "driver")))
      ),
    [me]
  )

  const canDelete = React.useCallback(
    (member: TeamMember) =>
      Boolean(
        me &&
        !member.isSystem &&
        member.membershipId !== me.membershipId &&
        (me.role === "developer" ||
          (me.role === "owner" && member.role !== "developer") ||
          (me.role === "admin" &&
            member.role !== "developer" &&
            (!member.isActive ||
              member.role === "dispatcher" ||
              member.role === "driver")))
      ),
    [me]
  )

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
      setForm(emptyForm)
      setShowForm(false)
      setNotice("Сотрудник добавлен. Передайте пароль безопасным способом.")
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
    change: { role?: Role; isActive?: boolean },
    quiet = false
  ) {
    setChangingId(member.membershipId)
    setError(null)
    if (!quiet) setNotice(null)
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
      if (!quiet) setNotice("Доступ сотрудника обновлён.")
      return true
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось изменить доступ."
      )
      return false
    } finally {
      setChangingId(null)
    }
  }

  async function deleteMember(member: TeamMember) {
    setChangingId(member.membershipId)
    setError(null)
    try {
      const response = await sessionFetch(
        `/api/team?id=${encodeURIComponent(member.membershipId)}`,
        { method: "DELETE" }
      )
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(payload, "Не удалось удалить сотрудника."))
      setNotice(`${member.displayName} удалён из команды.`)
      return true
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось удалить сотрудника."
      )
      return false
    } finally {
      setChangingId(null)
    }
  }

  async function updateSelected(isActive: boolean) {
    const targets = members.filter(
      (member) => selected.has(member.membershipId) && canManage(member)
    )
    let updated = 0
    for (const member of targets) {
      if (!(await updateMember(member, { isActive }, true))) break
      updated += 1
    }
    setSelected(new Set())
    setNotice(`Обновлено сотрудников: ${updated}.`)
    await load()
  }

  const filteredMembers = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU")
    if (!normalized) return members
    return members.filter((member) =>
      [
        member.displayName,
        member.email,
        member.isSystem
          ? "системный автомат автоматизация"
          : roleLabels[member.role],
      ].some((value) => value.toLocaleLowerCase("ru-RU").includes(normalized))
    )
  }, [members, query])

  const roles = React.useMemo(() => (me ? manageableRoles(me.role) : []), [me])
  const columns = React.useMemo<EntityColumn<TeamMember>[]>(
    () => [
      {
        id: "name",
        metric: { kind: "text", getValue: (member) => member.displayName },
        label: "Сотрудник",
        value: (member) => (
          <div className="min-w-48">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{member.displayName}</span>
              {member.membershipId === me?.membershipId ? (
                <Badge variant="secondary">Вы</Badge>
              ) : null}
              {member.isSystem ? <Badge variant="ghost">Система</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {member.isSystem ? "Внутренняя автоматизация" : member.email}
            </p>
          </div>
        ),
      },
      {
        id: "status",
        metric: {
          kind: "enum",
          getValue: (member) =>
            member.isSystem
              ? "system"
              : member.isActive
                ? "active"
                : "inactive",
          options: [
            { value: "active", label: "Активен", tone: "success" },
            { value: "inactive", label: "Отключён", tone: "neutral" },
            { value: "system", label: "Системный", tone: "info" },
          ],
        },
        label: "Статус",
        value: (member) => (
          <Badge
            variant={
              member.isSystem || member.isActive ? "default" : "secondary"
            }
          >
            {member.isSystem
              ? "Работает"
              : member.isActive
                ? "Активен"
                : "Отключён"}
          </Badge>
        ),
      },
      {
        id: "role",
        metric: {
          kind: "enum",
          getValue: (member) => (member.isSystem ? "automation" : member.role),
          options: [
            ...allRoles.map((value) => ({ value, label: roleLabels[value] })),
            { value: "automation", label: "Автоматизация" },
          ],
        },
        label: "Роль",
        value: (member) =>
          member.isSystem ? (
            <Badge variant="ghost">Автоматизация</Badge>
          ) : (
            <FieldSelect
              aria-label={`Роль ${member.displayName}`}
              disabled={
                !canManage(member) || changingId === member.membershipId
              }
              onValueChange={(value) =>
                void updateMember(member, { role: value as Role }).then(
                  (ok) => {
                    if (ok) void load()
                  }
                )
              }
              options={(canManage(member) ? roles : [member.role]).map(
                (role) => ({
                  value: role,
                  label: roleLabels[role],
                })
              )}
              triggerClassName="h-9 min-w-40 text-sm"
              value={member.role}
            />
          ),
      },
      {
        id: "lastSeen",
        metric: {
          kind: "date",
          getValue: (member) => (member.isSystem ? null : member.lastSeenAt),
        },
        label: "Последний вход",
        value: (member) =>
          member.isSystem ? "Вход запрещён" : humanDate(member.lastSeenAt),
      },
      {
        id: "actionCount",
        metric: { kind: "number", getValue: (member) => member.actionCount },
        label: "Действий",
        value: (member) => (member.isSystem ? member.actionCount : "—"),
        className: "tabular-nums",
      },
      {
        id: "lastActionAt",
        metric: { kind: "date", getValue: (member) => member.lastActionAt },
        label: "Последнее действие",
        value: (member) =>
          member.isSystem
            ? humanDate(member.lastActionAt, "Ещё нет действий")
            : "—",
      },
      {
        id: "createdAt",
        metric: { kind: "date", getValue: (member) => member.createdAt },
        label: "Добавлен",
        value: (member) => humanDate(member.createdAt),
        defaultVisible: false,
      },
      {
        id: "userId",
        metric: { kind: "text", getValue: (member) => member.userId },
        label: "ID пользователя",
        value: (member) => member.userId,
        defaultVisible: false,
      },
      {
        id: "membershipId",
        metric: { kind: "text", getValue: (member) => member.membershipId },
        label: "ID доступа",
        value: (member) => member.membershipId,
        defaultVisible: false,
      },
      {
        id: "driverId",
        metric: { kind: "text", getValue: (member) => member.driverId },
        label: "ID водителя",
        value: (member) => member.driverId ?? "—",
        defaultVisible: false,
      },
    ],
    [canManage, changingId, load, me?.membershipId, roles]
  )

  const actions = React.useMemo<EntityAction<TeamMember>[]>(
    () => [
      {
        label: "Включить / отключить",
        disabled: (member) =>
          !canManage(member) || member.membershipId === me?.membershipId,
        onSelect: (member) =>
          void updateMember(member, { isActive: !member.isActive }).then(
            (ok) => {
              if (ok) void load()
            }
          ),
      },
      {
        label: "Удалить из команды",
        destructive: true,
        disabled: (member) => !canDelete(member),
        onSelect: setDeleteTarget,
      },
    ],
    [canDelete, canManage, load, me?.membershipId]
  )

  return (
    <AppShell
      collectionFooter
      onRefresh={load}
      refreshing={loading}
      localSearch={{
        value: query,
        onChange: setQuery,
        placeholder: "Сотрудник, email или роль",
      }}
      pageActions={
        <Button disabled={loading || !me} onClick={() => setShowForm(true)}>
          <HugeiconsIcon icon={Add01Icon} size={17} />
          Добавить сотрудника
        </Button>
      }
      pageDescription="Сотрудники, роли доступа и системная автоматизация"
      pageTitle="Команда"
      utilities={<ThemeCustomizer />}
    >
      <div className="space-y-4">
        {error ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {notice ? (
          <div
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400"
            role="status"
          >
            {notice}
          </div>
        ) : null}
        <EntityDataView
          collection="team"
          filters={[
            {
              id: "status",
              label: "Статус",
              options: [
                { value: "active", label: "Активен" },
                { value: "inactive", label: "Отключён" },
                { value: "system", label: "Системный" },
              ],
              matches: (member, value) =>
                value === "system"
                  ? Boolean(member.isSystem)
                  : !member.isSystem &&
                    member.isActive === (value === "active"),
            },
            {
              id: "role",
              label: "Роль",
              options: allRoles.map((role) => ({
                value: role,
                label: roleLabels[role],
              })),
              matches: (member, value) => member.role === value,
            },
          ]}
          actions={actions}
          bulkActions={
            <>
              <Button
                onClick={() => void updateSelected(true)}
                size="sm"
                variant="outline"
              >
                Включить
              </Button>
              <Button
                onClick={() => void updateSelected(false)}
                size="sm"
                variant="outline"
              >
                Отключить
              </Button>
            </>
          }
          columns={columns}
          emptyText="Сотрудники не найдены."
          getId={(member) => member.membershipId}
          getLabel={(member) => member.displayName}
          groupBy={(member) => (member.isSystem ? "automation" : member.role)}
          items={filteredMembers}
          isSelectable={(member) => !member.isSystem}
          kanbanGroups={[
            ...allRoles.map((role) => ({
              id: role,
              label: roleLabels[role],
            })),
            { id: "automation", label: "Автоматизация" },
          ]}
          loading={loading}
          modes={["table", "list", "kanban", "gallery"]}
          canMoveInKanban={(member) =>
            !member.isSystem &&
            member.membershipId !== me?.membershipId &&
            changingId !== member.membershipId &&
            canManage(member)
          }
          canMoveToKanbanGroup={(_, group) =>
            isRole(group) && roles.includes(group)
          }
          onKanbanGroupChange={async (member, group) => {
            if (!isRole(group)) return false
            const updated = await updateMember(member, { role: group })
            if (updated) await load()
            return updated
          }}
          onSelectedChange={setSelected}
          renderCard={(member) => (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{member.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {member.isSystem
                      ? "Внутренняя автоматизация"
                      : member.email}
                  </p>
                </div>
                <Badge
                  variant={
                    member.isSystem || member.isActive ? "default" : "secondary"
                  }
                >
                  {member.isSystem
                    ? "Работает"
                    : member.isActive
                      ? "Активен"
                      : "Отключён"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {member.isSystem
                  ? `Автоматизация · ${member.actionCount} действий · ${humanDate(member.lastActionAt, "ещё нет действий")}`
                  : `${roleLabels[member.role]} · ${humanDate(member.lastSeenAt)}`}
              </p>
            </div>
          )}
          selected={selected}
        />
      </div>

      <Dialog onOpenChange={setShowForm} open={showForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Новый сотрудник</DialogTitle>
            <DialogDescription>
              Создайте доступ и назначьте рабочую роль.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4 sm:grid-cols-2"
            id="team-member-form"
            onSubmit={createMember}
          >
            <label className="grid gap-2 text-sm font-semibold">
              Имя
              <Input
                autoComplete="name"
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
              <Input
                autoComplete="email"
                disabled={saving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
                type="email"
                value={form.email}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Временный пароль
              <Input
                autoComplete="new-password"
                disabled={saving}
                minLength={12}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                required
                type="password"
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
                <Input
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
              </label>
            ) : null}
          </form>
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => setShowForm(false)}
              type="button"
              variant="outline"
            >
              Отмена
            </Button>
            <Button disabled={saving} form="team-member-form" type="submit">
              {saving ? "Добавляем…" : "Выдать доступ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        open={Boolean(deleteTarget)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить сотрудника?</DialogTitle>
            <DialogDescription>
              Доступ {deleteTarget?.displayName} будет удалён, активные сессии
              завершатся. История рейсов сохранится.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDeleteTarget(null)} variant="outline">
              Отмена
            </Button>
            <Button
              disabled={
                !deleteTarget || changingId === deleteTarget.membershipId
              }
              onClick={() => {
                if (!deleteTarget) return
                void deleteMember(deleteTarget).then((ok) => {
                  if (ok) {
                    setDeleteTarget(null)
                    void load()
                  }
                })
              }}
              variant="destructive"
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
