import { DriverLocationTracker } from "@/components/driver-location-tracker"
import { redirect } from "next/navigation"
import { getSessionRole } from "@/lib/server-role"

export default async function DriverPage() {
  const role = await getSessionRole()
  if (role && role !== "driver") redirect("/")
  return <DriverLocationTracker />
}
