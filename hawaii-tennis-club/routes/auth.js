const express = require('express');
const { checkPin, hashPin, normalizePhone, validPin } = require('../lib/db');

module.exports = function authRoutes(db, auth) {
  const router = express.Router();

  // 로그인 — 전화번호 + 4자리 PIN
  router.post('/login', (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const pin = String(req.body?.pin ?? '');
    if (!phone || !pin) return res.status(400).json({ error: 'phone_pin_required' });

    const wait = auth.lockedFor(phone);
    if (wait) return res.status(429).json({ error: 'too_many_tries', retry_after: wait });

    const m = db.prepare('SELECT * FROM member WHERE phone=?').get(phone);
    // 번호가 없는 건지 PIN이 틀린 건지 알려주지 않는다 (번호 떠보기 방지)
    if (!m || !checkPin(pin, m.pin_hash)) {
      auth.noteFail(phone);
      return res.status(401).json({ error: 'bad_login' });
    }
    if (m.status === 'dormant') return res.status(403).json({ error: 'dormant' });

    auth.clearFails(phone);
    auth.setCookie(res, auth.sign(m));
    res.json({ ok: true, me: publicMe(m) });
  });

  router.post('/logout', (req, res) => {
    auth.clearCookie(res);
    res.json({ ok: true });
  });

  // 앱을 다시 열었을 때 로그인 화면을 건너뛰기 위한 확인
  router.get('/me', (req, res) => {
    if (!req.me) return res.status(401).json({ error: 'login_required' });
    res.json({ me: publicMe(req.me) });
  });

  // 본인 PIN 변경 (지금 PIN을 확인한 뒤)
  router.post('/pin', auth.requireMember, (req, res) => {
    const { current, new_pin } = req.body || {};
    if (!validPin(new_pin)) return res.status(400).json({ error: 'pin_4_digits' });
    const m = db.prepare('SELECT pin_hash FROM member WHERE id=?').get(req.me.id);
    if (!checkPin(current, m.pin_hash)) return res.status(401).json({ error: 'bad_current_pin' });
    db.prepare('UPDATE member SET pin_hash=? WHERE id=?').run(hashPin(new_pin), req.me.id);
    res.json({ ok: true });
  });

  return router;
};

const publicMe = (m) => ({
  id: m.id, name: m.name, phone: m.phone, role: m.role,
  title: m.title, level: m.level, status: m.status, joined_at: m.joined_at,
});
