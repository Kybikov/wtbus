import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать выбор компании." },
      { status: 400 }
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const upstream = await fetch(`${apiBaseURL}/api/v1/auth/select-company`, {
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
    if (
      !upstream.ok ||
      typeof body !== "object" ||
      body === null ||
      !("sessionToken" in body) ||
      typeof body.sessionToken !== "string"
    ) {
      const error =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Не удалось выбрать компанию."
      return NextResponse.json(
        { error },
        { status: [400, 401, 403].includes(upstream.status) ? upstream.status : 502 }
      )
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
