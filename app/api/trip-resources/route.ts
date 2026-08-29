import { NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function GET() {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)

  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/trip-resources`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: abortController.signal,
      }
    )

    const payload: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const error =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Не удалось загрузить транспорт и водителей."
      return NextResponse.json(
        { error },
        { status: [400, 401, 402, 403].includes(upstream.status) ? upstream.status : 502 }
      )
    }

    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: "Сервис рейсов временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}
