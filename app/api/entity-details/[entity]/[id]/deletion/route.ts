import { NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
type Context = { params: Promise<{ entity: string; id: string }> }
async function forward(request: Request, { params }: Context) {
  const { entity, id } = await params
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/tenants/vivat-bus/entity-details/${encodeURIComponent(entity)}/${encodeURIComponent(id)}/deletion`,
      {
        method: request.method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: request.method === "DELETE" ? await request.text() : undefined,
        signal: AbortSignal.timeout(15000),
      }
    )
    return NextResponse.json(await response.json(), {
      status:
        response.ok || [400, 401, 403, 404, 409].includes(response.status)
          ? response.status
          : 502,
    })
  } catch {
    return NextResponse.json(
      {
        error:
          "Не удалось выполнить удаление. Проверьте связь и обновите состав записей.",
      },
      { status: 503 }
    )
  }
}
export const GET = forward
export const DELETE = forward
