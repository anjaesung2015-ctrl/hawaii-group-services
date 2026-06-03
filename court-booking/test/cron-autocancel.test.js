const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8'));
  db.exec('ALTER TABLE court ADD COLUMN floor_cols TEXT');
  return db;
}

test('autoCancel: awaiting_until 지난 payment → cancelled', () => {
  const db = freshDb();
  const bookingId = db.prepare(`INSERT INTO booking (public_code, court_id, booking_date, start_time, end_time, guest_name, guest_phone, amount, status) VALUES ('BKAAAA', 1, '2026-07-15', '10:00', '11:00', 'T', '99110000', 30000, 'pending')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until) VALUES (?, 'qpay', 'INV1', 30000, 'awaiting', datetime('now','-1 minute'))`).run(bookingId);

  const { autoCancelExpired } = require('../cron-jobs')(db);
  const n = autoCancelExpired();
  assert.strictEqual(n, 1);

  const p = db.prepare(`SELECT status FROM payment WHERE booking_id=?`).get(bookingId);
  const b = db.prepare(`SELECT status FROM booking WHERE id=?`).get(bookingId);
  assert.strictEqual(p.status, 'auto_cancelled');
  assert.strictEqual(b.status, 'cancelled');
});

test('autoCancel: awaiting_until 안 지난 건은 그대로', () => {
  const db = freshDb();
  const bookingId = db.prepare(`INSERT INTO booking (public_code, court_id, booking_date, start_time, end_time, guest_name, guest_phone, amount, status) VALUES ('BKBBBB', 1, '2026-07-15', '11:00', '12:00', 'T', '99110000', 30000, 'pending')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until) VALUES (?, 'qpay', 'INV2', 30000, 'awaiting', datetime('now','+5 minutes'))`).run(bookingId);

  const { autoCancelExpired } = require('../cron-jobs')(db);
  const n = autoCancelExpired();
  assert.strictEqual(n, 0);
});
