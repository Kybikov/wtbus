export type LayoutPreferences = {
  sidebarMode: "default" | "icon" | "full"
  sidebarVariant: "default" | "inset" | "floating"
  scale: "sm" | "md" | "lg"
  radius: "sm" | "md" | "lg"
  density: "comfortable" | "compact"
}

export type SidebarOverride = {
  mode: LayoutPreferences["sidebarMode"]
  open: boolean
}

export type LayoutSnapshot = {
  preferences: LayoutPreferences
  override: SidebarOverride | null
}

export const layoutCookieName = "vivat_layout"
export const defaultLayoutPreferences: LayoutPreferences = {
  sidebarMode: "default",
  sidebarVariant: "default",
  scale: "md",
  radius: "lg",
  density: "comfortable",
}

export function parseLayoutPreferences(value: unknown): LayoutPreferences | null {
  if (typeof value !== "object" || value === null) return null
  const data = value as Record<string, unknown>
  if (
    typeof data.sidebarMode !== "string" ||
    typeof data.sidebarVariant !== "string" ||
    typeof data.scale !== "string" ||
    typeof data.radius !== "string" ||
    typeof data.density !== "string"
  ) return null
  if (
    !["default", "icon", "full"].includes(data.sidebarMode) ||
    !["default", "inset", "floating"].includes(data.sidebarVariant) ||
    !["sm", "md", "lg"].includes(data.scale) ||
    !["sm", "md", "lg"].includes(data.radius) ||
    !["comfortable", "compact"].includes(data.density)
  ) return null
  return {
    sidebarMode: data.sidebarMode as LayoutPreferences["sidebarMode"],
    sidebarVariant: data.sidebarVariant as LayoutPreferences["sidebarVariant"],
    scale: data.scale as LayoutPreferences["scale"],
    radius: data.radius as LayoutPreferences["radius"],
    density: data.density as LayoutPreferences["density"],
  }
}

export function parseLayoutCookie(value: string | undefined): LayoutSnapshot | null {
  if (!value) return null
  try {
    const data = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>
    const preferences = parseLayoutPreferences(data.preferences)
    if (!preferences) return null
    const override = data.override as Partial<SidebarOverride> | null
    return {
      preferences,
      override:
        override && override.mode === preferences.sidebarMode &&
        typeof override.open === "boolean"
          ? { mode: override.mode, open: override.open }
          : null,
    }
  } catch {
    return null
  }
}

export function serializeLayoutCookie(snapshot: LayoutSnapshot) {
  return encodeURIComponent(JSON.stringify(snapshot))
}
