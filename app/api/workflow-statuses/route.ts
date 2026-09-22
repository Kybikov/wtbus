import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"
const baseURL = `${apiBaseURL}/api/v1/tenants/vivat-bus/workflow-statuses`

function errorFrom(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

export async function GET(request: NextRequest) {
  const entity = request.nextUrl.searchParams.get("entity") ?? ""
  try {
    const response = await apiFetch(
      `${baseURL}?entity=${encodeURIComponent(entity)}`,
      { cache: "no-store", headers: { Accept: "application/json" } }
    )
    const payload: unknown = await response.json().catch(() => null)
    return NextResponse.json(
      response.ok
        ? payload
        : { error: errorFrom(payload, "Не удалось загрузить статусы.") },
      { status: response.status < 500 ? response.status : 502 }
    )
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
  try {
    const response = await apiFetch(baseURL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: await request.text(),
    })
    const payload: unknown = await response.json().catch(() => null)
    return NextResponse.json(payload, {
      status: response.status < 500 ? response.status : 502,
    })
  } catch {
    return NextResponse.json(
      { error: "Сервис статусов временно недоступен." },
      { status: 503 }
    )
  }
}
