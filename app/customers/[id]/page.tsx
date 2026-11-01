import { EntityDetailPage } from "@/components/entity-detail-page"
export default async function CustomerDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <EntityDetailPage entity="customers" id={id} />
}
