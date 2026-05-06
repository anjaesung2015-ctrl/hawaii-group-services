// SW v10 — HTML never cached, force update
const CACHE = "sm-reports-v10";

self.addEventListener("install", (e) => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  // API와 HTML은 항상 네트워크 (캐시 절대 안함)
  if (e.request.url.includes("/api/")) return;
  if (e.request.method !== "GET") return;
  const accept = e.request.headers.get("accept") || "";
  if (e.request.mode === "navigate" || accept.includes("text/html")) return;
  // 이미지/폰트/icon만 캐시
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const fp = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fp;
    })
  );
});
