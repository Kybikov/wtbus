"use client"
import { motion, useReducedMotion } from "motion/react"
import {
  Plus,
  Upload,
  Download,
  UserRound,
  Ticket,
  CalendarDays,
  Route,
  Car,
  Users,
} from "lucide-react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { useRouter, usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogClose,
} from "@/components/ui/dialog"
import { createTargets, type StaffRole } from "@/lib/admin-actions"
const icons = {
  "/customers": UserRound,
  "/bookings": Ticket,
  "/trips": CalendarDays,
  "/routes": Route,
  "/fleet": Car,
  "/team": Users,
}
// Mobile 2 Sorbet: independent pills above the add button, without a menu card.
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
  const spring = reduce
    ? { duration: 0 }
    : { type: "spring" as const, bounce: 0, duration: 0.35 }
  const targets = createTargets.filter((target) => target.roles.includes(role))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            aria-label="Создать"
            disabled={!targets.length}
            disabledReason="Ваша роль не позволяет создавать записи."
            className="size-12 shrink-0 self-end rounded-full border-0 bg-transparent shadow-none"
          />
        }
      >
        <Plus className="size-6" />
      </DialogTrigger>
      <DialogPortal>
        <DialogOverlay
          forceRender
          className="bg-black/65 supports-backdrop-filter:backdrop-blur-sm"
        />
        <DialogPrimitive.Popup className="mobile-create-menu fixed z-50 flex w-fit max-w-[calc(100vw-2rem)] flex-col items-start gap-3 outline-none">
          <DialogTitle className="sr-only">Создать</DialogTitle>
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
            className="mobile-create-actions flex max-h-[calc(var(--mobile-viewport-height,100dvh)-7rem)] [scrollbar-width:none] flex-col items-start gap-2 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden"
          >
            {targets.map((target) => {
              const Icon = icons[target.href as keyof typeof icons]
              return (
                <motion.li
                  key={target.href}
                  variants={{
                    closed: { opacity: 0, y: reduce ? 0 : 12 },
                    open: { opacity: 1, y: 0 },
                  }}
                  transition={spring}
                >
                  <Button
                    variant="secondary"
                    className="h-12 w-fit justify-between gap-5 rounded-full border-0 px-5 font-semibold shadow-md"
                    disabled={target.href === pathname && createDisabled}
                    disabledReason="Дождитесь загрузки данных для создания записи."
                    onClick={() => {
                      onOpenChange(false)
                      if (target.href === pathname && onCreate) onCreate()
                      else router.push(target.href + "?create=1")
                    }}
                  >
                    {target.label}
                    <Icon className="size-5" />
                  </Button>
                </motion.li>
              )
            })}
            {["developer", "owner", "admin", "dispatcher"].includes(role) && (
              <motion.li
                variants={{
                  closed: { opacity: 0, y: reduce ? 0 : 12 },
                  open: { opacity: 1, y: 0 },
                }}
                transition={spring}
              >
                <Button
                  variant="secondary"
                  className="h-12 gap-5 rounded-full border-0 px-5 font-semibold shadow-md"
                  onClick={() => {
                    onOpenChange(false)
                    window.dispatchEvent(new Event("vivat:import-customers"))
                  }}
                >
                  Импорт клиентов
                  <Upload className="size-5" />
                </Button>
              </motion.li>
            )}
            {role !== "driver" && (
              <motion.li
                variants={{
                  closed: { opacity: 0, y: reduce ? 0 : 12 },
                  open: { opacity: 1, y: 0 },
                }}
                transition={spring}
              >
                <Button
                  variant="secondary"
                  className="h-12 gap-5 rounded-full border-0 px-5 font-semibold shadow-md"
                  onClick={() => {
                    onOpenChange(false)
                    window.dispatchEvent(new Event("vivat:export-customers"))
                  }}
                >
                  Экспорт клиентов
                  <Download className="size-5" />
                </Button>
              </motion.li>
            )}
          </motion.ul>
          <DialogClose
            render={
              <Button
                aria-label="Закрыть создание"
                size="icon"
                className="size-12 shrink-0 rounded-full border-0 shadow-none ring-0"
              />
            }
          >
            <motion.span
              initial={{ rotate: 0 }}
              animate={{ rotate: 45 }}
              transition={spring}
            >
              <Plus className="size-6" />
            </motion.span>
          </DialogClose>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
