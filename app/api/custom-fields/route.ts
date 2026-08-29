import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"
const validEntities = new Set(["customer", "trip", "booking"])

function entityFrom(value: unknown) {
  return typeof value === "string" && validEntities.has(value) ? value : null
}

function collectionURL(entity: string) {
  return `${apiBaseURL}/api/v1/tenants/vivat-bus/custom-fields?entity=${encodeURIComponent(entity)}`
}

function errorFrom(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

export async function GET(request: NextRequest) {
  const entity = entityFrom(
    request.nextUrl.searchParams.get("entity") ?? "customer"
  )
  if (!entity)
    return NextResponse.json(
      { error: "Сущность поля указана неверно." },
      { status: 400 }
    )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)

  try {
    const response = await apiFetch(collectionURL(entity), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(
        { error: errorFrom(payload, "Не удалось загрузить поля.") },
        { status: [400, 401, 402, 403].includes(response.status) ? response.status : 502 }
      )
    }
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: "Сервис полей временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}

async function forwardWrite(request: NextRequest, method: "POST" | "PATCH") {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать поле." },
      { status: 400 }
    )
  }

  const id = request.nextUrl.searchParams.get("id")
  if (method === "PATCH" && !id) {
    return NextResponse.json({ error: "Не указано поле." }, { status: 400 })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const entity =
      typeof payload === "object" && payload !== null && "entityType" in payload
        ? entityFrom(payload.entityType)
        : null
    if (method === "POST" && !entity) {
      return NextResponse.json(
        { error: "Сущность поля указана неверно." },
        { status: 400 }
      )
    }
    const response = await apiFetch(
      method === "PATCH"
        ? `${apiBaseURL}/api/v1/tenants/vivat-bus/custom-fields/${encodeURIComponent(id as string)}`
        : collectionURL(entity as string),
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
    if (!response.ok) {
      return NextResponse.json(
        { error: errorFrom(body, "Не удалось сохранить поле.") },
        {
          status: [400, 402, 404, 409].includes(response.status)
            ? response.status
            : 502,
        }
      )
    }
    return NextResponse.json(body, { status: method === "POST" ? 201 : 200 })
  } catch {
    return NextResponse.json(
      { error: "Сервис полей временно недоступен." },
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
