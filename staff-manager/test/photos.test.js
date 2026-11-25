const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const createReportRoutes = require('../report-simple');

// 오픈·마감 인증 사진 (실제 jobs.json): 카메라로 찍어야 완료, 출근 대비 분, 매니저·대표만 열람
const SECRET = 'test-secret';
const TUE = '2026-12-01';
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).toString('base64');

function makeServer() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  db.exec(`CREATE TABLE report_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, work_date TEXT, check_in TEXT, check_out TEXT)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-'));
  const st = { clock: '09:10' };
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: 'b', today: () => TUE, photoDir: dir, clock: () => st.clock }));
  const add = (n, job) => db.prepare("INSERT INTO report_users (name, pin_hash, role, job) VALUES (?,?, 'staff', ?)").run(n, 'x', job).lastInsertRowid;
  const ids = { 바트: add('바트', '피트-청소'), 오윤: add('오윤', '피트-리셉션'), 구엔: add('구엔', '피트-매니저'), 톨가: add('톨가', '센터-매니저') };
  const server = app.listen(0);
  return { db, dir, st, ids, server, base: `http://127.0.0.1:${server.address().port}/api/report` };
}
const as = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
const req = (base, method, q, c, body) => fetch(`${base}${q}`, { method, headers: { 'Content-Type': 'application/json', cookie: c }, body: body ? JSON.stringify(body) : undefined });

test('사진 줄: 체크만으론 완료 안 됨, 사진 올리면 완료 + 출근 대비 분', async () => {
  const { server, base, ids, db, st } = makeServer();
  try {
    db.prepare("INSERT INTO report_attendance (staff_id, work_date, check_in) VALUES (?,?,?)").run(ids.바트, TUE, '09:00');
    const c = as(ids.바트, '바트');
    const items = await (await req(base, 'GET', `/items?period=today&date=${TUE}`, c)).json();
    const open = items.find(i => i.tpl_photo === 'open');
    const close = items.find(i => i.tpl_photo === 'close');
    assert.ok(open && close, '오픈·마감 사진 줄');
    assert.ok(close.title.includes('환풍기'));
    assert.strictEqual((await req(base, 'PATCH', `/items/${open.id}`, c, { done: true })).status, 403);

    const r = await (await req(base, 'POST', `/items/${open.id}/photo`, c, { data: JPEG, shot_at: Date.now() })).json();
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual([r.open.minutes, r.open.ok], [10, true]);
    const after = await (await req(base, 'GET', `/items?period=today&date=${TUE}`, c)).json();
    const o2 = after.find(i => i.id === open.id);
    assert.strictEqual(o2.done, 1);
    assert.strictEqual(o2.photos.length, 1);
    assert.strictEqual(o2.photos[0].at, '09:10');

    st.clock = '22:05';
    assert.strictEqual((await req(base, 'POST', `/items/${close.id}/photo`, c, { data: JPEG })).status, 200);
    // 일일보고에 오픈·마감 인증
    const d = await (await req(base, 'GET', `/daily?date=${TUE}`, as(ids.구엔, '구엔'))).json();
    const p = d.sites[0].checklist.people.find(x => x.name === '바트');
    assert.deepStrictEqual([p.check_in, p.open_at, p.open_min, p.open_ok, p.close_at], ['09:00', '09:10', 10, true, '22:05']);
    assert.strictEqual(p.photos.length, 2);
  } finally { server.close(); }
});

test('15분 넘으면 표시, 옛 사진·남의 줄·이상한 파일 거절', async () => {
  const { server, base, ids, db, st } = makeServer();
  try {
    db.prepare("INSERT INTO report_attendance (staff_id, work_date, check_in) VALUES (?,?,?)").run(ids.바트, TUE, '09:00');
    const c = as(ids.바트, '바트');
    const open = (await (await req(base, 'GET', `/items?period=today&date=${TUE}`, c)).json()).find(i => i.tpl_photo === 'open');
    assert.strictEqual((await req(base, 'POST', `/items/${open.id}/photo`, c, { data: JPEG, shot_at: Date.now() - 3600e3 })).status, 400);
    assert.strictEqual((await req(base, 'POST', `/items/${open.id}/photo`, c, { data: 'data:image/jpeg;base64,AAAA' })).status, 400);
    assert.strictEqual((await req(base, 'POST', `/items/${open.id}/photo`, as(ids.오윤, '오윤'), { data: JPEG })).status, 403);
    st.clock = '09:25';
    const r = await (await req(base, 'POST', `/items/${open.id}/photo`, c, { data: JPEG })).json();
    assert.deepStrictEqual([r.open.minutes, r.open.ok], [25, false]);
    // 사진 아닌 줄엔 못 올림
    const plain = (await (await req(base, 'GET', `/items?period=today&date=${TUE}`, c)).json()).find(i => i.tpl_key && !i.tpl_photo);
    assert.strictEqual((await req(base, 'POST', `/items/${plain.id}/photo`, c, { data: JPEG })).status, 400);
  } finally { server.close(); }
});

test('사진 열람: 본인·담당 매니저·대표만', async () => {
  const { server, base, ids } = makeServer();
  try {
    const c = as(ids.바트, '바트');
    const open = (await (await req(base, 'GET', `/items?period=today&date=${TUE}`, c)).json()).find(i => i.tpl_photo === 'open');
    const { id } = await (await req(base, 'POST', `/items/${open.id}/photo`, c, { data: JPEG })).json();
    const get = async (ck) => (await req(base, 'GET', `/photo/${id}`, ck)).status;
    assert.strictEqual(await get(c), 200);
    assert.strictEqual(await get(as(ids.구엔, '구엔')), 200);
    assert.strictEqual(await get(boss()), 200);
    assert.strictEqual(await get(as(ids.톨가, '톨가')), 403, '다른 사업장 매니저');
    assert.strictEqual(await get(as(ids.오윤, '오윤')), 403, '동료 직원');
  } finally { server.close(); }
});
