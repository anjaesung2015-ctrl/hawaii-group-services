const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const createPush = require('../push');

const SECRET = 'test-secret';

function makeServer(sender) {
  const sent = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1, role TEXT DEFAULT 'staff')`);
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('미가','x')").run();
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('바트','x')").run();
  const push = createPush(db, {
    secret: SECRET,
    publicKey: 'TEST_PUBLIC_KEY',
    send: sender || (async (sub, payload) => { sent.push({ endpoint: sub.endpoint, payload }); return true; }),
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report/push', push.router);
  const server = app.listen(0);
  return { db, server, sent, push, base: `http://127.0.0.1:${server.address().port}/api/report/push` };
}

const cookie = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const bossCookie = () => 'report_sess=' + jwt.sign({ isBoss: true, staff_id: 9 }, SECRET, { expiresIn: '1d' });
const sub = (n) => ({ endpoint: 'https://push.example/' + n, keys: { p256dh: 'p' + n, auth: 'a' + n } });
const post = (base, body, c) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify(body) });

test('공개키와 구독 여부를 알려준다', async () => {
  const { server, base } = makeServer();
  const d = await (await fetch(base, { headers: { cookie: cookie(1, '미가') } })).json();
  assert.strictEqual(d.publicKey, 'TEST_PUBLIC_KEY');
  assert.strictEqual(d.subscribed, false);
  server.close();
});

test('구독을 저장하면 subscribed 가 true 가 된다', async () => {
  const { server, base } = makeServer();
  const c = cookie(1, '미가');
  const r = await post(base, sub(1), c);
  assert.strictEqual(r.status, 200);
  const d = await (await fetch(base, { headers: { cookie: c } })).json();
  assert.strictEqual(d.subscribed, true);
  server.close();
});

test('로그인 없이는 구독할 수 없다', async () => {
  const { server, base } = makeServer();
  const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub(1)) });
  assert.strictEqual(r.status, 401);
  server.close();
});

test('endpoint 가 없으면 400', async () => {
  const { server, base } = makeServer();
  const r = await post(base, { keys: { p256dh: 'x', auth: 'y' } }, cookie(1, '미가'));
  assert.strictEqual(r.status, 400);
  server.close();
});

test('같은 기기를 다시 구독하면 늘어나지 않고 갱신된다', async () => {
  const { db, server, base } = makeServer();
  const c = cookie(1, '미가');
  await post(base, sub(1), c);
  await post(base, sub(1), c);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_push").get().n, 1);
  server.close();
});

test('기기가 여러 대면 모두에 보낸다', async () => {
  const { server, base, sent, push } = makeServer();
  const c = cookie(1, '미가');
  await post(base, sub(1), c);
  await post(base, sub(2), c);
  const n = await push.sendTo(1, { title: '알림', body: '코트 청소' });
  assert.strictEqual(n, 2);
  assert.strictEqual(sent.length, 2);
  assert.match(sent[0].payload, /코트 청소/);
  server.close();
});

test('구독이 없으면 보내지 않고 0을 돌려준다', async () => {
  const { server, push, sent } = makeServer();
  assert.strictEqual(await push.sendTo(1, { title: 'x', body: 'y' }), 0);
  assert.strictEqual(sent.length, 0);
  server.close();
});

test('남의 구독으로 알림이 가지 않는다', async () => {
  const { server, base, sent, push } = makeServer();
  await post(base, sub(1), cookie(1, '미가'));
  await post(base, sub(2), cookie(2, '바트'));
  await push.sendTo(2, { title: 'x', body: 'y' });
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].endpoint, /\/2$/);
  server.close();
});

test('만료된 구독(410)은 지워진다', async () => {
  const gone = async () => { const e = new Error('gone'); e.statusCode = 410; throw e; };
  const { db, server, base, push } = makeServer(gone);
  await post(base, sub(1), cookie(1, '미가'));
  await push.sendTo(1, { title: 'x', body: 'y' });
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_push").get().n, 0, '죽은 구독이 남음');
  server.close();
});

test('일시적 오류(500)면 구독을 지우지 않는다', async () => {
  const flaky = async () => { const e = new Error('oops'); e.statusCode = 500; throw e; };
  const { db, server, base, push } = makeServer(flaky);
  await post(base, sub(1), cookie(1, '미가'));
  await push.sendTo(1, { title: 'x', body: 'y' });
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_push").get().n, 1);
  server.close();
});

test('구독을 해제할 수 있다', async () => {
  const { db, server, base } = makeServer();
  const c = cookie(1, '미가');
  await post(base, sub(1), c);
  const r = await fetch(base, { method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify({ endpoint: sub(1).endpoint }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM report_push").get().n, 0);
  server.close();
});

test('사장님도 본인 기기를 구독할 수 있다', async () => {
  const { db, server, base } = makeServer();
  await post(base, sub(9), bossCookie());
  assert.strictEqual(db.prepare("SELECT staff_id FROM report_push").get().staff_id, 9);
  server.close();
});
