import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"
export const dynamic = "force-dynamic"
async function proxy(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  if (!id || !/^[\da-f-]{36}$/i.test(id))
    return NextResponse.json(
      { error: "Некорректный номер бронирования." },
      { status: 400 }
    )
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/bookings/${encodeURIComponent(id)}/passengers`,
      {
        method: request.method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        ...(request.method !== "GET"
          ? { body: JSON.stringify(await request.json()) }
          : {}),
      }
    )
    const body = await response
      .json()
      .catch(() => ({
        error: "Не удалось загрузить пассажиров. Повторите попытку.",
      }))
    return NextResponse.json(body, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      {
        error:
          "Не удалось загрузить или изменить пассажиров. Повторите попытку.",
      },
      { status: 503 }
    )
  }
}
export const GET = proxy
export const POST = proxy
export const PATCH = proxy
