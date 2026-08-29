import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"
const baseURL = `${apiBaseURL}/api/v1/tenants/vivat-bus/availability-blocks`

function errorFrom(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

export async function GET(request: NextRequest) {
  const search = new URLSearchParams()
  for (const key of ["from", "to"]) {
    const value = request.nextUrl.searchParams.get(key)
    if (value) search.set(key, value)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(`${baseURL}?${search.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        { error: errorFrom(payload, "Не удалось загрузить недоступные даты.") },
        { status: [400, 401, 402, 403].includes(response.status) ? response.status : 502 }
      )
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: "Сервис доступности временно недоступен." },
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
      { error: "Не удалось прочитать блокировку." },
      { status: 400 }
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(baseURL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        { error: errorFrom(body, "Не удалось создать блокировку.") },
        {
          status: [400, 402, 409].includes(response.status)
            ? response.status
            : 502,
        }
      )
    return NextResponse.json(body, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Сервис доступности временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  if (!id)
    return NextResponse.json(
      { error: "Не указана блокировка." },
      { status: 400 }
    )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(`${baseURL}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        { error: errorFrom(body, "Не удалось удалить блокировку.") },
        {
          status: [400, 402, 404].includes(response.status)
            ? response.status
            : 502,
        }
      )
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис доступности временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}
