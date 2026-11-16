import { NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
export async function GET() {
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/me/trips`,
      { cache: "no-store" }
    )
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить ваши рейсы." },
      { status: 503 }
    )
  }
}
