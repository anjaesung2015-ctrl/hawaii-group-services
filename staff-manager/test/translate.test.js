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

// 번역기를 실제로 부르지 않고 가짜로 주입한다 (호출 횟수도 센다)
function makeServer(translate) {
  const calls = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  const ins = db.prepare("INSERT INTO report_users (name, pin_hash, is_active) VALUES (?,?,?)");
  ins.run('미가', bcrypt.hashSync('x', 10), 1);
  ins.run('바트', bcrypt.hashSync('x', 10), 1);
  const spy = async (text, from, to) => {
    calls.push({ text, from, to });
    return translate ? translate(text, from, to) : '[' + to + ']' + text;
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS, translate: spy }));
  const server = app.listen(0);
  return { db, server, calls, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const bossCookie = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const addItem = (db, sid, title, memo) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo) VALUES (?,?,?,?,?)")
    .run(sid, 'today', '2026-08-11', title, memo || '');
const get = (base, qs) =>
  fetch(`${base}/overview?period=today&date=2026-08-11${qs || ''}`, { headers: { cookie: bossCookie() } }).then(r => r.json());

test('lang 없으면 번역하지 않는다', async () => {
  const { db, server, base, calls } = makeServer();
  addItem(db, 1, '코트 청소');
  const rows = await get(base);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(rows[0].items[0].title_tr, undefined);
  server.close();
});

test('lang=mn이면 한국어 제목이 번역되어 붙는다 (원문은 유지)', async () => {
  const { db, server, base } = makeServer();
  addItem(db, 1, '코트 청소', '오전에');
  const rows = await get(base, '&lang=mn');
  const it = rows[0].items[0];
  assert.strictEqual(it.title, '코트 청소', '원문이 바뀌면 안 됨');
  assert.strictEqual(it.title_tr, '[mn]코트 청소');
  assert.strictEqual(it.memo_tr, '[mn]오전에');
  server.close();
});

test('이미 대상 언어면 번역기를 부르지 않는다', async () => {
  const { db, server, base, calls } = makeServer();
  addItem(db, 1, 'Талбай цэвэрлэх');
  const rows = await get(base, '&lang=mn');
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(rows[0].items[0].title_tr, undefined);
  server.close();
});

test('숫자·기호만 있으면 번역하지 않는다', async () => {
  const { db, server, base, calls } = makeServer();
  addItem(db, 1, '2026-08-11 / 100%');
  await get(base, '&lang=mn');
  assert.strictEqual(calls.length, 0);
  server.close();
});

test('번역이 실패해도 200이고 원문이 살아있다', async () => {
  const { db, server, base } = makeServer(async () => { throw new Error('translator down'); });
  addItem(db, 1, '코트 청소');
  const rows = await get(base, '&lang=mn');
  assert.strictEqual(rows[0].items[0].title, '코트 청소');
  assert.strictEqual(rows[0].items[0].title_tr, undefined);
  server.close();
});

test('같은 문장이 여러 건이어도 번역기는 한 번만 부른다', async () => {
  const { db, server, base, calls } = makeServer();
  addItem(db, 1, '코트 청소');
  addItem(db, 2, '코트 청소');
  const rows = await get(base, '&lang=mn');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(rows[0].items[0].title_tr, '[mn]코트 청소');
  assert.strictEqual(rows[1].items[0].title_tr, '[mn]코트 청소');
  server.close();
});

test('두 번째 요청은 캐시를 써서 번역기를 다시 부르지 않는다', async () => {
  const { db, server, base, calls } = makeServer();
  addItem(db, 1, '코트 청소');
  await get(base, '&lang=mn');
  assert.strictEqual(calls.length, 1);
  const rows = await get(base, '&lang=mn');
  assert.strictEqual(calls.length, 1, '캐시가 안 먹었다');
  assert.strictEqual(rows[0].items[0].title_tr, '[mn]코트 청소');
  server.close();
});

test('lang=ko면 몽골어 글이 한국어로 번역된다', async () => {
  const { db, server, base, calls } = makeServer();
  addItem(db, 1, 'Талбай цэвэрлэх');
  const rows = await get(base, '&lang=ko');
  assert.strictEqual(calls[0].from, 'mn');
  assert.strictEqual(calls[0].to, 'ko');
  assert.strictEqual(rows[0].items[0].title_tr, '[ko]Талбай цэвэрлэх');
  server.close();
});

test('빈 번역 결과는 무시하고 원문을 남긴다', async () => {
  const { db, server, base } = makeServer(async () => '   ');
  addItem(db, 1, '코트 청소');
  const rows = await get(base, '&lang=mn');
  assert.strictEqual(rows[0].items[0].title_tr, undefined);
  server.close();
});

test('잘못된 lang 값은 무시한다', async () => {
  const { db, server, base, calls } = makeServer();
  addItem(db, 1, '코트 청소');
  await get(base, '&lang=zz');
  assert.strictEqual(calls.length, 0);
  server.close();
});
