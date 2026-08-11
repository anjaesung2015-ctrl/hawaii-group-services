// 업무보고 알림 전용 서비스워커.
// fetch 를 가로채지 않는다 — 예전처럼 옛 화면이 캐시에 갇히는 일이 없도록.
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = { title: '업무보고', body: '', url: '/staff-manager/' };
  try { if (event.data) d = Object.assign(d, event.data.json()); } catch (e) { }
  event.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    icon: '/staff-manager/icon-192.png',
    badge: '/staff-manager/icon-192.png',
    data: { url: d.url },
    vibrate: [200, 100, 200],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/staff-manager/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.includes('/staff-manager') && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
