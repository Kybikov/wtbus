"use client"

import * as React from "react"
import {
  GPSDeliveryError,
  GPS_INTERVAL_MS,
  GPSQueue,
  indexedGPSStore,
  type GPSPoint,
} from "@/lib/gps-queue"

export type GPSTarget = {
  scope: string
  membershipId: string
  vehicleId: string
  tripId: string
}
type GPSStatus = {
  tracking: boolean
  fresh: boolean
  locating: boolean
  pending: number
  lastSent: Date | null
  accuracy: number | null
  online: boolean
  wakeLocked: boolean
  hidden: boolean
  error: string | null
  notice: string | null
  authRequired: boolean
}

export function useDriverGPS(target: GPSTarget | null) {
  const [state, setState] = React.useState<GPSStatus>({
    tracking: false,
    fresh: false,
    locating: false,
    pending: 0,
    lastSent: null,
    accuracy: null,
    online: true,
    wakeLocked: false,
    hidden: false,
    error: null,
    notice: null,
    authRequired: false,
  })
  const runtime = React.useRef<{
    start: () => void
    stop: () => void
    once: () => void
    flush: () => Promise<void>
    drain: () => Promise<boolean>
  } | null>(null)
  const scope = target?.scope
  const membershipId = target?.membershipId
  const vehicleId = target?.vehicleId
  const tripId = target?.tripId

  React.useEffect(() => {
    if (!scope || !membershipId || !vehicleId || !tripId) return
    let disposed = false
    let watching = false
    let starting = false
    let watch: number | null = null
    let generation = 0
    let lastCapture = -Infinity
    let lastFix = -Infinity
    let captureBusy = false
    let releaseTrackingLock: (() => void) | null = null
    let wake: WakeLockSentinel | null = null
    let requestingWake = false
    let flushing = false
    const requests = new Set<AbortController>()
    const update = (patch: Partial<GPSStatus>) => {
      if (!disposed) setState((current) => ({ ...current, ...patch }))
    }
    const releaseWake = () => {
      void wake?.release().catch(() => {})
      wake = null
      update({ wakeLocked: false })
    }
    const requestWake = async () => {
      if (
        !watching ||
        disposed ||
        document.visibilityState !== "visible" ||
        wake ||
        requestingWake ||
        !("wakeLock" in navigator)
      )
        return
      requestingWake = true
      try {
        const lock = await navigator.wakeLock.request("screen")
        if (disposed || !watching) {
          await lock.release()
          return
        }
        wake = lock
        update({ wakeLocked: true })
        lock.addEventListener("release", () => {
          if (wake === lock) {
            wake = null
            update({ wakeLocked: false })
          }
        })
      } catch {
        update({ wakeLocked: false })
      } finally {
        requestingWake = false
      }
    }
    const stop = () => {
      generation += 1
      watching = false
      starting = false
      if (watch !== null) navigator.geolocation.clearWatch(watch)
      watch = null
      releaseTrackingLock?.()
      releaseTrackingLock = null
      releaseWake()
      update({ tracking: false, locating: false })
    }
    const queue = new GPSQueue(
      indexedGPSStore,
      scope,
      async (point: GPSPoint) => {
        if (disposed) throw new Error("GPS screen closed")
        const controller = new AbortController()
        requests.add(controller)
        const timeout = window.setTimeout(() => controller.abort(), 12_000)
        try {
          const response = await fetch("/api/gps-points", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(point),
            signal: controller.signal,
          })
          if (!response.ok) {
            throw new GPSDeliveryError(
              response.status,
              "Не удалось отправить координаты."
            )
          }
          update({
            lastSent: new Date(),
            error: null,
            authRequired: false,
            online: navigator.onLine,
          })
        } finally {
          window.clearTimeout(timeout)
          requests.delete(controller)
        }
      }
    )
    const countPending = async () => {
      const points = await indexedGPSStore.list(scope)
      update({ pending: points.length })
      return points.length
    }
    const flush = async () => {
      if (disposed || flushing || !navigator.onLine) return
      flushing = true
      try {
        const deliver = () =>
          queue.flush((point) => {
            if (point.tripId === tripId) stop()
            update({
              notice:
                "Часть точек отклонена сервером или старше 48 часов. Проверьте назначение рейса и время на телефоне перед повторным запуском GPS.",
            })
          })
        if (navigator.locks) {
          await navigator.locks.request(
            `gps-delivery:${scope}`,
            { ifAvailable: true },
            (lock) => (lock ? deliver() : undefined)
          )
        } else {
          await deliver()
        }
        await countPending()
      } catch (error) {
        const authRequired =
          error instanceof GPSDeliveryError && [401, 403].includes(error.status)
        if (authRequired) stop()
        update({
          authRequired,
          error: authRequired
            ? "Сессия или доступ изменились. Войдите снова для продолжения GPS. Точки сохранены."
            : "Связь с сервером недоступна. Сохранённые точки отправятся при восстановлении связи.",
        })
      } finally {
        flushing = false
      }
    }
    const savePosition = async (
      position: GeolocationPosition,
      currentGeneration: number,
      manual = false
    ) => {
      if (disposed || currentGeneration !== generation || captureBusy) return
      if (!manual && Date.now() - lastCapture < GPS_INTERVAL_MS) return
      const { latitude, longitude, accuracy } = position.coords
      if (
        ![latitude, longitude, accuracy, position.timestamp].every(
          Number.isFinite
        ) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180 ||
        accuracy < 0
      ) {
        update({
          locating: false,
          error:
            "Телефон вернул некорректные координаты. Повторите определение GPS.",
        })
        return
      }
      update({ accuracy, locating: false })
      if (accuracy > 200) {
        update({
          notice: `Низкая точность GPS: ±${Math.round(accuracy)} м. Ожидаем более точную позицию.`,
        })
        return
      }
      captureBusy = true
      lastCapture = Date.now()
      lastFix = position.timestamp
      update({ fresh: Date.now() - lastFix <= 120_000 })
      try {
        await indexedGPSStore.add({
          scope,
          membershipId,
          vehicleId,
          tripId,
          clientPointId: crypto.randomUUID(),
          latitude,
          longitude,
          accuracyMeters: accuracy,
          recordedAt: new Date(position.timestamp).toISOString(),
        })
        update({ notice: null })
        await countPending()
        void flush()
      } catch (error) {
        stop()
        update({
          error:
            error instanceof Error
              ? error.message
              : "Не удалось сохранить GPS на телефоне.",
        })
      } finally {
        captureBusy = false
      }
    }
    const onError = (
      error: GeolocationPositionError,
      currentGeneration: number
    ) => {
      if (disposed || generation !== currentGeneration) return
      if (error.code === error.PERMISSION_DENIED) stop()
      update({
        locating: false,
        error:
          error.code === error.PERMISSION_DENIED
            ? "Доступ к геолокации выключен. Разрешите его в настройках браузера и запустите GPS снова."
            : "GPS временно недоступен. Проверьте геолокацию телефона; при активной передаче поиск продолжится.",
      })
    }
    const beginWatch = () => {
      if (disposed || !starting) return
      watching = true
      starting = false
      const currentGeneration = ++generation
      lastCapture = -Infinity
      update({
        tracking: true,
        locating: true,
        error: null,
        authRequired: false,
      })
      watch = navigator.geolocation.watchPosition(
        (position) => void savePosition(position, currentGeneration),
        (error) => onError(error, currentGeneration),
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5000 }
      )
      void requestWake()
    }
    const start = () => {
      if (watching || starting || disposed) return
      if (!navigator.geolocation || !window.isSecureContext) {
        update({
          error:
            "Для GPS откройте приложение по HTTPS в браузере с поддержкой геолокации.",
        })
        return
      }
      starting = true
      update({ locating: true, error: null })
      if (navigator.locks) {
        void navigator.locks
          .request("vivat-gps-capture", { ifAvailable: true }, async (lock) => {
            if (!lock) {
              starting = false
              update({
                locating: false,
                error:
                  "GPS уже работает в другом окне. Остановите передачу там, чтобы продолжить здесь.",
              })
              return
            }
            if (disposed || !starting) return
            await new Promise<void>((resolve) => {
              releaseTrackingLock = resolve
              beginWatch()
            })
          })
          .catch(() => {
            stop()
            update({
              error:
                "Не удалось запустить GPS. Закройте другие окна и повторите.",
            })
          })
      } else {
        beginWatch()
      }
    }
    const once = () => {
      if (!navigator.geolocation || !window.isSecureContext) {
        update({ error: "Для GPS нужен HTTPS и разрешение геолокации." })
        return
      }
      update({ locating: true, error: null })
      const currentGeneration = generation
      navigator.geolocation.getCurrentPosition(
        (position) => void savePosition(position, currentGeneration, true),
        (error) => onError(error, currentGeneration),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
      )
    }
    const onVisibility = () => {
      update({ hidden: document.visibilityState !== "visible" })
      if (document.visibilityState === "visible") {
        void requestWake()
        void flush()
      } else {
        releaseWake()
      }
    }
    const onOnline = () => {
      update({ online: true })
      void flush()
    }
    const onOffline = () => update({ online: false })
    const initialize = window.setTimeout(() => {
      update({
        tracking: false,
        fresh: false,
        locating: false,
        pending: 0,
        lastSent: null,
        accuracy: null,
        error: null,
        notice: null,
        authRequired: false,
        online: navigator.onLine,
        hidden: document.visibilityState !== "visible",
      })
      // Legacy data has no membership owner. Leave it intact, but never send it
      // under the identity of a newly signed-in driver.
      void countPending()
        .then(flush)
        .catch(() =>
          update({
            error:
              "Хранилище GPS недоступно. Разрешите сохранение данных для этого сайта.",
          })
        )
    }, 0)
    const timer = window.setInterval(() => {
      update({ fresh: Date.now() - lastFix <= 120_000 })
      void flush()
      void requestWake()
    }, 5000)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    document.addEventListener("visibilitychange", onVisibility)
    runtime.current = {
      start,
      stop,
      once,
      flush,
      drain: async () => {
        stop()
        const deadline = Date.now() + 15_000
        // A capture already being committed must be included before completing a trip.
        while (captureBusy && !disposed && Date.now() < deadline)
          await new Promise((resolve) => window.setTimeout(resolve, 20))
        while (flushing && !disposed && Date.now() < deadline)
          await new Promise((resolve) => window.setTimeout(resolve, 20))
        if (disposed || Date.now() >= deadline) return false
        let timer: number | undefined
        try {
          await Promise.race([
            flush(),
            new Promise<void>((resolve) => {
              timer = window.setTimeout(resolve, deadline - Date.now())
            }),
          ])
        } finally {
          window.clearTimeout(timer)
        }
        if (disposed) return false
        return (await countPending()) === 0
      },
    }
    return () => {
      disposed = true
      stop()
      runtime.current = null
      requests.forEach((controller) => controller.abort())
      window.clearTimeout(initialize)
      window.clearInterval(timer)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [scope, membershipId, vehicleId, tripId])

  return {
    ...state,
    tracking: !!target && state.tracking,
    start: () => runtime.current?.start(),
    stop: () => runtime.current?.stop(),
    sendOnce: () => runtime.current?.once(),
    retry: () => runtime.current?.flush(),
    prepareCompletion: async () =>
      runtime.current ? runtime.current.drain() : true,
  }
}
