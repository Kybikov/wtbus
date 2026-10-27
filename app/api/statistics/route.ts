import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const query = new URLSearchParams()
  for (const key of ["from", "to", "currency"]) {
    const value = request.nextUrl.searchParams.get(key)
    if (value) query.set(key, value)
  }
  try {
    const upstream = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/statistics?${query}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json" },
      }
    )
    const body = await upstream.json().catch(() => null)
    return NextResponse.json(
      upstream.ok
        ? body
        : { error: body?.error ?? "Не удалось загрузить статистику." },
      {
        status: upstream.ok
          ? 200
          : [400, 401, 402, 403].includes(upstream.status)
            ? upstream.status
            : 502,
        headers: { "Cache-Control": "private, no-store" },
      }
    )
  } catch {
    return NextResponse.json(
      { error: "Сервис статистики временно недоступен. Повторите загрузку." },
      { status: 503 }
    )
  }
}
