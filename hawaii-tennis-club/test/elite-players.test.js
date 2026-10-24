// 선수 명단 — 오너·선수반 코치만 관리, 동호인 임원은 403
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { player, makeStaffCoach } = require('./elite-fixtures');

test('오너가 선수를 등록하면 선수는 그 번호와 PIN 으로 로그인한다', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  const r = await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222' }) });
  assert.strictEqual(r.status, 200);
  const p = await loginAs(app.base, '77001122', '2222');
  assert.strictEqual((await p.call('/auth/me')).data.me.program, 'elite');
  const list = (await owner.call('/elite/players')).data;
  assert.deepStrictEqual([list.length, list[0].birth_year, list[0].parent_phone, list[0].elite_fee], [1, 2011, '99887766', 700000]);
  app.close();
});

test('PIN 을 비우면 번호 뒤 4자리, 동호인 회원 번호와 겹치면 409', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await owner.call('/elite/players', { method: 'POST', body: player() })).data.first_pin, '1122');
  assert.strictEqual((await owner.call('/elite/players', { method: 'POST', body: player({ phone: '88110044' }) })).status, 409);
  assert.strictEqual((await owner.call('/elite/players', { method: 'POST', body: player({ phone: '12' }) })).status, 400);
  app.close();
});

test('동호인 임원·일반 회원·선수는 명단을 못 본다, 선수반 코치는 본다', async () => {
  const app = makeApp();
  const { owner, coach } = await makeStaffCoach(app);
  await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222' }) });
  // 동호인 임원 (오너 아님, 선수반 코치 아님)
  const s = await owner.call('/members', { method: 'POST', body: { name: 'Secretary', phone: '88004455', pin: '4444' } });
  await owner.call(`/members/${s.data.id}`, { method: 'PATCH', body: { role: 'admin' } });
  const staff = await loginAs(app.base, '88004455', '4444');
  const member = await loginAs(app.base, '88110044', '1111');
  const p = await loginAs(app.base, '77001122', '2222');
  assert.strictEqual((await staff.call('/elite/players')).status, 403);
  assert.strictEqual((await member.call('/elite/players')).status, 403);
  assert.strictEqual((await p.call('/elite/players')).status, 403);
  assert.strictEqual((await coach.call('/elite/players')).status, 200);
  app.close();
});

test('선수반 코치 지정은 오너만, 선수에게는 못 준다', async () => {
  const app = makeApp();
  const { coach, coachId } = await makeStaffCoach(app);
  const owner = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await coach.call(`/elite/coaches/${coachId}`, { method: 'PUT', body: { on: false } })).status, 403);
  const pid = (await owner.call('/elite/players', { method: 'POST', body: player() })).data.id;
  assert.strictEqual((await owner.call(`/elite/coaches/${pid}`, { method: 'PUT', body: { on: true } })).status, 404);
  const staff = (await owner.call('/elite/staff')).data;
  assert.ok(staff.some(x => x.id === coachId) && staff.some(x => x.id === app.adminId));
  app.close();
});

test('선수 수정·탈퇴·PIN 재설정·삭제(사진 정리 포함)', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  const pid = (await owner.call('/elite/players', { method: 'POST', body: player() })).data.id;
  assert.strictEqual((await owner.call(`/elite/players/${pid}`, { method: 'PATCH', body: { elite_fee: '', status: 'dormant' } })).status, 200);
  const row = app.db.prepare('SELECT elite_fee, status FROM member WHERE id=?').get(pid);
  assert.deepStrictEqual([row.elite_fee, row.status], [null, 'dormant']);
  assert.strictEqual((await owner.call(`/elite/players/${pid}/pin`, { method: 'POST', body: { pin: '9999' } })).status, 200);
  assert.strictEqual((await owner.call(`/elite/players/${app.memberId}`, { method: 'PATCH', body: { name: 'x' } })).status, 404, '동호인 회원은 여기서 못 고친다');
  const sid = app.db.prepare("INSERT INTO elite_session (title, session_date, start_time, end_time) VALUES ('t','2026-11-01','10:00','11:00')").run().lastInsertRowid;
  app.db.prepare("INSERT INTO elite_attendance (session_id, member_id, status) VALUES (?,?,'present')").run(sid, pid);
  app.db.prepare("INSERT INTO elite_due (member_id, period, amount) VALUES (?,'2026-11',1000)").run(pid);
  assert.strictEqual((await owner.call(`/elite/players/${pid}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM elite_attendance WHERE member_id=?').get(pid).c, 0, '출석 기록도 같이 삭제');
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM elite_due WHERE member_id=?').get(pid).c, 0, '수강료 기록도 같이 삭제');
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM member WHERE id=?').get(pid).c, 0);
  app.close();
});
