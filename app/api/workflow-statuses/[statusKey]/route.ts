import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ statusKey: string }> }
) {
  const { statusKey } = await context.params
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/workflow-statuses/${encodeURIComponent(statusKey)}`,
      {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: await request.text(),
      }
    )
    return NextResponse.json(await response.json(), {
      status: response.status < 500 ? response.status : 502,
    })
  } catch {
    return NextResponse.json(
      { error: "API временно недоступен." },
      { status: 503 }
    )
  }
}
