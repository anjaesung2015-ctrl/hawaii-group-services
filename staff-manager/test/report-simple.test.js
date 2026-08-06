const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const createReportRoutes = require('../report-simple');

const SECRET = 'test-secret';
const BOSS = 'boss123';

function makeServer() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE staff (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1)`);
  db.prepare("INSERT INTO staff (name, role) VALUES ('미가','총매니저'),('바트','매니저'),('코치김','코치'),('직원박','직원')").run();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/report`;
  return { db, server, base };
}

function staffCookie(staff_id, name) {
  return 'report_sess=' + jwt.sign({ staff_id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
}
function bossCookie() {
  return 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
}

test('staff-list는 매니저/총매니저/코치만 반환(일반직원 제외)', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/staff-list`);
  const list = await res.json();
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(list.map(s => s.name).sort(), ['미가','바트','코치김']);
  server.close();
});

test('직원 이름 로그인 성공 → report_sess 쿠키 발급', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:'미가' }) });
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.isBoss, false);
  assert.strictEqual(body.name, '미가');
  assert.match(res.headers.get('set-cookie') || '', /report_sess=/);
  server.close();
});

test('없는 직원 로그인 → 401', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:'없는사람' }) });
  assert.strictEqual(res.status, 401);
  server.close();
});

test('일반직원 이름 로그인 → 401 (매니저/코치 아님)', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:'직원박' }) });
  assert.strictEqual(res.status, 401);
  server.close();
});

test('사장님 비번 로그인 성공 → isBoss true', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ boss_pw: BOSS }) });
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.isBoss, true);
  server.close();
});

test('사장님 비번 틀림 → 401', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ boss_pw: 'wrong' }) });
  assert.strictEqual(res.status, 401);
  server.close();
});

test('세션 없으면 items 조회 401', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/items?period=today&date=2026-08-06`);
  assert.strictEqual(res.status, 401);
  server.close();
});

test('직원: 항목 추가 후 조회하면 나온다', async () => {
  const { server, base } = makeServer();
  const cookie = staffCookie(1, '미가');
  const post = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie}, body: JSON.stringify({ period:'today', item_date:'2026-08-06', title:'코트 청소', memo:'' }) });
  assert.strictEqual(post.status, 200);
  const get = await fetch(`${base}/items?period=today&date=2026-08-06`, { headers:{ cookie } });
  const items = await get.json();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, '코트 청소');
  assert.strictEqual(items[0].staff_id, 1);
  server.close();
});

test('직원: done 토글 PATCH', async () => {
  const { server, base } = makeServer();
  const cookie = staffCookie(1, '미가');
  const post = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie}, body: JSON.stringify({ period:'today', item_date:'2026-08-06', title:'레슨' }) });
  const { id } = await post.json();
  const patch = await fetch(`${base}/items/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json', cookie}, body: JSON.stringify({ done: true }) });
  assert.strictEqual(patch.status, 200);
  const get = await fetch(`${base}/items?period=today&date=2026-08-06`, { headers:{ cookie } });
  const items = await get.json();
  assert.strictEqual(items[0].done, 1);
  server.close();
});

test('직원은 남의 항목 수정 불가 403', async () => {
  const { server, base } = makeServer();
  const post = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie: staffCookie(1,'미가')}, body: JSON.stringify({ period:'today', item_date:'2026-08-06', title:'내꺼' }) });
  const { id } = await post.json();
  const patch = await fetch(`${base}/items/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json', cookie: staffCookie(2,'바트')}, body: JSON.stringify({ done: true }) });
  assert.strictEqual(patch.status, 403);
  server.close();
});

test('사장님은 특정 직원 항목 조회 가능', async () => {
  const { server, base } = makeServer();
  await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie: staffCookie(1,'미가')}, body: JSON.stringify({ period:'today', item_date:'2026-08-06', title:'미가일' }) });
  const get = await fetch(`${base}/items?staff_id=1&period=today&date=2026-08-06`, { headers:{ cookie: bossCookie() } });
  const items = await get.json();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, '미가일');
  server.close();
});

test('잘못된 period → 400', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie: staffCookie(1,'미가')}, body: JSON.stringify({ period:'decade', item_date:'2026-08-06', title:'x' }) });
  assert.strictEqual(res.status, 400);
  server.close();
});

test('직원: 항목 삭제', async () => {
  const { server, base } = makeServer();
  const cookie = staffCookie(1, '미가');
  const post = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie}, body: JSON.stringify({ period:'week', item_date:'2026-08-03', memo:'주간목표' }) });
  const { id } = await post.json();
  const del = await fetch(`${base}/items/${id}`, { method:'DELETE', headers:{ cookie } });
  assert.strictEqual(del.status, 200);
  const get = await fetch(`${base}/items?period=week&date=2026-08-03`, { headers:{ cookie } });
  assert.strictEqual((await get.json()).length, 0);
  server.close();
});

test("직원은 남의 항목 삭제 불가 403", async () => {
  const { server, base } = makeServer();
  const post = await fetch(`${base}/items`, { method:"POST", headers:{"Content-Type":"application/json", cookie: staffCookie(1,"미가")}, body: JSON.stringify({ period:"today", item_date:"2026-08-06", title:"내꺼" }) });
  const { id } = await post.json();
  const del = await fetch(`${base}/items/${id}`, { method:"DELETE", headers:{ cookie: staffCookie(2,"바트") } });
  assert.strictEqual(del.status, 403);
  server.close();
});

module.exports = { makeServer, staffCookie, bossCookie, SECRET, BOSS };
