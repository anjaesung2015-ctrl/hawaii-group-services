const path = require('path');
const Database = require('better-sqlite3');
const { generateUnique } = require('./public-code');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'court.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

const stmtCache = new Map();
function prepare(sql) {
  if (!stmtCache.has(sql)) stmtCache.set(sql, db.prepare(sql));
  return stmtCache.get(sql);
}

// 슬롯 겹침 검사 + 부분유니크 인덱스의 안전망
function createBookingSafely(input) {
  const tx = module.exports.db.transaction((input) => {
    const conflict = module.exports.db.prepare(`
      SELECT id FROM booking
      WHERE court_id = @court_id
        AND booking_date = @booking_date
        AND status NOT IN ('cancelled','no_show')
        AND start_time < @end_time
        AND end_time > @start_time
    `).get(input);

    if (conflict) {
      const err = new Error('SLOT_CONFLICT');
      err.code = 'SLOT_CONFLICT';
      throw err;
    }

    // 1층 물리적 구역 규칙 (zone 모델): 같은 구역 1개만 + 농구 양쪽이면 중간도 차단
    const { violatesFloorRule } = require('./floor-rule');
    const tgt = module.exports.db.prepare('SELECT group_name, zone FROM court WHERE id=?').get(input.court_id);
    if (tgt) {
      const others = module.exports.db.prepare(`
        SELECT c.group_name, c.zone FROM booking b JOIN court c ON c.id = b.court_id
        WHERE b.booking_date = @booking_date
          AND b.status NOT IN ('cancelled','no_show')
          AND b.start_time < @end_time AND b.end_time > @start_time
          AND b.court_id != @court_id
      `).all(input);
      if (violatesFloorRule(tgt, others)) {
        const err = new Error('SLOT_CONFLICT');
        err.code = 'SLOT_CONFLICT';
        throw err;
      }
    }

    const codeExists = (code) => module.exports.db.prepare('SELECT 1 FROM booking WHERE public_code=?').get(code);
    const public_code = generateUnique(codeExists);

    const result = module.exports.db.prepare(`
      INSERT INTO booking
        (public_code, court_id, booking_date, start_time, end_time,
         guest_name, guest_phone, guest_email, amount)
      VALUES
        (@public_code, @court_id, @booking_date, @start_time, @end_time,
         @guest_name, @guest_phone, @guest_email, @amount)
    `).run({ ...input, public_code, guest_email: input.guest_email || null });

    return result.lastInsertRowid;
  });

  // BEGIN IMMEDIATE — write lock 즉시 확보
  return tx.immediate(input);
}

module.exports = { db, prepare, createBookingSafely };
