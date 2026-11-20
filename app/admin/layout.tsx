import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Shield } from "lucide-react"
import { PortalNavigation } from "./navigation"
import { getSessionAccess } from "@/lib/server-role"
import "./admin-shell.css"

export const metadata = { title: "Панель платформы · Vivat" }

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!(await getSessionAccess())?.platformAdmin) notFound()

  return (
    <div className="platform-shell min-h-dvh bg-background">
      <a
        href="#platform-content"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Перейти к содержимому
      </a>
      <div className="platform-shell-grid mx-auto grid max-w-[100rem] items-start gap-3 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-x-4">
        <aside className="platform-sidebar workspace-panel lg:row-span-2 lg:flex lg:flex-col lg:gap-4">
          <Link
            href="/admin"
            className="hidden items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
            aria-label="Vivat, панель платформы"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Shield className="size-4" aria-hidden="true" />
            </span>
            Vivat
          </Link>
          <PortalNavigation />
        </aside>
        <header className="platform-topbar workspace-panel flex min-h-13 min-w-0 items-center justify-between gap-3 px-3 py-1.5 sm:px-4 lg:col-start-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Shield
              className="size-4 shrink-0 text-primary lg:hidden"
              aria-hidden="true"
            />
            <span>Панель платформы</span>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> В CRM
          </Link>
        </header>
        <main
          id="platform-content"
          tabIndex={-1}
          className="min-w-0 outline-none lg:col-start-2"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
