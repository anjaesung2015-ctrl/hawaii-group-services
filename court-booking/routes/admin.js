const express = require('express');
const { prepare } = require('../db');
const { requireAdmin } = require('../auth');
const { apiError, sendError } = require('../errors');
const { log: auditLog } = require('../audit-log');

const router = express.Router();
router.use(requireAdmin);

// 예약 목록 (필터)
router.get('/bookings', (req, res) => {
  try {
    const date = req.query.date;
    const status = req.query.status;
    const phone = req.query.phone;
    const where = [];
    const args = {};
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { where.push('b.booking_date = @date'); args.date = date; }
    if (status === 'active') { where.push("b.status NOT IN ('cancelled','no_show')"); }
    else if (status) { where.push('b.status = @status'); args.status = status; }
    if (phone) { where.push('b.guest_phone LIKE @phone'); args.phone = `%${phone}%`; }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = prepare(`
      SELECT b.id, b.public_code, b.booking_date, b.start_time, b.end_time, b.status, b.amount,
             b.guest_name, b.guest_phone, b.guest_email, c.name_mn AS court_name
      FROM booking b JOIN court c ON c.id = b.court_id
      ${whereSql}
      ORDER BY b.booking_date DESC, b.start_time DESC
      LIMIT 200
    `).all(args);
    res.json(rows);
  } catch (e) { sendError(res, e); }
});

// 예약 상세 + 결제이력
router.get('/bookings/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = prepare(`
      SELECT b.*, c.name_mn AS court_name FROM booking b JOIN court c ON c.id=b.court_id WHERE b.id=?
    `).get(id);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    const payments = prepare(`SELECT * FROM payment WHERE booking_id=? ORDER BY id`).all(id);
    res.json({ ...b, payments });
  } catch (e) { sendError(res, e); }
});

// 강제 취소
router.post('/bookings/:id/cancel', express.json(), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body || {};
    if (!reason || reason.length < 2) throw apiError('INVALID_INPUT', { field: 'reason' });
    const b = prepare('SELECT id, status FROM booking WHERE id=?').get(id);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    if (!['pending','confirmed'].includes(b.status)) throw apiError('BOOKING_NOT_CANCELLABLE');

    prepare(`UPDATE booking SET status='cancelled', cancelled_at=datetime('now'), cancelled_by=?, cancel_reason=? WHERE id=?`).run(req.user.id, reason, id);
    prepare(`UPDATE payment SET status='auto_cancelled' WHERE booking_id=? AND status='awaiting'`).run(id);

    auditLog({
      actor_id: req.user.id, actor_type: 'admin', action: 'booking.cancel.admin',
      entity_type: 'booking', entity_id: id, metadata: { reason }, ip: req.ip
    });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// 노쇼
router.post('/bookings/:id/no-show', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = prepare('SELECT id, status FROM booking WHERE id=?').get(id);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    if (b.status !== 'confirmed') throw apiError('INVALID_INPUT', { hint: '확정된 예약만 노쇼 처리 가능' });
    prepare(`UPDATE booking SET status='no_show', no_show_at=datetime('now'), no_show_by=? WHERE id=?`).run(req.user.id, id);
    auditLog({ actor_id: req.user.id, actor_type: 'admin', action: 'booking.no_show', entity_type: 'booking', entity_id: id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// 현금 수납 처리
router.post('/bookings/:id/confirm-cash', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = prepare('SELECT id, status, amount FROM booking WHERE id=?').get(id);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    if (b.status !== 'pending') throw apiError('INVALID_INPUT', { hint: 'pending만 현금 처리 가능' });

    const { db } = require('../db');
    db.transaction(() => {
      db.prepare(`INSERT INTO payment (booking_id, provider, amount, status, paid_at, paid_by) VALUES (?, 'cash', ?, 'paid', datetime('now'), ?)`).run(id, b.amount, req.user.id);
      db.prepare(`UPDATE booking SET status='confirmed', confirmed_at=datetime('now') WHERE id=?`).run(id);
    }).immediate();

    auditLog({ actor_id: req.user.id, actor_type: 'admin', action: 'payment.cash', entity_type: 'booking', entity_id: id, ip: req.ip });

    // 알림 비동기
    const { sendNotificationsForBooking } = require('../notifications');
    setImmediate(() => sendNotificationsForBooking(id).catch(e => console.error(e)));

    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// 현황판: 날짜의 코트×시간 그리드 + 그날 요약(건수/매출)
router.get('/grid', (req, res) => {
  try {
    const date = req.query.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw apiError('INVALID_INPUT');
    const { computeAvailability } = require('../availability');
    const { violatesFloorRule } = require('../floor-rule');

    const courts = prepare(`SELECT id, name_mn, name_ko, group_name, open_hours FROM court WHERE active=1 ORDER BY id`).all();
    // 그날 전체 예약(코트 group 포함) — floor 차단 계산용
    const allBookings = prepare(`
      SELECT b.id, b.public_code, b.court_id, b.start_time, b.end_time, b.status,
             b.guest_name, b.guest_phone, b.amount, c.group_name
      FROM booking b JOIN court c ON c.id = b.court_id
      WHERE b.booking_date=? AND b.status NOT IN ('cancelled','no_show')
    `).all(date);

    const grid = courts.map(c => {
      const own = allBookings.filter(b => b.court_id === c.id).map(b => ({ start_time: b.start_time, end_time: b.end_time }));
      const slots = computeAvailability({ open_hours: c.open_hours, date, taken: own }).map(s => {
        const bk = allBookings.find(b => b.court_id === c.id && b.start_time < s.end && b.end_time > s.start);
        if (bk) {
          return { start: s.start, end: s.end, status: bk.status,
            booking: { id: bk.id, code: bk.public_code, name: bk.guest_name, phone: bk.guest_phone, amount: bk.amount } };
        }
        // 자기 코트는 비어있지만 1층 종목 섞임으로 차단되는지
        const others = allBookings.filter(b => b.court_id !== c.id && b.start_time < s.end && b.end_time > s.start).map(b => b.group_name);
        const blocked = violatesFloorRule(c.group_name, others);
        return { start: s.start, end: s.end, status: blocked ? 'blocked' : 'available', booking: null };
      });
      return { court_id: c.id, name_mn: c.name_mn, name_ko: c.name_ko, slots };
    });

    const sum = prepare(`
      SELECT
        SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed_cnt,
        SUM(CASE WHEN status='pending'   THEN 1 ELSE 0 END) AS pending_cnt,
        SUM(CASE WHEN status='confirmed' THEN amount ELSE 0 END) AS revenue
      FROM booking WHERE booking_date=? AND status NOT IN ('cancelled','no_show')
    `).get(date);

    res.json({
      date, courts: grid,
      summary: { confirmed: sum.confirmed_cnt || 0, pending: sum.pending_cnt || 0, revenue: sum.revenue || 0 }
    });
  } catch (e) { sendError(res, e); }
});

// 코트 관리
router.get('/courts', (req, res) => {
  res.json(prepare('SELECT * FROM court ORDER BY id').all().map(r => ({ ...r, open_hours: JSON.parse(r.open_hours) })));
});

router.patch('/courts/:id', express.json(), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fields = [];
    const args = { id };
    const allowed = ['name_mn','name_ko','group_name','open_hours','price_per_hour','active','maintenance_mode'];
    for (const k of allowed) {
      if (req.body?.[k] !== undefined) {
        fields.push(`${k} = @${k}`);
        args[k] = k === 'open_hours' && typeof req.body[k] === 'object' ? JSON.stringify(req.body[k]) : req.body[k];
      }
    }
    if (!fields.length) throw apiError('INVALID_INPUT');
    fields.push(`updated_at = datetime('now')`);
    const sql = `UPDATE court SET ${fields.join(', ')} WHERE id = @id`;
    const result = require('../db').db.prepare(sql).run(args);
    if (!result.changes) throw apiError('BOOKING_NOT_FOUND');
    auditLog({ actor_id: req.user.id, actor_type: 'admin', action: 'court.update', entity_type: 'court', entity_id: id, metadata: req.body, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

module.exports = router;
