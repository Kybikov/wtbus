import { NextResponse } from "next/server"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params
  const headers = { "Cache-Control": "private, no-store" }
  if (action !== "preview" && action !== "accept")
    return NextResponse.json(
      { error: "Страница не найдена." },
      { status: 404, headers }
    )
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json(
      { error: "Ожидается JSON." },
      { status: 415, headers }
    )
  try {
    const upstream = await fetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/auth/invitations/${action}`,
      {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: await request.text(),
        signal: AbortSignal.timeout(8000),
      }
    )
    const data = await upstream.json()
    if (!upstream.ok || action === "preview")
      return NextResponse.json(data, { status: upstream.status, headers })
    const { sessionToken, ...account } = data
    if (typeof sessionToken !== "string") throw Error("Missing session")
    const response = NextResponse.json(account, { status: 201, headers })
    for (const name of ["vivat_layout", "sidebar_state"])
      response.cookies.set({ name, value: "", path: "/", maxAge: 0 })
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
      { error: "Сервис приглашений временно недоступен." },
      { status: 503, headers }
    )
  }
}
