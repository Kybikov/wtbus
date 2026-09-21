import { notFound } from "next/navigation"
import { EntityDetailPage } from "@/components/entity-detail-page"
import { entityCollections, type EntityCollection } from "@/lib/entity-views"
export default async function Page({
  params,
}: {
  params: Promise<{ entity: string; id: string }>
}) {
  const { entity, id } = await params
  if (
    !entityCollections.includes(entity as EntityCollection) ||
    entity === "cash-balances"
  )
    notFound()
  return (
    <EntityDetailPage
      key={`${entity}:${id}`}
      entity={entity as EntityCollection}
      id={id}
    />
  )
}
