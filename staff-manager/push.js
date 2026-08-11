// 폰 알림(웹 푸시) — 봇도 문자도 없이 서버가 직접 폰으로 알림을 보낸다.
// 아이폰은 홈 화면에 추가된 상태에서만 동작한다 (iOS 16.4+ 제약). 안드로이드는 브라우저에서 바로 된다.
const express = require('express');
const jwt = require('jsonwebtoken');

module.exports = function createPush(db, opts = {}) {
  const secret = opts.secret || 'staff-mgr-2026-secret';
  const publicKey = opts.publicKey || process.env.VAPID_PUBLIC_KEY || '';
  const privateKey = opts.privateKey || process.env.VAPID_PRIVATE_KEY || '';
  const subject = opts.subject || process.env.VAPID_SUBJECT || 'mailto:admin@hawaiigroup.co';

  let send = opts.send;
  if (!send && publicKey && privateKey) {
    const webpush = require('web-push');
    webpush.setVapidDetails(subject, publicKey, privateKey);
    send = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 3600 });
  }

  db.exec(`CREATE TABLE IF NOT EXISTS report_push (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  const rows = db.prepare("SELECT id, endpoint, p256dh, auth FROM report_push WHERE staff_id=?");
  const drop = db.prepare("DELETE FROM report_push WHERE id=?");

  // 그 사람의 모든 기기로 보낸다. 죽은 구독(404/410)은 지운다. 보낸 개수를 돌려준다.
  async function sendTo(staffId, { title, body, url }) {
    if (!send) return 0;
    const list = rows.all(Number(staffId));
    if (!list.length) return 0;
    const payload = JSON.stringify({ title, body, url: url || '/staff-manager/' });
    let ok = 0;
    await Promise.all(list.map(async (r) => {
      const sub = { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } };
      try { await send(sub, payload); ok++; }
      catch (e) {
        const code = e.statusCode || e.status;
        if (code === 404 || code === 410) drop.run(r.id);       // 앱을 지웠거나 구독 만료
        else console.error('[push] 발송 실패:', code || e.message);
      }
    }));
    return ok;
  }

  const router = express.Router();
  router.use((req, res, next) => {
    const t = req.cookies?.report_sess;
    if (!t) return res.status(401).json({ error: 'login_required' });
    try { req.rsess = jwt.verify(t, secret); next(); }
    catch (e) { return res.status(401).json({ error: 'session_expired' }); }
  });

  const whose = (req) => Number(req.rsess.staff_id) || null;

  router.get('/', (req, res) => {
    const id = whose(req);
    const n = id ? db.prepare("SELECT COUNT(*) n FROM report_push WHERE staff_id=?").get(id).n : 0;
    res.json({ publicKey, subscribed: n > 0, devices: n, ready: !!publicKey });
  });

  router.post('/', (req, res) => {
    const id = whose(req);
    if (!id) return res.status(400).json({ error: 'staff_id_required' });
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'bad_subscription' });
    db.prepare(`INSERT INTO report_push (staff_id, endpoint, p256dh, auth) VALUES (?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET staff_id=excluded.staff_id, p256dh=excluded.p256dh, auth=excluded.auth`)
      .run(id, String(endpoint), String(keys.p256dh), String(keys.auth));
    res.json({ ok: true });
  });

  router.delete('/', (req, res) => {
    const id = whose(req);
    const ep = req.body?.endpoint;
    if (ep) db.prepare("DELETE FROM report_push WHERE endpoint=?").run(String(ep));
    else if (id) db.prepare("DELETE FROM report_push WHERE staff_id=?").run(id);
    res.json({ ok: true });
  });

  router.post('/test', async (req, res) => {
    const id = whose(req);
    const n = await sendTo(id, { title: '업무보고', body: '알림 테스트입니다. 이 알림이 보이면 설정 완료!' });
    if (!n) return res.status(400).json({ error: 'no_subscription' });
    res.json({ ok: true, sent: n });
  });

  return { router, sendTo, publicKey };
};
