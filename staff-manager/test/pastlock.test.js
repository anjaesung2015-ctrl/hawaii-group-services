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
const TODAY = '2026-08-12';
const YESTERDAY = '2026-08-11';
const TOMORROW = '2026-08-13';

function makeServer() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('미가',?)").run(bcrypt.hashSync('x', 10));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS, today: () => TODAY }));
  const server = app.listen(0);
  return { db, server, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const staff = () => 'report_sess=' + jwt.sign({ staff_id: 1, name: '미가', isBoss: false }, SECRET, { expiresIn: '1d' });
const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });

const put = (db, period, date, title) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo) VALUES (1,?,?,?,'')").run(period, date, title).lastInsertRowid;
const addItem = (base, body, c) =>
  fetch(`${base}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify(body) });
const patchItem = (base, id, body, c) =>
  fetch(`${base}/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify(body) });
const delItem = (base, id, c) => fetch(`${base}/items/${id}`, { method: 'DELETE', headers: { cookie: c } });

test('직원은 지난 날짜에 항목을 추가할 수 없다', async () => {
  const { server, base } = makeServer();
  const r = await addItem(base, { period: 'today', item_date: YESTERDAY, title: '뒤늦게' }, staff());
  assert.strictEqual(r.status, 403);
  server.close();
});

test('직원은 지난 날짜 항목을 수정할 수 없다', async () => {
  const { db, server, base } = makeServer();
  const id = put(db, 'today', YESTERDAY, '어제 일');
  const r = await patchItem(base, id, { done: 1 }, staff());
  assert.strictEqual(r.status, 403);
  server.close();
});

test('직원은 지난 날짜 항목을 지울 수 없다', async () => {
  const { db, server, base } = makeServer();
  const id = put(db, 'today', YESTERDAY, '어제 일');
  const r = await delItem(base, id, staff());
  assert.strictEqual(r.status, 403);
  server.close();
});

test('직원은 오늘 항목은 그대로 고칠 수 있다', async () => {
  const { db, server, base } = makeServer();
  const id = put(db, 'today', TODAY, '오늘 일');
  assert.strictEqual((await patchItem(base, id, { done: 1 }, staff())).status, 200);
  assert.strictEqual((await addItem(base, { period: 'today', item_date: TODAY, title: '새 일' }, staff())).status, 200);
  server.close();
});

test('직원은 내일 것도 미리 적을 수 있다', async () => {
  const { db, server, base } = makeServer();
  const id = put(db, 'tomorrow', TOMORROW, '내일 일');
  assert.strictEqual((await patchItem(base, id, { title: '수정' }, staff())).status, 200);
  assert.strictEqual((await addItem(base, { period: 'tomorrow', item_date: TOMORROW, title: '추가' }, staff())).status, 200);
  server.close();
});

test('주간·월간·연간 자유메모는 기준일이 지났어도 잠기지 않는다', async () => {
  const { db, server, base } = makeServer();
  const w = put(db, 'week', '2026-08-10', '');
  const m = put(db, 'month', '2026-08-01', '');
  const y = put(db, 'year', '2026-01-01', '');
  for (const id of [w, m, y]) {
    assert.strictEqual((await patchItem(base, id, { memo: '갱신' }, staff())).status, 200, 'id=' + id);
  }
  assert.strictEqual((await addItem(base, { period: 'month', item_date: '2026-08-01', memo: 'x' }, staff())).status, 200);
  server.close();
});

test('사장님은 지난 날짜를 고칠 수 있다', async () => {
  const { db, server, base } = makeServer();
  const id = put(db, 'today', YESTERDAY, '어제 일');
  assert.strictEqual((await patchItem(base, id, { done: 1, staff_id: 1 }, boss())).status, 200);
  assert.strictEqual((await addItem(base, { period: 'today', item_date: YESTERDAY, title: '보충', staff_id: 1 }, boss())).status, 200);
  assert.strictEqual((await delItem(base, id, boss())).status, 200);
  server.close();
});

test('사장님은 지난 날짜로 지시를 내릴 수 있다', async () => {
  const { server, base } = makeServer();
  const r = await fetch(`${base}/assign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: boss() },
    body: JSON.stringify({ staff_id: 1, title: '어제 몫', date: YESTERDAY }),
  });
  assert.strictEqual(r.status, 200);
  server.close();
});
