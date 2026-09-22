import { publicTenantPattern } from "@/lib/public-booking"

type Context = { params: Promise<{ slug: string; bookingID: string }> }

export async function GET(request: Request, context: Context) {
  const { slug, bookingID } = await context.params
  const token = new URL(request.url).searchParams.get("token") ?? ""
  if (!publicTenantPattern.test(slug) || !/^[a-f0-9-]{36}$/i.test(bookingID) || token.length < 32 || token.length > 128)
    return new Response(null, { status: 404 })
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/public/${slug}/payments/${bookingID}/qr?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      headers: { Accept: "image/png" },
      signal: AbortSignal.timeout(12_000),
    })
    return new Response(response.ok ? await response.arrayBuffer() : null, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store", ...(response.ok ? { "Content-Type": "image/png" } : {}) },
    })
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
