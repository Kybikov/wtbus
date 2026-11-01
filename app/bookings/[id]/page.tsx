import { EntityDetailPage } from "@/components/entity-detail-page"
export default async function BookingDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <EntityDetailPage entity="bookings" id={id} />
}
