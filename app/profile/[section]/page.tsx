import { notFound } from "next/navigation"
import {
  PersonalProfile,
  type ProfileSection,
} from "@/components/personal-profile"
export default async function ProfileSectionPage({
  params,
}: {
  params: Promise<{ section: string }>
}) {
  const { section } = await params
  if (!["notifications", "security", "app"].includes(section)) notFound()
  return <PersonalProfile section={section as ProfileSection} />
}
