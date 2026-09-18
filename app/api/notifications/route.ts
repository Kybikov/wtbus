import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
async function forward(request: Request) {
  const url = new URL(request.url)
  const resource =
    url.searchParams.get("resource") === "push" ? "push" : "notifications"
  try {
    const body = request.method === "GET" ? undefined : await request.text()
    if (body && body.length > 8192)
      return Response.json(
        { error: "Запрос слишком большой." },
        { status: 413 }
      )
    const origin = request.headers.get("origin")
    const origins = (process.env.APP_ORIGIN ?? url.origin)
      .split(",")
      .map((value) => value.trim())
    if (
      request.method !== "GET" &&
      (request.headers.get("sec-fetch-site") === "cross-site" ||
        (origin && !origins.includes(origin)))
    )
      return Response.json(
        { error: "Недопустимый источник запроса." },
        { status: 403 }
      )
    const upstream = new URL(
      `/api/v1/me/${resource}`,
      process.env.API_INTERNAL_URL ?? "http://localhost:8080"
    )
    if (resource === "notifications" && url.searchParams.has("before"))
      upstream.searchParams.set("before", url.searchParams.get("before")!)
    const response = await apiFetch(upstream, {
      method: request.method,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json" },
      body,
    })
    return Response.json(
      await response.json().catch(() => ({ error: "Сервис недоступен." })),
      {
        status: response.status,
        headers: { "Cache-Control": "private, no-store" },
      }
    )
  } catch {
    return Response.json(
      { error: "Уведомления временно недоступны." },
      { status: 503 }
    )
  }
}
export const GET = forward
export const POST = forward
export const PATCH = forward
export const DELETE = forward
