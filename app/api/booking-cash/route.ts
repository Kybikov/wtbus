import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"
export const dynamic = "force-dynamic"
async function proxy(request: NextRequest) {
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/finance/booking-cash?${request.nextUrl.searchParams}`,
      {
        method: request.method,
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        ...(request.method === "POST"
          ? { body: JSON.stringify(await request.json()) }
          : {}),
      }
    )
    return NextResponse.json(await response.json(), {
      status: response.status >= 500 ? 502 : response.status,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      {
        error: "Не удалось загрузить или сохранить оплату. Повторите попытку.",
      },
      { status: 503 }
    )
  }
}
export const GET = proxy
export const POST = proxy
