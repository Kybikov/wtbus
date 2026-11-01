"use client"

import { motion, useReducedMotion } from "motion/react"
import { Plus } from "lucide-react"
import { useRouter, usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import { createTargets, type StaffRole } from "@/lib/admin-actions"

// React Bits Pro Mobile 2 Sorbet: spring action stack and rotating add button.
// Shared Dialog provides focus trapping, Escape, outside dismissal and blur.
export function MobileCreateMenu({
  role,
  onCreate,
  createDisabled,
  open,
  onOpenChange,
}: {
  role: StaffRole
  onCreate?: () => void
  createDisabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter(),
    pathname = usePathname()
  const reduce = useReducedMotion()
  const targets = createTargets.filter((target) => target.roles.includes(role))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button
            size="icon"
            variant="default"
            aria-label="Создать"
            disabled={!targets.length}
            disabledReason="Ваша роль не позволяет создавать записи."
            className="size-12 shrink-0 rounded-full"
          />
        }
      >
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { type: "spring", bounce: 0, duration: 0.35 }
          }
        >
          <Plus className="size-6" />
        </motion.span>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="mobile-create-menu gap-3 rounded-3xl! p-4!"
      >
        <DialogTitle className="text-base font-semibold">Создать</DialogTitle>
        <DialogDescription className="sr-only">
          Выберите запись для создания.
        </DialogDescription>
        <motion.ul
          initial="closed"
          animate="open"
          variants={{
            closed: {},
            open: { transition: { staggerChildren: reduce ? 0 : 0.045 } },
          }}
          className="space-y-2"
        >
          {targets.map((target) => (
            <motion.li
              key={target.href}
              variants={{
                closed: { opacity: 0, y: reduce ? 0 : 12 },
                open: { opacity: 1, y: 0 },
              }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: "spring", bounce: 0, duration: 0.35 }
              }
            >
              <Button
                variant="secondary"
                className="h-12 w-full justify-between rounded-2xl"
                disabled={target.href === pathname && createDisabled}
                disabledReason="Дождитесь загрузки данных для создания записи."
                onClick={() => {
                  onOpenChange(false)
                  if (target.href === pathname && onCreate) onCreate()
                  else router.push(target.href + "?create=1")
                }}
              >
                {target.label}
                <Plus className="size-4" />
              </Button>
            </motion.li>
          ))}
        </motion.ul>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Закрыть
        </Button>
      </DialogContent>
    </Dialog>
  )
}
