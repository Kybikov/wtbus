import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
export async function GET(request: NextRequest) {
  const query = new URLSearchParams()
  query.set("q", request.nextUrl.searchParams.get("q") ?? "")
  if (request.nextUrl.searchParams.get("search") === "true")
    query.set("search", "true")
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/navigation-places?${query}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      }
    )
    const payload: unknown = await response.json().catch(() => null)
    return NextResponse.json(payload ?? { error: "Не удалось найти место." }, {
      status: payload ? response.status : 502,
    })
  } catch {
    return NextResponse.json(
      {
        error:
          "Поиск временно недоступен. Выберите точку на карте или повторите попытку.",
      },
      { status: 503 }
    )
  }
}
