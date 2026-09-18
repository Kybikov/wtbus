import { Geist_Mono, Inter } from "next/font/google"
import type { Metadata } from "next"

import "./globals.css"
import { PWARegistrar } from "@/components/pwa-registrar"
import { LayoutPreferencesProvider } from "@/components/layout-preferences-provider"
import { SessionMonitor } from "@/components/session-monitor"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getInitialLayoutSnapshot } from "@/lib/server-layout-preferences"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Vivat Bus — диспетчерская",
  description: "CRM и диспетчерская пассажирских перевозок.",
  applicationName: "Vivat Bus",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vivat Bus",
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const initialLayout = await getInitialLayoutSnapshot()
  return (
    <html
      lang="ru"
      suppressHydrationWarning
      data-sidebar-mode={initialLayout.preferences.sidebarMode}
      data-sidebar-variant={initialLayout.preferences.sidebarVariant}
      data-scale={initialLayout.preferences.scale}
      data-radius={initialLayout.preferences.radius}
      data-density={initialLayout.preferences.density}
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body>
        <ThemeProvider>
          <LayoutPreferencesProvider
            initial={initialLayout}
            key={initialLayout.authenticated ? "authenticated" : "anonymous"}
            persist={initialLayout.authenticated}
          >
            <TooltipProvider>
              <PWARegistrar />
              <SessionMonitor />
              {children}
            </TooltipProvider>
          </LayoutPreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
