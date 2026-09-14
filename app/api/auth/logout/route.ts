import { NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function POST() {
  const response = NextResponse.json({ ok: true })
  try {
    await apiFetch(`${apiBaseURL}/api/v1/auth/logout`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    // The browser must still drop its cookie when the upstream is unavailable.
  } finally {
    response.cookies.set({
      name: "vivat_session",
      value: "",
      httpOnly: true,
      path: "/",
      maxAge: 0,
    })
  }
  return response
}
