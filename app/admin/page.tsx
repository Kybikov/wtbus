import { PlatformWorkspaces } from "@/components/platform-workspaces"
import { apiFetch } from "@/lib/api-fetch"

async function findClient(
  id: string | undefined
): Promise<{ email: string; name: string } | undefined> {
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return
  try {
    const result = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/platform/clients`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    )
    if (result.ok) {
      const data: { items: { id: string; email: string; name: string }[] } =
        await result.json()
      return data.items.find((item) => item.id === id)
    }
  } catch {
    return undefined
  }
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; client?: string; create?: string }>
}) {
  const { company, client, create } = await searchParams
  const owner = await findClient(client)
  return (
    <PlatformWorkspaces
      key={JSON.stringify([company, client, create])}
      initialSlug={company}
      newOwner={owner}
      openCreate={create === "1" || !!owner}
    />
  )
}
