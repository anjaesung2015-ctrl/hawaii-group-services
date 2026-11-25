const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');
const { loadJobs, tasksForDate } = require('../checklist');

// 직무별 매일 체크리스트 — 직무를 정해 두면 오늘 탭을 열 때 그 요일 업무가 들어온다.
const SECRET = 'test-secret';
const BOSS = 'boss123';
const MON = '2026-11-30';      // 월요일 (그 달 첫 월요일은 아님 — 11/2)
const TUE = '2026-12-01';
const SUN = '2026-12-06';
const FIRST_MON = '2026-12-07';

const JOBS = [{
  key: '피트-리셉션', site: '피트니스', role: '리셉션', label_ko: '피트니스 리셉션', label_mn: 'Фитнес Ресепшн',
  tasks: [
    { when: '출근 15분 내', ko: '유니폼 착용', mn: 'Дүрэмт хувцас', when_mn: 'Ирснээс 15 мин' },
    { when: '마감', ko: '정산', mn: 'Тооцоо', when_mn: 'Хаахад' },
    { when: '화', ko: '화요일 재고', mn: 'Мягмар нөөц', when_mn: 'Мя' },
  ],
}, {
  key: '피트-매니저', site: '피트니스', role: '매니저', label_ko: '피트니스 매니저', label_mn: 'Фитнес Менежер',
  tasks: [
    { when: '매일', ko: '체크리스트 확인', mn: 'Шалгах', when_mn: 'Өдөр бүр' },
    { when: '매월 첫 월', ko: '월간 결산', mn: 'Сарын тайлан', when_mn: 'Сарын эхний Да' },
  ],
}].map(j => ({ ...j, tasks: j.tasks.map(t => ({ ...t, key: j.key + '|' + t.ko })) }));

function makeServer(today) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('미가',?)").run(bcrypt.hashSync('x', 10));
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('구엔',?)").run(bcrypt.hashSync('x', 10));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const state = { today };
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS, today: () => state.today, jobs: JOBS }));
  const server = app.listen(0);
  return { db, server, state, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const staff = (id = 1) => 'report_sess=' + jwt.sign({ staff_id: id, name: '미가', isBoss: false }, SECRET, { expiresIn: '1d' });
const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const get = async (base, q, c) => (await fetch(`${base}${q}`, { headers: { cookie: c } })).json();
const send = (base, method, q, body, c) => fetch(`${base}${q}`, { method, headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify(body) });
const setJob = (db, id, job) => db.prepare("UPDATE report_users SET job=? WHERE id=?").run(job, id);

test('요일 업무는 그 요일에만, 일요일은 없음, 매월 첫 월요일 업무', () => {
  const [rec, mgr] = JOBS;
  assert.deepStrictEqual(tasksForDate(rec, MON).map(t => t.ko), ['유니폼 착용', '정산']);
  assert.deepStrictEqual(tasksForDate(rec, TUE).map(t => t.ko), ['유니폼 착용', '정산', '화요일 재고']);
  assert.deepStrictEqual(tasksForDate(rec, SUN), []);
  assert.deepStrictEqual(tasksForDate(mgr, MON).map(t => t.ko), ['체크리스트 확인']);
  assert.deepStrictEqual(tasksForDate(mgr, FIRST_MON).map(t => t.ko), ['체크리스트 확인', '월간 결산']);
});

test('실제 jobs.json 이 읽히고 직무 9개', () => {
  const jobs = loadJobs();
  assert.strictEqual(jobs.length, 9);
  for (const j of jobs) {
    assert.ok(j.label_ko && j.label_mn, j.key);
    for (const t of j.tasks) assert.ok(t.ko && t.mn && t.when, j.key + ' ' + t.ko);
  }
});

test('직무가 있으면 오늘 탭을 열 때 체크리스트가 들어오고, 여러 번 열어도 한 번만', async () => {
  const { db, server, base } = makeServer(TUE);
  try {
    setJob(db, 1, '피트-리셉션');
    const a = await get(base, `/items?period=today&date=${TUE}`, staff());
    assert.deepStrictEqual(a.map(i => i.title), ['유니폼 착용', '정산', '화요일 재고']);
    assert.strictEqual(a[0].tpl_when, '출근 15분 내');
    assert.strictEqual(a[0].tpl_mn, 'Дүрэмт хувцас');
    const b = await get(base, `/items?period=today&date=${TUE}`, staff());
    assert.strictEqual(b.length, 3);
    // 직무 없는 사람은 아무것도 안 들어온다
    assert.deepStrictEqual(await get(base, `/items?period=today&date=${TUE}`, staff(2)), []);
  } finally { server.close(); }
});

test('오늘이 아닌 날짜를 넘겨볼 때는 만들지 않는다', async () => {
  const { db, server, base } = makeServer(TUE);
  try {
    setJob(db, 1, '피트-리셉션');
    assert.deepStrictEqual(await get(base, `/items?period=today&date=${MON}`, staff()), []);
    assert.deepStrictEqual(await get(base, `/items?period=today&date=2026-12-02`, staff()), []);
  } finally { server.close(); }
});

test('직원은 체크리스트 제목 수정·삭제 불가, 체크·메모는 가능. 사장님은 삭제 가능', async () => {
  const { db, server, base } = makeServer(TUE);
  try {
    setJob(db, 1, '피트-리셉션');
    const [it] = await get(base, `/items?period=today&date=${TUE}`, staff());
    assert.strictEqual((await send(base, 'PATCH', `/items/${it.id}`, { title: '바꿈' }, staff())).status, 403);
    assert.strictEqual((await send(base, 'DELETE', `/items/${it.id}`, {}, staff())).status, 403);
    assert.strictEqual((await send(base, 'PATCH', `/items/${it.id}`, { done: true }, staff())).status, 200);
    assert.strictEqual((await send(base, 'PATCH', `/items/${it.id}`, { memo: '완료 사진 올림' }, staff())).status, 200);
    assert.strictEqual((await send(base, 'DELETE', `/items/${it.id}`, {}, boss())).status, 200);
  } finally { server.close(); }
});

test('못 끝낸 체크리스트는 다음 날로 넘어가지 않는다 (직접 적은 할 일은 넘어감)', async () => {
  const { db, server, state, base } = makeServer(MON);
  try {
    setJob(db, 1, '피트-리셉션');
    await get(base, `/items?period=today&date=${MON}`, staff());
    db.prepare("INSERT INTO report_items (staff_id, period, item_date, title) VALUES (1,'today',?,'내 할 일')").run(MON);
    state.today = TUE;
    const t = await get(base, `/items?period=today&date=${TUE}`, staff());
    const titles = t.map(i => i.title);
    assert.ok(titles.includes('내 할 일'));
    assert.deepStrictEqual(titles.filter(x => x === '유니폼 착용').length, 1);   // 오늘 것 1개만
    assert.ok(t.filter(i => i.tpl_key).every(i => i.item_date === TUE));
  } finally { server.close(); }
});

test('사장님 현황판이 직원 체크리스트를 채우고, 몽골어 화면엔 몽골어 문구', async () => {
  const { db, server, base } = makeServer(TUE);
  try {
    setJob(db, 1, '피트-리셉션');
    setJob(db, 2, '피트-매니저');
    const rows = await get(base, `/overview?period=today&date=${TUE}&lang=mn`, boss());
    const miga = rows.find(r => r.staff_id === 1);
    assert.strictEqual(miga.job, '피트-리셉션');
    assert.strictEqual(miga.items.length, 3);
    assert.strictEqual(miga.items[0].title_tr, 'Дүрэмт хувцас');
    assert.strictEqual(rows.find(r => r.staff_id === 2).items.length, 1);
  } finally { server.close(); }
});

test('달력에는 체크리스트가 안 들어간다 (직접 적은 일만)', async () => {
  const { db, server, base } = makeServer(TUE);
  try {
    setJob(db, 1, '피트-리셉션');
    await get(base, `/items?period=today&date=${TUE}`, staff());
    db.prepare("INSERT INTO report_items (staff_id, period, item_date, title) VALUES (1,'today',?,'거래처 미팅')").run(TUE);
    const cal = await get(base, `/calendar?month=2026-12`, staff());
    assert.strictEqual(cal.days[TUE].total, 1);
    assert.strictEqual(cal.days[TUE].texts[0].t, '거래처 미팅');
  } finally { server.close(); }
});

test('직무 지정·변경 API — 바꾸면 손 안 댄 예전 체크리스트만 치운다', async () => {
  const { db, server, base } = makeServer(TUE);
  try {
    const jobs = await get(base, '/jobs', boss());
    assert.deepStrictEqual(jobs.map(j => j.key), ['피트-리셉션', '피트-매니저']);
    assert.strictEqual((await send(base, 'PATCH', '/staff/1', { job: '없는직무' }, boss())).status, 400);
    assert.strictEqual((await send(base, 'PATCH', '/staff/1', { job: '피트-리셉션' }, boss())).status, 200);
    assert.strictEqual((await send(base, 'PATCH', '/staff/1', { job: '피트-리셉션' }, staff())).status, 403);
    const list = await get(base, '/staff', boss());
    assert.strictEqual(list.find(u => u.id === 1).job, '피트-리셉션');

    const items = await get(base, `/items?period=today&date=${TUE}`, staff());
    await send(base, 'PATCH', `/items/${items[0].id}`, { done: true }, staff());   // 하나는 체크함
    await send(base, 'PATCH', '/staff/1', { job: '피트-매니저' }, boss());
    const after = await get(base, `/items?period=today&date=${TUE}`, staff());
    assert.deepStrictEqual(after.map(i => i.title).sort(), ['유니폼 착용', '체크리스트 확인'].sort());

    // 직무 해제
    await send(base, 'PATCH', '/staff/1', { job: '' }, boss());
    assert.strictEqual((await get(base, '/staff', boss())).find(u => u.id === 1).job, null);
  } finally { server.close(); }
});

test('직원 추가할 때 직무도 함께', async () => {
  const { server, base } = makeServer(TUE);
  try {
    const r = await send(base, 'POST', '/staff', { name: '바트', password: 'abcd', job: '피트-매니저' }, boss());
    assert.strictEqual(r.status, 200);
    const list = await get(base, '/staff', boss());
    assert.strictEqual(list.find(u => u.name === '바트').job, '피트-매니저');
    assert.strictEqual((await send(base, 'POST', '/staff', { name: '돌', password: 'abcd', job: 'x' }, boss())).status, 400);
  } finally { server.close(); }
});
