"use client"

import * as React from "react"
import Image from "next/image"
import { ImagePlus, Link2, LoaderCircle, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

async function prepareLogo(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Выберите PNG, JPG или WebP.")
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Размер файла должен быть до 5 МБ.")
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 25_000_000)
      throw new Error(
        "Изображение слишком большое. Максимум — 25 мегапикселей."
      )
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Не удалось обработать изображение.")
    for (const maxSize of [256, 128]) {
      const ratio = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL("image/png")
      if (data.length <= 128 * 1024) return data
    }
    throw new Error(
      "Не удалось уменьшить логотип. Попробуйте другое изображение."
    )
  } finally {
    bitmap.close()
  }
}

export function LogoPicker({
  value,
  onValueChange,
  onValueCommit,
  disabled,
  label = "Логотип компании",
}: {
  value: string
  onValueChange: (value: string) => void
  onValueCommit?: (value: string) => void
  disabled?: boolean
  label?: string
}) {
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const [failedFor, setFailedFor] = React.useState<string | null>(null)
  const labelID = React.useId()
  async function choose(file?: File) {
    if (!file || disabled || busy) return
    setBusy(true)
    try {
      const next = await prepareLogo(file)
      onValueChange(next)
      onValueCommit?.(next)
    } catch (reason) {
      toast.error("Не удалось загрузить логотип", {
        description:
          reason instanceof Error
            ? reason.message
            : "Попробуйте другое изображение.",
      })
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }
  return (
    <div className="min-w-0 space-y-2">
      <p id={labelID} className="text-sm font-medium">
        {label}
      </p>
      <div
        role="group"
        aria-labelledby={labelID}
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-4 rounded-xl border border-dashed border-border p-4 transition-colors",
          dragging && "border-primary bg-primary/5"
        )}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void choose(event.dataTransfer.files[0])
        }}
      >
        <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-control">
          {value && failedFor !== value ? (
            <Image
              src={value}
              unoptimized
              fill
              sizes="64px"
              alt={label}
              className="object-contain p-2"
              onError={() => setFailedFor(value)}
            />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-[min(100%,12rem)] flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
              {value ? "Заменить логотип" : "Загрузить логотип"}
            </Button>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled || busy}
                    aria-label="Логотип по ссылке"
                  />
                }
              >
                <Link2 />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80">
                <label className="space-y-2 text-sm font-medium">
                  HTTPS URL или локальный путь
                  <Input
                    className="mt-2 font-normal"
                    placeholder="https://example.com/logo.png"
                    value={value.startsWith("data:") ? "" : value}
                    onChange={(event) => onValueChange(event.target.value)}
                    onBlur={(event) => onValueCommit?.(event.target.value)}
                  />
                </label>
              </PopoverContent>
            </Popover>
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Убрать логотип"
                disabled={disabled || busy}
                onClick={() => {
                  onValueChange("")
                  onValueCommit?.("")
                }}
              >
                <X />
              </Button>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            PNG, JPG или WebP · до 5 МБ. Можно перетащить файл.
          </p>
        </div>
        <input
          ref={fileInput}
          className="hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={`Выбрать файл: ${label}`}
          disabled={disabled || busy}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </div>
    </div>
  )
}
