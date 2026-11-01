"use client"

// Adapted from licensed React Bits Pro Download 6: split hero and platform rows.
import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { ArrowDown, ArrowUpRight, Check, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { installPWA, usePWAInstall } from "@/lib/pwa-install"
import { pwaPlatform, pwaPlatforms, type PWAPlatform } from "@/lib/pwa-platform"

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-7">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  )
}
function WindowsMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-7">
      <path d="M3 5.479 11.049 4.37v8.03H3zM3 19.521 11.049 20.63v-7.962H3zM12.039 4.229 22.751 2.75v9.65H12.039zM12.039 12.668h10.712v9.65L12.039 20.771z" />
    </svg>
  )
}
const subscribe = () => () => {}
export function Download6() {
  const install = usePWAInstall()
  const reduce = useReducedMotion()
  const current = React.useSyncExternalStore(
    subscribe,
    () =>
      pwaPlatform(
        navigator.userAgent,
        navigator.platform,
        navigator.maxTouchPoints
      ),
    () => null
  )
  const [instructions, setInstructions] = React.useState<PWAPlatform | null>(
    null
  )
  const [installing, setInstalling] = React.useState(false)
  const selected = pwaPlatforms.find((platform) => platform.id === instructions)
  async function start(platform: PWAPlatform | null) {
    if (!platform) {
      document.getElementById("pwa-platforms")?.scrollIntoView({
        behavior: reduce ? "instant" : "smooth",
        block: "center",
      })
      return
    }
    if (platform === current && install.prompt && !install.standalone) {
      setInstalling(true)
      try {
        if ((await installPWA()) !== "accepted") setInstructions(platform)
      } catch {
        setInstructions(platform)
      } finally {
        setInstalling(false)
      }
    } else setInstructions(platform)
  }
  return (
    <section
      aria-label="Установить Vivat Bus"
      className="relative mx-auto grid w-full max-w-6xl min-w-0 items-center gap-8 overflow-hidden py-4 sm:py-8 lg:grid-cols-[1fr_1.05fr] lg:gap-12"
    >
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <p className="text-xs font-medium tracking-[.16em] text-primary uppercase">
          Vivat Bus · приложение
        </p>
        <h2 className="mt-5 max-w-lg text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
          Ваша работа.
          <br />
          <span className="text-muted-foreground">Всегда под рукой.</span>
        </h2>
        <p className="mt-5 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
          Рейсы, бронирования и команда — в отдельном окне на компьютере или на
          главном экране телефона.
        </p>
        <div className="mt-7">
          {install.standalone ? (
            <Badge variant="secondary" className="gap-2 px-4 py-2">
              <Check className="size-4" />
              Приложение установлено
            </Badge>
          ) : (
            <Button
              className="h-12 w-full gap-2 rounded-full px-6 sm:w-auto"
              disabled={!install.ready || installing}
              disabledReason={
                installing
                  ? "Дождитесь ответа в окне установки."
                  : "Проверяем возможность установки в этом браузере."
              }
              onClick={() => void start(current)}
            >
              <ArrowDown className="size-4" />
              {installing
                ? "Открываем установку…"
                : "Установить на это устройство"}
            </Button>
          )}
        </div>
        <p className="mt-4 max-w-md text-xs leading-5 text-muted-foreground">
          Устанавливается из браузера как PWA. Выберите платформу, чтобы увидеть
          шаги установки.
        </p>
      </motion.div>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: reduce ? 0 : 0.08 }}
        id="pwa-platforms"
        className="relative min-w-0 overflow-hidden rounded-3xl border border-border bg-card"
      >
        <div className="border-b border-border px-5 py-5 sm:px-6">
          <p className="text-xs text-muted-foreground">
            На всех ваших устройствах
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">
            Выберите платформу
          </h3>
        </div>
        <ul className="divide-y divide-border">
          {pwaPlatforms.map((platform) => (
            <li key={platform.id}>
              <Button
                variant="ghost"
                className="group h-auto min-h-24 w-full justify-start gap-4 rounded-none px-5 py-5 text-left whitespace-normal sm:px-6"
                disabled={installing}
                disabledReason="Дождитесь ответа в открытом окне установки."
                onClick={() => void start(platform.id)}
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-border bg-control">
                  {platform.id === "windows" ? (
                    <WindowsMark />
                  ) : platform.id === "android" ? (
                    <Smartphone className="size-7" />
                  ) : (
                    <AppleMark />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {platform.name}
                    {platform.id === current ? (
                      <span className="text-[10px] font-normal text-primary">
                        Это устройство
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {platform.detail}
                  </span>
                </span>
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border transition-colors group-hover:bg-control">
                  <ArrowDown className="size-4" />
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </motion.div>
      <Dialog
        open={instructions !== null}
        onOpenChange={(open) => {
          if (!open) setInstructions(null)
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle>Vivat Bus для {selected?.name}</DialogTitle>
            <DialogDescription>Установка через браузер</DialogDescription>
          </DialogHeader>
          <ol className="space-y-4">
            {selected?.steps.map((step, index) => (
              <li className="flex gap-3 text-sm leading-6" key={step}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-control text-xs font-semibold">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {selected ? (
            <a
              href={selected.help}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Инструкция браузера
              <ArrowUpRight className="size-3" />
            </a>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
