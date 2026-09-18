"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { MobileDock, type MobileDockProps } from "@/components/mobile-dock"
import {
  mobileNavigation,
  isMobileDestinationActive,
} from "@/lib/mobile-navigation"

type PageNavigation = MobileDockProps & { pathname: string }
const NavigationContext = React.createContext<React.Dispatch<
  React.SetStateAction<PageNavigation | null>
> | null>(null)

// Lives in the root layout: route changes must not remount the floating dock.
export function MobileNavigationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [page, setPage] = React.useState<PageNavigation | null>(null)
  const visible =
    page &&
    mobileNavigation(page.role).some((item) =>
      isMobileDestinationActive(pathname, item.href)
    )
  return (
    <NavigationContext.Provider value={setPage}>
      {children}
      {visible && page ? (
        <MobileDock
          key={page.role}
          role={page.role}
          localSearch={
            page.pathname === pathname ? page.localSearch : undefined
          }
        />
      ) : null}
    </NavigationContext.Provider>
  )
}

export function useMobilePageNavigation(ready: boolean, page: PageNavigation) {
  const register = React.useContext(NavigationContext)
  if (!register) throw new Error("MobileNavigationProvider is required")
  const { pathname, role, localSearch } = page
  React.useEffect(() => {
    if (ready) register({ pathname, role, localSearch })
    // Keep the previous role while the next page loads; never retain its search callback.
  }, [ready, register, pathname, role, localSearch])
}
