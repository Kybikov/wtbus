"use client"
import * as React from "react"
import { mobileViewportQuery } from "@/lib/mobile-viewport"
import { toast } from "sonner"
import { usePathname } from "next/navigation"
import { MobileDock, type MobileDockProps } from "@/components/mobile-dock"
import { MobileAccountMenu } from "@/components/mobile-account-menu"
import {
  mobileNavigation,
  isMobileDestinationActive,
  resolveMobileDock,
} from "@/lib/mobile-navigation"
type PageNavigation = MobileDockProps & { pathname: string }
type NavigationControls = {
  register: React.Dispatch<React.SetStateAction<PageNavigation | null>>
  openMenu: (trigger: HTMLElement) => void
}
function subscribeDock(listener: () => void) {
  window.addEventListener("storage", listener)
  window.addEventListener("vivat-dock-updated", listener)
  return () => {
    window.removeEventListener("storage", listener)
    window.removeEventListener("vivat-dock-updated", listener)
  }
}
const MobileToolsContext = React.createContext<HTMLDivElement | null>(null)
export function useMobileToolsHost() {
  return React.useContext(MobileToolsContext)
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
  const [toolsHost, setToolsHost] = React.useState<HTMLDivElement | null>(null)
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
  const storageKey = page?.account?.membershipId
    ? "vivat:dock:" + page.account.tenantSlug + ":" + page.account.membershipId
    : ""
  const role = page?.role
  const raw = React.useSyncExternalStore(
    subscribeDock,
    () => {
      try {
        return storageKey ? localStorage.getItem(storageKey) : null
      } catch {
        return null
      }
    },
    () => null
  )
  const dockHrefs = React.useMemo(() => {
    if (!role) return undefined
    try {
      return resolveMobileDock(role, JSON.parse(raw ?? "null")).map(
        (item) => item.href
      )
    } catch {
      return resolveMobileDock(role, undefined).map((item) => item.href)
    }
  }, [raw, role])
  const changeDock = (hrefs: string[]) => {
    if (!storageKey || !page) return
    const valid = resolveMobileDock(page.role, hrefs).map((item) => item.href)
    try {
      localStorage.setItem(storageKey, JSON.stringify(valid))
      window.dispatchEvent(new Event("vivat-dock-updated"))
    } catch {
      toast.error("Не удалось сохранить нижнюю навигацию.")
    }
  }
  const visible =
    page &&
    mobileNavigation(page.role).some((item) =>
      isMobileDestinationActive(pathname, item.href)
    )
  return (
    <NavigationContext.Provider value={controls}>
      <MobileToolsContext.Provider value={toolsHost}>
        {children}
      </MobileToolsContext.Provider>
      {visible && page ? (
        <>
          <MobileDock
            key={page.role}
            role={page.role}
            menuOpen={menuOpen}
            onOpenMenu={openMenu}
            dockHrefs={dockHrefs}
            onCreate={page.pathname === pathname ? page.onCreate : undefined}
            createDisabled={page.pathname !== pathname || page.createDisabled}
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
            dockHrefs={resolveMobileDock(page.role, dockHrefs).map(
              (item) => item.href
            )}
            onDockChange={changeDock}
            pageMenu={page.pathname === pathname ? page.pageMenu : undefined}
            unread={page.unread}
            pageTools={
              <div ref={setToolsHost} className="mobile-page-tools min-w-0" />
            }
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
  const {
    pathname,
    role,
    localSearch,
    account,
    onCreate,
    createDisabled,
    pageMenu,
    unread,
  } = page
  React.useEffect(() => {
    if (ready)
      register({
        pathname,
        role,
        localSearch,
        account,
        onCreate,
        createDisabled,
        pageMenu,
        unread,
      })
    // Keep the previous role while the next page loads; never retain its search callback.
  }, [
    ready,
    register,
    pathname,
    role,
    localSearch,
    account,
    onCreate,
    createDisabled,
    pageMenu,
    unread,
  ])
}
