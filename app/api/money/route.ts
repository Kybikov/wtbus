import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
const endpoints: Record<string, string> = {
  workspace: "workspace",
  booking: "booking-payments",
  profits: "trips",
}
async function proxy(request: NextRequest) {
  const view = request.nextUrl.searchParams.get("view") ?? "workspace"
  const endpoint = endpoints[view]
  if (!endpoint || (request.method === "POST" && view !== "workspace")) {
    return NextResponse.json(
      { error: "Неизвестная финансовая операция." },
      { status: 400 }
    )
  }
  const search = new URLSearchParams(request.nextUrl.searchParams)
  search.delete("view")
  let body: unknown
  if (request.method === "POST") {
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Проверьте данные операции." },
        { status: 400 }
      )
    }
  }
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/finance/${endpoint}?${search}`,
      {
        method: request.method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }
    )
    const payload = await response.json().catch(() => null)
    if (!payload)
      return NextResponse.json(
        { error: "Не удалось получить результат операции. Повторите запрос." },
        { status: 502 }
      )
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось выполнить финансовую операцию. Повторите запрос." },
      { status: 503 }
    )
  }
}
export const GET = proxy
export const POST = proxy
