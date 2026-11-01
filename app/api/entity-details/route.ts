import { NextRequest } from "next/server"
import { forwardEntityDetail } from "@/lib/entity-detail-proxy"
export const dynamic = "force-dynamic"
export async function GET(request: NextRequest) {
  return forwardEntityDetail(
    request.nextUrl.searchParams.get("entity") ?? "",
    request.nextUrl.searchParams.get("id") ?? ""
  )
}
