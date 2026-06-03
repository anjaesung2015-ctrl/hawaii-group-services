const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { violatesFloorRule } = require('../floor-rule');

const T = (cols) => ({ cols, group_name: 'floor1-tennis' });
const Vb = (cols) => ({ cols, group_name: 'floor1-volleyball' });
const B = (cols) => ({ cols, group_name: 'floor1-basketball' });

// --- 순수 규칙 함수 (칸 모델) ---
test('floor-rule: 같은 종목 다른 칸은 여러 면 허용', () => {
  assert.strictEqual(violatesFloorRule(T('3'), [T('1'), T('2')]), false);   // 테니스 3면
  assert.strictEqual(violatesFloorRule(Vb('3'), [Vb('1'), Vb('2')]), false); // 배구 3면
});
test('floor-rule: 같은 번호 테니스+배구는 충돌, 다른 번호는 OK', () => {
  assert.strictEqual(violatesFloorRule(T('1'), [Vb('1')]), true);
  assert.strictEqual(violatesFloorRule(T('2'), [Vb('2')]), true);
  assert.strictEqual(violatesFloorRule(T('1'), [Vb('2')]), false);
});
test('floor-rule: 농구a(23) → 테2·3·배2·3 차단, 테1·배1 허용', () => {
  assert.strictEqual(violatesFloorRule(T('2'), [B('23')]), true);
  assert.strictEqual(violatesFloorRule(T('3'), [B('23')]), true);
  assert.strictEqual(violatesFloorRule(Vb('2'), [B('23')]), true);
  assert.strictEqual(violatesFloorRule(T('1'), [B('23')]), false);
  assert.strictEqual(violatesFloorRule(Vb('1'), [B('23')]), false);
});
test('floor-rule: 농구b(12) → 테1·2·배1·2 차단, 테3·배3 허용', () => {
  assert.strictEqual(violatesFloorRule(T('1'), [B('12')]), true);
  assert.strictEqual(violatesFloorRule(T('2'), [B('12')]), true);
  assert.strictEqual(violatesFloorRule(T('3'), [B('12')]), false);
});
test('floor-rule: 농구끼리는 충돌 안 함, 둘 다면 테·배 전부 차단', () => {
  assert.strictEqual(violatesFloorRule(B('23'), [B('12')]), false);          // 농구 2면 OK
  assert.strictEqual(violatesFloorRule(T('1'), [B('23'), B('12')]), true);
  assert.strictEqual(violatesFloorRule(T('2'), [B('23'), B('12')]), true);
  assert.strictEqual(violatesFloorRule(T('3'), [B('23'), B('12')]), true);
});
test('floor-rule: 2층/야외(cols 없음)는 무관', () => {
  assert.strictEqual(violatesFloorRule({ cols: null, group_name: 'floor2' }, [B('23'), B('12')]), false);
  assert.strictEqual(violatesFloorRule(T('1'), [{ cols: null, group_name: 'floor2' }]), false);
});

// --- createBookingSafely 통합 ---
// 코트 id: 1테1(1) 2테2(2) 3테3(3) 4농a(23) 5농b(12) 6배1(1) 7배2(2) 8배3(3)
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8'));
  db.exec('ALTER TABLE court ADD COLUMN floor_cols TEXT');
  const oh = db.prepare('SELECT open_hours FROM court WHERE id=1').get().open_hours;
  db.prepare("UPDATE court SET group_name='floor1-tennis', floor_cols='1' WHERE id=1").run();
  const ins = db.prepare("INSERT INTO court (name_mn, group_name, sport, floor_cols, open_hours, price_per_hour) VALUES (?,?, 'tennis', ?, ?, 110000)");
  ins.run('테니스2', 'floor1-tennis', '2', oh);      // id2
  ins.run('테니스3', 'floor1-tennis', '3', oh);      // id3
  ins.run('농구a', 'floor1-basketball', '23', oh);   // id4
  ins.run('농구b', 'floor1-basketball', '12', oh);   // id5
  ins.run('배구1', 'floor1-volleyball', '1', oh);    // id6
  ins.run('배구2', 'floor1-volleyball', '2', oh);    // id7
  ins.run('배구3', 'floor1-volleyball', '3', oh);    // id8
  return db;
}
function loadWith(db) {
  delete require.cache[require.resolve('../db')];
  process.env.DB_PATH = ':memory:';
  const mod = require('../db');
  Object.defineProperty(mod, 'db', { value: db, writable: false, configurable: true });
  return mod;
}
const book = (m, id) => m.createBookingSafely({
  court_id: id, booking_date: '2026-07-15', start_time: '10:00', end_time: '11:00',
  guest_name: 'T', guest_phone: '99110000', amount: 110000
});

test('floor: 테니스 3면 동시 OK', () => {
  const m = loadWith(freshDb());
  assert.ok(book(m, 1)); assert.ok(book(m, 2)); assert.ok(book(m, 3));
});
test('floor: 농구 2면 동시 OK', () => {
  const m = loadWith(freshDb());
  assert.ok(book(m, 4)); assert.ok(book(m, 5));
});
test('floor: 농구a 후 테1 허용 / 테2 차단', () => {
  const m = loadWith(freshDb()); book(m, 4);
  assert.ok(book(m, 1));
  assert.throws(() => book(m, 2), /SLOT_CONFLICT/);
});
test('floor: 농구b 후 테3 허용 / 테1 차단', () => {
  const m = loadWith(freshDb()); book(m, 5);
  assert.ok(book(m, 3));
  assert.throws(() => book(m, 1), /SLOT_CONFLICT/);
});
test('floor: 농구a+농구b 후 테니스/배구 전부 차단', () => {
  const m = loadWith(freshDb()); book(m, 4); book(m, 5);
  assert.throws(() => book(m, 1), /SLOT_CONFLICT/);
  assert.throws(() => book(m, 3), /SLOT_CONFLICT/);
  assert.throws(() => book(m, 8), /SLOT_CONFLICT/);
});
test('floor: 같은 번호 테니스1 + 배구1 차단', () => {
  const m = loadWith(freshDb()); book(m, 1);
  assert.throws(() => book(m, 6), /SLOT_CONFLICT/);
});
