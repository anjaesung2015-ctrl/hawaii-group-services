const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');
const createAttendance = require('../attendance');

const SECRET = 'test-secret';
const BOSS = 'boss123';

function makeServer() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  const ins = db.prepare("INSERT INTO report_users (name, pin_hash) VALUES (?,?)");
  ins.run('미가', bcrypt.hashSync('x', 10));
  ins.run('바트', bcrypt.hashSync('x', 10));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  createAttendance(db, { secret: SECRET });          // 테이블 준비
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS }));
  const server = app.listen(0);
  return { db, server, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const staff = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const card = (base, qs, c) => fetch(`${base}/scorecard?${qs}`, { headers: { cookie: c || boss() } }).then(r => r);

const item = (db, sid, date, title, done, fromBoss) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo, done, from_boss) VALUES (?,'today',?,?,'',?,?)")
    .run(sid, date, title, done || 0, fromBoss || 0);
const att = (db, sid, date, cin, cout) =>
  db.prepare("INSERT INTO report_attendance (staff_id, work_date, check_in, check_out) VALUES (?,?,?,?)").run(sid, date, cin, cout);

test('종합 현황 — 할 일 완료율', async () => {
  const { db, server, base } = makeServer();
  item(db, 1, '2026-08-03', 'A', 1);
  item(db, 1, '2026-08-03', 'B', 1);
  item(db, 1, '2026-08-04', 'C', 0);
  const d = await (await card(base, 'month=2026-08')).json();
  const me = d.rows.find(r => r.name === '미가');
  assert.strictEqual(me.tasks, 3);
  assert.strictEqual(me.tasksDone, 2);
  server.close();
});

test('종합 현황 — 보고 작성일수 (같은 날 여러 건이어도 1일)', async () => {
  const { db, server, base } = makeServer();
  item(db, 1, '2026-08-03', 'A', 1);
  item(db, 1, '2026-08-03', 'B', 0);
  item(db, 1, '2026-08-05', 'C', 0);
  const d = await (await card(base, 'month=2026-08')).json();
  assert.strictEqual(d.rows.find(r => r.name === '미가').reportDays, 2);
  server.close();
});

test('종합 현황 — 사장님 지시 이행', async () => {
  const { db, server, base } = makeServer();
  item(db, 1, '2026-08-03', '지시1', 1, 1);
  item(db, 1, '2026-08-04', '지시2', 0, 1);
  item(db, 1, '2026-08-04', '내일', 1, 0);
  const d = await (await card(base, 'month=2026-08')).json();
  const me = d.rows.find(r => r.name === '미가');
  assert.strictEqual(me.assigned, 2);
  assert.strictEqual(me.assignedDone, 1);
  server.close();
});

test('종합 현황 — 근태(근무일·시간·지각)가 함께 나온다', async () => {
  const { db, server, base } = makeServer();
  att(db, 1, '2026-08-03', '09:00', '18:00');
  att(db, 1, '2026-08-04', '09:30', '18:00');
  const d = await (await card(base, 'month=2026-08')).json();
  const me = d.rows.find(r => r.name === '미가');
  assert.strictEqual(me.workDays, 2);
  assert.strictEqual(me.workMinutes, 540 + 510);
  assert.strictEqual(me.late, 1);
  server.close();
});

test('종합 현황 — 기록이 없는 직원도 0으로 나온다', async () => {
  const { server, base } = makeServer();
  const d = await (await card(base, 'month=2026-08')).json();
  assert.deepStrictEqual(d.rows.map(r => r.name), ['미가', '바트']);
  assert.strictEqual(d.rows[0].tasks, 0);
  assert.strictEqual(d.rows[0].workDays, 0);
  server.close();
});

test('종합 현황 — 다른 달은 섞이지 않는다', async () => {
  const { db, server, base } = makeServer();
  item(db, 1, '2026-07-31', 'A', 1);
  att(db, 1, '2026-07-31', '09:00', '18:00');
  const d = await (await card(base, 'month=2026-08')).json();
  const me = d.rows.find(r => r.name === '미가');
  assert.strictEqual(me.tasks, 0);
  assert.strictEqual(me.workDays, 0);
  server.close();
});

test('종합 현황 — 직원은 볼 수 없다 (403)', async () => {
  const { server, base } = makeServer();
  const r = await card(base, 'month=2026-08', staff(1, '미가'));
  assert.strictEqual(r.status, 403);
  server.close();
});

test('종합 현황 — 잘못된 월은 400', async () => {
  const { server, base } = makeServer();
  const r = await card(base, 'month=2026-8');
  assert.strictEqual(r.status, 400);
  server.close();
});

test('종합 현황 — 엑셀(CSV)로 내려받을 수 있다', async () => {
  const { db, server, base } = makeServer();
  item(db, 1, '2026-08-03', 'A', 1);
  att(db, 1, '2026-08-03', '09:00', '18:00');
  const r = await fetch(`${base}/scorecard/export?month=2026-08`, { headers: { cookie: boss() } });
  assert.strictEqual(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepStrictEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM 없음');
  assert.match(buf.toString('utf8'), /미가/);
  server.close();
});
