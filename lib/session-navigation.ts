/** Keep login return URLs on this site, including query parameters and anchors. */
export function safeReturnPath(value: string | null | undefined): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  ) {
    return "/"
  }
  const url = new URL(value, "https://vivat.invalid")
  if (url.origin !== "https://vivat.invalid" || /^\/login\/?$/.test(url.pathname))
    return "/"
  return `${url.pathname}${url.search}${url.hash}`
}

export function loginPath(returnPath: string): string {
  return `/login?${new URLSearchParams({ next: safeReturnPath(returnPath) })}`
}

let redirecting = false

/** Preserve the response (including GPS retry semantics) while handling session loss. */
export async function sessionFetch(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const response = await fetch(input, init)
  if (response.status !== 401 || typeof window === "undefined" || redirecting)
    return response

  const url = new URL(
    input instanceof Request ? input.url : input.toString(),
    window.location.href
  )
  if (
    url.origin === window.location.origin &&
    url.pathname.startsWith("/api/") &&
    ![
      "/api/auth/login",
      "/api/auth/select-company",
      "/api/auth/logout",
    ].includes(url.pathname) &&
    window.location.pathname !== "/login"
  ) {
    redirecting = true
    window.location.replace(
      loginPath(
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      )
    )
  }
  return response
}
