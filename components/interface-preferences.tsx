"use client"
import * as React from "react"
import { useTheme } from "next-themes"
import { usePathname } from "next/navigation"
import { FieldSelect } from "@/components/ui/field-select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useLayoutPreferences } from "@/components/layout-preferences-provider"
import { sessionFetch } from "@/lib/session-navigation"
import { cn } from "@/lib/utils"
import { defaultInterfacePreferences } from "@/lib/layout-preferences"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { RotateCcw } from "lucide-react"
type ThemePreset = "company" | "gold" | "ocean" | "emerald" | "violet"
type Radius = "sm" | "md" | "lg"
type Scale = "xs" | "sm" | "md" | "lg" | "xl"
const scaleLevels: Scale[] = ["xs", "sm", "md", "lg", "xl"]
type SidebarVariant = "default" | "inset" | "floating"
type SidebarMode = "default" | "icon" | "full"

type UIPreferences = {
  configured?: boolean
  theme: "light" | "dark" | "system"
  accent: ThemePreset
  density: "comfortable" | "compact"
  radius: Radius
  scale: Scale
  sidebarVariant: SidebarVariant
  sidebarMode: SidebarMode
}

const presets: Record<
  Exclude<ThemePreset, "company">,
  { label: string; primary: string; foreground: string }
> = {
  gold: {
    label: "Vivat Gold",
    primary: "oklch(0.78 0.15 82)",
    foreground: "oklch(0.18 0.015 80)",
  },
  ocean: {
    label: "Ocean",
    primary: "oklch(0.72 0.13 230)",
    foreground: "oklch(0.18 0.02 230)",
  },
  emerald: {
    label: "Emerald",
    primary: "oklch(0.73 0.15 157)",
    foreground: "oklch(0.18 0.02 157)",
  },
  violet: {
    label: "Violet",
    primary: "oklch(0.7 0.16 295)",
    foreground: "oklch(0.2 0.025 295)",
  },
}

function isUIPreferences(value: unknown): value is UIPreferences {
  return (
    typeof value === "object" &&
    value !== null &&
    "theme" in value &&
    (value.theme === "light" ||
      value.theme === "dark" ||
      value.theme === "system") &&
    "accent" in value &&
    (value.accent === "company" ||
      (typeof value.accent === "string" && value.accent in presets)) &&
    "density" in value &&
    (value.density === "comfortable" || value.density === "compact") &&
    "radius" in value &&
    (value.radius === "sm" || value.radius === "md" || value.radius === "lg") &&
    "scale" in value &&
    typeof value.scale === "string" &&
    scaleLevels.includes(value.scale as Scale) &&
    "sidebarVariant" in value &&
    (value.sidebarVariant === "default" ||
      value.sidebarVariant === "inset" ||
      value.sidebarVariant === "floating") &&
    "sidebarMode" in value &&
    (value.sidebarMode === "default" ||
      value.sidebarMode === "icon" ||
      value.sidebarMode === "full")
  )
}

let rememberedUIPreferences: UIPreferences | null | undefined

function getRememberedUIPreferences() {
  if (rememberedUIPreferences !== undefined) return rememberedUIPreferences
  if (typeof window === "undefined") return null

  const saved = window.localStorage.getItem("vivat-ui-preferences")
  if (!saved) {
    rememberedUIPreferences = null
    return null
  }

  try {
    const stored = JSON.parse(saved) as Record<string, unknown>
    const preferences: unknown = {
      theme: stored.theme,
      accent: stored.preset,
      density: stored.compact === true ? "compact" : "comfortable",
      radius: stored.radius,
      scale: stored.scale,
      sidebarVariant: stored.sidebarVariant,
      sidebarMode: stored.sidebarMode,
    }
    if (isUIPreferences(preferences)) {
      rememberedUIPreferences = preferences
      return preferences
    }
  } catch {
    // Invalid local preferences are cleared below.
  }

  window.localStorage.removeItem("vivat-ui-preferences")
  rememberedUIPreferences = null
  return null
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
}) {
  return (
    <ToggleGroup
      className="grid w-full auto-cols-fr grid-flow-col rounded-xl border border-border bg-control p-1"
      onValueChange={(next) => {
        const value = next[0]
        if (value) onChange(value as T)
      }}
      spacing={0}
      value={[value]}
    >
      {options.map((option) => (
        <ToggleGroupItem
          className={cn(
            "w-full rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
            value === option.value
              ? "bg-control-hover text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

const InterfaceContext = React.createContext<{
  ready: boolean
  controls: React.ReactNode
  scaleControl: React.ReactNode
} | null>(null)
export function InterfaceScaleControl() {
  return React.useContext(InterfaceContext)?.scaleControl ?? null
}
export function InterfacePreferencesProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const path = usePathname()
  if (
    path === "/login" ||
    path === "/offline" ||
    path === "/book" ||
    path.startsWith("/book/")
  )
    return children
  return <InterfacePreferencesState>{children}</InterfacePreferencesState>
}
export function PersonalizationSettings() {
  const value = React.useContext(InterfaceContext)
  return (
    <section className="settings-panel">
      <h2 className="font-semibold">Персонализация</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Оформление вашего рабочего пространства на всех устройствах.
      </p>
      {value?.controls}
    </section>
  )
}
function InterfacePreferencesState({
  children,
}: {
  children: React.ReactNode
}) {
  const { resolvedTheme, setTheme, theme } = useTheme()
  // next-themes changes setTheme identity when the theme changes. Initial loads
  // must not rerun and restore the company default after a personal selection.
  const applyTheme = React.useEffectEvent((value: string) => setTheme(value))
  const { preferences: initialLayout } = useLayoutPreferences()
  const [preset, setPreset] = React.useState<ThemePreset>(
    defaultInterfacePreferences.accent
  )
  const [companyAccent, setCompanyAccent] = React.useState("#E9B74D")
  const [radius, setRadius] = React.useState<Radius>(initialLayout.radius)
  const [compact, setCompact] = React.useState(
    initialLayout.density === "compact"
  )
  const [scale, setScale] = React.useState<Scale>(initialLayout.scale)
  const [scalePreview, setScalePreview] = React.useState<Scale | null>(null)
  const [sidebarVariant, setSidebarVariant] = React.useState<SidebarVariant>(
    initialLayout.sidebarVariant
  )
  const [sidebarMode, setSidebarMode] = React.useState<SidebarMode>(
    initialLayout.sidebarMode
  )
  const [preferencesReady, setPreferencesReady] = React.useState(false)
  const hasPersonalThemePreference = React.useRef(false)
  const preferenceSave = useFieldAutosave<UIPreferences>(async (next) => {
    const response = await sessionFetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
      signal: AbortSignal.timeout(15000),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !isUIPreferences(payload))
      throw Error(
        payload?.error ?? "Не удалось сохранить настройки интерфейса."
      )
    return payload
  })

  function resetPreferences() {
    const defaults = defaultInterfacePreferences
    hasPersonalThemePreference.current = true
    setPreset(defaults.accent)
    setRadius(defaults.radius)
    setCompact(defaults.density === "compact")
    setScale(defaults.scale)
    setSidebarVariant(defaults.sidebarVariant)
    setSidebarMode(defaults.sidebarMode)
    setTheme(defaults.theme)
  }

  React.useEffect(() => {
    const controller = new AbortController()
    const localPreferences = getRememberedUIPreferences()

    function applyPreferences(preferences: UIPreferences) {
      rememberedUIPreferences = preferences
      React.startTransition(() => {
        setPreset(preferences.accent)
        setRadius(preferences.radius)
        setCompact(preferences.density === "compact")
        setScale(preferences.scale)
        setSidebarVariant(preferences.sidebarVariant)
        setSidebarMode(preferences.sidebarMode)
        hasPersonalThemePreference.current = true
        applyTheme(preferences.theme)
      })
    }

    void (async () => {
      try {
        const response = await sessionFetch("/api/preferences", {
          signal: controller.signal,
        })
        const payload: unknown = await response.json().catch(() => null)
        if (response.ok && isUIPreferences(payload)) {
          preferenceSave.initialize(payload)
          if (payload.configured) applyPreferences(payload)
          if (!controller.signal.aborted)
            React.startTransition(() => setPreferencesReady(true))
        }
      } catch {
        if (!controller.signal.aborted && localPreferences) {
          applyPreferences(localPreferences)
          preferenceSave.initialize(localPreferences)
          setPreferencesReady(true)
        }
      }
    })()

    return () => controller.abort()
  }, [preferenceSave])

  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/branding", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json()
        if (
          response.ok &&
          typeof payload === "object" &&
          payload !== null &&
          "primaryColor" in payload &&
          typeof payload.primaryColor === "string" &&
          "defaultTheme" in payload &&
          (payload.defaultTheme === "light" ||
            payload.defaultTheme === "dark" ||
            payload.defaultTheme === "system")
        ) {
          setCompanyAccent(payload.primaryColor)
          if (!hasPersonalThemePreference.current)
            applyTheme(payload.defaultTheme)
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  React.useEffect(() => {
    const onBrandingChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          primaryColor?: string
          defaultTheme?: "light" | "dark" | "system"
        }>
      ).detail
      const primaryColor = detail?.primaryColor
      if (typeof primaryColor === "string") setCompanyAccent(primaryColor)
      if (
        !hasPersonalThemePreference.current &&
        (detail?.defaultTheme === "light" ||
          detail?.defaultTheme === "dark" ||
          detail?.defaultTheme === "system")
      )
        applyTheme(detail.defaultTheme)
    }
    window.addEventListener("vivat-branding-change", onBrandingChange)
    return () =>
      window.removeEventListener("vivat-branding-change", onBrandingChange)
  }, [])

  React.useEffect(() => {
    const root = document.documentElement
    const current =
      preset === "company"
        ? { primary: companyAccent, foreground: colorInk(companyAccent) }
        : presets[preset]
    root.style.setProperty("--primary", current.primary)
    root.style.setProperty("--primary-foreground", current.foreground)
    root.style.setProperty("--sidebar-primary", current.primary)
    root.style.setProperty("--sidebar-primary-foreground", current.foreground)
    root.style.setProperty("--ring", current.primary)
    root.dataset.radius = radius
    root.dataset.density = compact ? "compact" : "comfortable"
    root.dataset.scale = scale
    root.dataset.sidebarVariant = sidebarVariant
    root.dataset.sidebarMode = sidebarMode
  }, [
    compact,
    companyAccent,
    preset,
    radius,
    scale,
    sidebarMode,
    sidebarVariant,
  ])

  React.useEffect(() => {
    if (!preferencesReady) return

    const preferences: UIPreferences = {
      theme:
        theme === "system"
          ? "system"
          : resolvedTheme === "light"
            ? "light"
            : "dark",
      accent: preset,
      density: compact ? "compact" : "comfortable",
      radius,
      scale,
      sidebarVariant,
      sidebarMode,
    }
    rememberedUIPreferences = preferences
    window.localStorage.setItem(
      "vivat-ui-preferences",
      JSON.stringify({
        preset,
        radius,
        compact,
        scale,
        sidebarVariant,
        sidebarMode,
        theme: preferences.theme,
      })
    )
    void preferenceSave.commit(preferences)
  }, [
    compact,
    preferencesReady,
    preferenceSave,
    preset,
    radius,
    resolvedTheme,
    scale,
    sidebarMode,
    sidebarVariant,
    theme,
  ])

  const scaleControl = (
    <div className="min-w-0 space-y-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Масштаб интерфейса</span>
        <output className="text-sm tabular-nums">
          {75 + scaleLevels.indexOf(scalePreview ?? scale) * 12.5}%
        </output>
      </div>
      <Slider
        aria-label="Масштаб интерфейса"
        min={75}
        max={125}
        step={12.5}
        value={[75 + scaleLevels.indexOf(scalePreview ?? scale) * 12.5]}
        disabled={!preferencesReady}
        data-disabled-reason="Дождитесь загрузки настроек интерфейса."
        onValueChange={(value) =>
          setScalePreview(
            scaleLevels[
              Math.round(
                ((Array.isArray(value) ? value[0] : value) - 75) / 12.5
              )
            ]
          )
        }
        onValueCommitted={(value) => {
          setScale(
            scaleLevels[
              Math.round(
                ((Array.isArray(value) ? value[0] : value) - 75) / 12.5
              )
            ]
          )
          setScalePreview(null)
        }}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>75%</span>
        <span>100%</span>
        <span>125%</span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Текст, кнопки и отступы меняются вместе на телефоне и компьютере.
      </p>
    </div>
  )
  return (
    <InterfaceContext.Provider
      value={{
        ready: preferencesReady,
        scaleControl,
        controls: (
          <div className="mt-5">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium">Цветовой акцент</span>
                <FieldSelect
                  onValueChange={(value) => setPreset(value as ThemePreset)}
                  options={[
                    { value: "company", label: "Цвет компании" },
                    ...Object.entries(presets).map(([value, option]) => ({
                      value,
                      label: option.label,
                    })),
                  ]}
                  triggerClassName="text-sm"
                  value={preset}
                />
              </label>
              <div className="space-y-2">
                <span className="block text-sm font-medium">Режим</span>
                <SegmentedControl
                  value={
                    theme === "system"
                      ? "system"
                      : resolvedTheme === "light"
                        ? "light"
                        : "dark"
                  }
                  onChange={setTheme}
                  options={[
                    { value: "light", label: "Светлый" },
                    { value: "dark", label: "Тёмный" },
                    { value: "system", label: "Система" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <span className="block text-sm font-medium">Скругление</span>
                <SegmentedControl
                  value={radius}
                  onChange={setRadius}
                  options={[
                    { value: "sm", label: "S" },
                    { value: "md", label: "M" },
                    { value: "lg", label: "L" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <span className="block text-sm font-medium">Плотность</span>
                <SegmentedControl
                  value={compact ? "compact" : "full"}
                  onChange={(value) => setCompact(value === "compact")}
                  options={[
                    { value: "compact", label: "Компактно" },
                    { value: "full", label: "Свободно" },
                  ]}
                />
              </div>
              {scaleControl}
              <div className="space-y-2">
                <span className="block text-sm font-medium">
                  Вид бокового меню
                </span>
                <SegmentedControl
                  value={sidebarVariant}
                  onChange={setSidebarVariant}
                  options={[
                    { value: "default", label: "Обычный" },
                    { value: "inset", label: "Вставка" },
                    { value: "floating", label: "Плавающий" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <span className="block text-sm font-medium">
                  Режим бокового меню
                </span>
                <SegmentedControl
                  value={sidebarMode}
                  onChange={setSidebarMode}
                  options={[
                    { value: "default", label: "Обычный" },
                    { value: "icon", label: "Иконки" },
                    { value: "full", label: "Широкий" },
                  ]}
                />
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-4 text-muted-foreground">
                Настройки сохраняются в профиле и синхронизируются между
                устройствами.
              </p>
              <Button
                disabled={!preferencesReady}
                disabledReason={"Дождитесь загрузки настроек оформления."}
                onClick={resetPreferences}
                variant="outline"
              >
                <RotateCcw />
                По умолчанию
              </Button>
            </div>
          </div>
        ),
      }}
    >
      {children}
    </InterfaceContext.Provider>
  )
}
function colorInk(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance > 150 ? "#191914" : "#FFFFFF"
}
