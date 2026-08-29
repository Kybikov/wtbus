import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать файл." },
      { status: 400 }
    )
  }
  const file = form.get("file")
  if (!(file instanceof File))
    return NextResponse.json(
      { error: "Выберите CSV или XLSX файл." },
      { status: 400 }
    )
  if (file.size > 10 * 1024 * 1024)
    return NextResponse.json(
      { error: "Размер файла не должен превышать 10 МБ." },
      { status: 400 }
    )
  const upstreamForm = new FormData()
  upstreamForm.set("file", file, file.name)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const upstream = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/customers/import`,
      {
        method: "POST",
        body: upstreamForm,
        cache: "no-store",
        signal: controller.signal,
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
          : "Не удалось импортировать клиентов."
      return NextResponse.json(
        { error },
        { status: [400, 402].includes(upstream.status) ? upstream.status : 502 }
      )
    }
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(
      { error: "Сервис импорта временно недоступен." },
      { status: 503 }
    )
  } finally {
    clearTimeout(timer)
  }
}
