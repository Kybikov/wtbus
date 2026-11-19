import { MyTripsWorkspace } from "@/components/my-trips-workspace"

export default async function DriverPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return (
    <MyTripsWorkspace initialTab={tab === "money" ? "money" : "passengers"} />
  )
}
