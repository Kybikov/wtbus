import { NextRequest } from "next/server"
import { forwardRecordNumbers } from "@/lib/record-number-proxy"
export const dynamic = "force-dynamic"
export async function GET(request: NextRequest) {
  return forwardRecordNumbers(
    `record-number-search?q=${encodeURIComponent(request.nextUrl.searchParams.get("q") ?? "")}`,
    "GET"
  )
}
