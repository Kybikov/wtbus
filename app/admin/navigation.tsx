"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const pages = [
  { href: "/admin", label: "Компании" },
  { href: "/admin/plans", label: "Тарифы" },
]

export function PortalNavigation() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1">
      {pages.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={cn(
            "flex min-h-9 items-center rounded-lg px-3 text-sm hover:bg-accent",
            pathname === href
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground"
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  )
}
