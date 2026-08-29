import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function GET() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/routes`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    )
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        {
          error:
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : "Не удалось загрузить маршруты.",
        },
        { status: [400, 401, 402, 403].includes(response.status) ? response.status : 502 }
      )
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: "Сервис маршрутов временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
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
      { error: "Не удалось прочитать маршрут." },
      { status: 400 }
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/routes`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    )
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const error =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Не удалось создать маршрут."
      return NextResponse.json(
        { error },
        { status: [400, 402].includes(response.status) ? response.status : 502 }
      )
    }
    return NextResponse.json(body, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Сервис маршрутов временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function PATCH(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  if (!id)
    return NextResponse.json({ error: "Не указан маршрут." }, { status: 400 })
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать маршрут." },
      { status: 400 }
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/routes/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    )
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const error =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Не удалось обновить маршрут."
      return NextResponse.json(
        { error },
        { status: [400, 404].includes(response.status) ? response.status : 502 }
      )
    }
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис маршрутов временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}
