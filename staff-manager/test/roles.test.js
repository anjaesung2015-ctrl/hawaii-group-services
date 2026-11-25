const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');

// 조직: 대표(.env 비번) / 사장님(관리자 계정, role='admin') / 총매니저 / 사업장 매니저 / 직원
const SECRET = 'test-secret';
const BOSS = 'boss123';
const TODAY = '2026-12-01';

const JOBS = [
  { key: '총매니저', site: '전체', role: '총매니저', label_ko: '총매니저', label_mn: 'Ерөнхий менежер',
    tasks: [{ when: '매일', ko: '공통 확인', mn: 'Шалгах', when_mn: '' }] },
  { key: '피트-매니저', site: '피트니스', role: '매니저', label_ko: '피트니스 매니저', label_mn: 'Фитнес Менежер',
    tasks: [{ when: '매일', ko: '체크 확인', mn: 'Шалгах', when_mn: '' }] },
  { key: '센터-매니저', site: '센터', role: '매니저', label_ko: '센터 매니저', label_mn: 'Төв Менежер',
    tasks: [{ when: '매일', ko: '체크 확인', mn: 'Шалгах', when_mn: '' }] },
].map(j => ({ ...j, tasks: j.tasks.map(t => ({ ...t, key: j.key + '|' + t.ko })) }));

function makeServer() {
  const sent = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  for (const n of ['미가', '구엔', '톨가']) db.prepare("INSERT INTO report_users (name, pin_hash) VALUES (?,?)").run(n, bcrypt.hashSync('pw-' + n, 10));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, {
    secret: SECRET, bossPw: BOSS, today: () => TODAY, jobs: JOBS,
    notify: async (id, text, title) => { sent.push({ id, text, title }); return true; },
  }));
  db.prepare("INSERT INTO report_users (name, pin_hash, role) VALUES ('전아름',?, 'admin')").run(bcrypt.hashSync('pw-arum', 10));
  db.prepare("UPDATE report_users SET job='총매니저' WHERE name='미가'").run();
  db.prepare("UPDATE report_users SET job='피트-매니저' WHERE name='구엔'").run();
  db.prepare("UPDATE report_users SET job='센터-매니저' WHERE name='톨가'").run();
  const server = app.listen(0);
  const id = n => db.prepare("SELECT id FROM report_users WHERE name=?").get(n).id;
  return { db, server, sent, id, base: `http://127.0.0.1:${server.address().port}/api/report` };
}
const req = (base, method, q, c, body) => fetch(`${base}${q}`, { method, headers: { 'Content-Type': 'application/json', cookie: c || '' }, body: body ? JSON.stringify(body) : undefined });
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];
const as = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });

test('사장님(관리자)은 이름 목록 맨 앞, 자기 비번으로 로그인하면 대표와 같은 권한', async () => {
  const { server, base, id } = makeServer();
  try {
    const list = await (await req(base, 'GET', '/staff-list')).json();
    assert.strictEqual(list[0].name, '전아름');
    assert.strictEqual(list[0].role, 'admin');
    assert.strictEqual((await req(base, 'POST', '/login', '', { name: '전아름', password: 'x' })).status, 401);
    const r = await req(base, 'POST', '/login', '', { name: '전아름', password: 'pw-arum' });
    const d = await r.json();
    assert.strictEqual(d.isBoss, true);
    assert.strictEqual(d.my_id, id('전아름'));
    const c = cookieOf(r);
    const me = await (await req(base, 'GET', '/me', c)).json();
    assert.deepStrictEqual(me, { isBoss: true, my_id: id('전아름'), name: '전아름' });
    // 대표 전용이던 화면들
    assert.strictEqual((await req(base, 'GET', '/staff', c)).status, 200);
    assert.strictEqual((await req(base, 'GET', `/overview?period=today&date=${TODAY}`, c)).status, 200);
    const daily = await (await req(base, 'GET', `/daily?date=${TODAY}`, c)).json();
    assert.deepStrictEqual(daily.sites.map(s => s.site), ['피트니스', '센터']);
    // 본인 비밀번호 변경 가능
    assert.strictEqual((await req(base, 'POST', '/change-password', c, { current: 'pw-arum', new_password: 'new-arum' })).status, 200);
  } finally { server.close(); }
});

test('사장님이 내린 지시는 이름으로 알림이 간다', async () => {
  const { server, base, sent, id } = makeServer();
  try {
    const c = cookieOf(await req(base, 'POST', '/login', '', { name: '전아름', password: 'pw-arum' }));
    await req(base, 'POST', '/assign', c, { staff_id: id('구엔'), title: '재고 확인' });
    assert.ok(sent[0].text.startsWith('📌 전아름 지시'));
    assert.strictEqual(sent[0].title, '전아름 지시');
    const b = 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
    await req(base, 'POST', '/assign', b, { staff_id: id('구엔'), title: '청소' });
    assert.ok(sent[1].text.startsWith('📌 대표 지시'));
  } finally { server.close(); }
});

test('대표 로그인은 그대로 (.env 비번), 이름은 대표', async () => {
  const { server, base } = makeServer();
  try {
    const r = await req(base, 'POST', '/login', '', { boss_pw: BOSS });
    assert.strictEqual(r.status, 200);
    const me = await (await req(base, 'GET', '/me', cookieOf(r))).json();
    assert.strictEqual(me.name, '대표');
  } finally { server.close(); }
});

test('총매니저는 두 사업장 일일보고를 보지만 쓰지는 않는다', async () => {
  const { server, base, id } = makeServer();
  try {
    const c = as(id('미가'), '미가');
    const me = await (await req(base, 'GET', '/me', c)).json();
    assert.strictEqual(me.manager_site, '전체');
    const d = await (await req(base, 'GET', `/daily?date=${TODAY}`, c)).json();
    assert.deepStrictEqual(d.sites.map(s => s.site), ['피트니스', '센터']);
    assert.deepStrictEqual(d.editable, []);
    assert.strictEqual((await req(base, 'PUT', '/daily', c, { date: TODAY, cash: 1 })).status, 403);
    // 각 사업장 매니저는 자기 것만
    const g = await (await req(base, 'GET', `/daily?date=${TODAY}`, as(id('구엔'), '구엔'))).json();
    assert.deepStrictEqual(g.editable, ['피트니스']);
    const t = await (await req(base, 'GET', `/daily?date=${TODAY}`, as(id('톨가'), '톨가'))).json();
    assert.deepStrictEqual(t.sites.map(s => s.site), ['센터']);
  } finally { server.close(); }
});
