import { publicTenantPattern } from "@/lib/public-booking"

type Context = { params: Promise<{ slug: string; action: string }> }

async function forward(request: Request, context: Context, method: "GET" | "POST") {
  const { slug, action } = await context.params
  if (!publicTenantPattern.test(slug) || !(method === "GET" ? ["catalog", "trips"] : ["bookings"]).includes(action)) {
    return Response.json({ error: "Сторінку не знайдено." }, { status: 404 })
  }
  let body: string | undefined
  if (method === "POST") {
    const origin = request.headers.get("origin")
    // TLS terminates at the deployment proxy; compare the public host rather
    // than Next's internal HTTP protocol. Cross-site browser calls remain denied.
    const sameHost = !origin || (() => { try { const url = new URL(origin); return ["https:", "http:"].includes(url.protocol) && url.host === (request.headers.get("host") ?? new URL(request.url).host) } catch { return false } })()
    if (!sameHost || request.headers.get("sec-fetch-site") === "cross-site") {
      return Response.json({ error: "Недозволене джерело запиту." }, { status: 403 })
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Некоректний формат запиту." }, { status: 415 })
    if (Number(request.headers.get("content-length")) > 16_384) return Response.json({ error: "Завеликий запит." }, { status: 413 })
    // Bound streamed requests too; do not buffer an unbounded anonymous body.
    const reader = request.body?.getReader()
    if (!reader) return Response.json({ error: "Дані відсутні." }, { status: 400 })
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16_384) { await reader.cancel(); return Response.json({ error: "Завеликий запит." }, { status: 413 }) }
      chunks.push(value)
    }
    body = Buffer.concat(chunks).toString("utf8")
  }
  const query = new URLSearchParams()
  if (action === "trips") for (const key of ["origin", "destination", "date", "seats"]) {
    const value = new URL(request.url).searchParams.get(key)
    if (value !== null) query.set(key, value)
  }
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/public/${slug}/${action}?${query}`, {
      method, body, cache: "no-store", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(12_000),
    })
    return Response.json(await response.json(), { status: response.status, headers: { "Cache-Control": "no-store", ...(response.status === 429 ? { "Retry-After": "900" } : {}) } })
  } catch {
    return Response.json({ error: "Сервіс тимчасово недоступний. Спробуйте ще раз." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
export function GET(request: Request, context: Context) { return forward(request, context, "GET") }
export function POST(request: Request, context: Context) { return forward(request, context, "POST") }
