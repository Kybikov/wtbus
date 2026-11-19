import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

async function proxy(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  const entity =
    request.nextUrl.searchParams.get("entity") === "trips" ? "trips" : "routes"
  if (!id || !/^[\da-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { error: "Маршрут или рейс не указан." },
      { status: 400 }
    )
  }

  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/${entity}/${id}/itinerary`,
      {
        method: request.method,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "If-Match": request.headers.get("If-Match") ?? "",
        },
        body: request.method === "PATCH" ? await request.text() : undefined,
        signal: AbortSignal.timeout(15_000),
      }
    )
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить или сохранить остановки." },
      { status: 503 }
    )
  }
}

export const GET = proxy
export const PATCH = proxy
