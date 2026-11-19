import { NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

async function workspaces(request: Request) {
  const headers = { "Cache-Control": "private, no-store" }
  const switching = request.method === "POST"
  if (
    switching &&
    !request.headers.get("content-type")?.includes("application/json")
  ) {
    return NextResponse.json(
      { error: "Ожидается JSON." },
      { status: 415, headers }
    )
  }
  try {
    const upstream = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/auth/workspaces`,
      {
        method: request.method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: switching ? await request.text() : undefined,
        signal: AbortSignal.timeout(8_000),
      }
    )
    const data = await upstream.json()
    if (!upstream.ok || !switching)
      return NextResponse.json(data, { status: upstream.status, headers })

    if (typeof data.sessionToken !== "string")
      return NextResponse.json(
        { error: "Не удалось сменить компанию." },
        { status: 502, headers }
      )

    const response = NextResponse.json(
      { tenantSlug: data.tenantSlug },
      { headers }
    )
    for (const name of ["vivat_layout", "sidebar_state"])
      response.cookies.set({ name, value: "", path: "/", maxAge: 0 })
    response.cookies.set({
      name: "vivat_session",
      value: data.sessionToken,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    })
    return response
  } catch {
    return NextResponse.json(
      { error: "Сервис компаний временно недоступен." },
      { status: 503, headers }
    )
  }
}

export const GET = workspaces
export const POST = workspaces
