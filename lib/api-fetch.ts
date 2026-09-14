import { cookies } from "next/headers"

const demoTenantPath = "/api/v1/tenants/vivat-bus"

async function resolveTenantScopedInput(
  input: RequestInfo | URL,
  session: string | undefined,
  signal?: AbortSignal | null
) {
  if (!session || (typeof input !== "string" && !(input instanceof URL)))
    return input
  const url = new URL(input.toString())
  if (!url.pathname.startsWith(demoTenantPath)) return input

  try {
    const identityResponse = await fetch(
      new URL("/api/v1/auth/me", url.origin),
      {
        cache: "no-store",
        signal,
        headers: {
          Authorization: `Bearer ${session}`,
          Accept: "application/json",
        },
      }
    )
    const identity: unknown = await identityResponse.json().catch(() => null)
    if (
      !identityResponse.ok ||
      typeof identity !== "object" ||
      identity === null ||
      !("tenantSlug" in identity) ||
      typeof identity.tenantSlug !== "string" ||
      identity.tenantSlug.trim() === ""
    ) {
      return input
    }
    url.pathname = url.pathname.replace(
      demoTenantPath,
      `/api/v1/tenants/${encodeURIComponent(identity.tenantSlug)}`
    )
    return url.toString()
  } catch {
    return input
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const session = (await cookies()).get("vivat_session")?.value
  const headers = new Headers(init?.headers)

  if (session) {
    headers.set("Authorization", `Bearer ${session}`)
  }

  return fetch(await resolveTenantScopedInput(input, session, init?.signal), {
    ...init,
    headers,
  })
}
