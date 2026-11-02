"use client"

import * as React from "react"
import Link from "next/link"
import { Check, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { sessionFetch } from "@/lib/session-navigation"
import { serializeViewCsv } from "@/lib/admin-actions"

type ImportLine = {
  row: number
  name: string
  phone: string
  status: "create" | "update" | "duplicate" | "error"
  message: string
  id?: string
}
type ImportReport = {
  token: string
  created: number
  updated: number
  skipped: number
  errors: number
  duplicates: number
  committed: boolean
  rows: ImportLine[]
  columns: { source: string; target: string }[]
}
const statusLabels = {
  create: "Создать",
  update: "Обновить",
  duplicate: "Пропустить",
  error: "Ошибка",
}
function validReport(value: unknown): value is ImportReport {
  if (!value || typeof value !== "object") return false
  const v = value as ImportReport
  return (
    typeof v.token === "string" &&
    typeof v.committed === "boolean" &&
    [v.created, v.updated, v.skipped, v.errors, v.duplicates].every(
      (n) => Number.isInteger(n) && n >= 0
    ) &&
    Array.isArray(v.rows) &&
    Array.isArray(v.columns) &&
    v.columns.every(
      (column) =>
        typeof column.source === "string" && typeof column.target === "string"
    ) &&
    v.rows.every(
      (row) =>
        Number.isInteger(row.row) &&
        typeof row.name === "string" &&
        typeof row.phone === "string" &&
        typeof row.message === "string" &&
        ["create", "update", "duplicate", "error"].includes(row.status)
    )
  )
}
export function CustomerImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void>
}) {
  const [file, setFile] = React.useState<File | null>(null)
  const [duplicates, setDuplicates] = React.useState("skip")
  const [report, setReport] = React.useState<ImportReport | null>(null)
  const [busy, setBusy] = React.useState<"preview" | "commit" | null>(null)
  const [error, setError] = React.useState("")
  const [filter, setFilter] = React.useState("all")
  const [limit, setLimit] = React.useState(100)
  const [refreshFailed, setRefreshFailed] = React.useState(false)
  async function submit(mode: "preview" | "commit") {
    if (!file || busy || (mode === "commit" && !report)) return
    setBusy(mode)
    setError("")
    try {
      const body = new FormData()
      body.set("file", file)
      body.set("mode", mode)
      body.set("duplicates", duplicates)
      if (report) body.set("token", report.token)
      const response = await sessionFetch("/api/customers/import", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(60000),
      })
      const value = await response.json().catch(() => null)
      if (!response.ok) {
        if (response.status === 409) setReport(null)
        throw new Error(
          value?.error ?? "Не удалось обработать файл. Повторите попытку."
        )
      }
      if (!validReport(value))
        throw new Error(
          "Не удалось прочитать отчёт импорта. Повторите попытку."
        )
      setReport(value)
      setLimit(100)
      if (value.committed) {
        try {
          await onImported()
        } catch {
          setRefreshFailed(true)
        }
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Импорт не завершён. Повторите попытку."
      )
    } finally {
      setBusy(null)
    }
  }
  const rows =
    report?.rows.filter(
      (row) =>
        filter === "all" ||
        (filter === "error" && row.status === "error") ||
        (filter === "duplicate" && row.status === "duplicate") ||
        (filter === "loaded" &&
          (row.status === "create" || row.status === "update"))
    ) ?? []
  function downloadReport() {
    if (!report) return
    const blob = new Blob(
      [
        serializeViewCsv(
          ["Строка", "Имя", "Телефон", "Результат", "Описание"],
          report.rows.map((row) => [
            row.row,
            row.name,
            row.phone,
            row.status === "create" && report.committed
              ? "Создан"
              : row.status === "update" && report.committed
                ? "Обновлён"
                : statusLabels[row.status],
            row.message,
          ])
        ),
      ],
      { type: "text/csv;charset=utf-8" }
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "vivat-import-report.csv"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
    >
      <DialogContent
        className="flex max-h-[min(90dvh,var(--mobile-viewport-height,90dvh))] w-[calc(100%-1.5rem)] max-w-3xl! flex-col gap-4 overflow-hidden p-4 sm:p-6"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>
            {report?.committed ? "Результат импорта" : "Импорт клиентов"}
          </DialogTitle>
          <DialogDescription>
            {report?.committed
              ? file?.name
              : "Скачайте шаблон, заполните его и проверьте файл перед добавлением."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
          {!report?.committed && (
            <>
              <Button
                nativeButton={false}
                render={<a href="/api/customers/import" download />}
                variant="outline"
              >
                <Download />
                Скачать шаблон · XLSX
              </Button>
              <label className="grid gap-2 text-sm font-medium">
                Файл CSV или XLSX
                <Input
                  type="file"
                  accept=".csv,.xlsx"
                  disabled={!!busy}
                  data-disabled-reason="Дождитесь завершения обработки файла."
                  onChange={(event) => {
                    const next = event.target.files?.[0] ?? null
                    setReport(null)
                    setError("")
                    if (next && next.size > 10 * 1024 * 1024) {
                      setFile(null)
                      setError("Размер файла — не больше 10 МБ.")
                    } else setFile(next)
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                До 5000 строк. Телефон обязателен; совпадения определяем по
                телефону.
              </p>
              <FieldSelect
                aria-label="Клиент уже есть"
                value={duplicates}
                disabled={!!busy}
                disabledReason="Дождитесь завершения обработки файла."
                options={[
                  { value: "skip", label: "Пропускать совпадения" },
                  { value: "update", label: "Обновлять заполненные поля" },
                ]}
                onValueChange={(value) => {
                  setDuplicates(value)
                  setReport(null)
                }}
              />
            </>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {busy === "preview"
                ? "Проверяем строки и дубликаты…"
                : "Добавляем клиентов…"}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {refreshFailed && (
            <p role="status" className="text-sm text-muted-foreground">
              Импорт сохранён. Обновите список клиентов, чтобы увидеть
              изменения.
            </p>
          )}
          {report && (
            <>
              <details className="text-sm">
                <summary className="cursor-pointer py-2">Колонки файла</summary>
                <dl className="space-y-1 py-2">
                  {report.columns.map((column) => (
                    <div
                      key={column.source}
                      className="grid min-w-0 grid-cols-2 gap-2"
                    >
                      <dt className="truncate">{column.source}</dt>
                      <dd
                        className={
                          column.target
                            ? "text-muted-foreground"
                            : "text-destructive"
                        }
                      >
                        {column.target || "Не импортируется"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
              <div
                className="flex flex-wrap gap-x-4 gap-y-2 text-sm"
                aria-label="Итоги импорта"
              >
                <span>
                  {report.committed ? "Создано" : "Новых"}:{" "}
                  <strong>{report.created}</strong>
                </span>
                <span>
                  {report.committed ? "Обновлено" : "К обновлению"}:{" "}
                  <strong>{report.updated}</strong>
                </span>
                <span>
                  Пропущено: <strong>{report.skipped}</strong>
                </span>
                <span>
                  Ошибок: <strong>{report.errors}</strong>
                </span>
                <span>
                  Совпадений: <strong>{report.duplicates}</strong>
                </span>
              </div>
              <Tabs
                value={filter}
                onValueChange={(value) => {
                  setFilter(value)
                  setLimit(100)
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="all">Все</TabsTrigger>
                  <TabsTrigger value="error">Ошибки</TabsTrigger>
                  <TabsTrigger value="duplicate">Дубли</TabsTrigger>
                  <TabsTrigger value="loaded">
                    {report.committed ? "Загружено" : "Готовы"}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <ol className="divide-y" aria-label="Строки импорта">
                {rows.slice(0, limit).map((row) => (
                  <li
                    key={row.row}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3 text-sm"
                  >
                    <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                      {row.row}. {row.name || row.phone || "Без имени"}
                    </span>
                    <span
                      className={
                        row.status === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {report.committed && row.status === "create"
                        ? "Создан"
                        : report.committed && row.status === "update"
                          ? "Обновлён"
                          : statusLabels[row.status]}
                    </span>
                    <span className="col-span-2 text-xs [overflow-wrap:anywhere] text-muted-foreground">
                      {row.phone} · {row.message}
                    </span>
                    {report.committed &&
                      row.id &&
                      (row.status === "create" || row.status === "update") && (
                        <Link
                          className="col-span-2 text-xs text-primary underline"
                          href={`/customers/${row.id}`}
                          onClick={() => onOpenChange(false)}
                        >
                          Открыть клиента
                        </Link>
                      )}
                  </li>
                ))}
              </ol>
              {rows.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Таких строк нет.
                </p>
              )}
              {rows.length > limit && (
                <Button
                  variant="ghost"
                  onClick={() => setLimit((n) => n + 100)}
                >
                  Показать ещё · {rows.length - limit}
                </Button>
              )}
            </>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2 border-t pt-3">
          {report && (
            <Button variant="outline" onClick={downloadReport}>
              <FileSpreadsheet />
              Скачать отчёт
            </Button>
          )}
          {report?.committed ? (
            <Button onClick={() => onOpenChange(false)}>
              <Check />
              Готово
            </Button>
          ) : (
            <Button
              disabled={
                !!busy ||
                !file ||
                (!!report && report.created + report.updated === 0)
              }
              disabledReason={
                busy
                  ? "Дождитесь завершения обработки файла."
                  : !file
                    ? "Выберите заполненный CSV или XLSX файл."
                    : "Нет строк для добавления или обновления. Исправьте ошибки или выберите обновление совпадений."
              }
              onClick={() => void submit(report ? "commit" : "preview")}
            >
              <Upload />
              {busy
                ? "Обрабатываем…"
                : report
                  ? `Импортировать · ${report.created + report.updated}`
                  : "Проверить файл"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
