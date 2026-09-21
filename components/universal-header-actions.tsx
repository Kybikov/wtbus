"use client"
import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { Plus, Upload, Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { sessionFetch } from "@/lib/session-navigation"
import { createTargets, type StaffRole } from "@/lib/admin-actions"
import type { EntityExport } from "@/components/entity-export-context"

export type HeaderDataActions = {
  onImport: () => void
  onExport: () => void | Promise<void>
  importing: boolean
  exporting: boolean
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function UniversalHeaderActions({
  role,
  ready,
  onCreate,
  createDisabled = false,
  dataActions,
  viewExport,
  onImported,
}: {
  role: StaffRole
  ready: boolean
  onCreate?: () => void
  createDisabled?: boolean
  dataActions?: HeaderDataActions
  viewExport: EntityExport | null
  onImported: () => Promise<void>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState<"import" | "export" | null>(null)
  const [message, setMessage] = React.useState<{
    title: string
    text: string
    issues?: { row: number; message: string }[]
  } | null>(null)
  const canOperate = ready && role !== "driver"
  React.useEffect(() => {
    if (!ready || !onCreate || createDisabled) return
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href)
      if (url.searchParams.get("create") !== "1") return
      url.searchParams.delete("create")
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash
      )
      if (
        createTargets.some(
          (target) => target.href === pathname && target.roles.includes(role)
        )
      )
        onCreate()
    }, 0)
    return () => clearTimeout(timer)
  }, [ready, onCreate, createDisabled, pathname, role])
  async function importCustomers(file: File) {
    if (!canOperate || busy) return
    setBusy("import")
    try {
      const body = new FormData()
      body.set("file", file)
      const response = await sessionFetch("/api/customers/import", {
        method: "POST",
        body,
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось импортировать клиентов.")
      if (
        !Number.isInteger(result.created) ||
        !Number.isInteger(result.updated) ||
        !Number.isInteger(result.skipped)
      )
        throw new Error("Некорректный ответ импорта.")
      setMessage({
        title: "Импорт завершён",
        text: `Создано: ${result.created}. Обновлено: ${result.updated}. Пропущено: ${result.skipped}.`,
        issues: Array.isArray(result.issues)
          ? result.issues.filter(
              (issue: unknown): issue is { row: number; message: string } =>
                typeof issue === "object" &&
                issue !== null &&
                "row" in issue &&
                Number.isInteger(issue.row) &&
                "message" in issue &&
                typeof issue.message === "string"
            )
          : [],
      })
      await onImported()
    } catch (error) {
      setMessage({
        title: "Ошибка импорта",
        text:
          error instanceof Error
            ? error.message
            : "Не удалось импортировать клиентов.",
      })
    } finally {
      setBusy(null)
    }
  }
  async function exportCustomers() {
    if (dataActions) {
      await dataActions.onExport()
      return
    }
    if (!canOperate || busy) return
    setBusy("export")
    try {
      const response = await sessionFetch("/api/customers?export=xlsx", {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("Не удалось выгрузить базу клиентов.")
      download(await response.blob(), "vivat-customers.xlsx")
    } catch (error) {
      setMessage({
        title: "Ошибка экспорта",
        text:
          error instanceof Error
            ? error.message
            : "Не удалось выгрузить клиентов.",
      })
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="Создать или перенести данные"
                    className="size-9 rounded-lg"
                    size="icon-lg"
                    variant="ghost"
                    disabled={!canOperate}
                  />
                }
              />
            }
          >
            {busy || dataActions?.importing || dataActions?.exporting ? (
              <Loader2 className="size-4 motion-safe:animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
          </TooltipTrigger>
          <TooltipContent>
            Создать, импортировать или экспортировать
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Создать</DropdownMenuLabel>
            {createTargets
              .filter((target) => target.roles.includes(role))
              .map((target) => (
                <DropdownMenuItem
                  key={target.href}
                  disabled={target.href === pathname && createDisabled}
                  onClick={() => {
                    if (target.href === pathname && onCreate) onCreate()
                    else router.push(target.href + "?create=1")
                  }}
                >
                  <Plus className="size-4 text-muted-foreground" />
                  {target.label}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Данные</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={busy !== null || dataActions?.importing}
              onClick={() =>
                dataActions
                  ? dataActions.onImport()
                  : fileInput.current?.click()
              }
            >
              {busy === "import" || dataActions?.importing ? (
                <Loader2 className="size-4 motion-safe:animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              <span>
                Импорт
                <span className="block text-xs text-muted-foreground">
                  Клиенты · CSV / XLSX
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={busy !== null || dataActions?.exporting}
              >
                {busy === "export" || dataActions?.exporting ? (
                  <Loader2 className="size-4 motion-safe:animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Экспорт
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72">
                {viewExport && (
                  <DropdownMenuItem
                    disabled={viewExport.loading || !viewExport.rows}
                    onClick={() =>
                      download(
                        new Blob([viewExport.csv], {
                          type: "text/csv;charset=utf-8",
                        }),
                        viewExport.filename
                      )
                    }
                  >
                    <span>
                      Текущий вид · CSV
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {viewExport.rows} строк · видимые колонки
                        {viewExport.total > viewExport.loaded
                          ? " · загруженная часть"
                          : ""}
                      </span>
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => void exportCustomers()}>
                  Клиенты · XLSX (вся база)
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        aria-label="Файл импорта клиентов"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.currentTarget.value = ""
          if (file) void importCustomers(file)
        }}
      />
      <Dialog
        open={message !== null}
        onOpenChange={(open) => {
          if (!open) setMessage(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{message?.title}</DialogTitle>
            <DialogDescription>{message?.text}</DialogDescription>
          </DialogHeader>
          {!!message?.issues?.length && (
            <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
              {message.issues.map((issue, index) => (
                <li key={index}>
                  Строка {issue.row}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
