"use client"

import * as React from "react"
import { Copy, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
import { sessionFetch } from "@/lib/session-navigation"
import {
  invitationRoleLabels,
  type InvitationRole,
} from "@/lib/invitation-roles"

type Invite = {
  id: string
  role: InvitationRole
  expiresAt: string
  status: "open" | "expired" | "revoked" | "accepted"
  acceptedBy: string
  createdBy: string
  driverName: string
}
const states = {
  open: "Действует",
  expired: "Истекло",
  revoked: "Отозвано",
  accepted: "Принято",
}
const expires = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
})
const endpoint = "/api/team/invitations"

async function invitations(path = "", init?: RequestInit) {
  const response = await sessionFetch(endpoint + path, {
    cache: "no-store",
    ...init,
  })
  if (response.status === 204) return null
  const data = await response.json()
  if (!response.ok)
    throw Error(data.error ?? "Не удалось обновить приглашения.")
  return data
}

export function TeamInvitations({
  roles,
  drivers,
  readOnly,
}: {
  roles: string[]
  drivers: { id: string; name: string }[]
  readOnly?: boolean
}) {
  const options = (Object.keys(invitationRoleLabels) as InvitationRole[])
    .filter((role) => roles.includes(role))
    .map((value) => ({ value, label: invitationRoleLabels[value] }))
  const [open, setOpen] = React.useState(false)
  const [role, setRole] = React.useState<InvitationRole>("driver")
  const [driverId, setDriverId] = React.useState("")
  const [items, setItems] = React.useState<Invite[]>()
  const [busy, setBusy] = React.useState(false)
  const [shareLink, setShareLink] = React.useState("")
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState("")
  const disabled = readOnly || busy
  const reason = readOnly
    ? "Подписка истекла. Доступен только просмотр."
    : "Дождитесь завершения операции."

  async function load() {
    const result = await invitations()
    setItems(result.items)
  }

  function openDialog(value: boolean) {
    if (busy) return
    setOpen(value)
    setShareLink("")
    setCopied(false)
    setError("")
    if (value) {
      setItems(undefined)
      void load().catch((reason) => setError(reason.message))
    }
  }

  async function change(action: "create" | "revoke", id?: string) {
    if (disabled) return
    setBusy(true)
    setError("")
    try {
      if (action === "create") {
        const data = await invitations("", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            driverId: role === "driver" ? driverId : "",
          }),
        })
        setShareLink(`${window.location.origin}/invite#${data.token}`)
        setCopied(false)
      } else {
        await invitations(`?id=${encodeURIComponent(id ?? "")}`, {
          method: "DELETE",
        })
        setShareLink("")
      }
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось обновить приглашения."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => openDialog(true)}>
        <Link2 /> Приглашения
      </Button>
      <Dialog open={open} onOpenChange={openDialog}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Приглашения в команду</DialogTitle>
            <DialogDescription>
              Отправьте сотруднику одноразовую ссылку. Она действует 7 дней.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void change("create")
            }}
          >
            <label className="grid gap-1.5 text-sm">
              Роль
              <FieldSelect
                aria-label="Роль приглашённого"
                value={role}
                options={options}
                onValueChange={(value) => setRole(value as InvitationRole)}
                disabled={disabled}
                disabledReason={reason}
              />
            </label>
            {role === "driver" && (
              <label className="grid gap-1.5 text-sm">
                Профиль водителя
                <FieldSelect
                  aria-label="Профиль водителя"
                  value={driverId || "new"}
                  disabled={disabled}
                  disabledReason={reason}
                  options={[
                    { value: "new", label: "Создать профиль при регистрации" },
                    ...drivers.map((driver) => ({
                      value: driver.id,
                      label: driver.name,
                    })),
                  ]}
                  onValueChange={(value) =>
                    setDriverId(value === "new" ? "" : value)
                  }
                />
              </label>
            )}
            <Button
              type="submit"
              className="justify-self-start"
              disabled={disabled}
              disabledReason={reason}
            >
              Создать ссылку
            </Button>
          </form>
          {shareLink && (
            <div className="space-y-1.5 rounded-xl border border-border p-3">
              <label
                className="block text-sm font-medium"
                htmlFor="team-invitation-link"
              >
                Ссылка для сотрудника
              </label>
              <div className="flex gap-2">
                <Input
                  id="team-invitation-link"
                  value={shareLink}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shareLink)
                      setCopied(true)
                    } catch {
                      setError("Выделите ссылку и скопируйте её вручную.")
                    }
                  }}
                >
                  <Copy /> {copied ? "Скопировано" : "Копировать"}
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {items?.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {invitationRoleLabels[item.role]}
                      {item.driverName ? ` · ${item.driverName}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        states[item.status],
                        item.acceptedBy || item.createdBy,
                        item.status === "open"
                          ? expires.format(new Date(item.expiresAt))
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {item.status === "open" &&
                    options.some((role) => role.value === item.role) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        disabledReason={reason}
                        onClick={() => void change("revoke", item.id)}
                      >
                        Отозвать
                      </Button>
                    )}
                </li>
              ))}
            </ul>
          ) : !error ? (
            <p className="text-sm text-muted-foreground">
              {items ? "Приглашений пока нет." : "Загружаем приглашения…"}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
