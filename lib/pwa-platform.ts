export type PWAPlatform = "mac" | "windows" | "android" | "ios"
export function pwaPlatform(
  userAgent: string,
  platform: string,
  maxTouchPoints: number
): PWAPlatform | null {
  if (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  )
    return "ios"
  if (/Android/i.test(userAgent)) return "android"
  if (/Windows/i.test(userAgent)) return "windows"
  if (/Macintosh|Mac OS X/i.test(userAgent) || /Mac/i.test(platform))
    return "mac"
  return null
}
export const pwaPlatforms = [
  {
    id: "mac",
    name: "macOS",
    detail: "Safari или Chrome · в Dock",
    steps: [
      "Откройте Vivat Bus в Safari на Mac.",
      "В меню «Файл» выберите «Добавить в Dock» и нажмите «Добавить».",
      "В Chrome можно нажать значок установки в адресной строке.",
    ],
    help: "https://support.apple.com/104996",
  },
  {
    id: "windows",
    name: "Windows",
    detail: "Chrome или Edge · отдельное окно",
    steps: [
      "Откройте Vivat Bus в Chrome или Edge.",
      "Нажмите значок установки в адресной строке и подтвердите установку.",
      "В Edge также можно открыть меню → «Дополнительные инструменты» → «Приложения» → «Установить этот сайт как приложение».",
    ],
    help: "https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge",
  },
  {
    id: "android",
    name: "Android",
    detail: "Chrome · на главный экран",
    steps: [
      "Откройте Vivat Bus в Chrome на телефоне.",
      "Откройте меню ⋮ → «Добавить на главный экран» → «Установить».",
      "Если браузер предлагает окно установки, подтвердите его.",
    ],
    help: "https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid",
  },
  {
    id: "ios",
    name: "iOS",
    detail: "Safari · на экран «Домой»",
    steps: [
      "Откройте Vivat Bus в Safari на iPhone или iPad.",
      "Нажмите «Поделиться» → «На экран Домой».",
      "Если есть переключатель «Открывать как веб-приложение», включите его. Нажмите «Добавить».",
    ],
    help: "https://support.apple.com/guide/iphone/iphea86e5236/ios",
  },
] as const
