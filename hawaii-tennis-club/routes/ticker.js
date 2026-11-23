// 홈 전광판 — 홈 맨 위에서 옆으로 흘러가는 한 줄.
//  · 오늘 생일인 동호인 회원 (회원이 ☰ → My profile 에서 직접 적은 월·일)
//  · 운영진이 쓰는 문구 (setting ticker_text, 줄마다 하나)
//  · 30일 안의 행사·대회 D-day
const express = require('express');
const { today } = require('../lib/db');

const MAX_TEXT = 500;
const DAYS_AHEAD = 30;

module.exports = function tickerRoutes(db, auth) {
  const router = express.Router();
  router.use(auth.requireClub);

  router.get('/', (req, res) => {
    const d = today();
    const birthdays = db.prepare(`SELECT id, name FROM member
      WHERE program='club' AND status='active' AND birthday=? ORDER BY name`).all(d.slice(5));
    const text = db.prepare("SELECT v FROM setting WHERE k='ticker_text'").get()?.v || '';
    const events = db.prepare(`SELECT id, title, kind, event_date,
        CAST(julianday(event_date) - julianday(?) AS INTEGER) AS days
      FROM event WHERE kind IN ('event','tournament') AND event_date >= ? AND event_date <= date(?, '+${DAYS_AHEAD} days')
      ORDER BY event_date, start_time LIMIT 5`).all(d, d, d);
    res.json({ today: d, birthdays, messages: text.split('\n').map(s => s.trim()).filter(Boolean), text, events });
  });

  // 캘린더용 — 그 달 생일인 동호인 회원 (?month=MM 또는 YYYY-MM)
  router.get('/birthdays', (req, res) => {
    const m = String(req.query.month || '').match(/(?:^\d{4}-)?(0[1-9]|1[0-2])$/);
    if (!m) return res.status(400).json({ error: 'bad_month' });
    res.json(db.prepare(`SELECT id, name, birthday FROM member
      WHERE program='club' AND status='active' AND substr(birthday,1,2)=? ORDER BY birthday, name`).all(m[1]));
  });

  // 운영진 문구 — 빈 칸이면 문구 없이 생일·일정만
  router.put('/text', auth.requireAdmin, (req, res) => {
    const text = String(req.body?.text ?? '').replace(/\r/g, '').trim();
    if (text.length > MAX_TEXT) return res.status(400).json({ error: 'too_long' });
    db.prepare("INSERT INTO setting (k, v) VALUES ('ticker_text', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(text);
    res.json({ ok: true, text });
  });

  return router;
};
