import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { checkSession } from "@/lib/session-check"
import { loginPath } from "@/lib/session-navigation"

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/login") {
    return NextResponse.next()
  }
  const session = await checkSession(
    request.cookies.get("vivat_session")?.value,
    process.env.API_INTERNAL_URL ?? "http://localhost:8080"
  )
  if (session === "unauthenticated") {
    const response = NextResponse.redirect(
      new URL(
        loginPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
        request.url
      )
    )
    response.cookies.set("vivat_session", "", {
      httpOnly: true,
      path: "/",
      maxAge: 0,
    })
    response.headers.set("Cache-Control", "no-store")
    return response
  }
  if (session === "unavailable") {
    return new NextResponse(
      "Не удалось проверить сессию. Обновите страницу через несколько секунд.",
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": "5",
        },
      }
    )
  }
  const response = NextResponse.next()
  response.headers.set("Cache-Control", "private, no-store")
  return response
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline|brand/).*)",
  ],
}
