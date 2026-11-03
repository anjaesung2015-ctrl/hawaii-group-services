// 회비 — 한 줄이 "누가 어느 달치를 냈는가". paid_at 이 비어 있으면 미납.
// 월회비 줄은 미리 만들어 두지 않고, 관리자가 체크할 때 그 자리에서 만든다
// (회원이 늘어도 빈 줄이 쌓이지 않고, 금액은 체크하는 시점의 설정값을 쓴다).
const express = require('express');
const { getSettings, today, thisMonth, METHODS, DUE_KINDS, MONTHLY_EXEMPT_SQL, FEE_FREE_SQL, LEGACY_JOIN_UNTIL, monthlyFeeFor } = require('../lib/db');

const { sendDuesReminders } = require('../lib/dues-remind');

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

module.exports = function dueRoutes(db, auth, notify) {
  const router = express.Router();
  router.use(auth.requireClub);

  // 내 납부 내역 (회원은 본인 것만 본다). 면제 달(코치·총무, 옛 규칙으로 가입한 달)의 안 낸 월회비 줄은 미납으로 보이지 않게 뺀다
  router.get('/me', (req, res) => {
    res.json(db.prepare(`SELECT d.id, d.kind, d.period, d.amount, d.paid_at, d.method, d.note
                         FROM due d JOIN member m ON m.id = d.member_id
                         WHERE d.member_id=?
                           AND NOT (d.kind='joining' AND d.paid_at IS NULL AND ${FEE_FREE_SQL})
                           AND NOT (d.kind='monthly' AND d.paid_at IS NULL
                                    AND (${FEE_FREE_SQL} OR EXISTS (SELECT 1 FROM due j WHERE j.member_id = m.id AND j.kind='joining' AND j.period = d.period AND j.period <= '${LEGACY_JOIN_UNTIL}')))
                         ORDER BY d.period DESC, d.kind`).all(req.me.id));
  });

  // 월별 전체 납부 현황표 (관리자·회비 담당)
  router.get('/grid', auth.requireDues, (req, res) => {
    const month = PERIOD.test(req.query.month || '') ? req.query.month : thisMonth();
    const { monthly_fee, joining_fee, currency } = getSettings(db);

    // 월회비는 활동 회원에게만 매긴다. 휴면 회원의 지난 납부 기록은 본인 내역에 그대로 남는다.
    const members = db.prepare(`SELECT m.id, m.name, m.phone, m.level, m.joined_at, m.is_coach,
                                       EXISTS (SELECT 1 FROM officer o WHERE o.role = 'manager1' AND o.member_id = m.id) AS secretary
                                FROM member m WHERE m.status='active' AND m.program='club' ORDER BY m.name`).all();
    const dues = db.prepare('SELECT * FROM due WHERE period=?').all(month);
    const byKey = new Map(dues.map(d => [`${d.member_id}:${d.kind}`, d]));
    // 입회비는 낸 달이 따로라 전 기간에서 미납분을 찾아 함께 보여준다
    const joiningOwed = new Map(db.prepare("SELECT * FROM due WHERE kind='joining' AND paid_at IS NULL").all()
      .map(d => [d.member_id, d]));

    const rows = members.map(m => {
      const d = byKey.get(`${m.id}:monthly`);
      // 코치·총무는 입회비도 안 낸다 — 미납 입회비 표시를 띄우지 않는다
      const j = (m.is_coach || m.secretary) ? null : (byKey.get(`${m.id}:joining`) || joiningOwed.get(m.id));
      // 월회비 면제 — 코치·총무(lib/db FEE_FREE_SQL), 또는 옛 규칙(2026-10까지)으로 가입한 달. 낸 기록이 있으면 낸 걸로 보여준다
      const reason = d?.paid_at ? null
        : m.is_coach ? 'coach' : m.secretary ? 'secretary'
          : (month <= LEGACY_JOIN_UNTIL && byKey.get(`${m.id}:joining`) ? 'joining' : null);
      return {
        member_id: m.id, name: m.name, phone: m.phone, level: m.level, joined_at: m.joined_at,
        monthly: reason
          ? { amount: 0, paid: true, exempt: true, reason, paid_at: null, method: null, note: null }
          : {
            amount: d ? d.amount : monthlyFeeFor(m.joined_at, month, monthly_fee),   // 16일 이후 가입한 달은 반액
            paid: !!d?.paid_at, paid_at: d?.paid_at || null, method: d?.method || null, note: d?.note || null,
          },
        joining: j ? { amount: j.amount, period: j.period, paid: !!j.paid_at, paid_at: j.paid_at || null, method: j.method || null } : null,
      };
    });

    const charged = rows.filter(r => !r.monthly.exempt);   // 면제(가입한 달)는 월회비 집계에서 뺀다
    const paid = charged.filter(r => r.monthly.paid);
    res.json({
      month, currency, monthly_fee, joining_fee,
      rows,
      summary: {
        members: charged.length,
        total: rows.length,                 // 회원 탭 활동 회원 수 = members + exempt
        exempt: rows.length - charged.length,
        paid: paid.length,
        unpaid: charged.length - paid.length,
        collected: paid.reduce((s, r) => s + r.monthly.amount, 0),
        expected: rows.reduce((s, r) => s + r.monthly.amount, 0),
      },
      settlement: settlement(month),
    });
  });

  // 정산 — 받은 날 기준(통장과 맞춘다). 회비 합계 = 월회비(몇 월치든) + 입회비, 찬조금·지출은 따로, 잔액 = 회비 + 찬조금 − 지출
  function settlement(month) {
    const like = `${month}%`;
    // 코치(선생님)·총무는 월회비·입회비 모두 정산 금액에서 뺀다 (2026-11-04 사장님 지시)
    const sum = (kind) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(d.amount),0) AS s FROM due d JOIN member m ON m.id = d.member_id
                                      WHERE d.kind=? AND d.paid_at LIKE ? AND NOT ${FEE_FREE_SQL}`).get(kind, like);
    const mo = sum('monthly');
    const jo = sum('joining');
    const dn = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM donation WHERE given_at LIKE ?').get(like);
    const ex = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM expense WHERE spent_at LIKE ?').get(like);
    const total = mo.s + jo.s;          // 회비 합계 — 찬조금은 넣지 않는다 (2026-11-04 사장님 지시)
    return {
      monthly: mo.s, monthly_n: mo.n,
      joining: jo.s, joining_n: jo.n,
      donation: dn.s, donation_n: dn.n,
      total,
      expense: ex.s, expense_n: ex.n,
      balance: total + dn.s - ex.s,     // 잔액 = 회비 + 찬조금 − 지출
    };
  }

  // 지출 — 관리자·회비 담당이 입력. 무엇에(title) 얼마를 언제 썼나
  function expenseInput(b) {
    const title = String(b.title || '').trim().slice(0, 120);
    if (!title) return { error: 'title_required' };
    const amount = Math.round(Number(b.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'bad_amount' };
    const spent_at = DATE.test(b.spent_at || '') ? b.spent_at : today();
    const method = METHODS.includes(b.method) ? b.method : 'cash';
    const note = String(b.note || '').trim().slice(0, 300) || null;
    return { title, amount, spent_at, method, note };
  }

  router.get('/expenses', auth.requireDues, (req, res) => {
    const month = PERIOD.test(req.query.month || '') ? req.query.month : thisMonth();
    res.json(db.prepare('SELECT * FROM expense WHERE spent_at LIKE ? ORDER BY spent_at DESC, id DESC').all(`${month}%`));
  });

  router.post('/expenses', auth.requireDues, (req, res) => {
    const v = expenseInput(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const r = db.prepare('INSERT INTO expense (title, amount, spent_at, method, note, created_by) VALUES (?,?,?,?,?,?)')
      .run(v.title, v.amount, v.spent_at, v.method, v.note, req.me.id);
    res.json(db.prepare('SELECT * FROM expense WHERE id=?').get(r.lastInsertRowid));
  });

  router.put('/expenses/:id', auth.requireDues, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM expense WHERE id=?').get(id)) return res.status(404).json({ error: 'not_found' });
    const v = expenseInput(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    db.prepare(`UPDATE expense SET title=?, amount=?, spent_at=?, method=?, note=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(v.title, v.amount, v.spent_at, v.method, v.note, id);
    res.json(db.prepare('SELECT * FROM expense WHERE id=?').get(id));
  });

  router.delete('/expenses/:id', auth.requireDues, (req, res) => {
    const r = db.prepare('DELETE FROM expense WHERE id=?').run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  // 찬조금 — 관리자·회비 담당이 입력. 회원을 고르거나(member_id) 외부인 이름을 직접 쓴다
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  function donationInput(b) {
    const member_id = b.member_id ? Number(b.member_id) : null;
    let donor_name = String(b.donor_name || '').trim().slice(0, 80);
    if (member_id) {
      const m = db.prepare('SELECT name FROM member WHERE id=?').get(member_id);
      if (!m) return { error: 'member_not_found' };
      if (!donor_name) donor_name = m.name;
    }
    if (!donor_name) return { error: 'name_required' };
    const amount = Math.round(Number(b.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'bad_amount' };
    const given_at = DATE.test(b.given_at || '') ? b.given_at : today();
    const method = METHODS.includes(b.method) ? b.method : 'cash';
    const note = String(b.note || '').trim().slice(0, 300) || null;
    return { member_id, donor_name, amount, given_at, method, note };
  }

  router.get('/donations', auth.requireDues, (req, res) => {
    const month = PERIOD.test(req.query.month || '') ? req.query.month : thisMonth();
    res.json(db.prepare('SELECT * FROM donation WHERE given_at LIKE ? ORDER BY given_at DESC, id DESC').all(`${month}%`));
  });

  router.post('/donations', auth.requireDues, (req, res) => {
    const v = donationInput(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const r = db.prepare(`INSERT INTO donation (member_id, donor_name, amount, given_at, method, note, created_by)
                          VALUES (?,?,?,?,?,?,?)`).run(v.member_id, v.donor_name, v.amount, v.given_at, v.method, v.note, req.me.id);
    res.json(db.prepare('SELECT * FROM donation WHERE id=?').get(r.lastInsertRowid));
  });

  router.put('/donations/:id', auth.requireDues, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM donation WHERE id=?').get(id)) return res.status(404).json({ error: 'not_found' });
    const v = donationInput(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    db.prepare(`UPDATE donation SET member_id=?, donor_name=?, amount=?, given_at=?, method=?, note=?, updated_at=datetime('now','localtime')
                WHERE id=?`).run(v.member_id, v.donor_name, v.amount, v.given_at, v.method, v.note, id);
    res.json(db.prepare('SELECT * FROM donation WHERE id=?').get(id));
  });

  router.delete('/donations/:id', auth.requireDues, (req, res) => {
    const r = db.prepare('DELETE FROM donation WHERE id=?').run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  // 이번 달 미납자만 (관리자·회비 담당) — 홈 화면에서 한눈에 보려고
  router.get('/unpaid', auth.requireDues, (req, res) => {
    const month = PERIOD.test(req.query.month || '') ? req.query.month : thisMonth();
    const { monthly_fee } = getSettings(db);
    const rows = db.prepare(`
      SELECT m.id AS member_id, m.name, m.phone, m.level, m.joined_at, d.amount
      FROM member m
      LEFT JOIN due d ON d.member_id = m.id AND d.kind='monthly' AND d.period = ?
      WHERE m.status='active' AND m.program='club' AND (d.id IS NULL OR d.paid_at IS NULL)
        AND NOT ${MONTHLY_EXEMPT_SQL}
      ORDER BY m.name`).all(month, month)   // 코치·총무와 옛 규칙으로 가입한 달(입회비에 포함)은 빠진다
      .map(({ joined_at, ...r }) => ({ ...r, amount: r.amount ?? monthlyFeeFor(joined_at, month, monthly_fee) }));
    res.json({ month, monthly_fee, count: rows.length, rows });
  });

  // 미납자에게 알림 (관리자·회비 담당) — 1:1 채팅 + 폰 알림 (lib/dues-remind.js, 자동 알림과 같은 코드)
  router.post('/remind', auth.requireDues, async (req, res) => {
    const month = PERIOD.test(req.body?.month || '') ? req.body.month : thisMonth();
    const r = await sendDuesReminders(db, notify, { senderId: req.me.id, month });
    res.json({ ok: true, ...r });
  });

  // 완납/미납 체크 (관리자·회비 담당) — 같은 요청을 두 번 보내도 결과가 같다
  router.put('/mark', auth.requireDues, (req, res) => {
    const b = req.body || {};
    const member_id = Number(b.member_id);
    const kind = DUE_KINDS.includes(b.kind) ? b.kind : 'monthly';
    const period = PERIOD.test(b.period || '') ? b.period : thisMonth();
    const paid = !!b.paid;
    const method = METHODS.includes(b.method) ? b.method : (paid ? 'cash' : null);
    const note = String(b.note || '').trim() || null;
    const paid_at = paid ? (/^\d{4}-\d{2}-\d{2}$/.test(b.paid_at || '') ? b.paid_at : today()) : null;

    const m = db.prepare("SELECT id, joined_at FROM member WHERE id=? AND program='club'").get(member_id);
    if (!m) return res.status(404).json({ error: 'member_not_found' });

    const s = getSettings(db);
    const fallback = kind === 'joining' ? s.joining_fee : monthlyFeeFor(m.joined_at, period, s.monthly_fee);
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
