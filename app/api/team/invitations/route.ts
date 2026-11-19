import { NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

async function invitations(request: Request) {
  const method = request.method
  const id = new URL(request.url).searchParams.get("id")
  if (method === "DELETE" && !/^[a-f0-9-]{36}$/i.test(id ?? ""))
    return NextResponse.json(
      { error: "Приглашение не найдено." },
      { status: 404 }
    )
  if (
    method === "POST" &&
    !request.headers.get("content-type")?.includes("application/json")
  )
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  try {
    const suffix = method === "DELETE" ? `/${id}` : ""
    const result = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/team/invitations${suffix}`,
      {
        method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? await request.text() : undefined,
        signal: AbortSignal.timeout(8000),
      }
    )
    const headers = { "Cache-Control": "private, no-store" }
    if (result.status === 204)
      return new NextResponse(null, { status: 204, headers })
    return NextResponse.json(await result.json(), {
      status: result.status,
      headers,
    })
  } catch {
    return NextResponse.json(
      { error: "Приглашения временно недоступны." },
      { status: 503 }
    )
  }
}

export const GET = invitations
export const POST = invitations
export const DELETE = invitations
