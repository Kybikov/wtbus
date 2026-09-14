import { NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function GET() {
  try {
    const response = await apiFetch(`${apiBaseURL}/api/v1/auth/me`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const error =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Не удалось проверить сессию."
      const result = NextResponse.json(
        { error },
        {
          status: response.status === 401 ? 401 : 502,
          headers: { "Cache-Control": "no-store" },
        }
      )
      if (response.status === 401) {
        result.cookies.set("vivat_session", "", {
          httpOnly: true,
          path: "/",
          maxAge: 0,
        })
      }
      return result
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Сервис проверки сессии временно недоступен." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    )
  }
}
