import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"
const baseURL = `${apiBaseURL}/api/v1/tenants/vivat-bus/route-statuses`

function errorFrom(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

export async function GET() {
  try {
    const response = await apiFetch(baseURL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        {
          error: errorFrom(payload, "Не удалось загрузить статусы маршрутов."),
        },
        { status: response.status < 500 ? response.status : 502 }
      )
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: "Сервис статусов временно недоступен." },
      { status: 503 }
    )
  }
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать статус." },
      { status: 400 }
    )
  }
  try {
    const response = await apiFetch(baseURL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        { error: errorFrom(body, "Не удалось добавить статус.") },
        { status: response.status < 500 ? response.status : 502 }
      )
    return NextResponse.json(body, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Сервис статусов временно недоступен." },
      { status: 503 }
    )
  }
}
