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
  const ins = db.prepare("INSERT INTO report_users (name, pin_hash) VALUES (?,?)");
  ins.run('미가', bcrypt.hashSync('pw-miga', 10));
  ins.run('바트', bcrypt.hashSync('pw-bat', 10));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS }));
  const server = app.listen(0);
  return { db, server, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const staff = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const list = (base, c) => fetch(`${base}/staff`, { headers: { cookie: c || boss() } });
const add = (base, body, c) => fetch(`${base}/staff`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c || boss() }, body: JSON.stringify(body) });
const patch = (base, id, body, c) => fetch(`${base}/staff/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: c || boss() }, body: JSON.stringify(body) });
const login = (base, body) => fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('사장님은 직원 목록을 본다 (비활성 포함, 사장님 행 제외)', async () => {
  const { server, base } = makeServer();
  const rows = await (await list(base)).json();
  assert.deepStrictEqual(rows.map(r => r.name), ['미가', '바트']);
  assert.ok(!rows.some(r => r.name === '사장님'), '사장님 행이 목록에 나옴');
  assert.ok('is_active' in rows[0]);
  server.close();
});

test('직원은 관리 목록을 못 본다 (403)', async () => {
  const { server, base } = makeServer();
  const r = await list(base, staff(1, '미가'));
  assert.strictEqual(r.status, 403);
  server.close();
});

test('직원을 추가하면 그 비번으로 로그인된다', async () => {
  const { server, base } = makeServer();
  const r = await add(base, { name: '체첵', password: 'chechek1' });
  assert.strictEqual(r.status, 200);
  const lg = await login(base, { name: '체첵', password: 'chechek1' });
  assert.strictEqual(lg.status, 200);
  server.close();
});

test('추가한 직원은 로그인 이름 목록에도 나온다', async () => {
  const { server, base } = makeServer();
  await add(base, { name: '체첵', password: 'chechek1' });
  const names = (await (await fetch(`${base}/staff-list`)).json()).map(s => s.name);
  assert.ok(names.includes('체첵'));
  server.close();
});

test('같은 이름은 추가할 수 없다 (409)', async () => {
  const { server, base } = makeServer();
  const r = await add(base, { name: '미가', password: 'abcd1234' });
  assert.strictEqual(r.status, 409);
  server.close();
});

test('이름이 비었거나 비번이 짧으면 400', async () => {
  const { server, base } = makeServer();
  assert.strictEqual((await add(base, { name: '  ', password: 'abcd' })).status, 400);
  assert.strictEqual((await add(base, { name: '체첵', password: 'ab' })).status, 400);
  server.close();
});

test('직원은 추가할 수 없다 (403)', async () => {
  const { server, base } = makeServer();
  const r = await add(base, { name: '체첵', password: 'abcd1234' }, staff(1, '미가'));
  assert.strictEqual(r.status, 403);
  server.close();
});

test('퇴사 처리하면 로그인 목록에서 사라지고 로그인도 막힌다', async () => {
  const { server, base } = makeServer();
  const r = await patch(base, 2, { is_active: 0 });
  assert.strictEqual(r.status, 200);
  const names = (await (await fetch(`${base}/staff-list`)).json()).map(s => s.name);
  assert.ok(!names.includes('바트'));
  const lg = await login(base, { name: '바트', password: 'pw-bat' });
  assert.strictEqual(lg.status, 401);
  server.close();
});

test('퇴사자를 다시 복귀시킬 수 있다', async () => {
  const { server, base } = makeServer();
  await patch(base, 2, { is_active: 0 });
  await patch(base, 2, { is_active: 1 });
  const names = (await (await fetch(`${base}/staff-list`)).json()).map(s => s.name);
  assert.ok(names.includes('바트'));
  server.close();
});

test('퇴사 처리해도 그동안 쌓인 기록은 남는다', async () => {
  const { db, server, base } = makeServer();
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo) VALUES (2,'today','2026-08-11','일','')").run();
  await patch(base, 2, { is_active: 0 });
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_items WHERE staff_id=2").get().n, 1);
  server.close();
});

test('이름을 바꿀 수 있다', async () => {
  const { db, server, base } = makeServer();
  const r = await patch(base, 2, { name: '바트뭉흐' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.prepare("SELECT name FROM report_users WHERE id=2").get().name, '바트뭉흐');
  server.close();
});

test('이미 있는 이름으로는 못 바꾼다 (409)', async () => {
  const { server, base } = makeServer();
  const r = await patch(base, 2, { name: '미가' });
  assert.strictEqual(r.status, 409);
  server.close();
});

test('사장님 행은 건드릴 수 없다 (403)', async () => {
  const { db, server, base } = makeServer();
  const bossId = db.prepare("SELECT id FROM report_users WHERE role='boss'").get().id;
  assert.strictEqual((await patch(base, bossId, { is_active: 0 })).status, 403);
  assert.strictEqual((await patch(base, bossId, { name: '해킹' })).status, 403);
  server.close();
});

test('없는 직원이면 404', async () => {
  const { server, base } = makeServer();
  assert.strictEqual((await patch(base, 999, { name: 'x' })).status, 404);
  server.close();
});
