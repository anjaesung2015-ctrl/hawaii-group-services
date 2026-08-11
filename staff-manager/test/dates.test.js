const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');

const SECRET = 'test-secret';
const BOSS = 'boss123';

function makeServer() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  const ins = db.prepare("INSERT INTO report_users (name, pin_hash, is_active) VALUES (?,?,?)");
  ins.run('미가', bcrypt.hashSync('x', 10), 1);
  ins.run('바트', bcrypt.hashSync('x', 10), 1);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS }));
  const server = app.listen(0);
  return { db, server, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const staffCookie = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const bossCookie = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });

// 자유메모(주/월/년)를 하나 넣는다
const memo = (db, sid, period, date, text) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo) VALUES (?,?,?,'',?)")
    .run(sid, period, date, text);
const todo = (db, sid, date, title, done) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo, done) VALUES (?,'today',?,?,'',?)")
    .run(sid, date, title, done || 0);

const cal = async (base, month, cookie) =>
  (await fetch(`${base}/calendar?month=${month}`, { headers: { cookie: cookie || staffCookie(1, '미가') } })).json();

test('글에 8/15 라고 쓰면 그날에 걸린다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'month', '2026-08-01', '8/15 한국국제주니어 대회 인솔');
  const d = await cal(base, '2026-08');
  assert.strictEqual(d.days['2026-08-15'].notes, 1);
  server.close();
});

test('8월 15일 형식도 걸린다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'month', '2026-08-01', '8월 15일 센코컵 출장');
  const d = await cal(base, '2026-08');
  assert.strictEqual(d.days['2026-08-15'].notes, 1);
  server.close();
});

test('2026-08-15 형식도 걸린다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'year', '2026-01-01', '2026-08-15 광복절 행사');
  const d = await cal(base, '2026-08');
  assert.strictEqual(d.days['2026-08-15'].notes, 1);
  server.close();
});

test('8/15~8/20 은 사이 날짜 전부에 걸린다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'month', '2026-08-01', '8/15~8/20 대회 기간');
  const d = await cal(base, '2026-08');
  for (const day of ['15', '16', '17', '18', '19', '20']) {
    assert.strictEqual(d.days['2026-08-' + day]?.notes, 1, '8/' + day + ' 누락');
  }
  assert.strictEqual(d.days['2026-08-21'], undefined);
  server.close();
});

test('8월 15일~20일 처럼 뒤에 일만 써도 범위로 본다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'month', '2026-08-01', '8월 15일~20일 합숙');
  const d = await cal(base, '2026-08');
  assert.strictEqual(d.days['2026-08-15'].notes, 1);
  assert.strictEqual(d.days['2026-08-20'].notes, 1);
  server.close();
});

test('일 없이 8월 이라고만 쓰면 달력에 안 걸린다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'month', '2026-08-01', '8월 한국국제주니어 테니스대회 인솔');
  const d = await cal(base, '2026-08');
  assert.deepStrictEqual(d.days, {});
  server.close();
});

test('시각(9:30)이나 비율(100/5)은 날짜로 보지 않는다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'month', '2026-08-01', '9:30 미팅, 달성률 100/5, 13/45');
  const d = await cal(base, '2026-08');
  assert.deepStrictEqual(d.days, {});
  server.close();
});

test('없는 날짜(2/30)는 무시한다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'month', '2026-02-01', '2/30 유령날짜');
  const d = await cal(base, '2026-02');
  assert.deepStrictEqual(d.days, {});
  server.close();
});

test('연도를 안 쓰면 그 글이 속한 해로 본다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'year', '2025-01-01', '8/15 작년 행사');
  const d2025 = await cal(base, '2025-08');
  const d2026 = await cal(base, '2026-08');
  assert.strictEqual(d2025.days['2025-08-15'].notes, 1);
  assert.deepStrictEqual(d2026.days, {});
  server.close();
});

test('다른 달 언급은 그 달 달력에만 나온다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'month', '2026-08-01', '9/5 센코컵');
  const aug = await cal(base, '2026-08');
  const sep = await cal(base, '2026-09');
  assert.deepStrictEqual(aug.days, {});
  assert.strictEqual(sep.days['2026-09-05'].notes, 1);
  server.close();
});

test('오늘/내일 항목의 완료 집계는 그대로다', async () => {
  const { db, server, base } = makeServer();
  todo(db, 1, '2026-08-11', 'A', 1);
  todo(db, 1, '2026-08-11', 'B', 0);
  memo(db, 1, 'month', '2026-08-01', '8/11 회의');
  const d = await cal(base, '2026-08');
  assert.strictEqual(d.days['2026-08-11'].total, 2);
  assert.strictEqual(d.days['2026-08-11'].done, 1);
  assert.strictEqual(d.days['2026-08-11'].notes, 1);
  server.close();
});

test('오늘 항목 제목에 쓴 날짜도 그날에 걸린다', async () => {
  const { db, server, base } = makeServer();
  todo(db, 1, '2026-08-11', '8/20 대회 준비물 챙기기', 0);
  const d = await cal(base, '2026-08');
  assert.strictEqual(d.days['2026-08-20'].notes, 1);
  server.close();
});

test('직원은 남의 글에서 나온 날짜가 안 보인다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 2, 'month', '2026-08-01', '8/15 바트 일정');
  const d = await cal(base, '2026-08');
  assert.deepStrictEqual(d.days, {});
  server.close();
});

test('day: 그날 항목과 그날이 언급된 글을 함께 준다', async () => {
  const { db, server, base } = makeServer();
  todo(db, 1, '2026-08-15', '코트 정비', 0);
  memo(db, 1, 'month', '2026-08-01', '8/15 대회 인솔');
  const rows = await (await fetch(`${base}/day?date=2026-08-15`, { headers: { cookie: staffCookie(1, '미가') } })).json();
  const me = rows.find(r => r.staff_id === 1);
  assert.deepStrictEqual(me.items.map(i => i.title), ['코트 정비']);
  assert.strictEqual(me.mentions.length, 1);
  assert.strictEqual(me.mentions[0].period, 'month');
  server.close();
});

test('day: 사장님은 전 직원의 그날을 본다', async () => {
  const { db, server, base } = makeServer();
  memo(db, 1, 'week', '2026-08-10', '8/15 미가 일정');
  memo(db, 2, 'month', '2026-08-01', '8/15 바트 일정');
  const rows = await (await fetch(`${base}/day?date=2026-08-15`, { headers: { cookie: bossCookie() } })).json();
  assert.deepStrictEqual(rows.map(r => r.name), ['미가', '바트']);
  assert.strictEqual(rows[0].mentions.length, 1);
  assert.strictEqual(rows[1].mentions.length, 1);
  server.close();
});

test('day: 잘못된 날짜는 400', async () => {
  const { server, base } = makeServer();
  const r = await fetch(`${base}/day?date=2026-8-1`, { headers: { cookie: bossCookie() } });
  assert.strictEqual(r.status, 400);
  server.close();
});
