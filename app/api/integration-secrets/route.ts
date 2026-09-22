import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"
const endpoint = `${apiBaseURL}/api/v1/tenants/vivat-bus/integration-secrets`

async function forward(method: "GET" | "PATCH", body?: string) {
  try {
    const response = await apiFetch(endpoint, {
      method,
      cache: "no-store",
      headers: body
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      body,
    })
    const payload: unknown = await response.json().catch(() => null)
    return NextResponse.json(payload, {
      status: response.status < 500 ? response.status : 502,
    })
  } catch {
    return NextResponse.json(
      { error: "Сервис интеграций временно недоступен." },
      { status: 503 }
    )
  }
}

export async function GET() {
  return forward("GET")
}

export async function PATCH(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  return forward("PATCH", await request.text())
}
