import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const tripId = request.nextUrl.searchParams.get("tripId") ?? ""
  if (!/^[a-f0-9-]{36}$/i.test(tripId)) return NextResponse.json({ error: "Оберіть рейс." }, { status: 400 })
  try {
    const upstream = await apiFetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/driver/passengers?${new URLSearchParams({ tripId })}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) })
    const body = await upstream.json().catch(() => null)
    return NextResponse.json(body ?? { error: "Не вдалося завантажити пасажирів." }, { status: [200, 400, 401, 403, 404].includes(upstream.status) ? upstream.status : 502, headers: { "Cache-Control": "no-store" } })
  } catch { return NextResponse.json({ error: "Не вдалося завантажити пасажирів. Спробуйте ще раз." }, { status: 503 }) }
}
