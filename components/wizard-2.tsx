"use client"

// Licensed React Bits Pro wizard-2: grouped task flow and back/continue footer,
// adapted for a compact bus checkout with one named step indicator.
import { type ReactNode } from "react"
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function Wizard2({ step, title, children, summary, onBack, onNext, busy, nextLabel, disabled }: {
  step: number; title: string; children: ReactNode; summary: ReactNode; onBack: () => void; onNext: () => void; busy: boolean; nextLabel: string; disabled?: boolean
}) {
  const headings = ["Пасажири", "Перевірка", "Готово"]
  return <section data-trip-checkout aria-label="Оформлення бронювання" className="mx-auto flex w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-[var(--rb-r-lg)] border border-border bg-card">
    <header className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-4 sm:px-8">
      <h1 className="min-w-0 text-lg font-semibold">{title}</h1>
    </header>
    <div className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8">
      <ol aria-label="Кроки оформлення" className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs sm:text-sm">{headings.map((heading, index) => <li key={heading} aria-current={index + 1 === step ? "step" : undefined} className={`flex items-center gap-2 ${index + 1 === step ? "font-semibold text-primary" : "text-muted-foreground"}`}><span aria-hidden="true" className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${index + 1 <= step ? "border-primary/40 text-primary" : "border-border"}`}>{index + 1 < step ? <Check className="size-3.5" /> : index + 1}</span>{heading}</li>)}</ol>
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_260px]"><div className="min-w-0">{children}</div><aside aria-label="Ваш рейс" className="min-w-0 border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">{summary}</aside></div>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-4 sm:px-8">
      <Button className="h-11 px-4" variant="outline" disabled={busy} onClick={onBack}><ArrowLeft />{step === 1 || step === 3 ? "До пошуку" : "Назад"}</Button>
      <Button className="h-11 px-4" onClick={onNext} disabled={busy || disabled} aria-busy={busy}>{busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ArrowRight />}{nextLabel}</Button>
    </footer>
  </section>
}
