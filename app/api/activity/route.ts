import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"
export async function GET(request: NextRequest) {
  const query = new URLSearchParams()
  if (request.nextUrl.searchParams.get("kind") === "requests")
    query.set("kind", "requests")
  const before = request.nextUrl.searchParams.get("before")
  if (before && /^\d{1,19}$/.test(before)) query.set("before", before)
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/activity?${query}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) }
    )
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить журнал." },
      { status: 503 }
    )
  }
}
