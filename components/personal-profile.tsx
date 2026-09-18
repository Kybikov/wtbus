"use client"

import * as React from "react"
import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { SettingsFormSection, SettingsRow } from "@/components/settings-form-1"
import { sessionFetch } from "@/lib/session-navigation"

type Profile = { displayName: string; email: string; role: string; tenantSlug: string }
function isProfile(value: unknown): value is Profile {
  return typeof value === "object" && value !== null &&
    "displayName" in value && typeof value.displayName === "string" &&
    "email" in value && typeof value.email === "string" &&
    "role" in value && typeof value.role === "string" &&
    "tenantSlug" in value && typeof value.tenantSlug === "string"
}
function errorMessage(value: unknown, fallback: string) {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : fallback
}
const roles: Record<string, string> = { owner: "Владелец", admin: "Администратор", dispatcher: "Диспетчер", driver: "Водитель" }

export function PersonalProfile() {
  const [profile, setProfile] = React.useState<Profile | null>(null)
  const [name, setName] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmation, setConfirmation] = React.useState("")
  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await sessionFetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isProfile(payload)) throw new Error(errorMessage(payload, "Не удалось загрузить профиль."))
      setProfile(payload)
      setName(payload.displayName)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить профиль.") }
    finally { setLoading(false) }
  }, [])
  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function save(event: React.FormEvent, password: boolean) {
    event.preventDefault()
    setNotice(null)
    setError(null)
    if (password && (newPassword !== confirmation || new TextEncoder().encode(newPassword).length > 72)) {
      setError(newPassword !== confirmation ? "Пароли не совпадают." : "Пароль не должен превышать 72 байта.")
      return
    }
    setSaving(true)
    try {
      const response = await sessionFetch("/api/auth/me", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(password ? { currentPassword, newPassword } : { displayName: name.trim() }),
        signal: AbortSignal.timeout(15_000),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isProfile(payload)) throw new Error(errorMessage(payload, "Не удалось сохранить профиль."))
      setProfile(payload)
      if (password) {
        setCurrentPassword(""); setNewPassword(""); setConfirmation("")
      } else setName(payload.displayName)
      window.dispatchEvent(new CustomEvent("vivat-profile-change", { detail: payload }))
      setNotice(password ? "Пароль изменён. Сессии на других устройствах закрыты." : "Имя сохранено.")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить профиль.") }
    finally { setSaving(false) }
  }

  return (
    <AppShell pageTitle="Личный профиль" pageDescription="Ваши данные и безопасность аккаунта" onRefresh={load} refreshing={loading || saving} utilities={<ThemeCustomizer />}>
      <div className="space-y-5">
        {error ? <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">{notice}</p> : null}
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <SettingsFormSection title="Личные данные" description="Ваше имя и доступ в компанию.">
              <form className="@container space-y-5" onSubmit={(event) => void save(event, false)}>
                <SettingsRow id="profile-name" label="Имя" changed={profile !== null && name.trim() !== profile.displayName}><Input id="profile-name" autoComplete="name" disabled={loading || saving} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></SettingsRow>
                <SettingsRow id="profile-email" label="Email" description="Используется для входа в аккаунт."><Input id="profile-email" aria-describedby="profile-email-hint" autoComplete="email" readOnly value={profile?.email ?? ""} /></SettingsRow>
                <div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-muted-foreground">Роль в компании</span><Badge variant="secondary">{profile ? roles[profile.role] ?? profile.role : "Загружаем…"}</Badge></div>
                <Button disabled={loading || saving || !name.trim() || name.trim() === profile?.displayName} type="submit">{saving ? "Сохраняем…" : "Сохранить имя"}</Button>
              </form>
          </SettingsFormSection>
          <SettingsFormSection title="Смена пароля" description="После изменения потребуется заново войти на других устройствах.">
              <form className="@container space-y-5" onSubmit={(event) => void save(event, true)}>
                <SettingsRow id="profile-current-password" label="Текущий пароль"><Input id="profile-current-password" autoComplete="current-password" type="password" required disabled={loading || saving} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></SettingsRow>
                <SettingsRow id="profile-new-password" label="Новый пароль" description="От 10 символов. Максимум 72 байта."><Input id="profile-new-password" aria-describedby="profile-new-password-hint" autoComplete="new-password" type="password" minLength={10} required disabled={loading || saving} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></SettingsRow>
                <SettingsRow id="profile-confirmation" label="Повторите новый пароль"><Input id="profile-confirmation" autoComplete="new-password" type="password" minLength={10} required disabled={loading || saving} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></SettingsRow>
                <Button type="submit" variant="outline" disabled={loading || saving || !currentPassword || !newPassword || !confirmation}>{saving ? "Сохраняем…" : "Изменить пароль"}</Button>
              </form>
          </SettingsFormSection>
        </div>
      </div>
    </AppShell>
  )
}
