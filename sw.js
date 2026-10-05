// FuelAI offline support. Lives next to fuelai.html in the repo.
//
// - The app page: fetched from the network when there is one (so updates arrive at once),
//   served from the saved copy when offline or when the network takes over 3 seconds.
// - The React/Babel libraries from cdnjs: saved once and reused (their URLs never change).
// - Everything else (the AI proxy, Google Sheets sync) is left alone.

const CACHE = "fuelai-v1";
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Best effort: a failure here just means the libraries are saved on a later launch
    await Promise.all(LIBS.map((u) => cache.add(new Request(u, { mode: "cors" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Save the page that is already open, so the very next launch works offline
    const cache = await caches.open(CACHE);
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(open.map((c) => cache.add(c.url).catch(() => {})));
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "cdnjs.cloudflare.com") { e.respondWith(cacheFirst(req)); return; }
  const isPage = req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
  if (url.origin === self.location.origin && isPage) e.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req.url, res.clone()).catch(() => {});
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (!saved) return fresh;
  const slow = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
  const res = await Promise.race([fresh.catch(() => null), slow]);
  return res && res.ok ? res : saved;
}
