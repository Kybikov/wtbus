import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

function errorFrom(payload: unknown, fallback: string) {
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

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.toString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/individual-transfer-requests${search ? `?${search}` : ""}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    )
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        { error: errorFrom(body, "Не удалось загрузить заявки.") },
        { status: responseStatus(response.status) }
      )
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис заявок временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function PATCH(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  if (!id)
    return NextResponse.json(
      { error: "Не указана заявка." },
      { status: 400 }
    )
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Некорректные данные заявки." },
      { status: 400 }
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/individual-transfer-requests/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      }
    )
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        { error: errorFrom(body, "Не удалось обновить заявку.") },
        { status: responseStatus(response.status) }
      )
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис заявок временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}
