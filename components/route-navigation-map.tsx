"use client"

import * as React from "react"
import L from "leaflet"
import type {
  RoadPoint,
  RouteNavigation,
} from "@/components/route-navigation-editor"

export function RouteNavigationMap({
  navigation,
}: {
  navigation: RouteNavigation
}) {
  const container = React.useRef<HTMLDivElement>(null)
  const map = React.useRef<L.Map | null>(null)
  const road = React.useRef<L.LayerGroup | null>(null)
  React.useEffect(() => {
    if (!container.current) return
    const instance = L.map(container.current, {
      scrollWheelZoom: false,
    }).setView([50.1, 23.8], 5)
    instance.attributionControl.setPrefix(false)
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      referrerPolicy: "origin",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.openstreetmap.org/fixthemap" title="Сообщить об ошибке карты" aria-label="Сообщить об ошибке карты">ⓘ</a>',
    }).addTo(instance)
    const layer = L.layerGroup().addTo(instance)
    map.current = instance
    road.current = layer
    const resize = new ResizeObserver(() => instance.invalidateSize())
    resize.observe(container.current)
    return () => {
      resize.disconnect()
      instance.remove()
      map.current = null
      road.current = null
    }
  }, [])
  React.useEffect(() => {
    const instance = map.current,
      layer = road.current
    if (!instance || !layer) return
    layer.clearLayers()
    if (navigation.coordinates?.length)
      L.polyline(
        navigation.coordinates.map((p) => [p[1], p[0]]),
        { color: "#eab308", weight: 5 }
      ).addTo(layer)
    for (const key of ["start", "end"] as const) {
      const point = navigation[key]
      if (point)
        L.circleMarker([point[1], point[0]], {
          radius: 8,
          color: key === "start" ? "#059669" : "#dc2626",
          fillOpacity: 1,
        })
          .bindTooltip(key === "start" ? "Отправление" : "Прибытие")
          .addTo(layer)
    }
    const points = navigation.coordinates?.length
      ? navigation.coordinates
      : [navigation.start, navigation.end].filter(
          (p): p is RoadPoint => p !== null
        )
    if (points.length)
      instance.fitBounds(L.latLngBounds(points.map((p) => [p[1], p[0]])), {
        padding: [25, 25],
        maxZoom: points.length === 1 ? 12 : 13,
      })
  }, [navigation])
  return (
    <div
      ref={container}
      role="region"
      aria-label="Карта дороги маршрута"
      className="h-64 w-full bg-muted sm:h-80"
    />
  )
}
