"use client"
import { Copy, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { PasswordInput } from "@/components/ui/password-input"
import { Button } from "@/components/ui/button"
import { generateTemporaryPassword } from "@/lib/temporary-password"

export function TemporaryPasswordField({
  value,
  onChange,
  busy = false,
}: {
  value: string
  onChange: (value: string) => void
  busy?: boolean
}) {
  return (
    <div className="min-w-0 space-y-2">
      <label className="grid gap-2 text-sm font-semibold">
        Временный пароль
        <PasswordInput
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          minLength={12}
          maxLength={72}
          required
          disabled={busy}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          disabledReason="Дождитесь завершения операции."
          onClick={() => onChange(generateTemporaryPassword())}
        >
          <RefreshCw />
          Создать пароль
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || !value}
          disabledReason={
            busy
              ? "Дождитесь завершения операции."
              : "Сначала введите или создайте пароль."
          }
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              toast.success("Пароль скопирован")
            } catch {
              toast.error(
                "Не удалось скопировать. Выделите пароль и скопируйте вручную."
              )
            }
          }}
        >
          <Copy />
          Копировать
        </Button>
      </div>
    </div>
  )
}
