import { publicTenantPattern } from "@/lib/public-booking"

type Context = { params: Promise<{ slug: string; bookingID: string }> }

export async function GET(request: Request, context: Context) {
  const { slug, bookingID } = await context.params
  const token = new URL(request.url).searchParams.get("token") ?? ""
  if (!publicTenantPattern.test(slug) || !/^[a-f0-9-]{36}$/i.test(bookingID) || token.length < 32 || token.length > 128)
    return Response.json({ error: "Платіж не знайдено." }, { status: 404 })
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/public/${slug}/payments/${bookingID}?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    })
    return Response.json(await response.json(), { status: response.status, headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Не вдалося перевірити оплату." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
