const CACHE = 'hawaii-portal-v4';
const URLS = ['/center/portal', '/center/portal-icon-192.png', '/center/portal-icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', e => {
  // Network first, cache fallback
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
