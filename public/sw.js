const CACHE_NAME = "vivat-bus-shell-v1"
const APP_SHELL = ["/offline", "/brand/vivat-bus.png"]

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
      fetch(event.request).catch(() => caches.match("/offline"))
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
        return cached || fresh
      })
    )
  }
})
