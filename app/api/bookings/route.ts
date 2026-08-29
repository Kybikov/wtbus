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
      `${apiBaseURL}/api/v1/tenants/vivat-bus/bookings${search ? `?${search}` : ""}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    )
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        { error: errorFrom(body, "Не удалось загрузить бронирования.") },
        { status: responseStatus(response.status) }
      )
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис бронирований временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  const action = request.nextUrl.searchParams.get("action")
  if ((id || action) && (action !== "confirm-payment" || !id)) {
    return NextResponse.json(
      { error: "Некорректное действие бронирования." },
      { status: 400 }
    )
  }
  if (id && action === "confirm-payment") {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    try {
      const response = await apiFetch(
        `${apiBaseURL}/api/v1/tenants/vivat-bus/bookings/${encodeURIComponent(id)}/payment-confirmation`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        }
      )
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok)
        return NextResponse.json(
          { error: errorFrom(body, "Не удалось подтвердить оплату.") },
          { status: responseStatus(response.status) }
        )
      return NextResponse.json(body)
    } catch {
      return NextResponse.json(
        { error: "Сервис бронирований временно недоступен." },
        { status: 503 }
      )
    } finally {
      clearTimeout(timer)
    }
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Некорректные данные бронирования." },
      { status: 400 }
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/bookings`,
      {
        method: "POST",
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
    if (!response.ok) {
      const error = errorFrom(body, "Не удалось создать бронирование.")
      return NextResponse.json(
        { error },
        {
          status: responseStatus(response.status),
        }
      )
    }
    return NextResponse.json(body, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Сервис бронирования временно недоступен." },
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
      { error: "Не указано бронирование." },
      { status: 400 }
    )
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Некорректные данные бронирования." },
      { status: 400 }
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/bookings/${encodeURIComponent(id)}`,
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
        { error: errorFrom(body, "Не удалось изменить бронирование.") },
        { status: responseStatus(response.status) }
      )
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис бронирований временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}
