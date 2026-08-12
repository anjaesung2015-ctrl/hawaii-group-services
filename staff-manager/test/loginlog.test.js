// 로그인 실패를 로그로 남기는지 확인한다.
// 목적은 "누가 못 들어오는지" 사후에 알아내는 것 — nginx 로그엔 이름이 안 남는다.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');

const SECRET = 'test-secret';
const BOSS = 'boss123';

function makeServer() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  const ins = db.prepare("INSERT INTO report_users (name, pin_hash, is_active) VALUES (?,?,?)");
  ins.run('미가', bcrypt.hashSync('pw-miga', 10), 1);
  ins.run('비활성', bcrypt.hashSync('pw-x', 10), 0);
  const logs = [];
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, {
    secret: SECRET, bossPw: BOSS, today: () => '2000-01-01',
    log: (line) => logs.push(line),
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/report`;
  return { server, base, logs };
}

function login(base, body, headers = {}) {
  return fetch(`${base}/login`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify(body),
  });
}

// 실패해도 서버를 반드시 닫는다 (안 닫으면 node --test 가 그대로 멈춘다)
function withServer(fn) {
  return async () => {
    const ctx = makeServer();
    try { await fn(ctx); } finally { ctx.server.close(); }
  };
}

test('비번이 틀리면 이름과 사유가 로그에 남는다', withServer(async ({ base, logs }) => {
  await login(base, { name: '미가', password: 'wrong' });
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /\[login\] 실패/);
  assert.match(logs[0], /미가/);
  assert.match(logs[0], /bad_password/);
}));

test('없는 이름은 unknown_name 으로 남는다', withServer(async ({ base, logs }) => {
  await login(base, { name: '없는사람', password: 'x' });
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /unknown_name/);
  assert.match(logs[0], /없는사람/);
}));

test('퇴사(비활성) 직원도 unknown_name 으로 남는다', withServer(async ({ base, logs }) => {
  await login(base, { name: '비활성', password: 'pw-x' });
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /unknown_name/);
  assert.match(logs[0], /비활성/);
}));

test('사장님 비번 실패는 boss_password 로 남는다', withServer(async ({ base, logs }) => {
  await login(base, { boss_pw: 'wrong' });
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /boss_password/);
}));

test('로그인 성공하면 아무 로그도 남지 않는다', withServer(async ({ base, logs }) => {
  const a = await login(base, { name: '미가', password: 'pw-miga' });
  const b = await login(base, { boss_pw: BOSS });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.deepStrictEqual(logs, []);
}));

test('X-Forwarded-For 의 맨 앞 IP(진짜 직원 IP)를 남긴다', withServer(async ({ base, logs }) => {
  await login(base, { name: '미가', password: 'wrong' }, { 'X-Forwarded-For': '202.9.41.96, 10.0.0.1' });
  assert.match(logs[0], /ip=202\.9\.41\.96/);
}));

// nginx 가 X-Real-IP 를 $remote_addr 로 덮어쓰므로 이쪽이 위조에 강하다
test('X-Real-IP 가 있으면 위조된 X-Forwarded-For 보다 우선한다', withServer(async ({ base, logs }) => {
  await login(base, { name: '미가', password: 'wrong' }, {
    'X-Real-IP': '203.0.113.7',
    'X-Forwarded-For': '1.2.3.4',
  });
  assert.match(logs[0], /ip=203\.0\.113\.7/);
}));

test('입력한 비밀번호는 절대 로그에 남기지 않는다', withServer(async ({ base, logs }) => {
  await login(base, { name: '미가', password: 'SuperSecret123' });
  await login(base, { boss_pw: 'BossSecret456' });
  assert.strictEqual(logs.join('\n').includes('SuperSecret123'), false);
  assert.strictEqual(logs.join('\n').includes('BossSecret456'), false);
}));

test('로그 줄에 몽골 시간대 시각이 들어간다', withServer(async ({ base, logs }) => {
  await login(base, { name: '미가', password: 'wrong' });
  assert.match(logs[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /);
}));
