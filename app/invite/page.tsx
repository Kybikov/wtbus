import { InvitationRegistration } from "@/components/invitation-registration"

export const metadata = {
  title: "Приглашение в команду · Vivat",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
}

export default function InvitePage() {
  return <InvitationRegistration />
}
