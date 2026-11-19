"use client"

import * as React from "react"
import Link from "next/link"
import { Building2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  invitationRoleLabels,
  type InvitationRole,
} from "@/lib/invitation-roles"

type Invitation = { company: string; role: InvitationRole; expiresAt: string }

async function invitationRequest(
  action: "preview" | "accept",
  data: object,
  signal?: AbortSignal
) {
  const response = await fetch(`/api/auth/invitations/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal,
  })
  const payload = await response.json()
  if (!response.ok)
    throw Error(payload.error || "Приглашение временно недоступно.")
  return payload
}

export function InvitationRegistration() {
  const [invitation, setInvitation] = React.useState<Invitation>()
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [existing, setExisting] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    void invitationRequest(
      "preview",
      { token: window.location.hash.slice(1) },
      controller.signal
    )
      .then(setInvitation)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  async function accept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !invitation) return
    const fields = Object.fromEntries(new FormData(event.currentTarget))
    setSaving(true)
    setError("")
    try {
      await invitationRequest("accept", {
        ...fields,
        token: window.location.hash.slice(1),
      })
      try {
        localStorage.removeItem("vivat-ui-preferences")
        localStorage.setItem("vivat:workspace-change", crypto.randomUUID())
      } catch {
        // The new session already selects the workspace.
      }
      window.location.replace(invitation.role === "driver" ? "/driver" : "/")
    } catch (reason) {
      setSaving(false)
      setError(reason instanceof Error ? reason.message : "Попробуйте ещё раз.")
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <section className="workspace-panel w-full max-w-md space-y-5 p-5 sm:p-7">
        <div className="space-y-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-5" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold">
            {invitation?.company ?? "Приглашение в команду"}
          </h1>
          {invitation && (
            <p className="text-sm text-muted-foreground">
              Роль · {invitationRoleLabels[invitation.role]}
            </p>
          )}
        </div>
        {loading && (
          <p role="status" className="text-sm text-muted-foreground">
            Проверяем приглашение…
          </p>
        )}
        {invitation && (
          <form className="grid gap-4" onSubmit={accept}>
            {!existing && (
              <label className="grid gap-1.5 text-sm">
                Имя и фамилия
                <Input
                  name="displayName"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={120}
                />
              </label>
            )}
            <label className="grid gap-1.5 text-sm">
              Email
              <Input
                name="email"
                type="email"
                autoComplete="username"
                maxLength={254}
                required
              />
            </label>
            {invitation.role === "driver" && (
              <label className="grid gap-1.5 text-sm">
                Телефон водителя
                <Input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+380"
                  maxLength={30}
                  required
                />
              </label>
            )}
            <label className="grid gap-1.5 text-sm">
              {existing ? "Пароль аккаунта" : "Новый пароль"}
              <Input
                key={String(existing)}
                name="password"
                type="password"
                autoComplete={existing ? "current-password" : "new-password"}
                minLength={existing ? undefined : 12}
                maxLength={72}
                required
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={saving}
              disabledReason="Подключаем аккаунт к компании."
            >
              {saving ? "Подключаем…" : "Принять приглашение"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              disabledReason="Подключаем аккаунт к компании."
              onClick={() => {
                setExisting(!existing)
                setError("")
              }}
            >
              {existing ? "Создать новый аккаунт" : "У меня есть аккаунт"}
            </Button>
          </form>
        )}
        {!invitation && error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!invitation && !loading && (
          <Link className="text-sm text-primary hover:underline" href="/login">
            Перейти ко входу
          </Link>
        )}
      </section>
    </main>
  )
}
