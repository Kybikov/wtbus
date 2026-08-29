import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

function isCalendarDay(value: string) {
  if (!ISO_DAY.test(value)) return false

  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date")

  if (!date || !isCalendarDay(date)) {
    return NextResponse.json(
      { error: "Укажите корректную дату в формате ГГГГ-ММ-ДД." },
      { status: 400 }
    )
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)

  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/trips?date=${encodeURIComponent(date)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: abortController.signal,
      }
    )

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Не удалось получить рейсы. Повторите попытку." },
        {
          status: [400, 401, 402, 403].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
    }

    return NextResponse.json(await upstream.json())
  } catch {
    return NextResponse.json(
      { error: "Сервис рейсов временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { error: "Ожидается запрос в формате JSON." },
      { status: 415 }
    )
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать данные рейса." },
      { status: 400 }
    )
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)

  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/trips`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      }
    )
    const responsePayload: unknown = await upstream.json().catch(() => null)

    if (!upstream.ok) {
      const error =
        typeof responsePayload === "object" &&
        responsePayload !== null &&
        "error" in responsePayload &&
        typeof responsePayload.error === "string"
          ? responsePayload.error
          : "Не удалось создать рейс. Повторите попытку."
      return NextResponse.json(
        { error },
        {
          status: [400, 401, 402, 403, 409].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
    }

    return NextResponse.json(responsePayload, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Сервис рейсов временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function PATCH(request: NextRequest) {
  const tripID = request.nextUrl.searchParams.get("id")
  if (!tripID) {
    return NextResponse.json({ error: "Не указан рейс." }, { status: 400 })
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { error: "Ожидается запрос в формате JSON." },
      { status: 415 }
    )
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать действие по рейсу." },
      { status: 400 }
    )
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)

  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/trips/${encodeURIComponent(tripID)}`,
      {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      }
    )
    const responsePayload: unknown = await upstream.json().catch(() => null)

    if (!upstream.ok) {
      const error =
        typeof responsePayload === "object" &&
        responsePayload !== null &&
        "error" in responsePayload &&
        typeof responsePayload.error === "string"
          ? responsePayload.error
          : "Не удалось обновить рейс. Повторите попытку."
      return NextResponse.json(
        { error },
        {
          status: [400, 401, 402, 403, 404, 409].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
    }

    return NextResponse.json(responsePayload)
  } catch {
    return NextResponse.json(
      { error: "Сервис рейсов временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function PUT(request: NextRequest) {
  const tripID = request.nextUrl.searchParams.get("id")
  if (!tripID)
    return NextResponse.json({ error: "Не указан рейс." }, { status: 400 })
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
      { error: "Не удалось прочитать рейс." },
      { status: 400 }
    )
  }
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/trips/${encodeURIComponent(tripID)}`,
      {
        method: "PUT",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      }
    )
    const responsePayload: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const error =
        typeof responsePayload === "object" &&
        responsePayload !== null &&
        "error" in responsePayload &&
        typeof responsePayload.error === "string"
          ? responsePayload.error
          : "Не удалось изменить рейс."
      return NextResponse.json(
        { error },
        {
          status: [400, 401, 402, 403, 404, 409].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
    }
    return NextResponse.json(responsePayload)
  } catch {
    return NextResponse.json(
      { error: "Сервис рейсов временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}
