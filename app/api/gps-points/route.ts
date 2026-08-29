import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

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
      { error: "Не удалось прочитать координаты." },
      { status: 400 }
    )
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/gps-points`,
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
    const body: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const error =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Не удалось передать геолокацию."
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
      { error: "Сервис геолокации временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}
