"use client"
import * as React from "react"
import { mobileViewportQuery } from "@/lib/mobile-viewport"
import { usePathname } from "next/navigation"
import { MobileDock, type MobileDockProps } from "@/components/mobile-dock"
import { MobileAccountMenu } from "@/components/mobile-account-menu"
import {
  mobileNavigation,
  isMobileDestinationActive,
} from "@/lib/mobile-navigation"
type PageNavigation = MobileDockProps & { pathname: string }
type NavigationControls = {
  register: React.Dispatch<React.SetStateAction<PageNavigation | null>>
  openMenu: (trigger: HTMLElement) => void
}
const NavigationContext = React.createContext<NavigationControls | null>(null)
// Lives in the root layout: route changes must not remount the floating dock.
export function MobileNavigationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [page, setPage] = React.useState<PageNavigation | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const trigger = React.useRef<HTMLElement | null>(null)
  const openMenu = React.useCallback((element: HTMLElement) => {
    trigger.current = element
    setMenuOpen(true)
  }, [])
  const controls = React.useMemo(
    () => ({ register: setPage, openMenu }),
    [openMenu]
  )
  React.useEffect(() => {
    const mobile = window.matchMedia(mobileViewportQuery)
    const close = () => {
      if (!mobile.matches) setMenuOpen(false)
    }
    mobile.addEventListener("change", close)
    return () => mobile.removeEventListener("change", close)
  }, [])
  // Browser back/forward must dismiss a panel opened on the previous page too.
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setMenuOpen(false))
    return () => cancelAnimationFrame(frame)
  }, [pathname])
  const visible =
    page &&
    mobileNavigation(page.role).some((item) =>
      isMobileDestinationActive(pathname, item.href)
    )
  return (
    <NavigationContext.Provider value={controls}>
      {children}
      {visible && page ? (
        <>
          <MobileDock
            key={page.role}
            role={page.role}
            menuOpen={menuOpen}
            onOpenMenu={openMenu}
            localSearch={
              page.pathname === pathname ? page.localSearch : undefined
            }
          />
          <MobileAccountMenu
            role={page.role}
            account={page.account}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            trigger={trigger}
          />
        </>
      ) : null}
    </NavigationContext.Provider>
  )
}
export function useMobileNavigationControls() {
  const controls = React.useContext(NavigationContext)
  if (!controls) throw new Error("MobileNavigationProvider is required")
  return controls
}
export function useMobilePageNavigation(ready: boolean, page: PageNavigation) {
  const { register } = useMobileNavigationControls()
  const { pathname, role, localSearch, account } = page
  React.useEffect(() => {
    if (ready) register({ pathname, role, localSearch, account })
    // Keep the previous role while the next page loads; never retain its search callback.
  }, [ready, register, pathname, role, localSearch, account])
}
