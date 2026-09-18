const CACHE_NAME = "vivat-bus-shell-v5"
const APP_SHELL = ["/offline.html", "/brand/vivat-bus.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("vivat-bus-") && key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return

  const requestURL = new URL(event.request.url)
  if (requestURL.origin !== self.location.origin) return

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline.html"))
    )
    return
  }

  if (requestURL.pathname.startsWith("/_next/static/") || requestURL.pathname.startsWith("/brand/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fresh = fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        if (cached) {
          event.waitUntil(fresh.catch(() => undefined))
          return cached
        }
        return fresh
      })
    )
  }
})

const notificationPaths = new Set(["/requests", "/bookings", "/finance", "/trips", "/driver", "/profile"])
function notificationPath(value) { return notificationPaths.has(value) ? value : "/profile" }

self.addEventListener("push", (event) => {
  let payload
  try { payload = event.data?.json() } catch { payload = null }
  if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string") return
  event.waitUntil(self.registration.showNotification(payload.title.slice(0, 120), {
    body: payload.body.slice(0, 300), icon: "/icon/192", badge: "/icon/64",
    tag: typeof payload.tag === "string" ? payload.tag.slice(0, 100) : "vivat-notification",
    data: { url: notificationPath(payload.url) },
  }))
})

self.addEventListener("pushsubscriptionchange", (event) => {
  // A client with an authenticated session can safely rebind/renew its subscription.
  // Never re-register a departed user's endpoint from an unauthenticated background worker.
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const client of windows) client.postMessage({ type: "vivat-push-subscription-changed" })
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const requested = event.notification.data?.url
  const path = notificationPath(requested)
  const url = new URL(path, self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(url)
        return client.focus()
      }
    }
    return self.clients.openWindow(url)
  }))
})
