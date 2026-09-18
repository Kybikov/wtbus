"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { LockPasswordIcon, Login03Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff } from "lucide-react"
import { safeReturnPath } from "@/lib/session-navigation"

type CompanyChoice = {
  slug: string
  name: string
  role: string
}

type CompanySelection = {
  selectionToken: string
  companies: CompanyChoice[]
}

function isCompanySelection(payload: unknown): payload is {
  requiresCompanySelection: true
  selectionToken: string
  companies: CompanyChoice[]
} {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "requiresCompanySelection" in payload &&
    payload.requiresCompanySelection === true &&
    "selectionToken" in payload &&
    typeof payload.selectionToken === "string" &&
    "companies" in payload &&
    Array.isArray(payload.companies) &&
    payload.companies.every(
      (company) =>
        typeof company === "object" &&
        company !== null &&
        "slug" in company &&
        typeof company.slug === "string" &&
        "name" in company &&
        typeof company.name === "string" &&
        "role" in company &&
        typeof company.role === "string"
    )
  )
}

function payloadError(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [companySelection, setCompanySelection] =
    React.useState<CompanySelection | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        throw new Error(payloadError(payload, "Не удалось выполнить вход."))
      }
      if (isCompanySelection(payload)) {
        setCompanySelection({
          selectionToken: payload.selectionToken,
          companies: payload.companies,
        })
        return
      }
      const next = new URLSearchParams(window.location.search).get("next")
      router.replace(safeReturnPath(next))
      router.refresh()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось выполнить вход."
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function selectCompany(company: CompanyChoice) {
    if (!companySelection) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/auth/select-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectionToken: companySelection.selectionToken,
          tenantSlug: company.slug,
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        throw new Error(payloadError(payload, "Не удалось выбрать компанию."))
      }
      const next = new URLSearchParams(window.location.search).get("next")
      router.replace(safeReturnPath(next))
      router.refresh()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось выбрать компанию."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
      <section className="w-full max-w-md rounded-[var(--app-radius)] border border-border bg-card p-6 shadow-xl shadow-black/10 sm:p-8">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <HugeiconsIcon icon={LockPasswordIcon} size={22} />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-[-.035em]">
          {companySelection ? "Выберите компанию" : "Вход в диспетчерскую"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {companySelection
            ? "Для этого профиля доступно несколько компаний."
            : "Используйте email и пароль рабочей учётной записи."}
        </p>
        {companySelection ? (
          <div className="mt-7 space-y-3">
            <p className="text-sm text-muted-foreground">{email}</p>
            <div className="space-y-2" role="list">
              {companySelection.companies.map((company) => (
                <button
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-primary/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={submitting}
                  key={company.slug}
                  onClick={() => selectCompany(company)}
                  role="listitem"
                  type="button"
                >
                  <span className="font-semibold">{company.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {company.role}
                  </span>
                </button>
              ))}
            </div>
            <Button
              className="w-full"
              disabled={submitting}
              onClick={() => {
                setCompanySelection(null)
                setPassword("")
                setShowPassword(false)
                setError(null)
              }}
              size="lg"
              type="button"
              variant="outline"
            >
              Войти с другим email
            </Button>
          </div>
        ) : (
          <form className="mt-7 space-y-4" onSubmit={submit}>
            <label className="grid gap-2 text-sm font-semibold">
              Email
              <Input
                autoComplete="email"
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <div className="grid gap-2 text-sm font-semibold">
              <label htmlFor="login-password">Пароль</label>
              <div className="relative">
                <Input
                  id="login-password"
                  autoComplete="current-password"
                  className="h-11 rounded-xl border border-border bg-background pr-12 pl-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <Button
                  aria-label={
                    showPassword ? "Скрыть пароль" : "Показать пароль"
                  }
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                  className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowPassword((visible) => !visible)}
                  size="icon-lg"
                  type="button"
                  variant="ghost"
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>
            <Button
              className="w-full"
              disabled={submitting}
              size="lg"
              type="submit"
            >
              <HugeiconsIcon icon={Login03Icon} size={18} />
              {submitting ? "Входим…" : "Войти"}
            </Button>
          </form>
        )}
        {error ? (
          <p
            className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </section>
    </main>
  )
}
