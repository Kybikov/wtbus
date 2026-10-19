import { redirect } from "next/navigation"
import { PersonalizationSettings } from "@/components/interface-preferences"
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
  if (section === "security") redirect("/profile")
  if (section === "personalization") return <PersonalizationSettings />
  if (!["notifications", "app"].includes(section)) notFound()
  return <PersonalProfile section={section as ProfileSection} />
}
