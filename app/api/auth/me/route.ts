import { NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function GET() {
  const response = await apiFetch(`${apiBaseURL}/api/v1/auth/me`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Не удалось проверить сессию."
    return NextResponse.json(
      { error },
      { status: response.status === 401 ? 401 : 502 }
    )
  }
  return NextResponse.json(payload)
}
