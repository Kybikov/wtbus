"use client"

import * as React from "react"
import { MapPin, Search, History, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { sessionFetch } from "@/lib/session-navigation"
import type { RoadPoint } from "@/components/route-navigation-editor"

type Place = { label: string; point: RoadPoint }
export function RoutePlacePicker({
  title,
  label,
  point,
  disabled,
  disabledReason,
  onChoose,
  onOpen,
}: {
  title: string
  label?: string
  point: RoadPoint | null
  disabled: boolean
  disabledReason: string
  onChoose: (point: RoadPoint | null, label: string) => void
  onOpen: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [saved, setSaved] = React.useState<Place[]>([])
  const [results, setResults] = React.useState<Place[] | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const version = React.useRef(0)
  const searchController = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => searchController.current?.abort(), [])
  React.useEffect(() => {
    if (!open) return
    let active = true
    void sessionFetch("/api/routes/places")
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok)
          throw new Error(payload.error || "Не удалось загрузить ваши места.")
        if (active) setSaved(payload.items)
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить ваши места."
          )
      })
    return () => {
      active = false
    }
  }, [open])
  async function search(event?: React.FormEvent) {
    event?.preventDefault()
    if (searching || query.trim().length < 2) return
    const requestVersion = ++version.current
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setSearching(true)
    setError(null)
    setResults(null)
    try {
      const response = await sessionFetch(
        `/api/routes/places?search=true&q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal }
      )
      const payload = await response.json()
      if (!response.ok)
        throw new Error(payload.error || "Не удалось найти место.")
      if (version.current === requestVersion) setResults(payload.items)
    } catch (reason) {
      if (version.current === requestVersion)
        setError(
          reason instanceof Error ? reason.message : "Не удалось найти место."
        )
    } finally {
      if (version.current === requestVersion) setSearching(false)
    }
  }
  function finish(point: RoadPoint | null, label: string) {
    version.current++
    searchController.current?.abort()
    setSearching(false)
    onChoose(point, label)
    setOpen(false)
  }
  function select(place: Place) {
    finish(place.point, place.label)
  }
  const available = saved.filter((place) =>
    place.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )
  return (
    <>
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-muted-foreground">{title}</p>
        <Button
          variant="outline"
          className="h-auto min-h-11 w-full justify-start gap-2 rounded-xl px-3 py-2.5 text-left font-normal whitespace-normal"
          aria-label={`Выбрать: ${title}`}
          disabled={disabled}
          disabledReason={disabledReason}
          onClick={() => {
            onOpen()
            setQuery("")
            setResults(null)
            setError(null)
            setOpen(true)
          }}
        >
          <MapPin className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">
            {label || (point ? "Точка на карте" : "Выбрать место")}
          </span>
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            version.current++
            searchController.current?.abort()
            setSearching(false)
          }
          setOpen(value)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom)-2rem)] gap-4 overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">
              Поиск по адресу или ссылке Google Maps, выбор из ваших мест.
            </DialogDescription>
          </DialogHeader>
          <div
            role="search"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.stopPropagation()
                void search()
              }
            }}
            className="flex min-w-0 gap-2"
          >
            <Input
              aria-label="Адрес или ссылка Google Maps"
              placeholder="Адрес, место или Google Maps"
              value={query}
              onChange={(event) => {
                version.current++
                searchController.current?.abort()
                setSearching(false)
                setQuery(event.target.value)
                setResults(null)
                setError(null)
              }}
              className="min-w-0 flex-1"
              autoComplete="off"
            />
            <Button
              type="button"
              onClick={() => void search()}
              size="icon"
              aria-label="Найти место"
              disabled={searching || query.trim().length < 2}
              disabledReason={
                searching
                  ? "Ищем место. Дождитесь результатов."
                  : "Введите хотя бы два символа адреса или названия."
              }
            >
              {searching ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {results !== null ? (
            <div className="space-y-1" aria-label="Результаты поиска">
              {results.length === 0 ? (
                <p role="status" className="py-3 text-sm text-muted-foreground">
                  Места не найдены. Уточните адрес.
                </p>
              ) : (
                results.map((place, index) => (
                  <Button
                    key={`${place.point}:${index}`}
                    variant="ghost"
                    className="h-auto min-h-12 w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal"
                    onClick={() => select(place)}
                  >
                    <MapPin className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-words">{place.label}</span>
                  </Button>
                ))
              )}
            </div>
          ) : null}
          {available.length > 0 ? (
            <div className="space-y-1">
              <p className="px-3 text-xs text-muted-foreground">Ваши места</p>
              {available.map((place, index) => (
                <Button
                  key={`${place.point}:${index}`}
                  variant="ghost"
                  className="h-auto min-h-12 w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal"
                  onClick={() => select(place)}
                >
                  <History className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">{place.label}</span>
                </Button>
              ))}
            </div>
          ) : null}
          {point ? (
            <Button
              variant="ghost"
              className="justify-self-start text-muted-foreground"
              onClick={() => {
                finish(null, "")
              }}
            >
              Очистить точку
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
