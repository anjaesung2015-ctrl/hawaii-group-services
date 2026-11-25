const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');

// 매니저 일일 보고 — 사업장마다 하루 한 장, 사장님이 확인·코멘트
const SECRET = 'test-secret';
const BOSS = 'boss123';
const TODAY = '2026-12-01';      // 화요일
const YDAY = '2026-11-30';
const OLD = '2026-11-28';

const JOBS = [
  { key: '피트-매니저', site: '피트니스', role: '매니저', label_ko: '피트니스 매니저', label_mn: 'Фитнес Менежер',
    tasks: [{ when: '매일', ko: '체크 확인', mn: 'Шалгах', when_mn: 'Өдөр бүр' }] },
  { key: '피트-리셉션', site: '피트니스', role: '리셉션', label_ko: '피트니스 리셉션', label_mn: 'Фитнес Ресепшн',
    tasks: [{ when: '출근 15분 내', ko: '유니폼', mn: 'Хувцас', when_mn: '' }, { when: '마감', ko: '정산', mn: 'Тооцоо', when_mn: '' }] },
  { key: '센터-매니저', site: '센터', role: '매니저', label_ko: '센터 매니저', label_mn: 'Төв Менежер',
    tasks: [{ when: '매일', ko: '체크 확인', mn: 'Шалгах', when_mn: '' }] },
].map(j => ({ ...j, tasks: j.tasks.map(t => ({ ...t, key: j.key + '|' + t.ko })) }));

function makeServer() {
  const sent = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  for (const n of ['바트', '미가', '구엔', '돌']) db.prepare("INSERT INTO report_users (name, pin_hash) VALUES (?,?)").run(n, bcrypt.hashSync('pw-' + n, 10));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, {
    secret: SECRET, bossPw: BOSS, today: () => TODAY, jobs: JOBS,
    notify: async (id, text, title) => { sent.push({ id, text, title }); return true; },
  }));
  db.prepare("UPDATE report_users SET job='피트-매니저' WHERE id=1").run();
  db.prepare("UPDATE report_users SET job='피트-리셉션' WHERE id=2").run();
  db.prepare("UPDATE report_users SET job='센터-매니저' WHERE id=3").run();
  const server = app.listen(0);
  return { db, server, sent, base: `http://127.0.0.1:${server.address().port}/api/report` };
}

const as = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const req = (base, method, q, c, body) => fetch(`${base}${q}`, { method, headers: { 'Content-Type': 'application/json', cookie: c }, body: body ? JSON.stringify(body) : undefined });
const FIT = () => as(1, '바트'), REC = () => as(2, '미가'), CEN = () => as(3, '구엔'), NOJOB = () => as(4, '돌');

test('매니저만 일일 보고를 본다 — 매니저는 자기 사업장만, 사장님은 둘 다', async () => {
  const { server, base } = makeServer();
  try {
    assert.strictEqual((await req(base, 'GET', `/daily?date=${TODAY}`, REC())).status, 403);
    assert.strictEqual((await req(base, 'GET', `/daily?date=${TODAY}`, NOJOB())).status, 403);
    const f = await (await req(base, 'GET', `/daily?date=${TODAY}`, FIT())).json();
    assert.deepStrictEqual(f.sites.map(s => s.site), ['피트니스']);
    assert.deepStrictEqual(f.editable, ['피트니스']);
    const b = await (await req(base, 'GET', `/daily?date=${TODAY}`, boss())).json();
    assert.deepStrictEqual(b.sites.map(s => s.site), ['피트니스', '센터']);
    assert.deepStrictEqual(b.editable, []);
  } finally { server.close(); }
});

test('보고 저장 → 총매출·달성률 계산, 처음 올릴 때만 사장님께 알림', async () => {
  const { server, base, sent } = makeServer();
  try {
    const body = { date: TODAY, headcount: 4, cash: '300,000', card: 500000, transfer: 150000, target: 1000000,
      new_members: 2, renewals: 3, progress: '제휴 2곳 연락', decision: '에어컨 수리 승인', settle_ok: true };
    const r = await (await req(base, 'PUT', '/daily', FIT(), body)).json();
    assert.strictEqual(r.created, true);
    assert.strictEqual(r.notified, true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].title, '일일 보고');
    assert.ok(sent[0].text.includes('950,000'));
    assert.ok(sent[0].text.includes('95%'));
    assert.ok(sent[0].text.includes('에어컨 수리 승인'));

    await req(base, 'PUT', '/daily', FIT(), { ...body, cash: 400000 });
    assert.strictEqual(sent.length, 1, '고칠 때는 알림 안 감');

    const d = await (await req(base, 'GET', `/daily?date=${TODAY}`, boss())).json();
    const rep = d.sites[0].report;
    assert.strictEqual(rep.sales, 1050000);
    assert.strictEqual(rep.rate, 105);
    assert.strictEqual(rep.settle_ok, 1);
    assert.strictEqual(rep.by, '바트');
    assert.strictEqual(d.sites[1].report, null);
  } finally { server.close(); }
});

test('숫자가 아니면 400, 지난 날짜는 매니저가 못 씀(어제는 가능)', async () => {
  const { server, base } = makeServer();
  try {
    assert.strictEqual((await req(base, 'PUT', '/daily', FIT(), { date: TODAY, cash: 'abc' })).status, 400);
    assert.strictEqual((await req(base, 'PUT', '/daily', FIT(), { date: TODAY, cash: -5 })).status, 400);
    assert.strictEqual((await req(base, 'PUT', '/daily', FIT(), { date: YDAY, cash: 1 })).status, 200);
    assert.strictEqual((await req(base, 'PUT', '/daily', FIT(), { date: OLD, cash: 1 })).status, 403);
    assert.strictEqual((await req(base, 'PUT', '/daily', REC(), { date: TODAY, cash: 1 })).status, 403);
    assert.strictEqual((await req(base, 'PUT', '/daily', boss(), { date: TODAY, cash: 1 })).status, 403);
  } finally { server.close(); }
});

test('직원 체크리스트 완료율은 같은 사업장 직원(매니저 제외)만', async () => {
  const { server, base } = makeServer();
  try {
    const items = await (await req(base, 'GET', `/items?period=today&date=${TODAY}`, REC())).json();
    await req(base, 'PATCH', `/items/${items[0].id}`, REC(), { done: true });
    await req(base, 'GET', `/items?period=today&date=${TODAY}`, FIT());   // 매니저 본인 체크리스트도 생김
    const d = await (await req(base, 'GET', `/daily?date=${TODAY}`, FIT())).json();
    const c = d.sites[0].checklist;
    assert.strictEqual(c.total, 2);
    assert.strictEqual(c.done, 1);
    assert.deepStrictEqual(c.people.map(p => p.name), ['미가']);
  } finally { server.close(); }
});

test('사장님 확인·코멘트', async () => {
  const { server, base } = makeServer();
  try {
    assert.strictEqual((await req(base, 'PATCH', '/daily/boss', boss(), { site: '센터', date: TODAY, boss_ok: true })).status, 404);
    await req(base, 'PUT', '/daily', CEN(), { date: TODAY, cash: 100 });
    assert.strictEqual((await req(base, 'PATCH', '/daily/boss', CEN(), { site: '센터', date: TODAY, boss_ok: true })).status, 403);
    assert.strictEqual((await req(base, 'PATCH', '/daily/boss', boss(), { site: '센터', date: TODAY, boss_ok: true, boss_comment: '승인' })).status, 200);
    const d = await (await req(base, 'GET', `/daily?date=${TODAY}`, CEN())).json();
    assert.strictEqual(d.sites[0].report.boss_ok, 1);
    assert.strictEqual(d.sites[0].report.boss_comment, '승인');
    // 매니저가 다시 저장해도 사장님 확인은 지워지지 않는다
    await req(base, 'PUT', '/daily', CEN(), { date: TODAY, cash: 200 });
    const d2 = await (await req(base, 'GET', `/daily?date=${TODAY}`, CEN())).json();
    assert.strictEqual(d2.sites[0].report.boss_comment, '승인');
  } finally { server.close(); }
});

test('로그인·세션 응답에 매니저 사업장이 실린다', async () => {
  const { server, base } = makeServer();
  try {
    const me = await (await req(base, 'GET', '/me', FIT())).json();
    assert.strictEqual(me.manager_site, '피트니스');
    const me2 = await (await req(base, 'GET', '/me', REC())).json();
    assert.strictEqual(me2.manager_site, null);
    const lg = await (await req(base, 'POST', '/login', '', { name: '구엔', password: 'pw-구엔' })).json();
    assert.strictEqual(lg.manager_site, '센터');
  } finally { server.close(); }
});
