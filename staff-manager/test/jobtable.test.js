const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const createChecklist = require('../checklist');
const Database = require('better-sqlite3');
const { loadApp } = require('./apphost');

// 직무별 일주일 업무표: 모든 파트, 매일/요일/매월로 나눔
test('업무표 데이터: 10개 직무, 업무 전부', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY, name TEXT, pin_hash TEXT, is_active INTEGER DEFAULT 1, role TEXT DEFAULT 'staff')`);
  db.exec(`CREATE TABLE report_items (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, period TEXT, item_date TEXT, title TEXT, memo TEXT, done INTEGER DEFAULT 0, from_boss INTEGER DEFAULT 0)`);
  const tb = createChecklist(db, {}).table();
  assert.strictEqual(tb.length, 10);
  assert.strictEqual(tb.reduce((n, j) => n + j.tasks.length, 0), 123);   // 업무표 118 + 마감 인증 6 - 단톡 마감 사진 1
  const clean = tb.find(j => j.key === '피트-청소');
  assert.ok(clean.tasks.every(x => x.ko && x.when));
});

test('업무표 화면: 매일·요일별·매월 구역, 몽골어', () => {
  const ctx = loadApp();
  const job = { key: 'x', label_ko: '피트니스 매니저', label_mn: 'Фитнес менежер', tasks: [
    { when: '매일', ko: '체크리스트 확인', mn: 'Шалгах' }, { when: '화', ko: '신규 유치 기획', mn: 'Шинэ', ex: '예시 9' },
    { when: '매월 첫 월', ko: '월간 결산', mn: 'Сарын' }] };
  const html = vm.runInContext('jobTableHtml', ctx)(job);
  assert.ok(html.includes('매일'));
  assert.ok(html.includes('화요일'));
  assert.ok(html.includes('매월'));
  assert.ok(html.includes('data-ex="예시 9"'));
  assert.ok(html.includes('총 3개'));
  vm.runInContext("setLang('mn')", ctx);
  assert.ok(vm.runInContext('jobTableHtml', ctx)(job).includes('Фитнес менежер'));
});

test('업무표 편집: 추가 → 오늘 체크리스트에 바로, 삭제 → 손 안 댄 오늘 항목 치움, 되살리기, 매니저는 자기 사업장 일반 직무만', async () => {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const jwt = require('jsonwebtoken');
  const createReportRoutes = require('../report-simple');
  const db2 = new Database(':memory:');
  db2.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db2, { secret: 's', bossPw: 'b', today: () => '2026-12-02' }));
  const add = (n, job) => db2.prepare("INSERT INTO report_users (name, pin_hash, role, job) VALUES (?,?,'staff',?)").run(n, 'x', job).lastInsertRowid;
  const tol = add('톨가', '센터-매니저'), ing = add('잉해', '센터-청소');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/report`;
  const ck = (id, n) => 'report_sess=' + jwt.sign({ staff_id: id, name: n, isBoss: false }, 's');
  const call = (m, q, c, b) => fetch(base + q, { method: m, headers: { 'Content-Type': 'application/json', cookie: c }, body: b ? JSON.stringify(b) : undefined });
  const items = async () => (await (await call('GET', '/items?period=today&date=2026-12-02', ck(ing, '잉해'))).json()).filter(i => i.tpl_key).map(i => i.title);
  try {
    const before = await items();
    const T = ck(tol, '톨가'), K = encodeURIComponent('센터-청소');
    assert.strictEqual((await call('POST', `/jobtable/${K}/tasks`, T, { when: '매일', ko: '사우나 온도 기록', photo: 'close' })).status, 200);
    assert.ok((await items()).includes('사우나 온도 기록'));
    assert.strictEqual((await call('POST', `/jobtable/${K}/tasks`, T, { when: '매일', ko: '사우나 온도 기록' })).status, 409);
    const gone = before[0];
    assert.strictEqual((await call('DELETE', `/jobtable/${K}/tasks`, T, { ko: gone })).status, 200);
    assert.ok(!(await items()).includes(gone));
    const tb = (await (await call('GET', '/jobtable', T)).json()).find(j => j.key === '센터-청소');
    assert.ok(tb.editable && tb.removed.some(r => r.ko === gone) && tb.tasks.some(x => x.custom && x.photo === 'close'));
    assert.strictEqual((await (await call('POST', `/jobtable/${K}/tasks`, T, { ko: gone })).json()).restored, true);
    assert.ok((await items()).includes(gone));
    assert.strictEqual((await call('POST', `/jobtable/${encodeURIComponent('피트-청소')}/tasks`, T, { when: '매일', ko: 'x' })).status, 403);
    assert.strictEqual((await call('POST', `/jobtable/${encodeURIComponent('센터-매니저')}/tasks`, T, { when: '매일', ko: 'x' })).status, 403);
    assert.strictEqual((await call('POST', `/jobtable/${K}/tasks`, ck(ing, '잉해'), { when: '매일', ko: 'x' })).status, 403);
  } finally { server.close(); }
});
