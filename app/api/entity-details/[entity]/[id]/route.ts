import { NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"
import { entityCollections, type EntityCollection } from "@/lib/entity-views"
export const dynamic = "force-dynamic"
export async function GET(
  _: Request,
  { params }: { params: Promise<{ entity: string; id: string }> }
) {
  const { entity, id } = await params
  if (!entityCollections.includes(entity as EntityCollection))
    return NextResponse.json(
      { error: "Колекцію не знайдено." },
      { status: 404 }
    )
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/entity-details/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
      { cache: "no-store", signal: AbortSignal.timeout(10000) }
    )
    return NextResponse.json(await response.json(), {
      status:
        response.ok || [400, 401, 403, 404].includes(response.status)
          ? response.status
          : 502,
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить запись." },
      { status: 503 }
    )
  }
}
