import { NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function GET() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)

  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/dashboard`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    )
    const body: unknown = await upstream.json().catch(() => null)

    if (!upstream.ok) {
      const error =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Не удалось загрузить оперативную сводку."
      return NextResponse.json(
        { error },
        {
          status: [401, 402, 403].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
    }

    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис оперативной сводки временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}
