const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function freshDb() {
  const db = new Database(':memory:');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);
  db.exec('ALTER TABLE court ADD COLUMN floor_cols TEXT');
  return db;
}

test('markPaidIfAwaiting: awaiting → paid + booking confirmed', () => {
  const db = freshDb();
  const bookingId = db.prepare(`
    INSERT INTO booking (public_code, court_id, booking_date, start_time, end_time, guest_name, guest_phone, amount, status)
    VALUES ('BKAAAA', 1, '2026-07-15', '10:00', '11:00', 'T', '99110000', 30000, 'pending')
  `).run().lastInsertRowid;
  db.prepare(`INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until) VALUES (?, 'qpay', 'INV1', 30000, 'awaiting', datetime('now','+15 minutes'))`).run(bookingId);

  const { markPaidByInvoice } = require('../routes/qpay-tx')(db);
  markPaidByInvoice('INV1');

  const p = db.prepare('SELECT status FROM payment WHERE qpay_invoice_id=?').get('INV1');
  const b = db.prepare('SELECT status FROM booking WHERE id=?').get(bookingId);
  assert.strictEqual(p.status, 'paid');
  assert.strictEqual(b.status, 'confirmed');
});

test('두 번째 호출은 no-op (멱등)', () => {
  const db = freshDb();
  const bookingId = db.prepare(`INSERT INTO booking (public_code, court_id, booking_date, start_time, end_time, guest_name, guest_phone, amount, status) VALUES ('BKBBBB', 1, '2026-07-15', '11:00', '12:00', 'T', '99110000', 30000, 'pending')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until) VALUES (?, 'qpay', 'INV2', 30000, 'awaiting', datetime('now','+15 minutes'))`).run(bookingId);

  const { markPaidByInvoice } = require('../routes/qpay-tx')(db);
  const r1 = markPaidByInvoice('INV2');
  const r2 = markPaidByInvoice('INV2');
  assert.strictEqual(r1.changed, true);
  assert.strictEqual(r2.changed, false);
});
