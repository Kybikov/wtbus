import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ customerID: string }> }
) {
  const { customerID } = await context.params
  if (!customerID.trim())
    return NextResponse.json({ error: "Не указан клиент." }, { status: 400 })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/customers/${encodeURIComponent(customerID)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    )
    const payload: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const error =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Не удалось загрузить историю клиента."
      return NextResponse.json(
        { error },
        { status: [400, 401, 402, 403, 404].includes(upstream.status) ? upstream.status : 502 }
      )
    }
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: "Сервис клиентов временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}
