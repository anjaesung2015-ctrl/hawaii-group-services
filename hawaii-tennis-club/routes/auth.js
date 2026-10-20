const express = require('express');
const { checkPin, hashPin, normalizePhone, validPin, LEVELS } = require('../lib/db');

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
    const r = db.prepare('SELECT rules_agreed_at, rules_version FROM member WHERE id=?').get(req.me.id);
    const now = db.prepare("SELECT version FROM doc WHERE key='rules' AND lang='ko'").get()?.version || 1;
    res.json({
      me: publicMe(req.me),
      // 아직 동의하지 않았거나, 회칙이 개정된 뒤로 동의가 없으면 한 번 받는다
      rules_agreed: !!r?.rules_agreed_at && (r.rules_version || 0) >= now,
      rules_version: now,
    });
  });

  // 회칙 동의 (제6조7 서명 대신 — 기존 회원도 한 번 받는다)
  router.post('/agree-rules', auth.requireMember, (req, res) => {
    const v = db.prepare("SELECT version FROM doc WHERE key='rules' AND lang='ko'").get()?.version || 1;
    db.prepare("UPDATE member SET rules_agreed_at=datetime('now','localtime'), rules_version=? WHERE id=?").run(v, req.me.id);
    res.json({ ok: true, rules_version: v });
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

  // 본인 레벨·코치 표시 (☰ 메뉴 → My profile). 권한(role)은 여기서 못 바꾼다
  router.patch('/profile', auth.requireMember, (req, res) => {
    const b = req.body || {};
    const f = [], v = [];
    if ('level' in b) {
      if (!LEVELS.includes(b.level)) return res.status(400).json({ error: 'bad_level' });
      f.push('level=?'); v.push(b.level);
    }
    if ('is_coach' in b) {
      f.push('is_coach=?');
      v.push(b.is_coach === true || b.is_coach === 1 || b.is_coach === '1' || b.is_coach === 'true' ? 1 : 0);
    }
    if (!f.length) return res.status(400).json({ error: 'no_changes' });
    db.prepare(`UPDATE member SET ${f.join(', ')} WHERE id=?`).run(...v, req.me.id);
    res.json({ ok: true, me: publicMe(db.prepare('SELECT * FROM member WHERE id=?').get(req.me.id)) });
  });

  return router;
};

const publicMe = (m) => ({
  id: m.id, name: m.name, phone: m.phone, role: m.role,
  title: m.title, level: m.level, status: m.status, joined_at: m.joined_at,
  is_owner: !!m.is_owner, is_coach: !!m.is_coach,
});
