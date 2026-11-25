const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const createReportRoutes = require('../report-simple');

// 인사: 근무표·결재·구성원 (실제 jobs.json)
const SECRET = 'test-secret';
const TODAY = '2026-12-02';   // 수요일
const MON = '2026-11-30';

function makeServer() {
  const sent = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  db.exec(`CREATE TABLE report_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, work_date TEXT, check_in TEXT, check_out TEXT)`);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: 'b', today: () => TODAY,
    notify: async (id, text, title) => { sent.push({ id, text, title }); return true; } }));
  const add = (n, job, role = 'staff') => db.prepare("INSERT INTO report_users (name, pin_hash, role, job) VALUES (?,?,?,?)").run(n, 'x', role, job).lastInsertRowid;
  const ids = { 미가: add('미가', '총매니저'), 구엔: add('구엔', '피트-매니저'), 톨가: add('톨가', '센터-매니저'), 전아름: add('전아름', null, 'admin'),
    바트: add('바트', '피트-리셉션'), 잉해: add('잉해', '센터-청소') };
  const bossId = db.prepare("SELECT id FROM report_users WHERE role='boss'").get().id;
  const server = app.listen(0);
  return { db, sent, ids, bossId, server, base: `http://127.0.0.1:${server.address().port}/api/report` };
}
const as = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const call = async (base, method, q, c, body) => {
  const r = await fetch(`${base}${q}`, { method, headers: { 'Content-Type': 'application/json', cookie: c }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch (e) { }
  return { status: r.status, data };
};

test('근무표: 매니저는 자기 직원만 편집, 지각·결근 표시, 지난주 복사', async () => {
  const { server, base, ids, db } = makeServer();
  try {
    const g = as(ids.구엔, '구엔');
    assert.strictEqual((await call(base, 'PUT', '/hr/shifts', g, { staff_id: ids.바트, date: MON, start: '09:00', end: '18:00' })).status, 200);
    assert.strictEqual((await call(base, 'PUT', '/hr/shifts', g, { staff_id: ids.바트, date: '2026-12-01', start: '09:00', end: '18:00' })).status, 200);
    assert.strictEqual((await call(base, 'PUT', '/hr/shifts', g, { staff_id: ids.잉해, date: MON, start: '09:00', end: '18:00' })).status, 403);
    assert.strictEqual((await call(base, 'PUT', '/hr/shifts', g, { staff_id: ids.구엔, date: MON, start: '09:00', end: '18:00' })).status, 403, '자기 근무는 대표가');
    assert.strictEqual((await call(base, 'PUT', '/hr/shifts', g, { staff_id: ids.바트, date: MON, start: '9시', end: '18:00' })).status, 400);
    db.prepare("INSERT INTO report_attendance (staff_id, work_date, check_in) VALUES (?,?,?)").run(ids.바트, MON, '09:12');
    const w = (await call(base, 'GET', `/hr/shifts?week=${TODAY}`, g)).data;
    assert.strictEqual(w.week, MON);
    assert.strictEqual(w.days.length, 6);
    const bat = w.rows.find(r => r.name === '바트');
    assert.strictEqual(bat.att[MON].late, 12);
    assert.strictEqual(bat.att['2026-12-01'].absent, true);
    assert.strictEqual(bat.editable, true);
    assert.ok(!w.rows.some(r => r.name === '잉해'));
    assert.strictEqual(w.rows.find(r => r.name === '구엔').editable, false);
    // 직원은 본인만
    const mine = (await call(base, 'GET', '/hr/shifts', as(ids.바트, '바트'))).data;
    assert.deepStrictEqual(mine.rows.map(r => r.name), ['바트']);
    assert.strictEqual(mine.rows[0].editable, false);
    const cp = (await call(base, 'POST', '/hr/shifts/copy', g, { week: '2026-12-07' })).data;
    assert.strictEqual(cp.copied, 2);
  } finally { server.close(); }
});

test('결재: 직원 → 매니저 승인 → 대표 최종, 반려, 매니저 요청은 바로 대표', async () => {
  const { server, base, ids, sent, bossId } = makeServer();
  try {
    const b = as(ids.바트, '바트'), g = as(ids.구엔, '구엔');
    const a = (await call(base, 'POST', '/hr/approvals', b, { kind: '구매·발주', title: '수건 50장', amount: '250,000', body: '재고 부족' })).data;
    assert.strictEqual(a.status, 'mgr');
    assert.strictEqual((await call(base, 'PATCH', `/hr/approvals/${a.id}`, as(ids.톨가, '톨가'), { action: 'approve' })).status, 403);
    assert.strictEqual((await call(base, 'PATCH', `/hr/approvals/${a.id}`, g, { action: 'approve' })).data.status, 'boss');
    assert.ok(sent.some(s => s.id === bossId && s.text.includes('구엔 승인')));
    assert.strictEqual((await call(base, 'PATCH', `/hr/approvals/${a.id}`, g, { action: 'approve' })).status, 403, '매니저는 최종 승인 못함');
    const bt = (await call(base, 'GET', '/hr/approvals', boss())).data.todo;
    assert.strictEqual(bt[0].amount, 250000);
    assert.strictEqual((await call(base, 'PATCH', `/hr/approvals/${a.id}`, boss(), { action: 'approve' })).data.status, 'approved');
    const m = (await call(base, 'POST', '/hr/approvals', g, { kind: '비용', title: '에어컨 수리' })).data;
    assert.strictEqual(m.status, 'boss');
    const x = (await call(base, 'POST', '/hr/approvals', b, { kind: '기타', title: '근무 교대' })).data;
    assert.strictEqual((await call(base, 'PATCH', `/hr/approvals/${x.id}`, g, { action: 'reject', comment: '안됨' })).data.status, 'rejected');
    assert.strictEqual((await call(base, 'POST', '/hr/approvals', b, { kind: '기타', title: '' })).status, 400);
  } finally { server.close(); }
});

test('구성원: 매니저는 자기 직원 정보만 / 조직도는 누구나', async () => {
  const { server, base, ids } = makeServer();
  try {
    const g = as(ids.구엔, '구엔');
    const list = (await call(base, 'GET', '/hr/members', g)).data;
    assert.deepStrictEqual(list.map(u => u.name), ['바트']);
    assert.ok(!('pay_rate' in list[0]));
    assert.strictEqual((await call(base, 'PATCH', `/hr/members/${ids.바트}`, g, { phone: '9911-2233', hire_date: '2026-03-01' })).status, 200);
    assert.strictEqual((await call(base, 'PATCH', `/hr/members/${ids.잉해}`, g, { phone: 'x' })).status, 403);
    assert.strictEqual((await call(base, 'GET', '/hr/members', as(ids.바트, '바트'))).status, 403);
    const org = (await call(base, 'GET', '/hr/org', as(ids.잉해, '잉해'))).data;
    assert.deepStrictEqual(org.gm, ['미가']);
    assert.deepStrictEqual(org.admins, ['전아름']);
    const fit = org.sites.find(s => s.site === '피트니스');
    assert.deepStrictEqual([fit.managers, fit.staff.map(x => x.name)], [['구엔'], ['바트']]);
  } finally { server.close(); }
});

