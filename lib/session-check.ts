export async function checkSession(
  session: string | undefined,
  apiBaseURL: string
) {
  if (!session) return "unauthenticated"
  try {
    const response = await fetch(new URL("/api/v1/auth/me", apiBaseURL), {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    })
    // Consume the body so the upstream connection can be reused.
    await response.arrayBuffer()
    if (response.status === 401) return "unauthenticated"
    return response.status === 200 ? "authenticated" : "unavailable"
  } catch {
    return "unavailable"
  }
}
