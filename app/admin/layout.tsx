import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Shield } from "lucide-react"
import { PortalNavigation } from "./navigation"
import { getSessionAccess } from "@/lib/server-role"

export const metadata = { title: "Панель платформы · Vivat" }

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!(await getSessionAccess())?.platformAdmin) notFound()

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 p-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold sm:text-base">
            <Shield className="size-5 shrink-0 text-primary" aria-hidden />
            Панель платформы
          </div>
          <Link
            href="/"
            className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />В CRM
          </Link>
          <nav
            aria-label="Разделы платформы"
            className="order-last w-full sm:order-none sm:w-auto"
          >
            <PortalNavigation />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  )
}
