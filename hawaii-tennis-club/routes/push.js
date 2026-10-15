// 폰 알림 구독 — 폰이 브라우저에서 받은 구독 정보를 서버에 맡긴다.
const express = require('express');

module.exports = function pushRoutes(db, auth, notify) {
  const router = express.Router();
  router.use(auth.requireMember);

  router.get('/', (req, res) => {
    res.json({
      ready: true,
      publicKey: notify.publicKey(),
      subscribed: notify.subscribed(req.me.id),
      devices: db.prepare('SELECT COUNT(*) c FROM push_sub WHERE member_id=?').get(req.me.id).c,
    });
  });

  router.post('/', (req, res) => {
    const b = req.body || {};
    const endpoint = String(b.endpoint || '');
    const p256dh = String(b.keys?.p256dh || '');
    const auth2 = String(b.keys?.auth || '');
    if (!/^https?:\/\//.test(endpoint) || !p256dh || !auth2) return res.status(400).json({ error: 'bad_subscription' });

    // 같은 기기가 다시 구독하면 주인만 바꿔 덮어쓴다 (폰을 물려줬을 때)
    db.prepare(`INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)
                ON CONFLICT(endpoint) DO UPDATE SET member_id=excluded.member_id,
                  p256dh=excluded.p256dh, auth=excluded.auth`)
      .run(req.me.id, endpoint, p256dh, auth2);
    res.json({ ok: true });
  });

  router.delete('/', (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    if (endpoint) db.prepare('DELETE FROM push_sub WHERE endpoint=? AND member_id=?').run(endpoint, req.me.id);
    else db.prepare('DELETE FROM push_sub WHERE member_id=?').run(req.me.id);   // 이 사람 기기 전부
    res.json({ ok: true });
  });

  router.post('/test', async (req, res) => {
    const r = await notify.toMembers([req.me.id], {
      title: 'Hawaii Tennis Club',
      body: req.body?.body || '알림이 잘 옵니다 🎾',
      url: '',
    });
    if (!r.sent) return res.status(409).json({ error: 'no_device', ...r });
    res.json({ ok: true, ...r });
  });

  return router;
};
