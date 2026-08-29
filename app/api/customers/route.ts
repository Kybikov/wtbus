import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"

const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

function upstreamError() {
  return NextResponse.json(
    { error: "Сервис клиентов временно недоступен. Повторите попытку." },
    { status: 503 }
  )
}

export async function GET(request: NextRequest) {
	if (request.nextUrl.searchParams.get("export") === "xlsx") {
		const abortController = new AbortController()
		const timeout = setTimeout(() => abortController.abort(), 20_000)
		try {
			const upstream = await apiFetch(
				`${apiBaseURL}/api/v1/tenants/vivat-bus/customers/export`,
				{
					cache: "no-store",
					headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
					signal: abortController.signal,
				}
			)
			if (!upstream.ok) {
				if (![401, 402, 403].includes(upstream.status)) return upstreamError()
				const body: unknown = await upstream.json().catch(() => null)
				const error =
					typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
						? body.error
						: "Не удалось выгрузить базу клиентов."
				return NextResponse.json({ error }, { status: upstream.status })
			}
			return new NextResponse(await upstream.arrayBuffer(), {
				headers: {
					"Cache-Control": "no-store",
					"Content-Disposition": upstream.headers.get("content-disposition") ?? "attachment; filename=customers.xlsx",
					"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				},
			})
		} catch {
			return upstreamError()
		} finally {
			clearTimeout(timeout)
		}
	}
  const search = new URLSearchParams()
  const q = request.nextUrl.searchParams.get("q")
  const limit = request.nextUrl.searchParams.get("limit")
  const offset = request.nextUrl.searchParams.get("offset")
  if (q) search.set("q", q)
  if (limit) search.set("limit", limit)
  if (offset) search.set("offset", offset)

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/customers?${search.toString()}`,
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
          : "Не удалось загрузить клиентов."
      return NextResponse.json(
        { error },
        { status: [400, 401, 402, 403].includes(upstream.status) ? upstream.status : 502 }
      )
    }
    return NextResponse.json(payload)
  } catch {
    return upstreamError()
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { error: "Ожидается запрос в формате JSON." },
      { status: 415 }
    )
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать данные клиента." },
      { status: 400 }
    )
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/customers`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      }
    )
    const responsePayload: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const error =
        typeof responsePayload === "object" &&
        responsePayload !== null &&
        "error" in responsePayload &&
        typeof responsePayload.error === "string"
          ? responsePayload.error
          : "Не удалось создать клиента."
      return NextResponse.json(
        { error },
        {
          status: [400, 402, 409].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
    }
    return NextResponse.json(responsePayload, { status: 201 })
  } catch {
    return upstreamError()
  } finally {
    clearTimeout(timeout)
  }
}

export async function PATCH(request: NextRequest) {
  const customerID = request.nextUrl.searchParams.get("id")
  if (!customerID)
    return NextResponse.json({ error: "Не указан клиент." }, { status: 400 })
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json(
      { error: "Ожидается запрос в формате JSON." },
      { status: 415 }
    )

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать данные клиента." },
      { status: 400 }
    )
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 5_000)
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/customers/${encodeURIComponent(customerID)}`,
      {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      }
    )
    const responsePayload: unknown = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const error =
        typeof responsePayload === "object" &&
        responsePayload !== null &&
        "error" in responsePayload &&
        typeof responsePayload.error === "string"
          ? responsePayload.error
          : "Не удалось обновить клиента."
      return NextResponse.json(
        { error },
        {
          status: [400, 401, 402, 403, 404, 409].includes(upstream.status)
            ? upstream.status
            : 502,
        }
      )
    }
    return NextResponse.json(responsePayload)
  } catch {
    return upstreamError()
  } finally {
    clearTimeout(timeout)
  }
}
