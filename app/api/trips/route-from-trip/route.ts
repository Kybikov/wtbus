import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"
export const dynamic = "force-dynamic"
export async function POST(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("tripId") ?? ""
  if (!/^[a-f0-9-]{36}$/i.test(id))
    return NextResponse.json({ error: "Выберите рейс." }, { status: 400 })
  try {
    const payload = await request.json()
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/trips/${id}/route`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      }
    )
    const body = await response.json().catch(() => null)
    return NextResponse.json(body ?? { error: "Не удалось создать маршрут." }, {
      status: [200, 201, 400, 401, 402, 403, 404, 409].includes(response.status)
        ? response.status
        : 502,
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось создать маршрут. Проверьте связь и повторите." },
      { status: 503 }
    )
  }
}
