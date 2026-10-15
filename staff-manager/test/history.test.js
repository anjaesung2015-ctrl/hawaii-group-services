// 지난 기록 모아보기 ('기록' 탭)
// 끝낸 일은 오늘 목록에서 내려간다. 그래도 그동안 무엇을 했는지는 남아 있어야 한다.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');
const { loadApp } = require('./apphost');

const SECRET = 'test-secret';
const BOSS = 'boss123';

function makeServer() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  const ins = db.prepare("INSERT INTO report_users (name, pin_hash) VALUES (?,?)");
  ins.run('미가', bcrypt.hashSync('x', 10));       // id 1
  ins.run('구엔', bcrypt.hashSync('x', 10));       // id 2
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS }));
  const server = app.listen(0);
  const bossId = db.prepare("SELECT id FROM report_users WHERE role='boss'").get().id;
  return { db, server, bossId, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const bossSess = (id) => 'report_sess=' + jwt.sign({ isBoss: true, staff_id: id }, SECRET, { expiresIn: '1d' });
const staffSess = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });

const hist = (base, qs, cookie) =>
  fetch(`${base}/history?${qs}`, cookie === null ? {} : { headers: { cookie } });

const item = (db, sid, date, title, done, opts = {}) =>
  db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo, done, from_boss) VALUES (?,?,?,?,?,?,?)")
    .run(sid, opts.period || 'today', date, title, opts.memo || '', done || 0, opts.fromBoss || 0);

// ---- 서버 ----

test('기록 — 그 달 것만 모은다', async () => {
  const { db, server, base, bossId } = makeServer();
  item(db, bossId, '2026-10-09', '은행 서류 제출', 1);
  item(db, bossId, '2026-09-30', '지난달 일', 1);
  const d = await (await hist(base, 'month=2026-10', bossSess(bossId))).json();
  assert.deepStrictEqual(d.rows.map(r => r.date), ['2026-10-09']);
  assert.strictEqual(d.month, '2026-10');
  server.close();
});

test('기록 — 최신 날짜부터, 날짜별로 완료 집계가 붙는다', async () => {
  const { db, server, base, bossId } = makeServer();
  item(db, bossId, '2026-10-09', '은행 서류 제출', 1);
  item(db, bossId, '2026-10-09', '코트 보수 업체', 0);
  item(db, bossId, '2026-10-09', '보험 갱신', 0);
  item(db, bossId, '2026-10-14', '직원 급여 이체', 1);
  item(db, bossId, '2026-10-14', '세무사 통화', 1);
  const d = await (await hist(base, 'month=2026-10', bossSess(bossId))).json();
  assert.deepStrictEqual(d.rows.map(r => r.date), ['2026-10-14', '2026-10-09']);
  assert.deepStrictEqual(d.rows.map(r => [r.done, r.total]), [[2, 2], [1, 3]]);
  assert.deepStrictEqual(d.rows[0].items.map(i => i.title), ['직원 급여 이체', '세무사 통화']);
  server.close();
});

test('기록 — 완료한 일도 그대로 남아있다', async () => {
  const { db, server, base, bossId } = makeServer();
  item(db, bossId, '2026-10-09', '끝낸 일', 1);
  const d = await (await hist(base, 'month=2026-10', bossSess(bossId))).json();
  assert.strictEqual(d.rows[0].items[0].done, 1);
  assert.strictEqual(d.rows[0].items[0].title, '끝낸 일');
  server.close();
});

test('기록 — 제목·메모가 둘 다 빈 항목은 기록이 아니다', async () => {
  const { db, server, base, bossId } = makeServer();
  item(db, bossId, '2026-10-09', '', 0);
  item(db, bossId, '2026-10-09', '', 0, { memo: '메모만 있음' });
  const d = await (await hist(base, 'month=2026-10', bossSess(bossId))).json();
  assert.strictEqual(d.rows.length, 1);
  assert.deepStrictEqual(d.rows[0].items.map(i => i.memo), ['메모만 있음']);
  server.close();
});

test('기록 — 내일 할 일로 적어둔 것도 그 날짜에 들어간다', async () => {
  const { db, server, base, bossId } = makeServer();
  item(db, bossId, '2026-10-14', '내일 적어둔 일', 0, { period: 'tomorrow' });
  const d = await (await hist(base, 'month=2026-10', bossSess(bossId))).json();
  assert.deepStrictEqual(d.rows.map(r => r.date), ['2026-10-14']);
  server.close();
});

test('기록 — 주·월·연 자유메모는 섞이지 않는다', async () => {
  const { db, server, base, bossId } = makeServer();
  item(db, bossId, '2026-10-01', '이번 달 목표', 0, { period: 'month' });
  item(db, bossId, '2026-10-05', '이번 주 목표', 0, { period: 'week' });
  item(db, bossId, '2026-10-09', '할 일', 0);
  const d = await (await hist(base, 'month=2026-10', bossSess(bossId))).json();
  assert.deepStrictEqual(d.rows.map(r => r.date), ['2026-10-09']);
  server.close();
});

test('기록 — 사장님 전체 보기에 사장님 본인 기록이 들어있다', async () => {
  const { db, server, base, bossId } = makeServer();
  item(db, bossId, '2026-10-09', '사장님 일', 1);
  item(db, 1, '2026-10-09', '미가 일', 0);
  const d = await (await hist(base, 'month=2026-10', bossSess(bossId))).json();
  const names = d.rows[0].items.map(i => i.name);
  assert.ok(names.includes('사장님'), '사장님 기록이 빠졌다: ' + names.join(','));
  assert.ok(names.includes('미가'));
  server.close();
});

test('기록 — 사장님이 직원을 지정하면 그 직원 것만', async () => {
  const { db, server, base, bossId } = makeServer();
  item(db, bossId, '2026-10-09', '사장님 일', 1);
  item(db, 1, '2026-10-09', '미가 일', 0);
  item(db, 2, '2026-10-09', '구엔 일', 0);
  const d = await (await hist(base, 'month=2026-10&staff_id=1', bossSess(bossId))).json();
  assert.deepStrictEqual(d.rows[0].items.map(i => i.title), ['미가 일']);
  server.close();
});

test('기록 — 직원은 staff_id를 넘겨도 본인 것만 본다', async () => {
  const { db, server, base } = makeServer();
  item(db, 1, '2026-10-09', '미가 일', 0);
  item(db, 2, '2026-10-09', '구엔 일', 0);
  const d = await (await hist(base, 'month=2026-10&staff_id=2', staffSess(1, '미가'))).json();
  assert.deepStrictEqual(d.rows[0].items.map(i => i.title), ['미가 일']);
  server.close();
});

test('기록 — 직원도 자기 기록을 본다 (완료한 것까지)', async () => {
  const { db, server, base } = makeServer();
  item(db, 1, '2026-10-09', '끝낸 일', 1);
  item(db, 1, '2026-10-14', '남은 일', 0);
  const d = await (await hist(base, 'month=2026-10', staffSess(1, '미가'))).json();
  assert.deepStrictEqual(d.rows.map(r => r.date), ['2026-10-14', '2026-10-09']);
  assert.strictEqual(d.rows[1].items[0].done, 1);
  server.close();
});

test('기록 — 직원 응답에는 다른 사람 명단이 없다', async () => {
  const { db, server, base } = makeServer();
  item(db, 1, '2026-10-09', '미가 일', 0);
  const d = await (await hist(base, 'month=2026-10', staffSess(1, '미가'))).json();
  assert.deepStrictEqual(d.people, []);
  assert.deepStrictEqual([...new Set(d.rows[0].items.map(i => i.name))], ['미가']);
  server.close();
});

test('기록 — 기록이 없는 달은 빈 목록', async () => {
  const { server, base, bossId } = makeServer();
  const r = await hist(base, 'month=2026-10', bossSess(bossId));
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await r.json()).rows, []);
  server.close();
});

test('기록 — 잘못된 월은 400', async () => {
  const { server, base, bossId } = makeServer();
  assert.strictEqual((await hist(base, 'month=2026-13', bossSess(bossId))).status, 400);
  assert.strictEqual((await hist(base, 'month=2026-9', bossSess(bossId))).status, 400);
  assert.strictEqual((await hist(base, '', bossSess(bossId))).status, 400);
  server.close();
});

test('기록 — 로그인 없이는 못 본다 (401)', async () => {
  const { server, base } = makeServer();
  assert.strictEqual((await hist(base, 'month=2026-10', null)).status, 401);
  server.close();
});

test('기록 — 달력과 같은 사람 목록(people)을 함께 준다 (색 맞추기용)', async () => {
  const { server, base, bossId } = makeServer();
  const d = await (await hist(base, 'month=2026-10', bossSess(bossId))).json();
  assert.deepStrictEqual(d.people.map(p => p.name), ['미가', '구엔']);
  server.close();
});

// ---- 화면 ----

const ROWS = [{
  date: '2026-10-14', total: 2, done: 1,
  items: [
    { id: 1, staff_id: 6, name: '사장님', title: '직원 급여 이체', memo: '은행 앱', done: 1, from_boss: 0 },
    { id: 2, staff_id: 1, name: '미가', title: '효소표 정리', memo: '', done: 0, from_boss: 1 },
  ],
}];

test('화면 — 기록 탭은 직원 화면에서도 보인다', () => {
  const ctx = loadApp();
  assert.ok(!ctx.BOSS_TABS.includes('hist'), '기록은 사장님 전용이 아니다');
  assert.ok(ctx.BOSS_TABS.includes('att') && ctx.BOSS_TABS.includes('score'), '근태·종합은 사장님 전용');
});

test('화면 — 날짜 머리글과 완료 집계가 보인다', () => {
  const ctx = loadApp();
  const html = ctx.historyCards(ROWS, false);
  assert.ok(html.includes('10/14'), '날짜 머리글: ' + html);
  assert.ok(html.includes('1/2 완료'), '완료 집계: ' + html);
});

test('화면 — 끝낸 일은 ✓, 안 끝낸 일은 ○', () => {
  const ctx = loadApp();
  const html = ctx.historyCards(ROWS, false);
  assert.ok(html.includes('ov done'), '완료 항목에 취소선 클래스');
  assert.ok(html.includes('ov undone'));
  assert.ok(html.includes('직원 급여 이체') && html.includes('효소표 정리'));
  assert.ok(html.includes('은행 앱'), '메모도 함께 보인다');
});

test('화면 — 사장님 지시에는 📌 뱃지가 붙는다', () => {
  const ctx = loadApp();
  assert.ok(ctx.historyCards(ROWS, false).includes('class="tag"'));
});

test('화면 — 전체 모드에서는 누구 일인지 이름이 붙는다', () => {
  const ctx = loadApp();
  const all = ctx.historyCards(ROWS, true);
  assert.ok(all.includes('사장님') && all.includes('미가'), '이름 뱃지: ' + all);
  assert.ok(!ctx.historyCards(ROWS, false).includes('미가'), '한 사람만 볼 때는 이름을 반복하지 않는다');
});

test('화면 — 읽기 전용: 입력칸도 삭제 버튼도 없다', () => {
  const ctx = loadApp();
  const html = ctx.historyCards(ROWS, true);
  assert.ok(!html.includes('<input'), '입력칸이 있으면 안 된다: ' + html);
  assert.ok(!html.includes('ovdel') && !html.includes('class="del"'), '삭제 버튼이 있으면 안 된다');
});

test('화면 — 기록이 없으면 빈 문자열 (호출부가 "기록 없음"을 띄운다)', () => {
  const ctx = loadApp();
  assert.strictEqual(ctx.historyCards([], false), '');
});

test('화면 — 제목 없이 메모만 적은 항목도 그려진다', () => {
  const ctx = loadApp();
  const html = ctx.historyCards([{ date: '2026-10-09', total: 1, done: 0,
    items: [{ id: 3, staff_id: 1, name: '미가', title: '', memo: '하루 종일 코트 정리', done: 0, from_boss: 0 }] }], false);
  assert.ok(html.includes('하루 종일 코트 정리'), html);
});
