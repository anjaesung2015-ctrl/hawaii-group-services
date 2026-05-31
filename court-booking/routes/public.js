const express = require('express');
const { db, prepare, createBookingSafely } = require('../db');
const { computeAvailability } = require('../availability');
const { apiError, sendError } = require('../errors');
const { log: auditLog } = require('../audit-log');

const router = express.Router();

router.get('/courts', (req, res) => {
  const rows = prepare(`
    SELECT id, name_mn, group_name, sport, open_hours, price_per_hour
    FROM court WHERE active = 1 ORDER BY id
  `).all();
  res.json(rows.map(r => ({ ...r, open_hours: JSON.parse(r.open_hours) })));
});

router.get('/availability', (req, res) => {
  try {
    const court_id = parseInt(req.query.court_id, 10);
    const date = String(req.query.date || '');
    if (!court_id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw apiError('INVALID_INPUT');
    }
    const court = prepare('SELECT open_hours FROM court WHERE id=? AND active=1').get(court_id);
    if (!court) throw apiError('INVALID_INPUT');

    const taken = prepare(`
      SELECT start_time, end_time FROM booking
      WHERE court_id = ? AND booking_date = ?
        AND status NOT IN ('cancelled','no_show')
    `).all(court_id, date);

    res.json(computeAvailability({ open_hours: court.open_hours, date, taken }));
  } catch (e) {
    sendError(res, e);
  }
});

// 가격 계산: 단순 1시간당 * 시간
function calcAmount(price_per_hour, start_time, end_time) {
  const [sh, sm] = start_time.split(':').map(Number);
  const [eh, em] = end_time.split(':').map(Number);
  const hours = (eh * 60 + em - sh * 60 - sm) / 60;
  return Math.round(price_per_hour * hours);
}

router.post('/bookings', express.json(), async (req, res) => {
  try {
    const { court_id, booking_date, start_time, end_time, guest_name, guest_phone, guest_email } = req.body || {};

    // 기본 검증
    if (!court_id || !booking_date || !start_time || !end_time || !guest_name || !guest_phone) {
      throw apiError('INVALID_INPUT', { missing: ['court_id','booking_date','start_time','end_time','guest_name','guest_phone'].filter(k => !(req.body && req.body[k])) });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) throw apiError('INVALID_INPUT', { field: 'booking_date' });
    if (!/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time)) throw apiError('INVALID_INPUT', { field: 'time' });
    if (!/^[0-9+\-\s]{6,20}$/.test(guest_phone)) throw apiError('INVALID_INPUT', { field: 'guest_phone' });

    // Idempotency cooldown: 같은 phone + date + start_time 60초 내 → 기존 booking 반환
    const recent = prepare(`
      SELECT public_code, status, amount
      FROM booking
      WHERE guest_phone=? AND booking_date=? AND start_time=?
        AND created_at >= datetime('now','-60 seconds')
        AND status NOT IN ('cancelled','no_show')
      ORDER BY id DESC LIMIT 1
    `).get(guest_phone, booking_date, start_time);
    if (recent) {
      return res.status(200).json({ public_code: recent.public_code, idempotent: true });
    }

    const court = prepare('SELECT id, price_per_hour FROM court WHERE id=? AND active=1').get(court_id);
    if (!court) throw apiError('INVALID_INPUT', { field: 'court_id' });

    const amount = calcAmount(court.price_per_hour, start_time, end_time);

    const id = createBookingSafely({
      court_id, booking_date, start_time, end_time,
      guest_name, guest_phone, guest_email: guest_email || null,
      amount
    });

    const created = prepare('SELECT public_code FROM booking WHERE id=?').get(id);

    auditLog({
      actor_type: 'customer', action: 'booking.create',
      entity_type: 'booking', entity_id: id,
      metadata: { court_id, booking_date, start_time, amount },
      ip: req.ip
    });

    // QPay 인보이스 생성 (creds 있을 때만)
    let invoice = null;
    let expiresAt = null;
    if (process.env.QPAY_USERNAME && process.env.QPAY_PASSWORD && process.env.QPAY_INVOICE_CODE) {
      const qpay = require('../qpay-client');
      try {
        invoice = await qpay.createInvoice({
          amount,
          description: `Tennis ${booking_date} ${start_time}-${end_time}`,
          callback_url: `${process.env.QPAY_CALLBACK_URL}?bk=${created.public_code}`,
          sender_invoice_no: created.public_code,
          receiver_code: guest_phone
        });
      } catch (e) {
        // booking 롤백 (트랜잭션 후 INSERT라 별도 DELETE)
        prepare('DELETE FROM booking WHERE id=?').run(id);
        throw apiError('INTERNAL', { qpay_error: e.message });
      }

      expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      prepare(`
        INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until)
        VALUES (?, 'qpay', ?, ?, 'awaiting', ?)
      `).run(id, invoice.invoice_id, amount, expiresAt);
    }

    res.status(201).json({
      public_code: created.public_code,
      amount,
      ...(invoice ? {
        expires_at: expiresAt,
        qpay_qr_text: invoice.qr_text,
        qpay_qr_image: invoice.qr_image,
        qpay_deeplinks: invoice.urls || []
      } : {
        qpay_unavailable: true   // 운영자가 creds 추가 필요
      })
    });
  } catch (e) {
    if (e && e.code === 'SLOT_CONFLICT' && !e.error_code) {
      e = apiError('SLOT_CONFLICT');
    }
    sendError(res, e);
  }
});


router.get('/bookings/:code', (req, res) => {
  try {
    const code = req.params.code;
    const b = prepare(`
      SELECT b.public_code, b.booking_date, b.start_time, b.end_time, b.status, b.amount,
             b.guest_name, c.name_mn AS court_name
      FROM booking b JOIN court c ON c.id = b.court_id
      WHERE b.public_code = ?
    `).get(code);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    res.json(b);
  } catch (e) { sendError(res, e); }
});

router.get('/bookings/:code/payment-status', (req, res) => {
  try {
    const code = req.params.code;
    const row = prepare(`
      SELECT b.status AS booking_status, p.status AS payment_status
      FROM booking b
      LEFT JOIN payment p ON p.booking_id = b.id
      WHERE b.public_code = ?
      ORDER BY p.id DESC LIMIT 1
    `).get(code);
    if (!row) throw apiError('BOOKING_NOT_FOUND');

    let status = 'awaiting';
    if (row.payment_status === 'paid' || row.booking_status === 'confirmed') status = 'paid';
    else if (row.booking_status === 'cancelled') status = 'cancelled';

    res.json({ status });
  } catch (e) { sendError(res, e); }
});


router.post('/bookings/:code/cancel', express.json(), (req, res) => {
  try {
    const code = req.params.code;
    const { phone_last4 } = req.body || {};
    if (!phone_last4 || !/^\d{4}$/.test(phone_last4)) throw apiError('INVALID_INPUT', { field: 'phone_last4' });

    const b = prepare(`
      SELECT id, booking_date, start_time, guest_phone, status
      FROM booking WHERE public_code = ?
    `).get(code);
    if (!b) throw apiError('BOOKING_NOT_FOUND');

    if (b.guest_phone.slice(-4) !== phone_last4) throw apiError('PHONE_MISMATCH');

    if (!['pending','confirmed'].includes(b.status)) throw apiError('BOOKING_NOT_CANCELLABLE');

    // 24h 이내 차단 (코트 timezone UTC+8 기준)
    const startIso = `${b.booking_date}T${b.start_time}:00`;
    const startTs = new Date(startIso + '+08:00').getTime();
    const now = Date.now();
    if (startTs - now < 24 * 3600 * 1000) throw apiError('BOOKING_NOT_CANCELLABLE');

    prepare(`
      UPDATE booking
      SET status='cancelled', cancelled_at=datetime('now'),
          cancelled_by='customer', cancel_reason='self_cancel'
      WHERE id = ?
    `).run(b.id);

    // 연관 awaiting payment도 정리
    prepare(`
      UPDATE payment SET status='auto_cancelled'
      WHERE booking_id=? AND status='awaiting'
    `).run(b.id);

    auditLog({
      actor_type: 'customer', action: 'booking.cancel.self',
      entity_type: 'booking', entity_id: b.id,
      metadata: { reason: 'self_cancel' },
      ip: req.ip
    });

    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

module.exports = router;
