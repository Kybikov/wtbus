import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
const paths: Record<string, string> = {
  report: "finance/report",
  snapshot: "finance/accounting",
  ledger: "finance/ledger",
  operations: "finance/operations",
  review: "finance/review",
  settings: "finance/settings",
  wallet: "driver/wallet",
  handovers: "driver/handovers",
}
async function proxy(request: NextRequest) {
  const view = request.nextUrl.searchParams.get("view") ?? "snapshot"
  const allowed =
    request.method === "GET"
      ? ["snapshot", "ledger", "settings", "wallet", "report"]
      : request.method === "PATCH"
        ? ["review", "settings"]
        : ["operations", "handovers"]
  if (!allowed.includes(view))
    return NextResponse.json(
      { error: "Неизвестная операция." },
      { status: 400 }
    )
  const query = new URLSearchParams(request.nextUrl.searchParams)
  query.delete("view")
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/${paths[view]}?${query}`,
      {
        method: request.method,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(request.method !== "GET"
          ? { body: JSON.stringify(await request.json()) }
          : {}),
      }
    )
    const body: unknown = await response
      .json()
      .catch(() => ({ error: "Не удалось прочитать ответ." }))
    return NextResponse.json(body, {
      status: response.status >= 500 ? 502 : response.status,
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось связаться с сервисом финансов. Повторите попытку." },
      { status: 503 }
    )
  }
}
export const GET = proxy
export const POST = proxy
export const PATCH = proxy
