// 옛 shop-manager의 service worker를 정리하고 자체 등록 해제
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  await self.registration.unregister();
  const list = await self.clients.matchAll({ type: 'window' });
  list.forEach(c => c.navigate(c.url));
})()));
