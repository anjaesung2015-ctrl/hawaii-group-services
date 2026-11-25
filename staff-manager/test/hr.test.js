const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const createReportRoutes = require('../report-simple');

// 인사: 근무표·휴가·결재·구성원·급여 (실제 jobs.json)
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

test('휴가: 신청 → 담당 매니저 알림 → 승인, 연차 잔여, 매니저 휴가는 대표에게', async () => {
  const { server, base, ids, sent, bossId } = makeServer();
  try {
    const b = as(ids.바트, '바트');
    const r = await call(base, 'POST', '/hr/leave', b, { kind: '연차', start_date: '2026-12-05', end_date: '2026-12-08', reason: '가족 행사' });
    assert.strictEqual(r.data.days, 3, '토·월·화 (일요일 제외)');
    assert.deepStrictEqual(sent.filter(s => s.title === '휴가 신청').map(s => s.id).sort(), [ids.미가, ids.구엔].sort());
    assert.strictEqual((await call(base, 'POST', '/hr/leave', b, { kind: '연차', start_date: '2026-12-09', end_date: '2026-12-31' })).data.error, 'no_balance');
    const half = (await call(base, 'POST', '/hr/leave', b, { kind: '반차', start_date: '2026-12-10' })).data;
    assert.strictEqual(half.days, 0.5);
    const mineBefore = (await call(base, 'GET', '/hr/leave', b)).data;
    assert.deepStrictEqual([mineBefore.balance.used, mineBefore.balance.left], [3.5, 11.5]);

    assert.strictEqual((await call(base, 'PATCH', `/hr/leave/${r.data.id}`, as(ids.톨가, '톨가'), { action: 'approve' })).status, 403);
    const g = as(ids.구엔, '구엔');
    const todo = (await call(base, 'GET', '/hr/leave', g)).data.todo;
    assert.strictEqual(todo.length, 2);
    assert.strictEqual((await call(base, 'PATCH', `/hr/leave/${r.data.id}`, g, { action: 'approve', comment: 'OK' })).data.status, 'approved');
    assert.ok(sent.some(s => s.id === ids.바트 && s.text.includes('승인')));
    assert.strictEqual((await call(base, 'PATCH', `/hr/leave/${half.id}`, b, { action: 'cancel' })).status, 200);
    // 승인된 휴가는 근무표에
    const w = (await call(base, 'GET', '/hr/shifts?week=2026-12-07', g)).data;
    assert.strictEqual(w.rows.find(x => x.name === '바트').leave['2026-12-07'], '연차');
    // 매니저 휴가 → 대표·사장님
    sent.length = 0;
    await call(base, 'POST', '/hr/leave', g, { kind: '병가', start_date: '2026-12-03' });
    assert.deepStrictEqual(sent.map(s => s.id).sort(), [bossId, ids.전아름].sort());
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

test('구성원: 매니저는 자기 직원 정보만, 급여 칸은 대표만 / 조직도는 누구나', async () => {
  const { server, base, ids } = makeServer();
  try {
    const g = as(ids.구엔, '구엔');
    const list = (await call(base, 'GET', '/hr/members', g)).data;
    assert.deepStrictEqual(list.map(u => u.name), ['바트']);
    assert.ok(!('pay_rate' in list[0]));
    assert.strictEqual((await call(base, 'PATCH', `/hr/members/${ids.바트}`, g, { phone: '9911-2233', hire_date: '2026-03-01' })).status, 200);
    assert.strictEqual((await call(base, 'PATCH', `/hr/members/${ids.바트}`, g, { pay_rate: 1 })).status, 403);
    assert.strictEqual((await call(base, 'PATCH', `/hr/members/${ids.잉해}`, g, { phone: 'x' })).status, 403);
    assert.strictEqual((await call(base, 'GET', '/hr/members', as(ids.바트, '바트'))).status, 403);
    const org = (await call(base, 'GET', '/hr/org', as(ids.잉해, '잉해'))).data;
    assert.deepStrictEqual(org.gm, ['미가']);
    assert.deepStrictEqual(org.admins, ['전아름']);
    const fit = org.sites.find(s => s.site === '피트니스');
    assert.deepStrictEqual([fit.managers, fit.staff.map(x => x.name)], [['구엔'], ['바트']]);
  } finally { server.close(); }
});

test('급여: 월급·시급 계산, 무급 공제, 세금, 확정해야 직원에게 보임', async () => {
  const { server, base, ids, db } = makeServer();
  try {
    await call(base, 'PATCH', `/hr/members/${ids.바트}`, boss(), { pay_type: 'month', pay_rate: '1,300,000' });
    await call(base, 'PATCH', `/hr/members/${ids.잉해}`, boss(), { pay_type: 'hour', pay_rate: 8000 });
    db.prepare("INSERT INTO report_attendance (staff_id, work_date, check_in, check_out) VALUES (?,?,?,?)").run(ids.잉해, '2026-12-01', '09:00', '17:30');
    db.prepare("INSERT INTO report_leave (staff_id, kind, start_date, end_date, days, status) VALUES (?,?,?,?,?,'approved')").run(ids.바트, '무급', '2026-12-03', '2026-12-04', 2);
    const p = (await call(base, 'GET', '/hr/payroll?month=2026-12', boss())).data;
    const bat = p.rows.find(r => r.name === '바트').calc;
    assert.strictEqual(bat.unpaid_deduct, 100000);
    assert.strictEqual(bat.gross, 1200000);
    assert.strictEqual(bat.si, 138000);
    assert.strictEqual(bat.pit, 106200);
    assert.strictEqual(bat.net, 955800);
    const ing = p.rows.find(r => r.name === '잉해').calc;
    assert.deepStrictEqual([ing.hours, ing.base], [8.5, 68000]);
    assert.strictEqual((await call(base, 'GET', '/hr/payroll', as(ids.구엔, '구엔'))).status, 403);

    assert.strictEqual((await call(base, 'PUT', '/hr/payroll', boss(), { staff_id: ids.바트, month: '2026-12', bonus: '50,000', tax: false })).data.net, 1250000);
    assert.deepStrictEqual((await call(base, 'GET', '/hr/payslips', as(ids.바트, '바트'))).data, [], '확정 전엔 안 보임');
    await call(base, 'PUT', '/hr/payroll', boss(), { staff_id: ids.바트, month: '2026-12', bonus: 50000, tax: false, confirm: true });
    const slips = (await call(base, 'GET', '/hr/payslips', as(ids.바트, '바트'))).data;
    assert.strictEqual(slips[0].net, 1250000);
    assert.deepStrictEqual((await call(base, 'GET', '/hr/payslips', as(ids.잉해, '잉해'))).data, []);
  } finally { server.close(); }
});
