const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');
const createAlarm = require('../alarm');

const SECRET = 'test-secret';
const BOSS = 'boss123';

function makeServer() {
  const sent = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  const ins = db.prepare("INSERT INTO report_users (name, pin_hash, is_active) VALUES (?,?,?)");
  ins.run('미가', bcrypt.hashSync('x', 10), 1);
  ins.run('바트', bcrypt.hashSync('x', 10), 1);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS }));
  const alarm = createAlarm(db, { secret: SECRET, send: async (chat, text) => { sent.push({ chat, text }); return true; } });
  app.use('/api/report/alarm', alarm.router);
  const server = app.listen(0);
  return { db, server, sent, alarm, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const staffCookie = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const bossCookie = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const todo = (db, sid, date, title, done) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo, done) VALUES (?,'today',?,?,'',?)")
    .run(sid, date, title, done || 0);
const memo = (db, sid, period, date, text) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo) VALUES (?,?,?,'',?)")
    .run(sid, period, date, text);

const put = (base, body, cookie) =>
  fetch(`${base}/alarm`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });

test('알람 설정을 저장하고 다시 읽을 수 있다', async () => {
  const { server, base } = makeServer();
  const c = staffCookie(1, '미가');
  const r = await put(base, { chat_id: '111', enabled: 1, send_at: '09:00' }, c);
  assert.strictEqual(r.status, 200);
  const got = await (await fetch(`${base}/alarm`, { headers: { cookie: c } })).json();
  assert.strictEqual(got.chat_id, '111');
  assert.strictEqual(got.enabled, 1);
  assert.strictEqual(got.send_at, '09:00');
  server.close();
});

test('알람 설정에 세션이 없으면 401', async () => {
  const { server, base } = makeServer();
  const r = await fetch(`${base}/alarm`);
  assert.strictEqual(r.status, 401);
  server.close();
});

test('직원이 남의 staff_id를 보내도 본인 칸에만 저장된다', async () => {
  const { server, base } = makeServer();
  await put(base, { chat_id: '222', enabled: 1, send_at: '09:00', staff_id: 2 }, staffCookie(1, '미가'));
  // 바트(2) 칸은 그대로여야 한다 — 사장님 눈으로 확인
  const bat = await (await fetch(`${base}/alarm?staff_id=2`, { headers: { cookie: bossCookie() } })).json();
  assert.strictEqual(bat.chat_id, '', '남의 칸에 저장됨');
  // 미가(1) 본인 칸에는 저장돼 있어야 한다
  const me = await (await fetch(`${base}/alarm`, { headers: { cookie: staffCookie(1, '미가') } })).json();
  assert.strictEqual(me.chat_id, '222');
  server.close();
});

test('시각 형식이 틀리면 400', async () => {
  const { server, base } = makeServer();
  for (const v of ['9시', '25:00', '09:60', 'abc']) {
    const r = await put(base, { chat_id: '1', enabled: 1, send_at: v }, staffCookie(1, '미가'));
    assert.strictEqual(r.status, 400, v);
  }
  server.close();
});

test('메시지에 오늘 할 일과 내일 일정이 들어간다', async () => {
  const { db, server, alarm } = makeServer();
  todo(db, 1, '2026-08-11', '코트 청소', 0);
  todo(db, 1, '2026-08-11', '회원 등록', 1);
  memo(db, 1, 'month', '2026-08-01', '8/12 대회 인솔');
  const msg = alarm.buildMessage(1, '미가', '2026-08-11');
  assert.match(msg, /코트 청소/);
  assert.match(msg, /회원 등록/);
  assert.match(msg, /대회 인솔/, '내일 일정 누락');
  server.close();
});

test('오늘도 내일도 아무것도 없으면 메시지를 만들지 않는다', async () => {
  const { server, alarm } = makeServer();
  assert.strictEqual(alarm.buildMessage(1, '미가', '2026-08-11'), null);
  server.close();
});

test('설정 시각이 지나면 보내고, 같은 날 두 번은 안 보낸다', async () => {
  const { db, server, sent, alarm } = makeServer();
  todo(db, 1, '2026-08-11', '코트 청소', 0);
  db.prepare("INSERT INTO report_alarm (staff_id, chat_id, enabled, send_at) VALUES (1,'111',1,'09:00')").run();
  await alarm.tick('2026-08-11', '09:00');
  assert.strictEqual(sent.length, 1);
  await alarm.tick('2026-08-11', '09:05');
  assert.strictEqual(sent.length, 1, '같은 날 두 번 발송됨');
  await alarm.tick('2026-08-12', '09:00');
  assert.strictEqual(sent.length, 2, '11일에 못 끝낸 일이 남아 12일에도 알려준다');
  assert.match(sent[1].text, /코트 청소/);
  server.close();
});

test('지난 할 일을 다 끝냈으면 다음 날엔 안 보낸다', async () => {
  const { db, server, sent, alarm } = makeServer();
  todo(db, 1, '2026-08-11', '코트 청소', 1);
  db.prepare("INSERT INTO report_alarm (staff_id, chat_id, enabled, send_at) VALUES (1,'111',1,'09:00')").run();
  await alarm.tick('2026-08-12', '09:00');
  assert.strictEqual(sent.length, 0);
  server.close();
});

test('설정 시각 전에는 안 보낸다', async () => {
  const { db, server, sent, alarm } = makeServer();
  todo(db, 1, '2026-08-11', '코트 청소', 0);
  db.prepare("INSERT INTO report_alarm (staff_id, chat_id, enabled, send_at) VALUES (1,'111',1,'09:00')").run();
  await alarm.tick('2026-08-11', '08:55');
  assert.strictEqual(sent.length, 0);
  server.close();
});

test('꺼져 있거나 chat_id가 없으면 안 보낸다', async () => {
  const { db, server, sent, alarm } = makeServer();
  todo(db, 1, '2026-08-11', 'A', 0);
  todo(db, 2, '2026-08-11', 'B', 0);
  db.prepare("INSERT INTO report_alarm (staff_id, chat_id, enabled, send_at) VALUES (1,'111',0,'09:00')").run();
  db.prepare("INSERT INTO report_alarm (staff_id, chat_id, enabled, send_at) VALUES (2,NULL,1,'09:00')").run();
  await alarm.tick('2026-08-11', '09:30');
  assert.strictEqual(sent.length, 0);
  server.close();
});

test('테스트 발송은 설정한 chat_id로 즉시 보낸다', async () => {
  const { server, base, sent } = makeServer();
  const c = staffCookie(1, '미가');
  await put(base, { chat_id: '999', enabled: 1, send_at: '09:00' }, c);
  const r = await fetch(`${base}/alarm/test`, { method: 'POST', headers: { cookie: c } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chat, '999');
  server.close();
});

test('chat_id 없이 테스트 발송하면 400', async () => {
  const { server, base } = makeServer();
  const r = await fetch(`${base}/alarm/test`, { method: 'POST', headers: { cookie: staffCookie(1, '미가') } });
  assert.strictEqual(r.status, 400);
  server.close();
});

test('사장님은 직원 알람을 대신 설정할 수 있다', async () => {
  const { server, base } = makeServer();
  const r = await put(base, { chat_id: '555', enabled: 1, send_at: '09:00', staff_id: 2 }, bossCookie());
  assert.strictEqual(r.status, 200);
  const got = await (await fetch(`${base}/alarm?staff_id=2`, { headers: { cookie: bossCookie() } })).json();
  assert.strictEqual(got.chat_id, '555');
  server.close();
});
