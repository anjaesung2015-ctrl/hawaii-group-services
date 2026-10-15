// 회원 명단 — 관리자만 고치고, 회원에게는 이름·레벨만 보인다
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

test('일반 회원 화면에는 전화번호·가입일·메모가 내려가지 않는다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const list = (await m.call('/members')).data;
  assert.strictEqual(list.length, 2);
  for (const row of list) {
    assert.ok(row.name && row.level, '이름과 레벨은 보여야 한다');
    for (const hidden of ['phone', 'joined_at', 'memo', 'pin_hash']) {
      assert.ok(!(hidden in row), `${hidden} 가 새어나갔다`);
    }
  }
  app.close();
});

test('관리자 화면에는 전화번호·가입일이 보인다 (PIN 은 절대 안 나간다)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const list = (await a.call('/members')).data;
  assert.ok(list.every(r => r.phone && r.joined_at));
  assert.ok(list.every(r => !('pin_hash' in r)), 'PIN 해시가 새어나갔다');
  app.close();
});

test('관리자가 회원을 추가한다 — PIN 을 비우면 번호 뒤 4자리', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/members', { method: 'POST', body: { name: 'Мөнхбат', phone: '8999-1100', level: 'advanced' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.first_pin, '1100');

  const login = await loginAs(app.base, '89991100', '1100');
  assert.strictEqual((await login.call('/auth/me')).data.me.name, 'Мөнхбат');
  app.close();
});

test('같은 전화번호는 두 번 넣을 수 없다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/members', { method: 'POST', body: { name: '중복', phone: '8811-0044', pin: '1111' } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.data.error, 'phone_taken');
  app.close();
});

test('전화번호 8자리·PIN 4자리가 아니면 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/members', { method: 'POST', body: { name: 'a', phone: '123', pin: '1111' } })).data.error, 'bad_phone');
  assert.strictEqual((await a.call('/members', { method: 'POST', body: { name: 'a', phone: '95550000', pin: '99' } })).data.error, 'pin_4_digits');
  assert.strictEqual((await a.call('/members', { method: 'POST', body: { name: '', phone: '95550000', pin: '1111' } })).data.error, 'name_required');
  app.close();
});

test('레벨·상태·권한을 고칠 수 있다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call(`/members/${app.memberId}`, { method: 'PATCH', body: { level: 'advanced', status: 'dormant', role: 'admin', title: '코치' } });
  const m = app.db.prepare('SELECT * FROM member WHERE id=?').get(app.memberId);
  assert.strictEqual(m.level, 'advanced');
  assert.strictEqual(m.status, 'dormant');
  assert.strictEqual(m.role, 'admin');
  assert.strictEqual(m.title, '코치');
  app.close();
});

test('마지막 관리자는 일반회원으로 내리거나 지울 수 없다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const down = await a.call(`/members/${app.adminId}`, { method: 'PATCH', body: { role: 'member' } });
  const del = await a.call(`/members/${app.adminId}`, { method: 'DELETE' });
  assert.strictEqual(down.status, 409);
  assert.strictEqual(down.data.error, 'last_admin');
  assert.strictEqual(del.status, 409);
  app.close();
});

test('관리자가 둘이면 한 명은 내릴 수 있다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call(`/members/${app.memberId}`, { method: 'PATCH', body: { role: 'admin' } });
  assert.strictEqual((await a.call(`/members/${app.adminId}`, { method: 'PATCH', body: { role: 'member' } })).status, 200);
  app.close();
});

test('관리자가 잊어버린 PIN 을 새로 정해준다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call(`/members/${app.memberId}/pin`, { method: 'POST', body: { pin: '12' } })).status, 400);
  assert.strictEqual((await a.call(`/members/${app.memberId}/pin`, { method: 'POST', body: { pin: '7777' } })).status, 200);
  const c = await loginAs(app.base, '88110044', '7777');
  assert.strictEqual((await c.call('/auth/me')).status, 200);
  app.close();
});

test('일반 회원은 명단을 고칠 수 없다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/members', { method: 'POST', body: { name: 'x', phone: '95550000', pin: '1111' } })).status, 403);
  assert.strictEqual((await m.call(`/members/${app.adminId}`, { method: 'PATCH', body: { name: 'x' } })).status, 403);
  assert.strictEqual((await m.call(`/members/${app.adminId}`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await m.call(`/members/${app.adminId}/pin`, { method: 'POST', body: { pin: '0000' } })).status, 403);
  app.close();
});

// 일정·공지는 작성자(member)를 참조한다. 그냥 지우면 외래키가 막아 500이 난다.
test('공지·일정을 쓴 운영진도 지울 수 있다 (글은 남고 작성자 표시만 사라진다)', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  // 운영진 한 명을 만들고 그 사람이 공지·일정을 쓴다 (오너 자신은 지울 수 없으므로)
  await owner.call(`/members/${app.memberId}`, { method: 'PATCH', body: { role: 'admin' } });
  const staff = await loginAs(app.base, '88110044', '1111');
  await staff.call('/notices', { method: 'POST', body: { title: '공지', body: 'b' } });
  await staff.call('/events', { method: 'POST', body: { title: '모임', kind: 'regular', event_date: '2026-11-01', start_time: '19:00', end_time: '21:00' } });

  const r = await owner.call(`/members/${app.memberId}`, { method: 'DELETE' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM notice').get().c, 1, '공지는 남아야 한다');
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM event').get().c, 1, '일정도 남아야 한다');
  assert.strictEqual(app.db.prepare('SELECT created_by FROM notice').get().created_by, null);
  app.close();
});

test('지운 회원의 쿠키는 더 이상 통하지 않는다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/auth/me')).status, 200);
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call(`/members/${app.memberId}`, { method: 'DELETE' });
  assert.strictEqual((await m.call('/auth/me')).status, 401);
  app.close();
});

test('첫 실행이면 관리자 한 명을 만들고, 이미 있으면 만들지 않는다', async () => {
  const app = makeApp();
  const { ensureFirstAdmin } = app.dbmod;
  assert.strictEqual(ensureFirstAdmin(app.db), null, '이미 관리자가 있으면 또 만들면 안 된다');

  app.db.prepare("DELETE FROM member WHERE role='admin'").run();
  const made = ensureFirstAdmin(app.db, { name: '대표', phone: '99112233', pin: '4321' });
  assert.strictEqual(made.phone, '99112233');
  const row = app.db.prepare("SELECT * FROM member WHERE role='admin'").get();
  assert.ok(row && app.dbmod.checkPin('4321', row.pin_hash));
  app.close();
});
