"use client"
import * as React from "react"
import { CustomerImportDialog } from "@/components/customer-import-dialog"
import { usePathname, useRouter } from "next/navigation"
import { Plus, Upload, Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
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
import { sessionFetch } from "@/lib/session-navigation"
import { createTargets, type StaffRole } from "@/lib/admin-actions"
import type { EntityExport } from "@/components/entity-export-context"

export type HeaderDataActions = {
  onExport: () => void | Promise<void>
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
  const [importOpen, setImportOpen] = React.useState(false)
  const canImport =
    ready && ["developer", "owner", "admin", "dispatcher"].includes(role)
  const [busy, setBusy] = React.useState<"export" | null>(null)
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
      toast.success("Экспорт готов", {
        description: "Файл клиентов сохранён в формате XLSX.",
      })
    } catch (error) {
      toast.error("Ошибка экспорта", {
        description:
          error instanceof Error
            ? error.message
            : "Не удалось выгрузить клиентов.",
      })
    } finally {
      setBusy(null)
    }
  }
  React.useEffect(() => {
    const importData = () => {
      if (canImport) setImportOpen(true)
    }
    const exportData = () => {
      if (canOperate && !busy) void exportCustomers()
    }
    window.addEventListener("vivat:import-customers", importData)
    window.addEventListener("vivat:export-customers", exportData)
    return () => {
      window.removeEventListener("vivat:import-customers", importData)
      window.removeEventListener("vivat:export-customers", exportData)
    }
  })
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
                    disabledReason={
                      !ready
                        ? "Дождитесь загрузки данных аккаунта."
                        : "Создание и перенос записей недоступны в кабинете водителя."
                    }
                  />
                }
              />
            }
          >
            {busy || dataActions?.exporting ? (
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
                  disabledReason={
                    "Дождитесь загрузки данных для создания записи."
                  }
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
          <DropdownMenuItem
            disabled={!canImport || busy !== null}
            disabledReason={
              !canImport
                ? !ready
                  ? "Дождитесь загрузки аккаунта."
                  : "Импорт доступен владельцу, администратору, диспетчеру и разработчику."
                : "Экспорт уже выполняется. Дождитесь завершения."
            }
            onClick={() => setImportOpen(true)}
          >
            <Upload className="size-4" />
            <span>
              Импорт данных
              <span className="block text-xs text-muted-foreground">
                Клиенты · CSV / XLSX
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              disabledReason="Экспорт уже выполняется. Дождитесь завершения."
              disabled={busy !== null || dataActions?.exporting}
            >
              {busy === "export" || dataActions?.exporting ? (
                <Loader2 className="size-4 motion-safe:animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Экспорт данных
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72">
              {viewExport && (
                <DropdownMenuItem
                  disabled={viewExport.loading || !viewExport.rows}
                  disabledReason={
                    viewExport.loading
                      ? "Дождитесь загрузки записей для экспорта."
                      : "В текущем виде нет записей для экспорта."
                  }
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
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomerImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={onImported}
      />
    </>
  )
}
