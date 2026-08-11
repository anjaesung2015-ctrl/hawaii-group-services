const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const createBotLink = require('../bot-link');

const SECRET = 'test-secret';

function makeServer(opts = {}) {
  const sent = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1, role TEXT DEFAULT 'staff')`);
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('미가','x')").run();
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('바트','x')").run();
  db.exec(`CREATE TABLE IF NOT EXISTS report_alarm (staff_id INTEGER PRIMARY KEY, chat_id TEXT, enabled INTEGER DEFAULT 1, send_at TEXT DEFAULT '09:00', last_sent TEXT)`);
  const link = createBotLink(db, {
    secret: SECRET,
    botUsername: 'hawaii_report_bot',
    send: async (chat, text) => { sent.push({ chat, text }); return true; },
    now: opts.now,
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report/alarm', link.router);
  const server = app.listen(0);
  return { db, server, sent, link, base: `http://127.0.0.1:${server.address().port}/api/report/alarm` };
}

const staffCookie = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const issue = (base, cookie) => fetch(`${base}/link`, { method: 'POST', headers: { cookie } });
const msg = (text, chatId) => ({ update_id: 1, message: { chat: { id: chatId, first_name: '미가' }, text } });

test('연결 링크를 발급한다', async () => {
  const { server, base } = makeServer();
  const r = await issue(base, staffCookie(1, '미가'));
  const d = await r.json();
  assert.strictEqual(r.status, 200);
  assert.match(d.url, /^https:\/\/t\.me\/hawaii_report_bot\?start=[A-Za-z0-9_-]{16,}$/);
  server.close();
});

test('로그인 없이는 링크를 못 받는다', async () => {
  const { server, base } = makeServer();
  const r = await fetch(`${base}/link`, { method: 'POST' });
  assert.strictEqual(r.status, 401);
  server.close();
});

test('/start 토큰을 받으면 그 직원에게 chat_id가 연결된다', async () => {
  const { db, server, base, link, sent } = makeServer();
  const d = await (await issue(base, staffCookie(1, '미가'))).json();
  await link.handleUpdate(msg(`/start ${d.token}`, 555001));
  const row = db.prepare("SELECT chat_id, enabled FROM report_alarm WHERE staff_id=1").get();
  assert.strictEqual(row.chat_id, '555001');
  assert.strictEqual(row.enabled, 1);
  assert.strictEqual(sent.length, 1, '연결 완료 안내가 안 감');
  assert.strictEqual(sent[0].chat, 555001);
  server.close();
});

test('같은 토큰을 두 번 쓰면 두 번째는 무시된다', async () => {
  const { db, server, base, link } = makeServer();
  const d = await (await issue(base, staffCookie(1, '미가'))).json();
  await link.handleUpdate(msg(`/start ${d.token}`, 555001));
  await link.handleUpdate(msg(`/start ${d.token}`, 999999));
  assert.strictEqual(db.prepare("SELECT chat_id FROM report_alarm WHERE staff_id=1").get().chat_id, '555001');
  server.close();
});

test('만료된 토큰은 연결되지 않는다', async () => {
  let clock = Date.UTC(2026, 7, 11, 0, 0, 0);
  const { db, server, base, link } = makeServer({ now: () => clock });
  const d = await (await issue(base, staffCookie(1, '미가'))).json();
  clock += 11 * 60 * 1000;                       // 11분 뒤
  await link.handleUpdate(msg(`/start ${d.token}`, 555001));
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_alarm").get().n, 0);
  server.close();
});

test('없는 토큰은 무시한다', async () => {
  const { db, server, link } = makeServer();
  await link.handleUpdate(msg('/start 아무거나', 555001));
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_alarm").get().n, 0);
  server.close();
});

test('/start 가 아닌 일반 대화는 무시한다 (챗봇 노릇 안 함)', async () => {
  const { db, server, sent, link } = makeServer();
  await link.handleUpdate(msg('안녕하세요 뭐해요?', 555001));
  await link.handleUpdate(msg('/help', 555001));
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_alarm").get().n, 0);
  assert.strictEqual(sent.length, 0);
  server.close();
});

test('이미 연결돼 있으면 새 토큰으로 갈아끼운다', async () => {
  const { db, server, base, link } = makeServer();
  db.prepare("INSERT INTO report_alarm (staff_id, chat_id, enabled) VALUES (1,'111',1)").run();
  const d = await (await issue(base, staffCookie(1, '미가'))).json();
  await link.handleUpdate(msg(`/start ${d.token}`, 222));
  assert.strictEqual(db.prepare("SELECT chat_id FROM report_alarm WHERE staff_id=1").get().chat_id, '222');
  server.close();
});

test('연결 상태를 조회할 수 있다', async () => {
  const { db, server, base } = makeServer();
  const before = await (await fetch(`${base}/link`, { headers: { cookie: staffCookie(1, '미가') } })).json();
  assert.strictEqual(before.linked, false);
  db.prepare("INSERT INTO report_alarm (staff_id, chat_id, enabled) VALUES (1,'111',1)").run();
  const after = await (await fetch(`${base}/link`, { headers: { cookie: staffCookie(1, '미가') } })).json();
  assert.strictEqual(after.linked, true);
  server.close();
});

test('연결을 해제할 수 있다', async () => {
  const { db, server, base } = makeServer();
  db.prepare("INSERT INTO report_alarm (staff_id, chat_id, enabled) VALUES (1,'111',1)").run();
  const r = await fetch(`${base}/link`, { method: 'DELETE', headers: { cookie: staffCookie(1, '미가') } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.prepare("SELECT chat_id FROM report_alarm WHERE staff_id=1").get().chat_id, '');
  server.close();
});

test('남의 토큰으로 내 자리를 못 뺏는다 (토큰은 발급받은 직원에게만 묶인다)', async () => {
  const { db, server, base, link } = makeServer();
  const mine = await (await issue(base, staffCookie(1, '미가'))).json();
  await link.handleUpdate(msg(`/start ${mine.token}`, 777));
  assert.strictEqual(db.prepare("SELECT chat_id FROM report_alarm WHERE staff_id=1").get().chat_id, '777');
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_alarm WHERE staff_id=2").get().n, 0, '엉뚱한 직원에게 붙음');
  server.close();
});
