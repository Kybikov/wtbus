"use client"

import type { CSSProperties } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Building2, ReceiptText, UsersRound } from "lucide-react"

const pages = [
  { href: "/admin", label: "Компании", Icon: Building2 },
  { href: "/admin/clients", label: "Клиенты", Icon: UsersRound },
  { href: "/admin/plans", label: "Тарифы", Icon: ReceiptText },
]

// Adapted from React Bits Pill Nav. The fixed-size track uses CSS for its active
// pill, and Next.js links own navigation and the selected route.
export function PortalNavigation() {
  const pathname = usePathname()
  const active = pages.findIndex(({ href }) => pathname === href)

  return (
    <nav aria-label="Разделы платформы">
      <ul
        className="platform-nav-list"
        data-active={active >= 0 ? "" : undefined}
        style={
          { "--pn-active": active, "--pn-count": pages.length } as CSSProperties
        }
      >
        {pages.map(({ href, label, Icon }, index) => (
          <li key={href} className="relative min-w-0">
            <Link
              href={href}
              aria-current={index === active ? "page" : undefined}
              className="platform-nav-link"
            >
              <span className="platform-nav-fill" aria-hidden="true" />
              <Icon className="relative size-4 shrink-0" aria-hidden="true" />
              <span className="platform-nav-label">
                <span>{label}</span>
                <span aria-hidden="true">{label}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
