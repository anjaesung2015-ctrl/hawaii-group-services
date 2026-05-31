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
    if (status) { where.push('b.status = @status'); args.status = status; }
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

// 코트 관리
router.get('/courts', (req, res) => {
  res.json(prepare('SELECT * FROM court ORDER BY id').all().map(r => ({ ...r, open_hours: JSON.parse(r.open_hours) })));
});

router.patch('/courts/:id', express.json(), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fields = [];
    const args = { id };
    const allowed = ['name_mn','group_name','open_hours','price_per_hour','active','maintenance_mode'];
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
