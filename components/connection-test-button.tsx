"use client"
import { useState } from "react"
import { toast } from "sonner"
import CallChip, { type CallChipStatus } from "@/components/ui/call-chip"

export function ConnectionTestButton({
  name,
  disabled,
  hint,
  onTest,
}: {
  name: string
  disabled?: boolean
  hint?: string
  onTest: () => Promise<string>
}) {
  const [status, setStatus] = useState<CallChipStatus>("idle")
  async function test() {
    if (disabled || status === "running") return
    setStatus("running")
    try {
      const message = await onTest()
      setStatus("done")
      toast.success(message)
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "retryLater" in error &&
        error.retryLater
      ) {
        setStatus("idle")
        toast.info(
          error instanceof Error ? error.message : "Повторите проверку позже."
        )
        return
      }
      setStatus("error")
      toast.error(
        error instanceof Error ? error.message : "Не удалось выполнить проверку"
      )
    }
  }
  return (
    <button
      type="button"
      disabled={disabled || status === "running"}
      title={hint}
      aria-label={`Проверить ${name}`}
      onClick={() => void test()}
      className="max-w-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <CallChip
        name={name.endsWith(" API") ? "API" : "Тест"}
        argument={
          status === "idle"
            ? "Проверить"
            : status === "running"
              ? "Проверяем…"
              : status === "done"
                ? "Успешно"
                : "Повторить"
        }
        status={status}
        expectedMs={6000}
        size={40}
        radius={12}
        surfaceColor="var(--control)"
        showTimer={status !== "idle"}
        shake={3}
        className="max-w-full"
      />
    </button>
  )
}
