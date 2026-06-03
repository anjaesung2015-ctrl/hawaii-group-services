const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// 인메모리 DB로 격리
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);
  db.exec('ALTER TABLE court ADD COLUMN floor_cols TEXT');
  return db;
}

// db.js를 테스트용으로 다시 require
let mod;
function loadWith(db) {
  delete require.cache[require.resolve('../db')];
  process.env.DB_PATH = ':memory:';
  // 트릭: db.js에서 모듈 export된 db를 교체
  mod = require('../db');
  Object.defineProperty(mod, 'db', { value: db, writable: false, configurable: true });
  return mod;
}

test('첫 예약은 성공', () => {
  const db = freshDb();
  const m = loadWith(db);
  const id = m.createBookingSafely({
    court_id: 1, booking_date: '2026-07-15',
    start_time: '10:00', end_time: '11:00',
    guest_name: 'A', guest_phone: '99110001',
    amount: 30000
  });
  assert.ok(id > 0);
});

test('정확히 같은 시작시각 → SLOT_CONFLICT', () => {
  const db = freshDb();
  const m = loadWith(db);
  m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  assert.throws(
    () => m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'B', guest_phone:'99110002', amount:30000 }),
    /SLOT_CONFLICT/
  );
});

test('부분 겹침 (10:30~11:30 over 10:00~11:00) → SLOT_CONFLICT', () => {
  const db = freshDb();
  const m = loadWith(db);
  m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  assert.throws(
    () => m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:30', end_time:'11:30', guest_name:'B', guest_phone:'99110002', amount:30000 }),
    /SLOT_CONFLICT/
  );
});

test('인접 슬롯 (11:00~12:00 vs 10:00~11:00) → 성공', () => {
  const db = freshDb();
  const m = loadWith(db);
  m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  const id2 = m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'11:00', end_time:'12:00', guest_name:'B', guest_phone:'99110002', amount:30000 });
  assert.ok(id2 > 0);
});

test('다른 날짜 → 성공', () => {
  const db = freshDb();
  const m = loadWith(db);
  m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  const id2 = m.createBookingSafely({ court_id:1, booking_date:'2026-07-16', start_time:'10:00', end_time:'11:00', guest_name:'B', guest_phone:'99110002', amount:30000 });
  assert.ok(id2 > 0);
});

test('취소된 예약과 같은 슬롯 → 성공', () => {
  const db = freshDb();
  const m = loadWith(db);
  const id1 = m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  db.prepare(`UPDATE booking SET status='cancelled', cancelled_at=datetime('now') WHERE id=?`).run(id1);
  const id2 = m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'B', guest_phone:'99110002', amount:30000 });
  assert.ok(id2 > 0);
});
