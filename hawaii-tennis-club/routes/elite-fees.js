// 선수반 수강료 — 매월 20일까지. 한 줄 = 선수 한 명의 한 달치. 줄은 체크할 때 그 시점 금액으로 만든다(낸 기록은 불변, 미납 줄은 다시 체크할 때 새 금액).
const express = require('express');
const { getSettings, today, thisMonth, METHODS } = require('../lib/db');
const { eliteFeeOf } = require('../lib/elite');

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DUE_DAY = 20;

module.exports = function eliteFeeRoutes(db, auth) {
  const router = express.Router();
  router.use(auth.requireElite);

  router.get('/me', (req, res) => {
    if (req.me.program !== 'elite') return res.status(403).json({ error: 'elite_only' });
    const m = db.prepare('SELECT elite_fee FROM member WHERE id=?').get(req.me.id);
    const fee = eliteFeeOf(db, m);
    const rows = db.prepare('SELECT period, amount, paid_at, method FROM elite_due WHERE member_id=? ORDER BY period DESC').all(req.me.id);
    // 이번 달 줄은 코치가 체크해야 생긴다 — 아직 없으면 미납으로 보여 준다 (20일 알림과 같은 기준)
    const month = thisMonth();
    if (!rows.some(r => r.period === month)) rows.unshift({ period: month, amount: fee, paid_at: null, method: null });
    res.json({ fee, due_day: DUE_DAY, currency: getSettings(db).currency, rows });
  });

  router.get('/grid', auth.requireEliteStaff, (req, res) => {
    const month = PERIOD.test(req.query.month || '') ? req.query.month : thisMonth();
    const s = getSettings(db);
    // 활동 선수 + 그 달 기록이 있는 휴면 선수 (낸 돈이 집계에서 빠지지 않게)
    const players = db.prepare(`SELECT id, name, phone, photo, elite_fee, status FROM member
                                WHERE program='elite' AND (status='active' OR id IN (SELECT member_id FROM elite_due WHERE period=?))
                                ORDER BY name`).all(month);
    const dues = new Map(db.prepare('SELECT * FROM elite_due WHERE period=?').all(month).map(d => [d.member_id, d]));
    const rows = players.map(p => {
      const d = dues.get(p.id);
      return { member_id: p.id, name: p.name, phone: p.phone, photo: p.photo, status: p.status,
               amount: d ? d.amount : eliteFeeOf(db, p), paid: !!d?.paid_at, paid_at: d?.paid_at || null,
               method: d?.method || null, note: d?.note || null };
    });
    const paid = rows.filter(r => r.paid);
    res.json({
      month, currency: s.currency, default_fee: s.elite_fee, due_day: DUE_DAY, rows,
      summary: { players: rows.length, paid: paid.length, unpaid: rows.length - paid.length,
                 collected: paid.reduce((t, r) => t + r.amount, 0) },
    });
  });

  router.put('/mark', auth.requireEliteStaff, (req, res) => {
    const b = req.body || {};
    const p = db.prepare("SELECT id, elite_fee FROM member WHERE id=? AND program='elite'").get(Number(b.member_id));
    if (!p) return res.status(404).json({ error: 'player_not_found' });
    const period = PERIOD.test(b.period || '') ? b.period : thisMonth();
    const paid = !!b.paid;
    const method = METHODS.includes(b.method) ? b.method : (paid ? 'cash' : null);
    const paid_at = paid ? (/^\d{4}-\d{2}-\d{2}$/.test(b.paid_at || '') ? b.paid_at : today()) : null;
    const note = String(b.note || '').trim() || null;
    const hasNote = 'note' in b ? 1 : 0;   // 메모 칸을 보냈으면 비운 것도 반영
    db.prepare(`INSERT INTO elite_due (member_id, period, amount, paid_at, method, note, updated_at)
                VALUES (?,?,?,?,?,?, datetime('now','localtime'))
                ON CONFLICT(member_id, period) DO UPDATE SET paid_at=excluded.paid_at, method=excluded.method,
                  amount=CASE WHEN elite_due.paid_at IS NULL THEN excluded.amount ELSE elite_due.amount END,
                  note=CASE WHEN ? THEN excluded.note ELSE elite_due.note END, updated_at=excluded.updated_at`)
      .run(p.id, period, eliteFeeOf(db, p), paid_at, method, note, hasNote);
    res.json({ ok: true, ...db.prepare('SELECT * FROM elite_due WHERE member_id=? AND period=?').get(p.id, period) });
  });

  return router;
};

module.exports.DUE_DAY = DUE_DAY;
