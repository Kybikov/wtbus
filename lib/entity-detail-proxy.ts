import { NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"
import { entityCollections, type EntityCollection } from "@/lib/entity-views"

export async function forwardEntityDetail(entity: string, id: string) {
  if (
    !entityCollections.includes(entity as EntityCollection) ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)
  )
    return NextResponse.json({ error: "Запись не найдена." }, { status: 404 })
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/entity-details/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json" },
      }
    )
    const payload = await response.json().catch(() => null)
    if (!payload || typeof payload !== "object")
      return NextResponse.json(
        { error: "Не удалось загрузить запись. Повторите попытку." },
        { status: 503 }
      )
    return NextResponse.json(payload, {
      status:
        response.ok || [400, 401, 403, 404].includes(response.status)
          ? response.status
          : 502,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить запись. Повторите попытку." },
      { status: 503 }
    )
  }
}
