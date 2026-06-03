const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { violatesFloorRule } = require('../floor-rule');

// 헬퍼: {zone, group_name}
const T = (zone) => ({ zone, group_name: 'floor1-tennis' });
const V = (zone) => ({ zone, group_name: 'floor1-volleyball' });
const B = (zone) => ({ zone, group_name: 'floor1-basketball' });

// --- 순수 규칙 함수 (구역 모델) ---
test('floor-rule: 같은 종목은 구역이 달라 여러 면 허용', () => {
  assert.strictEqual(violatesFloorRule(T('R'), [T('L'), T('M')]), false); // 테니스 3면
  assert.strictEqual(violatesFloorRule(V('R'), [V('L'), V('M')]), false); // 배구 3면
  assert.strictEqual(violatesFloorRule(B('R'), [B('L')]), false);          // 농구 2면
});
test('floor-rule: 같은 구역은 1개만 (위치 겹침)', () => {
  assert.strictEqual(violatesFloorRule(T('L'), [B('L')]), true);  // 농구a + 테니스1 (둘 다 L)
  assert.strictEqual(violatesFloorRule(V('L'), [B('L')]), true);  // 농구a + 배구1
  assert.strictEqual(violatesFloorRule(T('M'), [V('M')]), true);  // 테니스2 + 배구2 (둘 다 M)
});
test('floor-rule: 농구a 1면이면 중간은 사용 가능', () => {
  assert.strictEqual(violatesFloorRule(T('M'), [B('L')]), false); // 농구a + 테니스2(중간) OK
  assert.strictEqual(violatesFloorRule(T('R'), [B('L')]), false); // 농구a + 테니스3(오른쪽) OK
});
test('floor-rule: 농구 양쪽이면 중간 차단', () => {
  assert.strictEqual(violatesFloorRule(T('M'), [B('L'), B('R')]), true);  // 농구a+농구b → 테니스2 차단
  assert.strictEqual(violatesFloorRule(V('M'), [B('L'), B('R')]), true);  // 농구a+농구b → 배구2 차단
  assert.strictEqual(violatesFloorRule(B('R'), [B('L')]), false);         // 농구 2면 자체는 OK
});
test('floor-rule: 2층/야외(zone 없음)는 무관', () => {
  assert.strictEqual(violatesFloorRule({ zone: null, group_name: 'floor2' }, [B('L'), B('R')]), false);
  assert.strictEqual(violatesFloorRule(T('L'), [{ zone: null, group_name: 'floor2' }]), false);
});

// --- createBookingSafely 통합 (구역 모델) ---
// 코트 id: 1테1(L) 2테2(M) 3테3(R) 4농a(L) 5농b(R) 6배1(L) 7배2(M) 8배3(R)
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8'));
  db.exec('ALTER TABLE court ADD COLUMN zone TEXT');
  const oh = db.prepare('SELECT open_hours FROM court WHERE id=1').get().open_hours;
  db.prepare("UPDATE court SET group_name='floor1-tennis', zone='L' WHERE id=1").run(); // id1 = 테니스1(L)
  const ins = db.prepare("INSERT INTO court (name_mn, group_name, sport, zone, open_hours, price_per_hour) VALUES (?,?, 'tennis', ?, ?, 110000)");
  ins.run('테니스2', 'floor1-tennis', 'M', oh);     // id2
  ins.run('테니스3', 'floor1-tennis', 'R', oh);     // id3
  ins.run('농구a', 'floor1-basketball', 'L', oh);   // id4
  ins.run('농구b', 'floor1-basketball', 'R', oh);   // id5
  ins.run('배구1', 'floor1-volleyball', 'L', oh);   // id6
  ins.run('배구2', 'floor1-volleyball', 'M', oh);   // id7
  ins.run('배구3', 'floor1-volleyball', 'R', oh);   // id8
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

test('floor: 테니스 3면 동시 허용', () => {
  const m = loadWith(freshDb());
  assert.ok(book(m, 1)); assert.ok(book(m, 2)); assert.ok(book(m, 3));
});
test('floor: 농구 2면 동시 허용', () => {
  const m = loadWith(freshDb());
  assert.ok(book(m, 4)); assert.ok(book(m, 5));
});
test('floor: 농구a 후 같은 구역 테니스1 차단', () => {
  const m = loadWith(freshDb());
  book(m, 4);                                       // 농구a (L)
  assert.throws(() => book(m, 1), /SLOT_CONFLICT/); // 테니스1 (L) → 차단
});
test('floor: 농구a 후 중간 테니스2 / 오른쪽 테니스3 허용', () => {
  const m = loadWith(freshDb());
  book(m, 4);              // 농구a (L)
  assert.ok(book(m, 2));   // 테니스2 (M) OK
  assert.ok(book(m, 3));   // 테니스3 (R) OK
});
test('floor: 농구a+농구b 후 중간 테니스2 차단', () => {
  const m = loadWith(freshDb());
  book(m, 4); book(m, 5);                            // 농구a + 농구b
  assert.throws(() => book(m, 2), /SLOT_CONFLICT/);  // 테니스2 (M) → 차단
});
test('floor: 농구a + 테니스3 후 같은 구역 농구b 차단', () => {
  const m = loadWith(freshDb());
  book(m, 4);                                        // 농구a (L)
  assert.ok(book(m, 3));                             // 테니스3 (R)
  assert.throws(() => book(m, 5), /SLOT_CONFLICT/);  // 농구b (R) → 테니스3과 같은 구역 차단
});
test('floor: 테니스2 + 배구2 같은 중간구역 차단', () => {
  const m = loadWith(freshDb());
  book(m, 2);                                        // 테니스2 (M)
  assert.throws(() => book(m, 7), /SLOT_CONFLICT/);  // 배구2 (M) → 차단
});
