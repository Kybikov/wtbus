"use client"
import * as React from "react"
import { CrewPayroll } from "@/components/trip-crew-editor"
import { sessionFetch } from "@/lib/session-navigation"
import type { MoneyWallet } from "@/lib/money-v2"

export function CrewPayrollWorkspace() {
  const [wallets, setWallets] = React.useState<MoneyWallet[]>([])
  const [error, setError] = React.useState("")
  const load = React.useCallback(async () => {
    try {
      const response = await sessionFetch("/api/money", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok)
        throw Error(data.error ?? "Не удалось загрузить доступные кошельки.")
      setWallets(data.wallets)
      setError("")
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить кошельки."
      )
    }
  }, [])
  React.useEffect(() => {
    const initial = setTimeout(() => void load(), 0)
    return () => clearTimeout(initial)
  }, [load])
  return (
    <div className="min-w-0 space-y-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <CrewPayroll wallets={wallets} onUpdated={() => void load()} />
    </div>
  )
}
