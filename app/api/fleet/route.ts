import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function GET() {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)

  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/fleet`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: abortController.signal,
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
          : "Не удалось загрузить автопарк."
      return NextResponse.json(
        { error },
        { status: [401, 402, 403].includes(upstream.status) ? upstream.status : 502 }
      )
    }

    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: "Сервис автопарка временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function forwardVehicleMutation(
  request: NextRequest,
  method: "POST" | "PATCH"
) {
  const vehicleID = request.nextUrl.searchParams.get("id")
  if (method === "PATCH" && !vehicleID)
    return NextResponse.json(
      { error: "Не указан автомобиль." },
      { status: 400 }
    )
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать автомобиль." },
      { status: 400 }
    )
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)
  const path =
    method === "PATCH"
      ? `/fleet/${encodeURIComponent(vehicleID ?? "")}`
      : "/fleet"
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus${path}`,
      {
        method,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
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
          : "Не удалось сохранить автомобиль."
      return NextResponse.json(
        { error },
        {
          status: [400, 401, 402, 403, 404, 409].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
    }
    return NextResponse.json(body, { status: method === "POST" ? 201 : 200 })
  } catch {
    return NextResponse.json(
      { error: "Сервис автопарка временно недоступен. Повторите попытку." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: NextRequest) {
  return forwardVehicleMutation(request, "POST")
}

export async function PATCH(request: NextRequest) {
  return forwardVehicleMutation(request, "PATCH")
}
