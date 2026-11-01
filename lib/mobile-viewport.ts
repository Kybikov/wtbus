// A rotated phone keeps touch navigation instead of opening the desktop sidebar.
// Keep this query aligned with the mobile app-shell media query in globals.css.
export const mobileViewportQuery =
  "(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)"

export type MobileViewport = {
  layoutHeight: number
  height: number
  top: number
  bottom: number
  keyboard: boolean
  safeTop: number
  safeBottom: number
}

// Only installed iOS uses the large viewport: Safari tabs must continue to
// follow their address bar, and Android may resize its layout for the keyboard.
export function resolveMobileViewport(input: {
  innerHeight: number
  largeHeight: number
  visualHeight: number
  visualTop: number
  scale: number
  iosStandalone: boolean
  focused: boolean
  wasKeyboard: boolean
  safeTop: number
  safeBottom: number
}): MobileViewport | null {
  if (
    Math.abs(input.scale - 1) > 0.01 ||
    !Number.isFinite(input.innerHeight) ||
    input.innerHeight <= 0 ||
    !Number.isFinite(input.visualHeight) ||
    input.visualHeight <= 0
  )
    return null
  const layoutHeight = Math.max(
    1,
    input.iosStandalone
      ? Math.max(input.innerHeight, input.largeHeight)
      : input.innerHeight
  )
  const visualHeight = Math.max(1, Math.min(input.visualHeight, layoutHeight))
  const occlusion =
    Math.max(input.largeHeight, input.innerHeight) -
    visualHeight -
    Math.max(0, input.visualTop)
  const keyboard = occlusion > 120 && (input.focused || input.wasKeyboard)
  const height = keyboard ? visualHeight : layoutHeight
  // WebKit can retain a small offset/height deficit after keyboard dismissal.
  // It is not keyboard occlusion and must not shrink the idle application.
  const top = keyboard
    ? Math.max(0, Math.min(input.visualTop, layoutHeight - height))
    : 0
  return {
    layoutHeight,
    height,
    top,
    bottom: Math.max(0, layoutHeight - top - height),
    keyboard,
    safeTop: Math.max(0, input.safeTop - top),
    safeBottom: keyboard ? 0 : Math.max(0, input.safeBottom),
  }
}
