import { createHash } from "node:crypto"

type SessionState = "authenticated" | "unauthenticated" | "unavailable"
const sessionCache = new Map<
  string,
  { expiresAt: number; promise: Promise<SessionState> }
>()

export async function checkSession(
  session: string | undefined,
  apiBaseURL: string
): Promise<SessionState> {
  if (!session) return "unauthenticated"
  const key = createHash("sha256")
    .update(apiBaseURL)
    .update("\0")
    .update(session)
    .digest("base64url")
  const now = Date.now()
  const cached = sessionCache.get(key)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = fetch(new URL("/api/v1/auth/me", apiBaseURL), {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
  })
    .then(async (response): Promise<SessionState> => {
      // Consume the body so the upstream connection can be reused.
      await response.arrayBuffer()
      if (response.status === 401) return "unauthenticated"
      return response.status === 200 ? "authenticated" : "unavailable"
    })
    .catch((): SessionState => "unavailable")
    .then((state) => {
      if (state !== "authenticated") sessionCache.delete(key)
      return state
    })

  if (sessionCache.size >= 500) {
    for (const [cacheKey, entry] of sessionCache) {
      if (entry.expiresAt <= now || sessionCache.size >= 500)
        sessionCache.delete(cacheKey)
      if (sessionCache.size < 500) break
    }
  }
  sessionCache.set(key, { expiresAt: now + 10_000, promise })
  return promise
}
