const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { violatesFloorRule } = require('../floor-rule');

// --- 순수 규칙 함수 ---
test('floor-rule: 단일 종목은 여러 면 허용', () => {
  assert.strictEqual(violatesFloorRule('floor1-tennis', ['floor1-tennis', 'floor1-tennis']), false); // 테3
  assert.strictEqual(violatesFloorRule('floor1-basketball', ['floor1-basketball']), false);           // 농2
});
test('floor-rule: 두 종목 섞이면 종목당 1면', () => {
  assert.strictEqual(violatesFloorRule('floor1-tennis', ['floor1-basketball']), false);                       // 테1+농1 OK
  assert.strictEqual(violatesFloorRule('floor1-volleyball', ['floor1-tennis', 'floor1-basketball']), false);  // 1+1+1 OK
  assert.strictEqual(violatesFloorRule('floor1-tennis', ['floor1-tennis', 'floor1-basketball']), true);       // 테2+농 X
  assert.strictEqual(violatesFloorRule('floor1-basketball', ['floor1-basketball', 'floor1-volleyball']), true); // 농2+배 X
});
test('floor-rule: 다른 floor는 무관', () => {
  assert.strictEqual(violatesFloorRule('floor2', ['floor1-tennis', 'floor1-basketball']), false);
  assert.strictEqual(violatesFloorRule('floor1-tennis', ['floor2', 'outdoor']), false);
});

// --- createBookingSafely 통합 (floor 차단) ---
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8'));
  db.prepare("UPDATE court SET group_name='floor1-tennis' WHERE id=1").run();
  const oh = db.prepare("SELECT open_hours FROM court WHERE id=1").get().open_hours;
  // sport CHECK가 'tennis'만 허용 → group_name으로 종목 구분(스키마 변경 회피)
  const ins = db.prepare("INSERT INTO court (name_mn, group_name, sport, open_hours, price_per_hour) VALUES (?,?, 'tennis', ?, 110000)");
  ins.run('테니스2', 'floor1-tennis', oh);    // id2
  ins.run('농구a', 'floor1-basketball', oh);  // id3
  ins.run('배구1', 'floor1-volleyball', oh);  // id4
  return db;
}
function loadWith(db) {
  delete require.cache[require.resolve('../db')];
  process.env.DB_PATH = ':memory:';
  const mod = require('../db');
  Object.defineProperty(mod, 'db', { value: db, writable: false, configurable: true });
  return mod;
}
const book = (m, court_id) => m.createBookingSafely({
  court_id, booking_date: '2026-07-15', start_time: '10:00', end_time: '11:00',
  guest_name: 'T', guest_phone: '99110000', amount: 110000
});

test('floor: 테니스1 후 테니스2 허용(같은 종목)', () => {
  const m = loadWith(freshDb());
  book(m, 1);
  assert.ok(book(m, 2));
});
test('floor: 테니스1 후 농구a 허용(1+1)', () => {
  const m = loadWith(freshDb());
  book(m, 1);
  assert.ok(book(m, 3));
});
test('floor: 테니스1+2 후 농구a 차단', () => {
  const m = loadWith(freshDb());
  book(m, 1); book(m, 2);
  assert.throws(() => book(m, 3), /SLOT_CONFLICT/);
});
test('floor: 농구a 후 테니스1 허용, 그 뒤 테니스2 차단', () => {
  const m = loadWith(freshDb());
  book(m, 3);
  assert.ok(book(m, 1));
  assert.throws(() => book(m, 2), /SLOT_CONFLICT/);
});
