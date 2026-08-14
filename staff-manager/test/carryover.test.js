const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');
const createAlarm = require('../alarm');

// 못 끝낸 할 일은 완료 체크할 때까지 오늘 탭에 계속 따라온다 (이월).
// 원래 날짜는 건드리지 않는다 — 지난 기록은 그대로 남아야 하니까.
const SECRET = 'test-secret';
const BOSS = 'boss123';
const TODAY = '2026-08-14';
const YESTERDAY = '2026-08-13';
const OLD = '2026-08-01';
const TOMORROW = '2026-08-15';

function makeServer() {
  const sent = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('미가',?)").run(bcrypt.hashSync('x', 10));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS, today: () => TODAY }));
  const alarm = createAlarm(db, { secret: SECRET, send: async (chat, text) => { sent.push({ chat, text }); return true; } });
  const server = app.listen(0);
  return { db, server, alarm, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const staff = () => 'report_sess=' + jwt.sign({ staff_id: 1, name: '미가', isBoss: false }, SECRET, { expiresIn: '1d' });
const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });

const put = (db, period, date, title, done, memo) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo, done) VALUES (1,?,?,?,?,?)")
    .run(period, date, title, memo || '', done || 0).lastInsertRowid;
const get = async (base, q, c) => (await fetch(`${base}${q}`, { headers: { cookie: c } })).json();
const patchItem = (base, id, body, c) =>
  fetch(`${base}/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify(body) });

test('어제 못 끝낸 할 일이 오늘 탭에 따라온다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'today', YESTERDAY, '파라솔 설치하기');
  put(db, 'today', TODAY, '오늘 일');
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.deepStrictEqual(rows.map(r => r.title), ['파라솔 설치하기', '오늘 일']);   // 이월이 위에
  assert.strictEqual(rows[0].item_date, YESTERDAY, '원래 날짜는 그대로 둔다');
  server.close();
});

test('내일할일로 적어둔 것도 못 끝내면 따라온다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'tomorrow', YESTERDAY, '리모콘 찾아보기');
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.deepStrictEqual(rows.map(r => r.title), ['리모콘 찾아보기']);
  server.close();
});

test('완료한 지난 할 일은 따라오지 않는다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'today', YESTERDAY, '끝낸 일', 1);
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.deepStrictEqual(rows, []);
  server.close();
});

test('제목·메모가 모두 빈 항목은 따라오지 않는다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'today', YESTERDAY, '');
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.deepStrictEqual(rows, []);
  server.close();
});

test('지난 주·월·연 자유메모는 따라오지 않는다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'week', YESTERDAY, '', 0, '주간 메모');
  put(db, 'month', OLD, '', 0, '월간 메모');
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.deepStrictEqual(rows, []);
  server.close();
});

test('오래된 것도 못 끝냈으면 날짜 순으로 따라온다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'today', YESTERDAY, '어제 일');
  put(db, 'today', OLD, '8월1일 일');
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.deepStrictEqual(rows.map(r => r.title), ['8월1일 일', '어제 일']);
  server.close();
});

test('같은 항목이 두 번 나오지 않는다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'today', TODAY, '오늘 일');
  const rows = await get(base, `/items?period=today&date=${TODAY}`, staff());
  assert.strictEqual(rows.length, 1);
  server.close();
});

test('내일 탭에는 이월이 붙지 않는다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'today', YESTERDAY, '어제 못한 일');
  const rows = await get(base, `/items?period=tomorrow&date=${TOMORROW}`, staff());
  assert.deepStrictEqual(rows, []);
  server.close();
});

test('지난 날짜를 넘겨볼 때는 이월이 섞이지 않는다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'today', OLD, '8월1일 일');
  put(db, 'today', YESTERDAY, '어제 일');
  const rows = await get(base, `/items?period=today&date=${YESTERDAY}`, staff());
  assert.deepStrictEqual(rows.map(r => r.title), ['어제 일']);
  server.close();
});

test('현황판 오늘에도 직원 이월이 원래 날짜와 함께 보인다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'tomorrow', YESTERDAY, '파라솔 설치하기');
  put(db, 'today', TODAY, '오늘 일');
  const rows = await get(base, `/overview?period=today&date=${TODAY}`, boss());
  const miga = rows.find(r => r.name === '미가');
  assert.deepStrictEqual(miga.items.map(i => i.title), ['파라솔 설치하기', '오늘 일']);
  assert.strictEqual(miga.items[0].item_date, YESTERDAY);
  server.close();
});

test('현황판에서 지난 날짜를 볼 때는 이월이 섞이지 않는다', async () => {
  const { db, server, base } = makeServer();
  put(db, 'today', OLD, '8월1일 일');
  put(db, 'today', YESTERDAY, '어제 일');
  const rows = await get(base, `/overview?period=today&date=${YESTERDAY}`, boss());
  const miga = rows.find(r => r.name === '미가');
  assert.deepStrictEqual(miga.items.map(i => i.title), ['어제 일']);
  server.close();
});

test('직원이 이월된 지난 할 일을 완료 체크할 수 있다', async () => {
  const { db, server, base } = makeServer();
  const id = put(db, 'today', YESTERDAY, '어제 못한 일');
  const r = await patchItem(base, id, { done: 1 }, staff());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.prepare('SELECT done FROM report_items WHERE id=?').get(id).done, 1);
  server.close();
});

test('완료 체크해도 원래 날짜는 그대로다', async () => {
  const { db, server, base } = makeServer();
  const id = put(db, 'today', YESTERDAY, '어제 못한 일');
  await patchItem(base, id, { done: 1 }, staff());
  assert.strictEqual(db.prepare('SELECT item_date FROM report_items WHERE id=?').get(id).item_date, YESTERDAY);
  server.close();
});

test('직원은 지난 할 일의 제목·메모는 여전히 못 고친다', async () => {
  const { db, server, base } = makeServer();
  const id = put(db, 'today', YESTERDAY, '어제 일');
  assert.strictEqual((await patchItem(base, id, { title: '몰래 수정' }, staff())).status, 403);
  assert.strictEqual((await patchItem(base, id, { done: 1, title: '같이 수정' }, staff())).status, 403);
  server.close();
});

test('아침 알람에도 이월된 할 일이 들어간다', async () => {
  const { db, server, alarm } = makeServer();
  put(db, 'today', YESTERDAY, '파라솔 설치하기');
  const msg = alarm.buildMessage(1, '미가', TODAY);
  assert.match(msg, /파라솔 설치하기/);
  assert.match(msg, /8\/13/, '언제 적은 것인지 날짜가 붙는다');
  server.close();
});
