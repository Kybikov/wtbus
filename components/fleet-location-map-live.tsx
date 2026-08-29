"use client"

import * as React from "react"
import L from "leaflet"
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet"

import type { FleetMapPosition } from "@/components/fleet-location-map"

const vehicleIcon = L.divIcon({
  className: "vivat-map-marker",
  html: '<span aria-hidden="true"></span>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -18],
})

function initialCenter(points: FleetMapPosition[]): [number, number] {
  const latitude =
    points.reduce((total, point) => total + point.latitude, 0) / points.length
  const longitude =
    points.reduce((total, point) => total + point.longitude, 0) / points.length
  return [latitude, longitude]
}

function FitFleetBounds({ points }: { points: FleetMapPosition[] }) {
  const map = useMap()
  const locationKey = points
    .map((point) => `${point.id}:${point.latitude}:${point.longitude}`)
    .join("|")

  React.useEffect(() => {
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 12, {
        animate: true,
      })
      return
    }
    map.fitBounds(
      points.map(
        (point) => [point.latitude, point.longitude] as [number, number]
      ),
      { padding: [32, 32], maxZoom: 10, animate: true }
    )
  }, [locationKey, map, points])

  return null
}

function externalMapURL(point: FleetMapPosition) {
  const latitude = point.latitude.toFixed(6)
  const longitude = point.longitude.toFixed(6)
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`
}

export function LiveFleetLocationMap({
  points,
}: {
  points: FleetMapPosition[]
}) {
  return (
    <MapContainer
      aria-label="Интерактивная карта с последними GPS-позициями автопарка"
      center={initialCenter(points)}
      className="h-72 w-full bg-muted/35"
      keyboard
      scrollWheelZoom
      touchZoom
      zoom={8}
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitFleetBounds points={points} />
      {points.map((point) => (
        <Marker
          icon={vehicleIcon}
          key={point.id}
          position={[point.latitude, point.longitude]}
          title={point.name}
        >
          <Popup>
            <div className="min-w-44 text-sm">
              <p className="font-semibold">{point.name}</p>
              <p className="mt-1 text-xs text-slate-600">
                {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
              </p>
              <a
                className="mt-3 inline-flex font-semibold text-blue-700 underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-blue-600/40"
                href={externalMapURL(point)}
                rel="noreferrer"
                target="_blank"
              >
                Открыть в OpenStreetMap
              </a>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
