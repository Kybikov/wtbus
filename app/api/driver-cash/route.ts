import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

function upstreamError(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

function responseStatus(status: number) {
  return [400, 401, 402, 403, 404, 409].includes(status) ? status : 502
}

export async function GET() {
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/driver/cash-summary`,
      { cache: "no-store", headers: { Accept: "application/json" } }
    )
    const body: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok)
      return NextResponse.json(
        { error: upstreamError(body, "Не удалось получить сумму наличных.") },
        { status: responseStatus(upstream.status) }
      )
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис наличных временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  }
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json(
      { error: "Ожидается запрос в формате JSON." },
      { status: 415 }
    )

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать подтверждение наличных." },
      { status: 400 }
    )
  }

  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/driver/cash-received`,
      {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      }
    )
    const body: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok)
      return NextResponse.json(
        { error: upstreamError(body, "Не удалось подтвердить наличные.") },
        { status: responseStatus(upstream.status) }
      )
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис наличных временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  }
}
