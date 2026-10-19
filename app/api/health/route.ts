// A local liveness probe must stay independent of sessions and Telegram.
export function GET() {
  return Response.json({ status: "ok" }, {
    headers: { "Cache-Control": "no-store" },
  })
}
