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
  const notified = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  const ins = db.prepare("INSERT INTO report_users (name, pin_hash, is_active) VALUES (?,?,?)");
  ins.run('미가', bcrypt.hashSync('x', 10), 1);
  ins.run('바트', bcrypt.hashSync('x', 10), 1);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, {
    secret: SECRET, bossPw: BOSS,
    today: () => '2000-01-01',   // 지난-날짜 잠금이 끼어들지 않게 (잠금은 pastlock.test.js 가 검증)
    notify: async (staffId, text) => { notified.push({ staffId, text }); return true; },
  }));
  const server = app.listen(0);
  return { db, server, notified, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const bossCookie = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const staffCookie = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const assign = (base, body, cookie) =>
  fetch(`${base}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });

test('사장님 지시는 그 직원의 오늘 할 일로 들어간다', async () => {
  const { db, server, base } = makeServer();
  const r = await assign(base, { staff_id: 1, title: '코트 라인 다시 긋기', date: '2026-08-11' }, bossCookie());
  assert.strictEqual(r.status, 200);
  const rows = db.prepare("SELECT * FROM report_items WHERE staff_id=1").all();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].title, '코트 라인 다시 긋기');
  assert.strictEqual(rows[0].period, 'today');
  assert.strictEqual(rows[0].item_date, '2026-08-11');
  assert.strictEqual(rows[0].from_boss, 1, '지시 표시가 안 붙음');
  server.close();
});

test('지시하면 그 직원에게 텔레그램이 간다', async () => {
  const { server, base, notified } = makeServer();
  await assign(base, { staff_id: 2, title: '창고 정리', date: '2026-08-11' }, bossCookie());
  assert.strictEqual(notified.length, 1);
  assert.strictEqual(notified[0].staffId, 2);
  assert.match(notified[0].text, /창고 정리/);
  server.close();
});

test('알림을 못 보내도 지시 자체는 저장된다', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  db.prepare("INSERT INTO report_users (name, pin_hash, is_active) VALUES ('미가','x',1)").run();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, {
    secret: SECRET, bossPw: BOSS,
    notify: async () => { throw new Error('chat_id 없음'); },
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/report`;
  const r = await assign(base, { staff_id: 1, title: '창고 정리', date: '2026-08-11' }, bossCookie());
  const body = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(body.notified, false, '알림 실패가 보고되지 않음');
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_items").get().n, 1);
  server.close();
});

test('직원은 지시를 내릴 수 없다 (403)', async () => {
  const { server, base } = makeServer();
  const r = await assign(base, { staff_id: 2, title: '남한테 시키기', date: '2026-08-11' }, staffCookie(1, '미가'));
  assert.strictEqual(r.status, 403);
  server.close();
});

test('내용이 비면 400', async () => {
  const { server, base } = makeServer();
  const r = await assign(base, { staff_id: 1, title: '   ', date: '2026-08-11' }, bossCookie());
  assert.strictEqual(r.status, 400);
  server.close();
});

test('없는 직원이면 404', async () => {
  const { server, base } = makeServer();
  const r = await assign(base, { staff_id: 999, title: '일', date: '2026-08-11' }, bossCookie());
  assert.strictEqual(r.status, 404);
  server.close();
});

test('날짜를 안 주면 오늘 날짜로 들어간다', async () => {
  const { db, server, base } = makeServer();
  await assign(base, { staff_id: 1, title: '일' }, bossCookie());
  const row = db.prepare("SELECT item_date FROM report_items WHERE staff_id=1").get();
  assert.match(row.item_date, /^\d{4}-\d{2}-\d{2}$/);
  server.close();
});

test('잘못된 날짜 형식은 400', async () => {
  const { server, base } = makeServer();
  const r = await assign(base, { staff_id: 1, title: '일', date: '2026-8-1' }, bossCookie());
  assert.strictEqual(r.status, 400);
  server.close();
});

test('직원이 자기 목록에서 지시를 보고 완료 체크할 수 있다', async () => {
  const { db, server, base } = makeServer();
  await assign(base, { staff_id: 1, title: '코트 청소', date: '2026-08-11' }, bossCookie());
  const c = staffCookie(1, '미가');
  const items = await (await fetch(`${base}/items?period=today&date=2026-08-11`, { headers: { cookie: c } })).json();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].from_boss, 1);
  const patch = await fetch(`${base}/items/${items[0].id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify({ done: 1 }),
  });
  assert.strictEqual(patch.status, 200);
  assert.strictEqual(db.prepare("SELECT done FROM report_items WHERE id=?").get(items[0].id).done, 1);
  server.close();
});

test('직원은 받은 지시를 지울 수 없다', async () => {
  const { server, base } = makeServer();
  await assign(base, { staff_id: 1, title: '코트 청소', date: '2026-08-11' }, bossCookie());
  const c = staffCookie(1, '미가');
  const items = await (await fetch(`${base}/items?period=today&date=2026-08-11`, { headers: { cookie: c } })).json();
  const del = await fetch(`${base}/items/${items[0].id}`, { method: 'DELETE', headers: { cookie: c } });
  assert.strictEqual(del.status, 403);
  server.close();
});

test('사장님은 자기가 내린 지시를 지울 수 있다', async () => {
  const { server, base } = makeServer();
  await assign(base, { staff_id: 1, title: '코트 청소', date: '2026-08-11' }, bossCookie());
  const items = await (await fetch(`${base}/items?period=today&date=2026-08-11&staff_id=1`, { headers: { cookie: bossCookie() } })).json();
  const del = await fetch(`${base}/items/${items[0].id}`, { method: 'DELETE', headers: { cookie: bossCookie() } });
  assert.strictEqual(del.status, 200);
  server.close();
});
