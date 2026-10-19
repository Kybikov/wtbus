"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SettingsFormSection } from "@/components/settings-form-1"
import { installPWA, usePWAInstall } from "@/lib/pwa-install"
export function ProfileAppSettings() {
  const install = usePWAInstall()
  const [instructions, setInstructions] = React.useState(false)
  const [installing, setInstalling] = React.useState(false)
  async function installApp() {
    if (!install.prompt) {
      setInstructions(true)
      return
    }
    setInstalling(true)
    try {
      if ((await installPWA()) === "dismissed") setInstructions(true)
    } catch {
      setInstructions(true)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <SettingsFormSection
      title="Приложение Vivat Bus"
      description="Установите приложение на телефон или компьютер."
    >
      <div className="space-y-4">
        {install.standalone ? (
          <Badge variant="secondary">Приложение установлено</Badge>
        ) : (
          <Button
            disabled={!install.ready || installing}
            onClick={() => void installApp()}
          >
            {installing ? "Открываем установку…" : "Установить приложение"}
          </Button>
        )}
        {!install.standalone && (instructions || install.ios) ? (
          <div
            className="rounded-lg bg-muted/35 p-3 text-sm leading-6 text-muted-foreground"
            role="status"
          >
            {install.ios
              ? "Откройте сайт в Safari, нажмите «Поделиться», затем «На экран Домой» → «Добавить»."
              : "В меню браузера выберите «Установить приложение» или «Добавить на главный экран». Если пункта нет, откройте сайт в Chrome или Edge."}
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Приложение доступно всем сотрудникам. Геолокация нужна только водителю
          при передаче GPS.
        </p>
      </div>
    </SettingsFormSection>
  )
}
