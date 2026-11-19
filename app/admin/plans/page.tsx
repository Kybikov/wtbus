import Link from "next/link"
import { ArrowRight, Receipt } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"

async function loadPlan(): Promise<{
  monthlyMinor: number
  currency: string
} | null> {
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/platform/plan`,
      { cache: "no-store", signal: AbortSignal.timeout(5_000) }
    )
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

export default async function PlansPage() {
  const plan = await loadPlan()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Тарифы</h1>
      <section
        className="workspace-panel max-w-xl space-y-5 p-5 sm:p-6"
        aria-label="Тариф рабочего пространства"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Receipt className="size-5" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold">Рабочее пространство</h2>
        </div>
        {plan ? (
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              {new Intl.NumberFormat("ru-RU", {
                style: "currency",
                currency: plan.currency,
                maximumFractionDigits: 0,
              }).format(plan.monthlyMinor / 100)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              За месяц для одной компании
            </p>
          </div>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            Не удалось загрузить стоимость тарифа.
          </p>
        )}
        <ul className="space-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
          <li>Платежи и продления вносятся вручную в карточке компании.</li>
          <li>
            Персональная скидка и дата оплаты задаются в карточке клиента.
          </li>
          <li>
            Доступ действует до указанной даты включительно по времени компании.
          </li>
          <li>По истечении срока компания может просматривать свои данные.</li>
        </ul>
        <Link
          className="inline-flex min-h-9 items-center gap-2 rounded-lg text-sm font-medium text-primary hover:underline"
          href="/admin"
        >
          Управление компаниями <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>
    </div>
  )
}
