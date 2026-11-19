import { NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

async function clients(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner")
  const headers = { "Cache-Control": "private, no-store" }
  const updating = request.method === "PATCH"
  if (updating && (!owner || !/^[a-f0-9-]{36}$/i.test(owner)))
    return NextResponse.json(
      { error: "Клиент не найден." },
      { status: 404, headers }
    )
  if (
    updating &&
    !request.headers.get("content-type")?.includes("application/json")
  )
    return NextResponse.json(
      { error: "Ожидается JSON." },
      { status: 415, headers }
    )
  try {
    const result = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/platform/clients${updating ? "/" + owner : ""}`,
      {
        method: request.method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: updating ? await request.text() : undefined,
        signal: AbortSignal.timeout(8000),
      }
    )
    if (result.status === 204)
      return new NextResponse(null, { status: 204, headers })
    return NextResponse.json(await result.json(), {
      status: result.status,
      headers,
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить данные клиентов." },
      { status: 503, headers }
    )
  }
}

export const GET = clients
export const PATCH = clients
