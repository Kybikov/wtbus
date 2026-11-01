import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

async function proxy(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  const entity =
    request.nextUrl.searchParams.get("entity") === "trips" ? "trips" : "routes"
  if (!id || !/^[\da-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "Не указан маршрут." }, { status: 400 })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const body = request.method === "PATCH" ? await request.json() : undefined
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/${entity}/${id}/navigation`,
      {
        method: request.method,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      }
    )
    const payload: unknown = await response.json().catch(() => null)
    return NextResponse.json(
      payload ?? { error: "Не удалось загрузить дорогу." },
      { status: payload ? response.status : 502 }
    )
  } catch {
    return NextResponse.json(
      { error: "Не удалось построить дорогу. Повторите попытку." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}

export const GET = proxy
export const PATCH = proxy
