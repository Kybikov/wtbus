import { NextRequest, NextResponse } from "next/server"
import { apiFetch } from "@/lib/api-fetch"

export const dynamic = "force-dynamic"
const apiBaseURL = process.env.API_INTERNAL_URL ?? "http://localhost:8080"

export async function GET() {
  try {
    const response = await apiFetch(
      `${apiBaseURL}/api/v1/tenants/vivat-bus/customers/import`,
      { cache: "no-store", signal: AbortSignal.timeout(20000) }
    )
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      return NextResponse.json(
        { error: data?.error ?? "Не удалось скачать шаблон." },
        { status: response.status }
      )
    }
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          "attachment; filename=vivat-customers-template.xlsx",
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return NextResponse.json(
      { error: "Не удалось скачать шаблон. Повторите попытку." },
      { status: 503 }
    )
  }
}

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
  for (const key of ["mode", "duplicates", "token"])
    upstreamForm.set(key, String(form.get(key) ?? ""))
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
        {
          status: [400, 401, 402, 403, 409, 413].includes(upstream.status)
            ? upstream.status
            : 502,
        }
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
