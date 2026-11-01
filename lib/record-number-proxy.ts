import { NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"
export async function forwardRecordNumbers(
  path: string,
  method: "GET" | "PATCH",
  body?: unknown
) {
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/${path}`,
      {
        method,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }
    )
    const payload = await response.json().catch(() => null)
    return NextResponse.json(
      payload ?? { error: "Не удалось прочитать ответ." },
      { status: response.status }
    )
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить номера записей. Повторите попытку." },
      { status: 503 }
    )
  }
}
