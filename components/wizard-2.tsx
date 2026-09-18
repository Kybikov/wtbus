"use client"

// Licensed React Bits Pro wizard-2: full-screen grouped task flow,
// centred progress and back/continue footer, adapted for bus booking.
import { type ReactNode } from "react"
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function Wizard2({ step, title, children, summary, onBack, onNext, busy, nextLabel, disabled }: {
  step: number; title: string; children: ReactNode; summary: ReactNode; onBack: () => void; onNext: () => void; busy: boolean; nextLabel: string; disabled?: boolean
}) {
  const headings = ["Дані пасажира", "Перевірка", "Готово"]
  return <section data-trip-checkout aria-label="Оформлення бронювання" className="flex min-h-[calc(100svh-8rem)] min-w-0 flex-col overflow-hidden rounded-[var(--rb-r-lg)] border border-border bg-card">
    <header className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-4 sm:px-8">
      <h1 className="min-w-0 text-lg font-semibold">{title}</h1>
      <div className="flex min-w-0 flex-1 justify-center"><div role="progressbar" aria-label="Прогрес бронювання" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3} aria-valuetext={headings[step - 1]} className="h-1.5 w-full max-w-60 overflow-hidden rounded-full bg-muted"><div style={{ width: `${step / 3 * 100}%` }} className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" /></div></div>
      <p className="text-xs tabular-nums text-muted-foreground">{step} / 3</p>
    </header>
    <div className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8">
      <ol aria-label="Кроки оформлення" className="mb-8 flex flex-wrap gap-x-6 gap-y-2 text-xs sm:text-sm">{headings.map((heading, index) => <li key={heading} aria-current={index + 1 === step ? "step" : undefined} className={index + 1 === step ? "font-semibold text-primary" : "text-muted-foreground"}>{index + 1}. {heading}</li>)}</ol>
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"><div className="min-w-0">{children}</div><aside aria-label="Ваш рейс" className="min-w-0 border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">{summary}</aside></div>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-4 sm:px-8">
      <Button className="h-11 px-4" variant="outline" disabled={busy} onClick={onBack}><ArrowLeft />{step === 1 || step === 3 ? "До пошуку" : "Назад"}</Button>
      <Button className="h-11 px-4" onClick={onNext} disabled={busy || disabled} aria-busy={busy}>{busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ArrowRight />}{nextLabel}</Button>
    </footer>
  </section>
}
