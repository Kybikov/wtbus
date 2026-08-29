import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

async function forward(method: "GET" | "PATCH", body?: unknown) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/branding`,
      {
        method,
        cache: "no-store",
        headers: body
          ? { "Content-Type": "application/json", Accept: "application/json" }
          : { Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      }
    )
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const error =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Не удалось сохранить бренд компании."
      return NextResponse.json(
        { error },
        { status: [400, 402].includes(response.status) ? response.status : 502 }
      )
    }
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: "Сервис настроек временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function GET() {
  return forward("GET")
}

export async function PATCH(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { error: "Ожидается запрос в формате JSON." },
      { status: 415 }
    )
  }
  try {
    return forward("PATCH", await request.json())
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать настройки бренда." },
      { status: 400 }
    )
  }
}
