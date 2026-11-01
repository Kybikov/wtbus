"use client"

import * as React from "react"
import { Bus, Check, Plus, Route, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const kinds = [
  { key: "route_id", resource: "routes", label: "Маршрут", icon: Route },
  { key: "vehicle_id", resource: "vehicles", label: "Авто", icon: Bus },
  { key: "driver_id", resource: "drivers", label: "Водитель", icon: UserRound },
] as const

export function TripLinkPicker({
  item,
  resources,
  onChoose,
  disabledReason,
  resourceError,
}: {
  item: Record<string, unknown>
  resources: Record<string, { id: string; name: string }[]>
  onChoose: (key: string, value: string) => void
  disabledReason?: string
  resourceError?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<string>("route_id")
  const [search, setSearch] = React.useState("")
  const selected = kinds.find((entry) => entry.key === kind) ?? kinds[0]
  const entries = resources[selected.resource]
  const unavailable =
    disabledReason ||
    (selected.key === "route_id" && item.kind === "individual"
      ? "Маршрут можно связать с регулярным рейсом. Измените тип рейса в деталях."
      : undefined)
  const choices = (entries ?? []).filter((entry) =>
    entry.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  )
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch("")
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Связать запись"
            disabled={!!disabledReason}
            disabledReason={disabledReason}
          />
        }
      >
        <Plus className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Связать запись</DialogTitle>
          <DialogDescription>
            Один маршрут, автомобиль и водитель на рейс. Новый выбор заменит
            текущую связь.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={kind}
          onValueChange={(next) => {
            setKind(String(next))
            setSearch("")
          }}
        >
          <TabsList className="w-full min-w-0" aria-label="Тип связи">
            {kinds.map(({ key, label, icon: Icon }) => (
              <TabsTrigger key={key} value={key} className="min-w-0 px-2">
                <Icon className="hidden size-4 sm:block" />
                <span className="truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          aria-label="Найти связанную запись"
          placeholder="Поиск по названию…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {unavailable || resourceError ? (
          <p role="status" className="text-sm text-muted-foreground">
            {unavailable || resourceError}
          </p>
        ) : !entries ? (
          <p role="status" className="text-sm text-muted-foreground">
            Загружаем записи…
          </p>
        ) : (
          <div className="grid min-w-0 gap-1">
            {choices.map((entry) => (
              <Button
                key={entry.id}
                variant="ghost"
                className="h-auto min-h-12 w-full justify-start gap-3 py-3 text-left whitespace-normal"
                onClick={() => {
                  onChoose(selected.key, entry.id)
                  setOpen(false)
                }}
              >
                <selected.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {entry.name}
                </span>
                {item[selected.key] === entry.id && (
                  <Check
                    className="size-4 shrink-0 text-primary"
                    aria-label="Уже связано"
                  />
                )}
              </Button>
            ))}
            {!choices.length && (
              <p className="py-4 text-sm text-muted-foreground">
                {search
                  ? "Ничего не найдено."
                  : "Нет доступных записей этого типа."}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
