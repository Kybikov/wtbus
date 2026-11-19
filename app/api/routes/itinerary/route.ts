import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

async function proxy(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  const applying = request.nextUrl.searchParams.get("apply") === "1"
  const entity =
    request.nextUrl.searchParams.get("entity") === "trips" ? "trips" : "routes"
  if (
    (applying && (entity !== "routes" || request.method === "PATCH")) ||
    (!applying && request.method === "POST")
  ) {
    return NextResponse.json(
      { error: "Некорректное действие." },
      { status: 400 }
    )
  }
  if (!id || !/^[\da-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { error: "Маршрут или рейс не указан." },
      { status: 400 }
    )
  }

  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/${entity}/${id}/itinerary${applying ? "/apply" : ""}`,
      {
        method: request.method,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "If-Match": request.headers.get("If-Match") ?? "",
        },
        body: request.method === "GET" ? undefined : await request.text(),
        signal: AbortSignal.timeout(15_000),
      }
    )
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить или сохранить остановки." },
      { status: 503 }
    )
  }
}

export const GET = proxy
export const PATCH = proxy
export const POST = proxy
