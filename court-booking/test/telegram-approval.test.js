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

function seedPending(db, code = 'BKAPRV') {
  return db.prepare(`INSERT INTO booking
    (public_code, court_id, booking_date, start_time, end_time, guest_name, guest_phone, amount, status)
    VALUES (?, 1, '2026-07-15', '10:00', '11:00', 'T', '99110000', 110000, 'pending')`).run(code).lastInsertRowid;
}

test('approve: pending → confirmed', () => {
  const db = freshDb();
  const id = seedPending(db);
  const { applyDecision } = require('../routes/approval-tx')(db);
  const r = applyDecision(id, 'approve');
  assert.strictEqual(r.status, 'done');
  assert.strictEqual(r.current, 'confirmed');
  assert.strictEqual(db.prepare('SELECT status FROM booking WHERE id=?').get(id).status, 'confirmed');
  assert.ok(db.prepare('SELECT confirmed_at FROM booking WHERE id=?').get(id).confirmed_at);
});

test('reject: pending → cancelled (사유 기록)', () => {
  const db = freshDb();
  const id = seedPending(db);
  const { applyDecision } = require('../routes/approval-tx')(db);
  const r = applyDecision(id, 'reject');
  assert.strictEqual(r.status, 'done');
  assert.strictEqual(r.current, 'cancelled');
  const b = db.prepare('SELECT status, cancelled_by, cancel_reason FROM booking WHERE id=?').get(id);
  assert.strictEqual(b.status, 'cancelled');
  assert.strictEqual(b.cancelled_by, 'telegram');
  assert.strictEqual(b.cancel_reason, 'rejected_by_admin');
});

test('멱등: 이미 confirmed면 다시 approve해도 already', () => {
  const db = freshDb();
  const id = seedPending(db);
  const { applyDecision } = require('../routes/approval-tx')(db);
  applyDecision(id, 'approve');
  const r2 = applyDecision(id, 'approve');
  assert.strictEqual(r2.status, 'already');
  assert.strictEqual(r2.current, 'confirmed');
});

test('멱등: 승인 후 거절 시도해도 상태 안 바뀜', () => {
  const db = freshDb();
  const id = seedPending(db);
  const { applyDecision } = require('../routes/approval-tx')(db);
  applyDecision(id, 'approve');
  const r = applyDecision(id, 'reject');
  assert.strictEqual(r.status, 'already');
  assert.strictEqual(db.prepare('SELECT status FROM booking WHERE id=?').get(id).status, 'confirmed');
});

test('없는 예약 → notfound', () => {
  const db = freshDb();
  const { applyDecision } = require('../routes/approval-tx')(db);
  assert.strictEqual(applyDecision(99999, 'approve').status, 'notfound');
});

test('잘못된 action → badaction, 상태 유지', () => {
  const db = freshDb();
  const id = seedPending(db);
  const { applyDecision } = require('../routes/approval-tx')(db);
  assert.strictEqual(applyDecision(id, 'whatever').status, 'badaction');
  assert.strictEqual(db.prepare('SELECT status FROM booking WHERE id=?').get(id).status, 'pending');
});
