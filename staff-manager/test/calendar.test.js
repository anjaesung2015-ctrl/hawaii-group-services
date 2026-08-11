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

const bossCookie = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const staffCookie = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const add = (db, sid, period, date, title, done) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo, done) VALUES (?,?,?,?,'',?)")
    .run(sid, period, date, title, done || 0);
const cal = (base, qs, cookie) =>
  fetch(`${base}/calendar?${qs}`, { headers: { cookie } });

test('calendar: 날짜별 전체/완료 개수를 센다', async () => {
  const { db, server, base } = makeServer();
  add(db, 1, 'today', '2026-08-11', 'A', 1);
  add(db, 1, 'today', '2026-08-11', 'B', 0);
  add(db, 1, 'tomorrow', '2026-08-12', 'C', 0);
  const d = await (await cal(base, 'month=2026-08', staffCookie(1, '미가'))).json();
  assert.strictEqual(d.days['2026-08-11'].total, 2);
  assert.strictEqual(d.days['2026-08-11'].done, 1);
  assert.strictEqual(d.days['2026-08-12'].total, 1);
  server.close();
});

test('calendar: 내일 항목도 그 날짜 칸에 들어간다', async () => {
  const { db, server, base } = makeServer();
  add(db, 1, 'tomorrow', '2026-08-12', 'C', 1);
  const d = await (await cal(base, 'month=2026-08', staffCookie(1, '미가'))).json();
  assert.strictEqual(d.days['2026-08-12'].done, 1);
  server.close();
});

test('calendar: 주간·월간·연간 메모는 달력에 섞이지 않는다', async () => {
  const { db, server, base } = makeServer();
  add(db, 1, 'month', '2026-08-01', '월간메모', 0);
  add(db, 1, 'week', '2026-08-10', '주간메모', 0);
  add(db, 1, 'year', '2026-08-01', '연간메모', 0);
  const d = await (await cal(base, 'month=2026-08', staffCookie(1, '미가'))).json();
  assert.deepStrictEqual(d.days, {}, '자유메모가 달력에 섞임');
  server.close();
});

test('calendar: 다른 달 항목은 포함되지 않는다', async () => {
  const { db, server, base } = makeServer();
  add(db, 1, 'today', '2026-07-31', 'A', 0);
  add(db, 1, 'today', '2026-09-01', 'B', 0);
  const d = await (await cal(base, 'month=2026-08', staffCookie(1, '미가'))).json();
  assert.deepStrictEqual(d.days, {});
  server.close();
});

test('calendar: 직원은 남의 기록이 안 보인다 (staff_id를 줘도 무시)', async () => {
  const { db, server, base } = makeServer();
  add(db, 2, 'today', '2026-08-11', '바트 것', 0);
  const d = await (await cal(base, 'month=2026-08&staff_id=2', staffCookie(1, '미가'))).json();
  assert.deepStrictEqual(d.days, {});
  server.close();
});

test('calendar: 사장님이 staff_id 없이 부르면 전 직원 합산 + 작성 인원 수', async () => {
  const { db, server, base } = makeServer();
  add(db, 1, 'today', '2026-08-11', 'A', 1);
  add(db, 2, 'today', '2026-08-11', 'B', 0);
  add(db, 2, 'today', '2026-08-11', 'C', 1);
  const d = await (await cal(base, 'month=2026-08', bossCookie())).json();
  assert.strictEqual(d.days['2026-08-11'].total, 3);
  assert.strictEqual(d.days['2026-08-11'].done, 2);
  assert.strictEqual(d.days['2026-08-11'].staff, 2, '작성한 직원 수');
  assert.strictEqual(d.staffTotal, 2, '활성 직원 총원');
  server.close();
});

test('calendar: 현황판(전체)에도 사장님 본인 일정이 나온다', async () => {
  const { db, server, base } = makeServer();
  const boss = db.prepare("SELECT id FROM report_users WHERE role='boss'").get().id;
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo) VALUES (?,'month','2026-08-01','','8월 19일~20일 대회 인솔')").run(boss);
  add(db, 1, 'today', '2026-08-11', 'A', 0);
  const d = await (await cal(base, 'month=2026-08', bossCookie())).json();
  assert.strictEqual(d.days['2026-08-19']?.notes, 1, '사장님 일정이 현황판 달력에서 빠짐');
  assert.strictEqual(d.days['2026-08-20']?.notes, 1);
  server.close();
});

test('calendar: 현황판 작성 인원 수에는 사장님을 세지 않는다', async () => {
  const { db, server, base } = makeServer();
  const boss = db.prepare("SELECT id FROM report_users WHERE role='boss'").get().id;
  add(db, boss, 'today', '2026-08-11', '사장님 일', 0);
  add(db, 1, 'today', '2026-08-11', '미가 일', 0);
  const d = await (await cal(base, 'month=2026-08', bossCookie())).json();
  assert.strictEqual(d.days['2026-08-11'].staff, 1, '사장님이 직원 인원수에 포함됨');
  assert.strictEqual(d.days['2026-08-11'].total, 2, '사장님 항목이 집계에서 빠짐');
  server.close();
});

test('calendar: 사장님이 staff_id를 주면 그 직원만', async () => {
  const { db, server, base } = makeServer();
  add(db, 1, 'today', '2026-08-11', 'A', 0);
  add(db, 2, 'today', '2026-08-11', 'B', 0);
  const d = await (await cal(base, 'month=2026-08&staff_id=2', bossCookie())).json();
  assert.strictEqual(d.days['2026-08-11'].total, 1);
  server.close();
});

test('calendar: 기록 없는 달은 빈 객체', async () => {
  const { server, base } = makeServer();
  const d = await (await cal(base, 'month=2026-08', bossCookie())).json();
  assert.deepStrictEqual(d.days, {});
  server.close();
});

test('calendar: 잘못된 month 형식은 400', async () => {
  const { server, base } = makeServer();
  for (const m of ['2026-8', '202608', 'abc', '']) {
    const r = await cal(base, 'month=' + m, bossCookie());
    assert.strictEqual(r.status, 400, 'month=' + m);
  }
  server.close();
});

test('calendar: 세션 없으면 401', async () => {
  const { server, base } = makeServer();
  const r = await fetch(`${base}/calendar?month=2026-08`);
  assert.strictEqual(r.status, 401);
  server.close();
});

test('items: periods=today,tomorrow 로 하루치를 모아 받는다', async () => {
  const { db, server, base } = makeServer();
  add(db, 1, 'today', '2026-08-11', 'A', 0);
  add(db, 1, 'tomorrow', '2026-08-11', 'B', 0);
  add(db, 1, 'month', '2026-08-11', '월간메모', 0);
  const rows = await (await fetch(`${base}/items?periods=today,tomorrow&date=2026-08-11`, { headers: { cookie: staffCookie(1, '미가') } })).json();
  assert.deepStrictEqual(rows.map(r => r.title), ['A', 'B']);
  server.close();
});

test('items: 잘못된 periods 값은 400', async () => {
  const { server, base } = makeServer();
  const r = await fetch(`${base}/items?periods=today,nope&date=2026-08-11`, { headers: { cookie: staffCookie(1, '미가') } });
  assert.strictEqual(r.status, 400);
  server.close();
});

test('overview: periods=today,tomorrow 지원', async () => {
  const { db, server, base } = makeServer();
  add(db, 1, 'today', '2026-08-11', 'A', 0);
  add(db, 1, 'tomorrow', '2026-08-11', 'B', 0);
  add(db, 1, 'month', '2026-08-11', '월간메모', 0);
  const rows = await (await fetch(`${base}/overview?periods=today,tomorrow&date=2026-08-11`, { headers: { cookie: bossCookie() } })).json();
  assert.deepStrictEqual(rows[0].items.map(i => i.title), ['A', 'B']);
  server.close();
});
