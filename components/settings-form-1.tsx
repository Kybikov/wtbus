"use client"

// Adapted from the licensed React Bits Pro settings-form-1 App UI block.
// Keep its responsive settings rows; controls use the shared shadcn primitives.
import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

export function SettingsFormSection({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  return <Card className="min-w-0">
    <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
}

export function SettingsRow({ id, label, description, changed, children }: {
  id: string
  label: string
  description?: string
  changed?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[var(--rb-r-lg)] bg-muted/35 p-3 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="text-sm font-medium">{label}</label>
          {changed ? <span className="text-xs text-primary">Изменено</span> : null}
        </div>
        {description ? <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="w-full min-w-0 @xl:w-64 @xl:shrink-0">{children}</div>
    </div>
  )
}
