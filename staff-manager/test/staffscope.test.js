const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');

// 직원 관리 권한: 대표·사장님 전부 / 총매니저 두 사업장 일반 직원 / 매니저 자기 사업장 일반 직원 (실제 jobs.json)
const SECRET = 'test-secret';

function makeServer() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: 'b', today: () => '2026-12-01' }));
  const add = (name, job, role = 'staff') => db.prepare("INSERT INTO report_users (name, pin_hash, role, job) VALUES (?,?,?,?)")
    .run(name, bcrypt.hashSync('x', 10), role, job).lastInsertRowid;
  const ids = {
    미가: add('미가', '총매니저'), 구엔: add('구엔', '피트-매니저'), 톨가: add('톨가', '센터-매니저'),
    전아름: add('전아름', null, 'admin'),
    바트: add('바트', '피트-리셉션'), 잠스랑: add('잠스랑', '센터-코치'), 무직: add('무직', null),
  };
  const server = app.listen(0);
  return { db, server, ids, base: `http://127.0.0.1:${server.address().port}/api/report` };
}
const as = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const req = (base, method, q, c, body) => fetch(`${base}${q}`, { method, headers: { 'Content-Type': 'application/json', cookie: c }, body: body ? JSON.stringify(body) : undefined });
const names = async (base, c) => (await (await req(base, 'GET', '/staff', c)).json()).map(u => u.name).sort();

test('보이는 직원: 대표 전부, 총매니저 두 사업장 일반 직원, 매니저 자기 사업장, 일반 직원 403', async () => {
  const { server, base, ids } = makeServer();
  try {
    assert.deepStrictEqual(await names(base, boss()), ['구엔', '무직', '미가', '바트', '잠스랑', '톨가'].sort());
    assert.deepStrictEqual(await names(base, as(ids.미가, '미가')), ['바트', '잠스랑'].sort());
    assert.deepStrictEqual(await names(base, as(ids.구엔, '구엔')), ['바트']);
    assert.deepStrictEqual(await names(base, as(ids.톨가, '톨가')), ['잠스랑']);
    assert.strictEqual((await req(base, 'GET', '/staff', as(ids.바트, '바트'))).status, 403);
  } finally { server.close(); }
});

test('줄 수 있는 직무: 매니저는 자기 사업장 일반 직무만', async () => {
  const { server, base, ids } = makeServer();
  try {
    const g = (await (await req(base, 'GET', '/jobs', as(ids.구엔, '구엔'))).json()).map(j => j.key);
    assert.deepStrictEqual(g, ['피트-리셉션', '피트-트레이너', '피트-청소']);
    const m = (await (await req(base, 'GET', '/jobs', as(ids.미가, '미가'))).json()).map(j => j.key);
    assert.strictEqual(m.length, 7);
    assert.ok(!m.some(k => k.includes('매니저')));
    assert.strictEqual((await (await req(base, 'GET', '/jobs', boss())).json()).length, 10);
  } finally { server.close(); }
});

test('매니저가 직원 추가: 자기 사업장 일반 직무로만', async () => {
  const { server, base, ids } = makeServer();
  try {
    const c = as(ids.구엔, '구엔');
    assert.strictEqual((await req(base, 'POST', '/staff', c, { name: '오윤', password: 'abcd', job: '피트-청소' })).status, 200);
    assert.strictEqual((await req(base, 'POST', '/staff', c, { name: '돌1', password: 'abcd', job: '센터-청소' })).status, 403);
    assert.strictEqual((await req(base, 'POST', '/staff', c, { name: '돌2', password: 'abcd', job: '피트-매니저' })).status, 403);
    assert.strictEqual((await req(base, 'POST', '/staff', c, { name: '돌3', password: 'abcd' })).status, 403, '직무 없이 추가 불가');
    assert.strictEqual((await req(base, 'POST', '/staff', as(ids.바트, '바트'), { name: '돌4', password: 'abcd', job: '피트-청소' })).status, 403);
  } finally { server.close(); }
});

test('매니저가 직무 변경·비번 재설정·퇴사: 자기 직원만, 매니저 직무로 올리기 불가', async () => {
  const { server, base, ids } = makeServer();
  try {
    const g = as(ids.구엔, '구엔');
    assert.strictEqual((await req(base, 'PATCH', `/staff/${ids.바트}`, g, { job: '피트-트레이너' })).status, 200);
    assert.strictEqual((await req(base, 'PATCH', `/staff/${ids.바트}`, g, { job: '피트-매니저' })).status, 403);
    assert.strictEqual((await req(base, 'PATCH', `/staff/${ids.바트}`, g, { job: '' })).status, 403);
    assert.strictEqual((await req(base, 'PATCH', `/staff/${ids.잠스랑}`, g, { is_active: 0 })).status, 403, '다른 사업장');
    assert.strictEqual((await req(base, 'PATCH', `/staff/${ids.톨가}`, g, { name: 'x' })).status, 403, '다른 매니저');
    assert.strictEqual((await req(base, 'POST', '/reset-password', g, { staff_id: ids.바트, new_password: 'newpw' })).status, 200);
    assert.strictEqual((await req(base, 'POST', '/reset-password', g, { staff_id: ids.미가, new_password: 'newpw' })).status, 403);
    assert.strictEqual((await req(base, 'PATCH', `/staff/${ids.바트}`, g, { is_active: 0 })).status, 200);
    // 총매니저는 두 사업장 일반 직원 모두
    const m = as(ids.미가, '미가');
    assert.strictEqual((await req(base, 'PATCH', `/staff/${ids.잠스랑}`, m, { job: '센터-시설' })).status, 200);
    assert.strictEqual((await req(base, 'PATCH', `/staff/${ids.구엔}`, m, { job: '피트-청소' })).status, 403);
    // 대표는 매니저 지정도 가능
    assert.strictEqual((await req(base, 'PATCH', `/staff/${ids.무직}`, boss(), { job: '센터-매니저' })).status, 200);
  } finally { server.close(); }
});

test('매니저 지시: 자기 직원에게만, 알림 제목은 매니저 이름, 목록에 현황', async () => {
  const { server, base, ids } = makeServer();
  try {
    const g = as(ids.구엔, '구엔');
    assert.strictEqual((await req(base, 'POST', '/assign', g, { staff_id: ids.바트, title: '거울 닦기' })).status, 200);
    assert.strictEqual((await req(base, 'POST', '/assign', g, { staff_id: ids.잠스랑, title: 'x' })).status, 403);
    assert.strictEqual((await req(base, 'POST', '/assign', g, { staff_id: ids.톨가, title: 'x' })).status, 403);
    assert.strictEqual((await req(base, 'POST', '/assign', as(ids.바트, '바트'), { staff_id: ids.바트, title: 'x' })).status, 403);
    assert.strictEqual((await req(base, 'POST', '/assign', as(ids.미가, '미가'), { staff_id: ids.잠스랑, title: '코트 정리' })).status, 200);
    const list = await (await req(base, 'GET', '/staff', g)).json();
    assert.strictEqual(list.find(u => u.name === '바트').asg_total, 1);
  } finally { server.close(); }
});

test('매니저: 맡은 직원의 오늘 체크리스트 보기·지우기, 다른 사업장·직원이 적은 줄은 불가', async () => {
  const { server, base, ids, db } = makeServer();
  try {
    const g = as(ids.구엔, '구엔');
    await req(base, 'GET', '/items?period=today&date=2026-12-01', as(ids.바트, '바트'));
    const list = await (await req(base, 'GET', `/staff/${ids.바트}/today`, g)).json();
    assert.ok(list.length > 0 && list.every(i => i.tpl_key || i.from_boss));
    assert.strictEqual((await req(base, 'DELETE', `/items/${list[0].id}`, g)).status, 200);
    assert.strictEqual((await req(base, 'GET', `/staff/${ids.잠스랑}/today`, g)).status, 403);
    await req(base, 'GET', '/items?period=today&date=2026-12-01', as(ids.잠스랑, '잠스랑'));
    const other = db.prepare("SELECT id FROM report_items WHERE staff_id=? AND tpl_key IS NOT NULL").get(ids.잠스랑);
    assert.strictEqual((await req(base, 'DELETE', `/items/${other.id}`, g)).status, 403, '다른 사업장');
    assert.strictEqual((await req(base, 'DELETE', `/items/${other.id}`, as(ids.톨가, '톨가'))).status, 200, '센터 매니저는 가능');
    const own = db.prepare("INSERT INTO report_items (staff_id, period, item_date, title) VALUES (?,'today','2026-12-01','바트 메모')").run(ids.바트).lastInsertRowid;
    assert.strictEqual((await req(base, 'DELETE', `/items/${own}`, g)).status, 403, '직원이 적은 줄');
  } finally { server.close(); }
});

test('기록: 매니저는 본인+맡은 직원 기록을 보고, 지난 날짜도 완료 바꾸기·체크리스트 지우기', async () => {
  const { server, base, ids, db } = makeServer();
  try {
    const g = as(ids.구엔, '구엔');
    const add = (sid, title, tpl) => db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, tpl_key) VALUES (?,'today','2026-11-20',?,?)").run(sid, title, tpl || null).lastInsertRowid;
    const a = add(ids.바트, '바닥 청소', '피트-청소|바닥 청소'), b = add(ids.바트, '바트 메모'), c = add(ids.잠스랑, '센터 일');
    const h = await (await req(base, 'GET', '/history?month=2026-11', g)).json();
    const names = [...new Set(h.rows.flatMap(r => r.items.map(i => i.name)))];
    assert.deepStrictEqual(names, ['바트']);
    assert.strictEqual((await req(base, 'PATCH', `/items/${b}`, g, { done: true })).status, 200);
    assert.strictEqual(db.prepare('SELECT done FROM report_items WHERE id=?').get(b).done, 1);
    assert.strictEqual((await req(base, 'PATCH', `/items/${b}`, g, { title: 'x' })).status, 403, '완료만');
    assert.strictEqual((await req(base, 'PATCH', `/items/${c}`, g, { done: true })).status, 403, '다른 사업장');
    assert.strictEqual((await req(base, 'DELETE', `/items/${a}`, g)).status, 200, '지난 체크리스트 지우기');
    assert.strictEqual((await req(base, 'DELETE', `/items/${b}`, g)).status, 403, '직원이 적은 줄');
    assert.strictEqual((await req(base, 'PATCH', `/items/${b}`, as(ids.바트, '바트'), { title: 'y' })).status, 403, '직원은 지난 기록 못 고침');
  } finally { server.close(); }
});
