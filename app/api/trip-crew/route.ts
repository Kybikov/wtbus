import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
async function proxy(request: NextRequest) {
  const tripId = request.nextUrl.searchParams.get("tripId")
  const payroll = request.nextUrl.searchParams.get("payroll") === "1"
  if (!payroll && (!tripId || !/^[\da-f-]{36}$/i.test(tripId)))
    return NextResponse.json({ error: "Выберите рейс." }, { status: 400 })
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/${payroll ? "crew-payroll" : `trips/${encodeURIComponent(tripId!)}/crew`}`,
      {
        method: request.method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        ...(request.method !== "GET"
          ? { body: JSON.stringify(await request.json()) }
          : {}),
      }
    )
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить или изменить команду рейса." },
      { status: 503 }
    )
  }
}
export const GET = proxy
export const PATCH = proxy
export const POST = proxy
