import { NextRequest, NextResponse } from "next/server"
import { forwardRecordNumbers } from "@/lib/record-number-proxy"
export const dynamic = "force-dynamic"
export async function GET() {
  return forwardRecordNumbers("record-number-settings", "GET")
}
export async function PATCH(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Ожидается JSON." }, { status: 415 })
  try {
    return await forwardRecordNumbers(
      "record-number-settings",
      "PATCH",
      await request.json()
    )
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать настройки." },
      { status: 400 }
    )
  }
}
