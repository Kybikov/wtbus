import { NextRequest, NextResponse } from "next/server"

import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"
const baseURL = `${apiBaseURL}/api/v1/tenants/vivat-bus/team`

function errorFrom(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

function responseStatus(status: number) {
  return [400, 401, 402, 403, 404, 409].includes(status) ? status : 502
}

export async function GET() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(baseURL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        { error: errorFrom(payload, "Не удалось загрузить команду.") },
        { status: responseStatus(response.status) }
      )
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: "Сервис команды временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}

async function forwardWrite(
  request: NextRequest,
  method: "POST" | "PATCH" | "DELETE"
) {
  const id = request.nextUrl.searchParams.get("id")
  if ((method === "PATCH" || method === "DELETE") && !id)
    return NextResponse.json({ error: "Не указан сотрудник." }, { status: 400 })

  if (method === "DELETE") {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    try {
      const response = await apiFetch(
        `${baseURL}/${encodeURIComponent(id as string)}`,
        { method, cache: "no-store", signal: controller.signal }
      )
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok)
        return NextResponse.json(
          { error: errorFrom(body, "Не удалось удалить сотрудника.") },
          { status: responseStatus(response.status) }
        )
      return NextResponse.json(body)
    } catch {
      return NextResponse.json(
        { error: "Сервис команды временно недоступен." },
        { status: 503 }
      )
    } finally {
      clearTimeout(timer)
    }
  }
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать данные сотрудника." },
      { status: 400 }
    )
  }
  if (method === "PATCH" && !id)
    return NextResponse.json({ error: "Не указан сотрудник." }, { status: 400 })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await apiFetch(
      method === "PATCH"
        ? `${baseURL}/${encodeURIComponent(id as string)}`
        : baseURL,
      {
        method,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    )
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok)
      return NextResponse.json(
        { error: errorFrom(body, "Не удалось сохранить доступ сотрудника.") },
        { status: responseStatus(response.status) }
      )
    return NextResponse.json(body, { status: method === "POST" ? 201 : 200 })
  } catch {
    return NextResponse.json(
      { error: "Сервис команды временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}

export function POST(request: NextRequest) {
  return forwardWrite(request, "POST")
}

export function PATCH(request: NextRequest) {
  return forwardWrite(request, "PATCH")
}

export function DELETE(request: NextRequest) {
  return forwardWrite(request, "DELETE")
}
