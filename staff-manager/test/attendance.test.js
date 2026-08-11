const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const createAttendance = require('../attendance');

const SECRET = 'test-secret';
const GYM = { lat: 47.918, lng: 106.917 };          // 휘트니스 기준점 (울란바토르 부근)

function makeServer(opts = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1, role TEXT DEFAULT 'staff')`);
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('미가','x')").run();
  db.prepare("INSERT INTO report_users (name, pin_hash) VALUES ('바트','x')").run();
  db.prepare("INSERT INTO report_users (name, pin_hash, role) VALUES ('사장님','!','boss')").run();
  const att = createAttendance(db, {
    secret: SECRET,
    now: opts.now || (() => ({ date: '2026-08-12', time: '09:05' })),
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report/attendance', att.router);
  const server = app.listen(0);
  return { db, server, att, base: `http://127.0.0.1:${server.address().port}/api/report/attendance` };
}

const staff = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const boss = () => 'report_sess=' + jwt.sign({ isBoss: true, staff_id: 3 }, SECRET, { expiresIn: '1d' });
const post = (base, path, body, c) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify(body || {}) });
const get = (base, path, c) => fetch(base + path, { headers: { cookie: c } });

// 위도 1도 ≈ 111km. 미터를 위도 차이로 바꾼다.
const north = (m) => ({ lat: GYM.lat + m / 111320, lng: GYM.lng });

async function registerGym(base) {
  return post(base, '/place', { name: '휘트니스', lat: GYM.lat, lng: GYM.lng, radius_m: 10 }, boss());
}

test('사장님이 근무지를 등록할 수 있다', async () => {
  const { server, base, db } = makeServer();
  const r = await registerGym(base);
  assert.strictEqual(r.status, 200);
  const row = db.prepare("SELECT * FROM report_place").get();
  assert.strictEqual(row.name, '휘트니스');
  assert.strictEqual(row.radius_m, 10);
  server.close();
});

test('직원은 근무지를 등록할 수 없다', async () => {
  const { server, base } = makeServer();
  const r = await post(base, '/place', { name: 'x', lat: 1, lng: 2 }, staff(1, '미가'));
  assert.strictEqual(r.status, 403);
  server.close();
});

test('근무지가 등록되기 전에는 위치를 따지지 않는다', async () => {
  const { server, base } = makeServer();
  const r = await post(base, '/in', {}, staff(1, '미가'));
  assert.strictEqual(r.status, 200);
  server.close();
});

test('반경 안에서 출근하면 기록된다', async () => {
  const { db, server, base } = makeServer();
  await registerGym(base);
  const r = await post(base, '/in', { ...north(4), acc: 5 }, staff(1, '미가'));
  assert.strictEqual(r.status, 200);
  const row = db.prepare("SELECT * FROM report_attendance WHERE staff_id=1").get();
  assert.strictEqual(row.work_date, '2026-08-12');
  assert.strictEqual(row.check_in, '09:05');
  server.close();
});

test('반경 밖이면 거부하고 거리를 알려준다', async () => {
  const { server, base } = makeServer();
  await registerGym(base);
  const r = await post(base, '/in', { ...north(300), acc: 5 }, staff(1, '미가'));
  const d = await r.json();
  assert.strictEqual(r.status, 403);
  assert.strictEqual(d.error, 'out_of_range');
  assert.ok(d.distance_m > 250 && d.distance_m < 350, '거리 계산이 이상함: ' + d.distance_m);
  server.close();
});

test('GPS 오차만큼 빼고 판정한다 (오차가 크면 통과)', async () => {
  const { server, base } = makeServer();
  await registerGym(base);
  const r = await post(base, '/in', { ...north(40), acc: 45 }, staff(1, '미가'));
  assert.strictEqual(r.status, 200, '오차 보정이 안 됨');
  server.close();
});

test('위치를 안 보내면 거부한다 (근무지가 등록된 경우)', async () => {
  const { server, base } = makeServer();
  await registerGym(base);
  const r = await post(base, '/in', {}, staff(1, '미가'));
  assert.strictEqual(r.status, 400);
  server.close();
});

test('출근을 두 번 눌러도 처음 시각이 유지된다', async () => {
  const { db, server, base } = makeServer();
  await post(base, '/in', {}, staff(1, '미가'));
  await post(base, '/in', {}, staff(1, '미가'));
  const rows = db.prepare("SELECT * FROM report_attendance WHERE staff_id=1").all();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].check_in, '09:05');
  server.close();
});

test('퇴근은 출근 뒤에만 된다', async () => {
  const { server, base } = makeServer();
  const r = await post(base, '/out', {}, staff(1, '미가'));
  assert.strictEqual(r.status, 400);
  server.close();
});

test('퇴근을 누르면 시각이 기록된다', async () => {
  let clock = { date: '2026-08-12', time: '09:05' };
  const { db, server, base } = makeServer({ now: () => clock });
  await post(base, '/in', {}, staff(1, '미가'));
  clock = { date: '2026-08-12', time: '18:02' };
  const r = await post(base, '/out', {}, staff(1, '미가'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.prepare("SELECT check_out FROM report_attendance WHERE staff_id=1").get().check_out, '18:02');
  server.close();
});

test('오늘 현황 — 직원은 본인 것만', async () => {
  const { server, base } = makeServer();
  await post(base, '/in', {}, staff(1, '미가'));
  await post(base, '/in', {}, staff(2, '바트'));
  const d = await (await get(base, '/today', staff(1, '미가'))).json();
  assert.strictEqual(d.rows.length, 1);
  assert.strictEqual(d.rows[0].name, '미가');
  server.close();
});

test('오늘 현황 — 사장님은 전 직원 (미출근 포함)', async () => {
  const { server, base } = makeServer();
  await post(base, '/in', {}, staff(1, '미가'));
  const d = await (await get(base, '/today', boss())).json();
  assert.deepStrictEqual(d.rows.map(r => r.name), ['미가', '바트']);
  assert.strictEqual(d.rows[1].check_in, null, '미출근은 빈 값이어야 함');
  server.close();
});

test('지각 판정 — 기준 시각 이후 출근', async () => {
  const { server, base } = makeServer({ now: () => ({ date: '2026-08-12', time: '09:31' }) });
  await post(base, '/in', {}, staff(1, '미가'));
  const d = await (await get(base, '/today', boss())).json();
  assert.strictEqual(d.rows[0].late, 1);
  server.close();
});

test('기준 시각을 바꾸면 지각 판정도 바뀐다', async () => {
  const { server, base } = makeServer({ now: () => ({ date: '2026-08-12', time: '09:31' }) });
  await post(base, '/config', { work_start: '10:00' }, boss());
  await post(base, '/in', {}, staff(1, '미가'));
  const d = await (await get(base, '/today', boss())).json();
  assert.strictEqual(d.rows[0].late, 0);
  server.close();
});

test('월별 집계 — 근무일수·시간·지각', async () => {
  const { db, server, base } = makeServer();
  const ins = db.prepare("INSERT INTO report_attendance (staff_id, work_date, check_in, check_out) VALUES (?,?,?,?)");
  ins.run(1, '2026-08-03', '09:00', '18:00');
  ins.run(1, '2026-08-04', '09:30', '18:00');
  ins.run(1, '2026-08-05', '08:50', null);
  ins.run(1, '2026-07-31', '09:00', '18:00');
  const d = await (await get(base, '/month?month=2026-08', boss())).json();
  const me = d.rows.find(r => r.name === '미가');
  assert.strictEqual(me.days, 3);
  assert.strictEqual(me.minutes, 540 + 510, '퇴근 안 찍은 날은 시간에서 빼야 함');
  assert.strictEqual(me.late, 1);
  server.close();
});

test('사장님은 기록을 고칠 수 있다', async () => {
  const { db, server, base } = makeServer();
  await post(base, '/in', {}, staff(1, '미가'));
  const id = db.prepare("SELECT id FROM report_attendance").get().id;
  const r = await fetch(`${base}/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: boss() },
    body: JSON.stringify({ check_in: '08:50', check_out: '17:30' }),
  });
  assert.strictEqual(r.status, 200);
  const row = db.prepare("SELECT * FROM report_attendance WHERE id=?").get(id);
  assert.strictEqual(row.check_in, '08:50');
  assert.strictEqual(row.check_out, '17:30');
  server.close();
});

test('직원은 남의 기록을 못 고친다', async () => {
  const { db, server, base } = makeServer();
  await post(base, '/in', {}, staff(2, '바트'));
  const id = db.prepare("SELECT id FROM report_attendance").get().id;
  const r = await fetch(`${base}/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: staff(1, '미가') },
    body: JSON.stringify({ check_in: '08:00' }),
  });
  assert.strictEqual(r.status, 403);
  server.close();
});

test('사장님이 대신 출근처리하면 현재 시각이 들어간다', async () => {
  const { db, server, base } = makeServer();
  const r = await post(base, '/mark', { staff_id: 2 }, boss());
  assert.strictEqual(r.status, 200);
  const row = db.prepare("SELECT * FROM report_attendance WHERE staff_id=2").get();
  assert.strictEqual(row.check_in, '09:05', '빈 줄이 만들어짐');
  server.close();
});

test('출근처리에 시각을 지정하면 그 시각이 들어간다', async () => {
  const { db, server, base } = makeServer();
  await post(base, '/mark', { staff_id: 2, check_in: '08:30', check_out: '17:00' }, boss());
  const row = db.prepare("SELECT * FROM report_attendance WHERE staff_id=2").get();
  assert.strictEqual(row.check_in, '08:30');
  assert.strictEqual(row.check_out, '17:00');
  server.close();
});

test('이미 출근한 사람에게 출근처리해도 원래 시각이 유지된다', async () => {
  const { db, server, base } = makeServer();
  await post(base, '/in', {}, staff(1, '미가'));
  await post(base, '/mark', { staff_id: 1 }, boss());
  assert.strictEqual(db.prepare("SELECT check_in FROM report_attendance WHERE staff_id=1").get().check_in, '09:05');
  server.close();
});

test('엑셀(CSV) 내려받기 — 사장님만', async () => {
  const { db, server, base } = makeServer();
  db.prepare("INSERT INTO report_attendance (staff_id, work_date, check_in, check_out) VALUES (1,'2026-08-03','09:00','18:00')").run();
  const r = await get(base, '/export?month=2026-08', boss());
  assert.strictEqual(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepStrictEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], '엑셀용 BOM이 없음');
  const text = buf.toString('utf8');
  assert.match(text, /미가/);
  assert.match(text, /2026-08-03/);
  const deny = await get(base, '/export?month=2026-08', staff(1, '미가'));
  assert.strictEqual(deny.status, 403);
  server.close();
});
