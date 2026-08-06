const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
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

function cookieOf(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/report_sess=([^;]+)/);
  return m ? `report_sess=${m[1]}` : '';
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

module.exports = { makeServer, cookieOf, SECRET, BOSS };
