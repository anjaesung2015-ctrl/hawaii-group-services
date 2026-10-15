// 권한 3단계 — 오너(사장님) / 운영진(권한 받은 사람) / 회원
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

// 운영진(관리자)이지만 오너가 아닌 사람을 하나 만든다
async function withStaff(app) {
  const owner = await loginAs(app.base, '99000000', '1234');
  await owner.call(`/members/${app.memberId}`, { method: 'PATCH', body: { role: 'admin' } });
  const staff = await loginAs(app.base, '88110044', '1111');
  return { owner, staff };
}

test('부팅하면 첫 관리자가 오너가 된다 (딱 한 명)', async () => {
  const app = makeApp();
  const { ensureOwner } = app.dbmod;
  // 앱이 뜰 때 이미 지정된다
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM member WHERE is_owner=1').get().c, 1);
  assert.strictEqual(app.db.prepare('SELECT id FROM member WHERE is_owner=1').get().id, app.adminId);
  assert.strictEqual(ensureOwner(app.db), null, '이미 있으면 또 만들지 않는다');

  // 오너가 사라지면 다시 가장 오래된 관리자를 오너로
  app.db.prepare('UPDATE member SET is_owner=0').run();
  assert.strictEqual(ensureOwner(app.db).id, app.adminId);
  app.close();
});

test('내가 오너인지 로그인 응답에 들어온다', async () => {
  const app = makeApp();
  const o = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await o.call('/auth/me')).data.me.is_owner, true);
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/auth/me')).data.me.is_owner, false);
  app.close();
});

test('운영진 권한을 주고 거두는 것은 오너만', async () => {
  const app = makeApp();
  const { owner, staff } = await withStaff(app);

  // 운영진이 다른 사람에게 권한을 주려 하면 막힌다
  const r = await staff.call(`/members/${app.adminId}`, { method: 'PATCH', body: { role: 'member' } });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.data.error, 'owner_only');

  // 오너는 줄 수 있고 거둘 수도 있다
  assert.strictEqual((await owner.call(`/members/${app.memberId}`, { method: 'PATCH', body: { role: 'member' } })).status, 200);
  assert.strictEqual(app.db.prepare('SELECT role FROM member WHERE id=?').get(app.memberId).role, 'member');
  app.close();
});

test('운영진은 이름·레벨 같은 다른 칸은 고칠 수 있다', async () => {
  const app = makeApp();
  const { staff } = await withStaff(app);
  const r = await staff.call(`/members/${app.adminId}`, { method: 'PATCH', body: { level: 'advanced', memo: '메모' } });
  assert.strictEqual(r.status, 200);
  app.close();
});

test('회칙 수정은 오너만 (운영진도 못 한다)', async () => {
  const app = makeApp();
  const { owner, staff } = await withStaff(app);
  const body = '제1조 (명칭) 하와이 테니스 클럽. '.repeat(5);

  const no = await staff.call('/docs/rules', { method: 'PUT', body: { lang: 'ko', body } });
  assert.strictEqual(no.status, 403);
  assert.strictEqual(no.data.error, 'owner_only');
  assert.strictEqual((await owner.call('/docs/rules', { method: 'PUT', body: { lang: 'ko', body } })).status, 200);
  app.close();
});

test('조직도·회비 금액 설정도 오너만', async () => {
  const app = makeApp();
  const { owner, staff } = await withStaff(app);

  assert.strictEqual((await staff.call('/officers/president', { method: 'PUT', body: { person_name: '누구' } })).status, 403);
  assert.strictEqual((await owner.call('/officers/president', { method: 'PUT', body: { person_name: '누구' } })).status, 200);

  assert.strictEqual((await staff.call('/settings', { method: 'PUT', body: { monthly_fee: 1000 } })).status, 403);
  assert.strictEqual((await owner.call('/settings', { method: 'PUT', body: { monthly_fee: 250000 } })).status, 200);
  app.close();
});

test('회원 삭제는 오너만, 오너 자신은 삭제할 수 없다', async () => {
  const app = makeApp();
  const { owner, staff } = await withStaff(app);

  assert.strictEqual((await staff.call(`/members/${app.adminId}`, { method: 'DELETE' })).status, 403);
  const self = await owner.call(`/members/${app.adminId}`, { method: 'DELETE' });
  assert.strictEqual(self.status, 409);
  assert.strictEqual(self.data.error, 'cannot_delete_owner');
  assert.strictEqual((await owner.call(`/members/${app.memberId}`, { method: 'DELETE' })).status, 200);
  app.close();
});

test('운영진은 가입 승인·회원 등록·공지·일정·회비를 할 수 있다', async () => {
  const app = makeApp();
  const { staff } = await withStaff(app);

  // 가입 승인
  const c = require('./helper').client(app.base);
  const id = (await c.call('/join', { method: 'POST', body: { name: 'Сарнай', phone: '95556677', pin: '2468', agree: true } })).data.id;
  assert.strictEqual((await staff.call(`/join/${id}/approve`, { method: 'POST' })).status, 200);

  // 회원 직접 등록
  assert.strictEqual((await staff.call('/members', { method: 'POST', body: { name: '새회원', phone: '95550001', pin: '1111' } })).status, 200);
  // 공지·일정·회비
  assert.strictEqual((await staff.call('/notices', { method: 'POST', body: { title: 'ㄱ', body: 'ㄴ' } })).status, 200);
  assert.strictEqual((await staff.call('/events', { method: 'POST', body: { title: '모임', kind: 'regular', event_date: '2026-11-03', start_time: '19:00', end_time: '21:00' } })).status, 200);
  assert.strictEqual((await staff.call('/dues/mark', { method: 'PUT', body: { member_id: app.memberId, paid: true, method: 'cash' } })).status, 200);
  app.close();
});

test('일반 회원은 가입 승인도 회원 등록도 못 한다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');   // 권한을 안 준 상태
  const c = require('./helper').client(app.base);
  const id = (await c.call('/join', { method: 'POST', body: { name: 'Сарнай', phone: '95556677', pin: '2468', agree: true } })).data.id;

  assert.strictEqual((await m.call(`/join/${id}/approve`, { method: 'POST' })).status, 403);
  assert.strictEqual((await m.call('/members', { method: 'POST', body: { name: 'x', phone: '95550002', pin: '1111' } })).status, 403);
  assert.strictEqual((await m.call('/docs/rules', { method: 'PUT', body: { lang: 'ko', body: 'x'.repeat(100) } })).status, 403);
  app.close();
});

test('명단에 오너 표시가 내려온다 (회원 화면에도)', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const rows = (await m.call('/members')).data;
  assert.strictEqual(rows[0].is_owner, 1, '오너가 맨 위');
  assert.ok(!('phone' in rows[0]), '회원 화면에는 전화번호가 없다');
  app.close();
});
