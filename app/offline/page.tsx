import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const dynamic = "force-static"

export default function OfflinePage() {
  return (
    <main className="grid min-h-svh place-items-center bg-background p-5 text-foreground">
      <section className="w-full max-w-sm rounded-[var(--app-radius)] border border-border bg-card p-6 shadow-xl shadow-black/10">
        <p className="text-lg font-bold">Vivat Bus</p>
        <h1 className="mt-10 text-3xl font-bold tracking-[-.035em]">
          Нет соединения
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Проверьте интернет и откройте водительское приложение снова, чтобы
          отправить сохранённые GPS-точки. На этом экране GPS не записывается.
        </p>
        <Link
          className={cn(buttonVariants({ size: "lg" }), "mt-7 w-full")}
          href="/driver"
        >
          Повторить
        </Link>
      </section>
    </main>
  )
}
