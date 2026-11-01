"use client"

import { PanelsTopLeft, X } from "lucide-react"
import { ReorderableList } from "@/components/list-4"
import { Button } from "@/components/ui/button"
import { DeliverySwitch } from "@/components/ui/delivery-switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import { mobileNavigation, resolveMobileDock } from "@/lib/mobile-navigation"
import type { StaffRole } from "@/lib/admin-actions"

export function MobileDockSettings({
  role,
  hrefs,
  onChange,
}: {
  role: StaffRole
  hrefs: string[]
  onChange: (hrefs: string[]) => void
}) {
  const selected = resolveMobileDock(role, hrefs)
  const available = mobileNavigation(role).filter(
    (page) => !selected.some((item) => item.href === page.href)
  )
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            className="h-12 w-full justify-start gap-3 rounded-2xl px-3"
          />
        }
      >
        <PanelsTopLeft className="size-5" />
        Нижняя навигация
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Нижняя навигация</DialogTitle>
        <DialogDescription className="sr-only">
            Перетащите разделы за ручку, чтобы изменить порядок. Добавьте нужные
            страницы.
          </DialogDescription>
        </DialogHeader>
        <ReorderableList
          items={selected}
          getId={(page) => page.href}
          getLabel={(page) => page.label}
          onReorder={(items) => onChange(items.map((page) => page.href))}
        >
          {(page, handle) => (
            <div className="flex min-h-12 items-center gap-2 rounded-2xl bg-control px-2 py-1">
              {handle}
              <span className="min-w-0 flex-1 text-sm">{page.label}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Убрать ${page.label}`}
                disabled={selected.length === 1}
                disabledReason="Оставьте хотя бы один раздел в нижней панели."
                onClick={() =>
                  onChange(
                    selected
                      .filter((item) => item.href !== page.href)
                      .map((item) => item.href)
                  )
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
        </ReorderableList>
        {available.length ? (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Добавить страницу
            </p>
            {available.map((page) => (
              <div
                key={page.href}
                className="flex min-h-12 items-center justify-between gap-3 px-2"
              >
                <span className="text-sm">{page.label}</span>
                <DeliverySwitch
                  label={`Добавить ${page.label}`}
                  checked={false}
                  onChange={(value) => {
                    if (value)
                      onChange([
                        ...selected.map((item) => item.href),
                        page.href,
                      ])
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
