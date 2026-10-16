// 홈 화면에 추가했을 때 껍데기(HTML·CSS·JS)를 캐시해 두어 바로 뜨게 한다.
// 데이터(api/…)와 사진(uploads/…)은 캐시하지 않는다 — 항상 최신이어야 하니까.
// 경로는 모두 이 파일이 있는 폴더 기준(상대 경로)이라 /club/ 아래에 올려도 그대로 동작한다.
const CACHE = 'htc-shell-v10';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.json', 'icon.svg',
  'js/app.js', 'js/ui.js', 'js/refresh.js', 'js/i18n.js', 'js/weekdays.js',
  'js/views/home.js', 'js/views/schedule.js', 'js/views/dues.js',
  'js/views/notices.js', 'js/views/members.js', 'js/views/board.js', 'js/views/push.js', 'js/views/install.js', 'js/views/rules.js', 'js/views/org.js',
];
const HOME = new URL('./', self.registration.scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ---- 폰 알림 ----
// 서버가 보낸 알림을 받아 띄운다. 같은 종류(tag)는 덮어써서 알림이 쌓이지 않게 한다.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Hawaii Tennis Club';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.url || 'htc',
    renotify: true,
    data: { url: d.url || '' },
  }));
});

// 알림을 누르면 앱을 띄우고, 이미 열려 있으면 그 창을 쓴다
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        if ('navigate' in c && target !== c.url) await c.navigate(target).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/uploads/')) return;

  // 껍데기는 네트워크를 먼저 보고, 안 되면 캐시로 (업데이트가 바로 반영되게)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match(HOME)))
  );
});
