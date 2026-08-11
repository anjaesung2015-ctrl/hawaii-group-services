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
  ins.run('미가', bcrypt.hashSync('pw-miga', 10), 1);
  ins.run('바트', bcrypt.hashSync('pw-bat', 10), 1);
  ins.run('비활성', bcrypt.hashSync('pw-x', 10), 0);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS, today: () => '2000-01-01' }));
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
function login(base, body) {
  return fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('staff-list는 활성 report_users만 반환', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/staff-list`);
  const list = await res.json();
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(list.map(s => s.name).sort(), ['미가', '바트']);
  server.close();
});

test('올바른 이름+비번 로그인 → report_sess 발급', async () => {
  const { server, base } = makeServer();
  const res = await login(base, { name: '미가', password: 'pw-miga' });
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.isBoss, false);
  assert.strictEqual(body.name, '미가');
  assert.match(res.headers.get('set-cookie') || '', /report_sess=/);
  server.close();
});

test('비번 틀리면 → 401', async () => {
  const { server, base } = makeServer();
  const res = await login(base, { name: '미가', password: 'wrong' });
  assert.strictEqual(res.status, 401);
  server.close();
});

test('없는 이름 → 401', async () => {
  const { server, base } = makeServer();
  const res = await login(base, { name: '없는사람', password: 'x' });
  assert.strictEqual(res.status, 401);
  server.close();
});

test('비활성 사용자 → 401', async () => {
  const { server, base } = makeServer();
  const res = await login(base, { name: '비활성', password: 'pw-x' });
  assert.strictEqual(res.status, 401);
  server.close();
});

test('사장님 비번 로그인 성공 → isBoss true', async () => {
  const { server, base } = makeServer();
  const res = await login(base, { boss_pw: BOSS });
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.isBoss, true);
  server.close();
});

test('사장님 비번 틀림 → 401', async () => {
  const { server, base } = makeServer();
  const res = await login(base, { boss_pw: 'wrong' });
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
  const post = await fetch(`${base}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ period: 'today', item_date: '2026-08-06', title: '코트 청소', memo: '' }) });
  assert.strictEqual(post.status, 200);
  const get = await fetch(`${base}/items?period=today&date=2026-08-06`, { headers: { cookie } });
  const items = await get.json();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, '코트 청소');
  assert.strictEqual(items[0].staff_id, 1);
  server.close();
});

test('직원: done 토글 PATCH', async () => {
  const { server, base } = makeServer();
  const cookie = staffCookie(1, '미가');
  const post = await fetch(`${base}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ period: 'today', item_date: '2026-08-06', title: '레슨' }) });
  const { id } = await post.json();
  const patch = await fetch(`${base}/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ done: true }) });
  assert.strictEqual(patch.status, 200);
  const get = await fetch(`${base}/items?period=today&date=2026-08-06`, { headers: { cookie } });
  const items = await get.json();
  assert.strictEqual(items[0].done, 1);
  server.close();
});

test('직원은 남의 항목 수정 불가 403', async () => {
  const { server, base } = makeServer();
  const post = await fetch(`${base}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: staffCookie(1, '미가') }, body: JSON.stringify({ period: 'today', item_date: '2026-08-06', title: '내꺼' }) });
  const { id } = await post.json();
  const patch = await fetch(`${base}/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: staffCookie(2, '바트') }, body: JSON.stringify({ done: true }) });
  assert.strictEqual(patch.status, 403);
  server.close();
});

test('사장님은 특정 직원 항목 조회 가능', async () => {
  const { server, base } = makeServer();
  await fetch(`${base}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: staffCookie(1, '미가') }, body: JSON.stringify({ period: 'today', item_date: '2026-08-06', title: '미가일' }) });
  const get = await fetch(`${base}/items?staff_id=1&period=today&date=2026-08-06`, { headers: { cookie: bossCookie() } });
  const items = await get.json();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, '미가일');
  server.close();
});

test('잘못된 period → 400', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: staffCookie(1, '미가') }, body: JSON.stringify({ period: 'decade', item_date: '2026-08-06', title: 'x' }) });
  assert.strictEqual(res.status, 400);
  server.close();
});

test('직원: 항목 삭제', async () => {
  const { server, base } = makeServer();
  const cookie = staffCookie(1, '미가');
  const post = await fetch(`${base}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ period: 'week', item_date: '2026-08-03', memo: '주간목표' }) });
  const { id } = await post.json();
  const del = await fetch(`${base}/items/${id}`, { method: 'DELETE', headers: { cookie } });
  assert.strictEqual(del.status, 200);
  const get = await fetch(`${base}/items?period=week&date=2026-08-03`, { headers: { cookie } });
  assert.strictEqual((await get.json()).length, 0);
  server.close();
});

test('직원은 남의 항목 삭제 불가 403', async () => {
  const { server, base } = makeServer();
  const post = await fetch(`${base}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: staffCookie(1, '미가') }, body: JSON.stringify({ period: 'today', item_date: '2026-08-06', title: '내꺼' }) });
  const { id } = await post.json();
  const del = await fetch(`${base}/items/${id}`, { method: 'DELETE', headers: { cookie: staffCookie(2, '바트') } });
  assert.strictEqual(del.status, 403);
  server.close();
});

test('change-password: 현재 비번 맞으면 변경되고 새 비번으로 로그인 가능', async () => {
  const { server, base } = makeServer();
  const c = await login(base, { name: '미가', password: 'pw-miga' });
  const cookie = (c.headers.get('set-cookie') || '').match(/report_sess=[^;]+/)[0];
  const chg = await fetch(`${base}/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ current: 'pw-miga', new_password: 'newpass1' }) });
  assert.strictEqual(chg.status, 200);
  const relog = await login(base, { name: '미가', password: 'newpass1' });
  assert.strictEqual(relog.status, 200);
  const oldlog = await login(base, { name: '미가', password: 'pw-miga' });
  assert.strictEqual(oldlog.status, 401);
  server.close();
});

test('change-password: 현재 비번 틀리면 401', async () => {
  const { server, base } = makeServer();
  const c = await login(base, { name: '미가', password: 'pw-miga' });
  const cookie = (c.headers.get('set-cookie') || '').match(/report_sess=[^;]+/)[0];
  const chg = await fetch(`${base}/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ current: 'wrong', new_password: 'newpass1' }) });
  assert.strictEqual(chg.status, 401);
  server.close();
});

test('change-password: 세션 없으면 401', async () => {
  const { server, base } = makeServer();
  const chg = await fetch(`${base}/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: 'pw-miga', new_password: 'newpass1' }) });
  assert.strictEqual(chg.status, 401);
  server.close();
});

test('reset-password: 사장님이 리셋하면 새 비번으로 로그인 가능', async () => {
  const { server, base } = makeServer();
  const reset = await fetch(`${base}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: bossCookie() }, body: JSON.stringify({ staff_id: 2, new_password: 'batnew1' }) });
  assert.strictEqual(reset.status, 200);
  const relog = await login(base, { name: '바트', password: 'batnew1' });
  assert.strictEqual(relog.status, 200);
  server.close();
});

test('reset-password: 일반 직원은 403', async () => {
  const { server, base } = makeServer();
  const reset = await fetch(`${base}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: staffCookie(1, '미가') }, body: JSON.stringify({ staff_id: 2, new_password: 'batnew1' }) });
  assert.strictEqual(reset.status, 403);
  server.close();
});

function bossId(db) { return db.prepare("SELECT id FROM report_users WHERE role='boss'").get().id; }

test('staff-list에 사장님 행은 포함되지 않는다', async () => {
  const { server, base } = makeServer();
  const list = await (await fetch(`${base}/staff-list`)).json();
  assert.ok(!list.some(s => s.name === '사장님'), '사장님이 직원 목록에 노출됨');
  server.close();
});

test('사장님 로그인 응답에 본인 업무공간 my_id가 담긴다', async () => {
  const { db, server, base } = makeServer();
  const res = await login(base, { boss_pw: BOSS });
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.isBoss, true);
  assert.strictEqual(body.my_id, bossId(db));
  server.close();
});

test('사장님은 본인 업무공간에 항목을 만들고 조회할 수 있다', async () => {
  const { db, server, base } = makeServer();
  const c = await login(base, { boss_pw: BOSS });
  const cookie = (c.headers.get('set-cookie') || '').match(/report_sess=[^;]+/)[0];
  const mine = bossId(db);
  const add = await fetch(`${base}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ period: 'today', item_date: '2026-08-11', title: '은행 미팅', staff_id: mine }) });
  assert.strictEqual(add.status, 200);
  const list = await (await fetch(`${base}/items?period=today&date=2026-08-11&staff_id=${mine}`, { headers: { cookie } })).json();
  assert.deepStrictEqual(list.map(i => i.title), ['은행 미팅']);
  server.close();
});

test('직원은 사장님 항목을 조회·수정할 수 없다', async () => {
  const { db, server, base } = makeServer();
  const mine = bossId(db);
  const r = db.prepare("INSERT INTO report_items (staff_id, period, item_date, title) VALUES (?,?,?,?)").run(mine, 'today', '2026-08-11', '사장님 비밀 업무');
  const cookie = staffCookie(1, '미가');
  const list = await (await fetch(`${base}/items?period=today&date=2026-08-11&staff_id=${mine}`, { headers: { cookie } })).json();
  assert.deepStrictEqual(list, [], '직원이 사장님 항목을 조회함');
  const patch = await fetch(`${base}/items/${r.lastInsertRowid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ done: 1 }) });
  assert.strictEqual(patch.status, 403);
  server.close();
});

test('reset-password 대상이 사장님 행이면 403', async () => {
  const { db, server, base } = makeServer();
  const reset = await fetch(`${base}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: bossCookie() }, body: JSON.stringify({ staff_id: bossId(db), new_password: 'hack1234' }) });
  assert.strictEqual(reset.status, 403);
  server.close();
});

test('me: 세션 없으면 401', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/me`);
  assert.strictEqual(res.status, 401);
  server.close();
});

test('me: 직원 세션이면 본인 정보 반환', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/me`, { headers: { cookie: staffCookie(1, '미가') } });
  const d = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(d.isBoss, false);
  assert.strictEqual(d.staff_id, 1);
  assert.strictEqual(d.name, '미가');
  server.close();
});

test('me: 사장님 세션이면 my_id 반환', async () => {
  const { db, server, base } = makeServer();
  const res = await fetch(`${base}/me`, { headers: { cookie: bossCookie() } });
  const d = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(d.isBoss, true);
  assert.strictEqual(d.my_id, bossId(db));
  server.close();
});

test('me: 만료·위조 토큰이면 401', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/me`, { headers: { cookie: 'report_sess=not-a-real-token' } });
  assert.strictEqual(res.status, 401);
  server.close();
});

function addItem(db, staff_id, date, title, done, period) {
  return db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, done) VALUES (?,?,?,?,?)")
    .run(staff_id, period || 'today', date, title, done || 0).lastInsertRowid;
}

test('overview: 활성 직원 전원 반환, 항목 0건 직원도 포함', async () => {
  const { db, server, base } = makeServer();
  addItem(db, 1, '2026-08-11', '코트 청소', 1);
  const rows = await (await fetch(`${base}/overview?period=today&date=2026-08-11`, { headers: { cookie: bossCookie() } })).json();
  assert.deepStrictEqual(rows.map(r => r.name), ['미가', '바트']);
  assert.deepStrictEqual(rows.find(r => r.name === '바트').items, []);
  server.close();
});

test('overview: 사장님 행은 포함되지 않는다', async () => {
  const { db, server, base } = makeServer();
  addItem(db, bossId(db), '2026-08-11', '사장님 개인 업무', 0);
  const rows = await (await fetch(`${base}/overview?period=today&date=2026-08-11`, { headers: { cookie: bossCookie() } })).json();
  assert.ok(!rows.some(r => r.name === '사장님'));
  server.close();
});

test('overview: 항목이 사람별로 정확히 묶인다', async () => {
  const { db, server, base } = makeServer();
  addItem(db, 1, '2026-08-11', '미가-A', 1);
  addItem(db, 1, '2026-08-11', '미가-B', 0);
  addItem(db, 2, '2026-08-11', '바트-A', 0);
  addItem(db, 1, '2026-08-12', '다른날', 0);
  const rows = await (await fetch(`${base}/overview?period=today&date=2026-08-11`, { headers: { cookie: bossCookie() } })).json();
  const miga = rows.find(r => r.name === '미가');
  assert.deepStrictEqual(miga.items.map(i => i.title), ['미가-A', '미가-B']);
  assert.strictEqual(miga.items.filter(i => i.done).length, 1);
  assert.deepStrictEqual(rows.find(r => r.name === '바트').items.map(i => i.title), ['바트-A']);
  server.close();
});

test('overview: 직원 세션은 403', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/overview?period=today&date=2026-08-11`, { headers: { cookie: staffCookie(1, '미가') } });
  assert.strictEqual(res.status, 403);
  server.close();
});

test('overview: 잘못된 period는 400', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/overview?period=nope&date=2026-08-11`, { headers: { cookie: bossCookie() } });
  assert.strictEqual(res.status, 400);
  server.close();
});

module.exports = { makeServer, staffCookie, bossCookie, SECRET, BOSS };
