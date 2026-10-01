const CACHE_NAME = "aion-shell-v1";
const APP_SHELL = ["/", "/radar", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Explicit per-request-type strategies — the previous version cached every
// single GET response indiscriminately (including API responses containing
// per-user data), which is both wasteful and risks serving stale dynamic
// data while claiming to be offline-safe. See README's PWA/offline notes for
// what this does and doesn't guarantee.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // API responses: never cached. This is live, per-user, frequently-changing
  // data (bookmarks, radar state, search) — serving a stale cached copy
  // while offline would be indistinguishable from lying about freshness.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Static, content-hashed build assets and icons: cache-first. These never
  // change under a given URL, so there's no freshness to lose by preferring
  // the cache.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json") {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
            return response;
          })
      )
    );
    return;
  }

  // Everything else (page navigations): network-first, falling back to a
  // cached copy (or the app shell) when offline. Never pretend stale data is
  // fresh — pages show their own "offline" state based on fetch failures;
  // this only keeps the shell itself reachable.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "AION", body: "New update available.", url: "/radar" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/radar";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
