import { forwardEntityDetail } from "@/lib/entity-detail-proxy"
export const dynamic = "force-dynamic"
export async function GET(
  _: Request,
  { params }: { params: Promise<{ entity: string; id: string }> }
) {
  const { entity, id } = await params
  return forwardEntityDetail(entity, id)
}
