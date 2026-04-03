/* BKQuant service worker — offline shell + CDN script caching after first online load.
   Requires HTTPS or http://localhost (not file://). */
const CACHE_NAME = "bkq-assets-v1";
const CDN_HOST_SUFFIXES = ["cdn.tailwindcss.com", "cdn.jsdelivr.net", "cdn.plot.ly"];

function assetUrl(name) {
  return new URL(name, self.location.href).href;
}

function isSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isCdnUrl(url) {
  try {
    const h = new URL(url).hostname;
    return CDN_HOST_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  const precache = [
    assetUrl("index.html"),
    assetUrl("styles.css"),
    assetUrl("app.js"),
    assetUrl("manifest.webmanifest"),
    assetUrl("icon.svg"),
    assetUrl("sw.js"),
  ];
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(precache.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = request.url;

  if (isCdnUrl(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request)
            .then((res) => {
              if (res.ok) cache.put(request, res.clone());
              return res;
            })
            .catch(() => cached);
        })
      )
    );
    return;
  }

  if (!isSameOrigin(url)) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((hit) => {
          if (hit) return hit;
          if (request.mode === "navigate" || request.destination === "document") {
            return caches.match(assetUrl("index.html"));
          }
          return hit;
        })
      )
  );
});
