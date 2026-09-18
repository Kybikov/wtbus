import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

async function forward(request: NextRequest) {
  const entity = request.nextUrl.searchParams.get("entity") ?? ""
  if (!["customers", "bookings", "team"].includes(entity))
    return NextResponse.json({ error: "Оберіть колекцію." }, { status: 400 })
  const params = new URLSearchParams({ entity })
  const id = request.nextUrl.searchParams.get("id")
  if (id) params.set("id", id)
  let body: string | undefined
  if (["POST", "PATCH"].includes(request.method)) {
    try {
      body = JSON.stringify(await request.json())
    } catch {
      return NextResponse.json({ error: "Некоректні дані." }, { status: 400 })
    }
    if (body.length > 32768)
      return NextResponse.json({ error: "Забагато даних." }, { status: 413 })
  }
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/entity-views?${params}`,
      {
        method: request.method,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
      }
    )
    const payload = await response.json()
    return NextResponse.json(payload, {
      status:
        response.ok || [400, 401, 403, 404, 409].includes(response.status)
          ? response.status
          : 502,
    })
  } catch {
    return NextResponse.json(
      { error: "Сервис видов временно недоступен." },
      { status: 503 }
    )
  }
}
export const GET = forward
export const POST = forward
export const PATCH = forward
export const DELETE = forward
