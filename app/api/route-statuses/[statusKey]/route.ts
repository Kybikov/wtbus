import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ statusKey: string }> }
) {
  const { statusKey } = await context.params
  if (
    request.headers.get("content-type")?.includes("application/json") !== true
  )
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  const body = await request.text()
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/route-statuses/${encodeURIComponent(statusKey)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        cache: "no-store",
      }
    )
    const payload: unknown = await response.json().catch(() => null)
    return NextResponse.json(payload, {
      status: response.status < 500 ? response.status : 502,
    })
  } catch {
    return NextResponse.json(
      { error: "API временно недоступен." },
      { status: 503 }
    )
  }
}
