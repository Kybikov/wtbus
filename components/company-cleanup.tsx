"use client"
import { useRecordDeletion } from "@/components/use-record-deletion"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

export function CompanyCleanup() {
  const router = useRouter()
  const deletion = useRecordDeletion("company", () => {
    router.replace("/")
    router.refresh()
  })
  if (!deletion.available) return null
  return (
    <section className="surface-card space-y-3 p-4">
      <h2 className="font-semibold">Рабочие данные</h2>
      <Button
        variant="destructive"
        onClick={() => deletion.open("current", "Рабочие данные этой компании")}
      >
        Очистить рабочие данные
      </Button>
      {deletion.dialog}
    </section>
  )
}
