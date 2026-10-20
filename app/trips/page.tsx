import { TripsPlanner } from "@/components/trips-planner"

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ createForRoute?: string | string[] }>
}) {
  const { createForRoute } = await searchParams
  return (
    <TripsPlanner
      createForRoute={
        typeof createForRoute === "string" ? createForRoute : undefined
      }
    />
  )
}
