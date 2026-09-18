import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

function isCompanySelection(body: unknown): body is {
  requiresCompanySelection: true
  selectionToken: string
  companies: unknown[]
} {
  return (
    typeof body === "object" &&
    body !== null &&
    "requiresCompanySelection" in body &&
    body.requiresCompanySelection === true &&
    "selectionToken" in body &&
    typeof body.selectionToken === "string" &&
    "companies" in body &&
    Array.isArray(body.companies)
  )
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать данные входа." },
      { status: 400 }
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const upstream = await fetch(`${apiBaseURL}/api/v1/auth/login`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const body: unknown = await upstream.json().catch(() => null)
    if (upstream.ok && isCompanySelection(body)) {
      return NextResponse.json(body)
    }
    if (
      !upstream.ok ||
      typeof body !== "object" ||
      body === null ||
      !("sessionToken" in body) ||
      typeof body.sessionToken !== "string"
    ) {
      const genericError =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Не удалось выполнить вход."
      const error =
        upstream.status === 429
          ? "Слишком много неверных попыток. Подождите 15 минут и попробуйте снова."
          : genericError
      const response = NextResponse.json(
        { error },
        {
          status: [400, 401, 429].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
      const retryAfter = upstream.headers.get("Retry-After")
      if (retryAfter) response.headers.set("Retry-After", retryAfter)
      return response
    }
    const { sessionToken, ...account } = body
    const response = NextResponse.json(account)
    for (const name of ["vivat_layout", "sidebar_state"]) {
      response.cookies.set({ name, value: "", path: "/", maxAge: 0 })
    }
    response.cookies.set({
      name: "vivat_session",
      value: sessionToken,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    })
    return response
  } catch {
    return NextResponse.json(
      { error: "Сервис авторизации временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}
