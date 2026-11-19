import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

async function proxy(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" }
  const slug = request.nextUrl.searchParams.get("slug")
  const payment = request.nextUrl.searchParams.get("payment") === "1"
  const owner = request.nextUrl.searchParams.get("owner") === "1"
  const valid =
    (!owner || (request.method === "PATCH" && !payment)) &&
    (!slug || /^[a-z0-9-]{3,63}$/.test(slug)) &&
    (request.method === "GET"
      ? !payment
      : request.method === "PATCH"
        ? Boolean(slug && !payment)
        : payment === Boolean(slug))
  if (!valid)
    return NextResponse.json(
      { error: "Некорректное действие." },
      { status: 400, headers }
    )
  if (
    request.method !== "GET" &&
    !request.headers.get("content-type")?.includes("application/json")
  )
    return NextResponse.json(
      { error: "Ожидается JSON." },
      { status: 415, headers }
    )

  try {
    const upstream = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/platform/workspaces${slug ? "/" + slug : ""}${payment ? "/payments" : owner ? "/owner" : ""}`,
      {
        method: request.method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: request.method === "GET" ? undefined : await request.text(),
        signal: AbortSignal.timeout(15_000),
      }
    )
    return NextResponse.json(await upstream.json(), {
      status: upstream.status,
      headers,
    })
  } catch {
    return NextResponse.json(
      { error: "Панель платформы временно недоступна." },
      { status: 503, headers }
    )
  }
}

export const GET = proxy
export const POST = proxy
export const PATCH = proxy
