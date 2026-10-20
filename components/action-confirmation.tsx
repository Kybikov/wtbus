"use client"
import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { HoldActionButton } from "@/components/ui/hold-action-button"

type Options = {
  title: string
  description?: string
  label?: string
  tone?: "danger" | "archive"
}
type Prompt = Options & { id: number; resolve: (result: boolean) => void }
const context = React.createContext<
  ((options: Options) => Promise<boolean>) | null
>(null)

export function ActionConfirmationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [prompt, setPrompt] = React.useState<Prompt | null>(null)
  const pending = React.useRef<Prompt | null>(null)
  const sequence = React.useRef(0)
  const [open, setOpen] = React.useState(false)
  const confirm = React.useCallback(
    (options: Options) =>
      new Promise<boolean>((resolve) => {
        pending.current?.resolve(false)
        const next = { ...options, resolve, id: ++sequence.current }
        pending.current = next
        setPrompt(next)
        setOpen(true)
      }),
    []
  )
  const finish = React.useCallback((result: boolean) => {
    pending.current?.resolve(result)
    pending.current = null
    setOpen(false)
  }, [])
  React.useEffect(
    () => () => {
      pending.current?.resolve(false)
      pending.current = null
    },
    []
  )
  return (
    <context.Provider value={confirm}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!open) finish(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{prompt?.title}</DialogTitle>
            <DialogDescription>
              {prompt?.description ??
                "Удерживайте кнопку для подтверждения действия."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => finish(false)}>
              Отмена
            </Button>
            <HoldActionButton
              key={prompt?.id}
              tone={prompt?.tone}
              onConfirm={() => finish(true)}
            >
              {prompt?.label ?? "Подтвердить"}
            </HoldActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </context.Provider>
  )
}

export function useActionConfirmation() {
  const value = React.useContext(context)
  if (!value) throw Error("ActionConfirmationProvider is required")
  return value
}
