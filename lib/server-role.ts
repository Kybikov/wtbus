import { apiFetch } from "@/lib/api-fetch"

export async function getSessionRole(): Promise<string | null> {
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/auth/me`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      }
    )
    const identity: unknown = await response.json().catch(() => null)
    return response.ok &&
      typeof identity === "object" &&
      identity !== null &&
      "role" in identity &&
      typeof identity.role === "string"
      ? identity.role
      : null
  } catch {
    return null
  }
}
