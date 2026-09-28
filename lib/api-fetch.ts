import { cookies } from "next/headers"
import { createHash } from "node:crypto"

const demoTenantPath = "/api/v1/tenants/vivat-bus"
const tenantCacheLifetime = 30_000
const tenantCache = new Map<
  string,
  { expiresAt: number; promise: Promise<string | undefined> }
>()

function tenantCacheKey(session: string, origin: string) {
  return createHash("sha256")
    .update(origin)
    .update("\0")
    .update(session)
    .digest("base64url")
}

function tenantSlugForSession(session: string, origin: string) {
  const key = tenantCacheKey(session, origin)
  const now = Date.now()
  const cached = tenantCache.get(key)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = fetch(new URL("/api/v1/auth/me", origin), {
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
    headers: {
      Authorization: `Bearer ${session}`,
      Accept: "application/json",
    },
  })
    .then(async (response) => {
      const identity: unknown = await response.json().catch(() => null)
      if (
        response.ok &&
        typeof identity === "object" &&
        identity !== null &&
        "tenantSlug" in identity &&
        typeof identity.tenantSlug === "string" &&
        identity.tenantSlug.trim() !== ""
      )
        return identity.tenantSlug
      tenantCache.delete(key)
      return undefined
    })
    .catch(() => {
      tenantCache.delete(key)
      return undefined
    })

  if (tenantCache.size >= 500) {
    for (const [cacheKey, entry] of tenantCache) {
      if (entry.expiresAt <= now || tenantCache.size >= 500)
        tenantCache.delete(cacheKey)
      if (tenantCache.size < 500) break
    }
  }
  tenantCache.set(key, { expiresAt: now + tenantCacheLifetime, promise })
  return promise
}

async function resolveTenantScopedInput(
  input: RequestInfo | URL,
  session: string | undefined
) {
  if (!session || (typeof input !== "string" && !(input instanceof URL)))
    return input
  const url = new URL(input.toString())
  if (!url.pathname.startsWith(demoTenantPath)) return input

  try {
    const tenantSlug = await tenantSlugForSession(session, url.origin)
    if (!tenantSlug) return input
    url.pathname = url.pathname.replace(
      demoTenantPath,
      `/api/v1/tenants/${encodeURIComponent(tenantSlug)}`
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

  return fetch(await resolveTenantScopedInput(input, session), {
    ...init,
    headers,
  })
}
