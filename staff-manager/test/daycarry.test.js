const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');

// 어제 '내일 할 일'로 적어둔 항목이, 그 날짜가 되면 '오늘' 탭에서 사라지던 버그.
// 오늘/내일은 같은 하루치 할 일이므로 날짜가 같으면 함께 보여야 한다.
const SECRET = 'test-secret';
const BOSS = 'boss123';
const TODAY = '2026-08-14';
const TOMORROW = '2026-08-15';

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
const get = async (base, q, c) => (await fetch(`${base}${q}`, { headers: { cookie: c } })).json();

test('어제 내일할일로 적어둔 항목이 그날 오늘 탭에 보인다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'tomorrow', TODAY, '파라솔 설치하기');   // 어제 '내일' 탭에서 적음
  put(db, 'today', TODAY, '오늘 적은 일');
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.deepStrictEqual(rows.map(r => r.title).sort(), ['오늘 적은 일', '파라솔 설치하기']);
  server.close();
});

test('내일 탭에도 그 날짜 할 일이 모두 보인다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'tomorrow', TOMORROW, '내일 적은 일');
  put(db, 'today', TOMORROW, '내일 날짜의 오늘항목');
  const rows = await get(base, `/items?period=tomorrow&date=${TOMORROW}`, staff());
  assert.strictEqual(rows.length, 2);
  server.close();
});

test('주/월/연 자유메모는 오늘 탭에 섞이지 않는다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'week', TODAY, '주간 메모');
  put(db, 'tomorrow', TODAY, '내일로 적은 일');
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.deepStrictEqual(rows.map(r => r.title), ['내일로 적은 일']);
  server.close();
});

test('다른 날짜 항목은 딸려오지 않는다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'tomorrow', TOMORROW, '진짜 내일 일');
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.deepStrictEqual(rows, []);
  server.close();
});

test('날짜 없이 조회하면 기존대로 해당 기간만 나온다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'today', TODAY, '오늘 일');
  put(db, 'tomorrow', TOMORROW, '내일 일');
  const rows = await get(base, '/items?period=today', staff());
  assert.deepStrictEqual(rows.map(r => r.title), ['오늘 일']);
  server.close();
});

test('현황판 오늘에도 어제 적어둔 내일할일이 보인다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'tomorrow', TODAY, '파라솔 설치하기');
  const rows = await get(base, `/overview?period=today&date=${TODAY}`, boss());
  const miga = rows.find(r => r.name === '미가');
  assert.deepStrictEqual(miga.items.map(i => i.title), ['파라솔 설치하기']);
  server.close();
});
