import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"
const isoDate = /^\d{4}-\d{2}-\d{2}$/

function validDate(value: string | null) {
  if (!value || !isoDate.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from")
  const to = request.nextUrl.searchParams.get("to")
  if (!validDate(from) || !validDate(to)) {
    return NextResponse.json(
      { error: "Укажите период в формате ГГГГ-ММ-ДД." },
      { status: 400 }
    )
  }
  const periodFrom = from as string
  const periodTo = to as string
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/finance/summary?from=${encodeURIComponent(periodFrom)}&to=${encodeURIComponent(periodTo)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    )
    const body: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const error =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Не удалось загрузить финансы."
      return NextResponse.json(
        { error },
        { status: [400, 401, 402, 403].includes(upstream.status) ? upstream.status : 502 }
      )
    }
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис финансов временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
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
      { error: "Не удалось прочитать кассовую операцию." },
      { status: 400 }
    )
  }
  const isExpense = request.nextUrl.searchParams.get("action") === "expense"
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/finance/${isExpense ? "expenses" : "driver-cash"}`,
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
    const body: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const error =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : isExpense
            ? "Не удалось сохранить расход."
            : "Не удалось сохранить кассовую операцию."
      return NextResponse.json(
        { error },
        {
          status: [400, 401, 402, 403, 404, 409].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
    }
    return NextResponse.json(body, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Сервис финансов временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}
