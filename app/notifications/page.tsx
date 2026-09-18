import { NotificationsInboxContent } from "@/components/notifications-inbox"
import { AppShell } from "@/components/app-shell"
import { Card } from "@/components/ui/card"
export default function NotificationsPage() {
  return (
    <AppShell pageTitle="Уведомления">
      <Card>
        <NotificationsInboxContent />
      </Card>
    </AppShell>
  )
}
