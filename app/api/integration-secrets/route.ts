import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"
const endpoint = `${apiBaseURL}/api/v1/tenants/vivat-bus/integration-secrets`

async function forward(method: "GET" | "PATCH" | "POST", body?: string) {
  try {
    const response = await apiFetch(
      method === "POST" ? `${endpoint}/test` : endpoint,
      {
        method,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
        headers: body
          ? { Accept: "application/json", "Content-Type": "application/json" }
          : { Accept: "application/json" },
        body,
      }
    )
    const payload: unknown = await response.json().catch(() => null)
    return NextResponse.json(payload, {
      status: response.status < 500 ? response.status : 502,
      headers: { "Cache-Control": "private, no-store" },
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

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin &&
      !(process.env.APP_ORIGIN ?? request.nextUrl.origin)
        .split(",")
        .map((s) => s.trim())
        .includes(origin))
  )
    return NextResponse.json(
      { error: "Недопустимый источник запроса." },
      { status: 403 }
    )
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  const body = await request.text()
  if (body.length > 1024)
    return NextResponse.json(
      { error: "Запрос слишком большой." },
      { status: 413 }
    )
  return forward("POST", body)
}
