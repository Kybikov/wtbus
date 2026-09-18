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

export async function PATCH(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  }
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Некорректные данные профиля." }, { status: 400 })
  }
  try {
    const response = await apiFetch(`${apiBaseURL}/api/v1/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    const payload: unknown = await response.json().catch(() => ({ error: "Не удалось сохранить профиль." }))
    return NextResponse.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Сервис профиля временно недоступен." }, { status: 503 })
  }
}
