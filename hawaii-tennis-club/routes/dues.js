// 회비 — 한 줄이 "누가 어느 달치를 냈는가". paid_at 이 비어 있으면 미납.
// 월회비 줄은 미리 만들어 두지 않고, 관리자가 체크할 때 그 자리에서 만든다
// (회원이 늘어도 빈 줄이 쌓이지 않고, 금액은 체크하는 시점의 설정값을 쓴다).
const express = require('express');
const { getSettings, today, thisMonth, METHODS, DUE_KINDS, MONTHLY_EXEMPT_SQL } = require('../lib/db');

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

module.exports = function dueRoutes(db, auth) {
  const router = express.Router();
  router.use(auth.requireMember);

  // 내 납부 내역 (회원은 본인 것만 본다). 면제 달(오너·가입한 달)의 안 낸 월회비 줄은 미납으로 보이지 않게 뺀다
  router.get('/me', (req, res) => {
    res.json(db.prepare(`SELECT d.id, d.kind, d.period, d.amount, d.paid_at, d.method, d.note
                         FROM due d JOIN member m ON m.id = d.member_id
                         WHERE d.member_id=?
                           AND NOT (d.kind='monthly' AND d.paid_at IS NULL
                                    AND (m.is_owner = 1 OR EXISTS (SELECT 1 FROM due j WHERE j.member_id = m.id AND j.kind='joining' AND j.period = d.period)))
                         ORDER BY d.period DESC, d.kind`).all(req.me.id));
  });

  // 월별 전체 납부 현황표 (관리자)
  router.get('/grid', auth.requireAdmin, (req, res) => {
    const month = PERIOD.test(req.query.month || '') ? req.query.month : thisMonth();
    const { monthly_fee, joining_fee, currency } = getSettings(db);

    // 월회비는 활동 회원에게만 매긴다. 휴면 회원의 지난 납부 기록은 본인 내역에 그대로 남는다.
    const members = db.prepare(`SELECT id, name, phone, level, joined_at, is_owner FROM member
                                WHERE status='active' ORDER BY name`).all();
    const dues = db.prepare('SELECT * FROM due WHERE period=?').all(month);
    const byKey = new Map(dues.map(d => [`${d.member_id}:${d.kind}`, d]));
    // 입회비는 낸 달이 따로라 전 기간에서 미납분을 찾아 함께 보여준다
    const joiningOwed = new Map(db.prepare("SELECT * FROM due WHERE kind='joining' AND paid_at IS NULL").all()
      .map(d => [d.member_id, d]));

    const rows = members.map(m => {
      const d = byKey.get(`${m.id}:monthly`);
      const j = byKey.get(`${m.id}:joining`) || joiningOwed.get(m.id);
      // 월회비 면제 — 클럽 오너, 또는 가입한 달(입회비에 포함, 회칙 제10조). 낸 기록이 있으면 낸 걸로 보여준다
      const reason = d?.paid_at ? null : (m.is_owner ? 'owner' : (byKey.get(`${m.id}:joining`) ? 'joining' : null));
      return {
        member_id: m.id, name: m.name, phone: m.phone, level: m.level, joined_at: m.joined_at,
        monthly: reason
          ? { amount: 0, paid: true, exempt: true, reason, paid_at: null, method: null, note: null }
          : {
            amount: d ? d.amount : monthly_fee,
            paid: !!d?.paid_at, paid_at: d?.paid_at || null, method: d?.method || null, note: d?.note || null,
          },
        joining: j ? { amount: j.amount, period: j.period, paid: !!j.paid_at, paid_at: j.paid_at || null, method: j.method || null } : null,
      };
    });

    const charged = rows.filter(r => !r.monthly.exempt);   // 면제(오너·가입한 달)는 월회비 집계에서 뺀다
    const paid = charged.filter(r => r.monthly.paid);
    res.json({
      month, currency, monthly_fee, joining_fee,
      rows,
      summary: {
        members: charged.length,
        paid: paid.length,
        unpaid: charged.length - paid.length,
        collected: paid.reduce((s, r) => s + r.monthly.amount, 0),
        expected: rows.reduce((s, r) => s + r.monthly.amount, 0),
      },
    });
  });

  // 이번 달 미납자만 (관리자) — 홈 화면에서 한눈에 보려고
  router.get('/unpaid', auth.requireAdmin, (req, res) => {
    const month = PERIOD.test(req.query.month || '') ? req.query.month : thisMonth();
    const { monthly_fee } = getSettings(db);
    const rows = db.prepare(`
      SELECT m.id AS member_id, m.name, m.phone, m.level
      FROM member m
      LEFT JOIN due d ON d.member_id = m.id AND d.kind='monthly' AND d.period = ?
      WHERE m.status='active' AND (d.id IS NULL OR d.paid_at IS NULL)
        AND NOT ${MONTHLY_EXEMPT_SQL}
      ORDER BY m.name`).all(month, month);   // 오너와 가입한 달(입회비에 포함)은 빠진다
    res.json({ month, monthly_fee, count: rows.length, rows });
  });

  // 완납/미납 체크 (관리자) — 같은 요청을 두 번 보내도 결과가 같다
  router.put('/mark', auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const member_id = Number(b.member_id);
    const kind = DUE_KINDS.includes(b.kind) ? b.kind : 'monthly';
    const period = PERIOD.test(b.period || '') ? b.period : thisMonth();
    const paid = !!b.paid;
    const method = METHODS.includes(b.method) ? b.method : (paid ? 'cash' : null);
    const note = String(b.note || '').trim() || null;
    const paid_at = paid ? (/^\d{4}-\d{2}-\d{2}$/.test(b.paid_at || '') ? b.paid_at : today()) : null;

    const m = db.prepare('SELECT id FROM member WHERE id=?').get(member_id);
    if (!m) return res.status(404).json({ error: 'member_not_found' });

    const s = getSettings(db);
    const fallback = kind === 'joining' ? s.joining_fee : s.monthly_fee;
    const amount = Number.isFinite(Number(b.amount)) && Number(b.amount) > 0 ? Math.round(Number(b.amount)) : fallback;

    db.prepare(`
      INSERT INTO due (member_id, kind, period, amount, paid_at, method, note, updated_at)
      VALUES (?,?,?,?,?,?,?, datetime('now','localtime'))
      ON CONFLICT(member_id, kind, period) DO UPDATE SET
        paid_at = excluded.paid_at,
        method  = excluded.method,
        note    = COALESCE(excluded.note, due.note),
        updated_at = excluded.updated_at`)
      .run(member_id, kind, period, amount, paid_at, method, note);

    res.json({ ok: true, ...db.prepare('SELECT * FROM due WHERE member_id=? AND kind=? AND period=?').get(member_id, kind, period) });
  });

  return router;
};
