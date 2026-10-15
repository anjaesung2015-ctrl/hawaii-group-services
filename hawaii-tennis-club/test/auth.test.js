// 로그인 — 전화번호 + 4자리 PIN
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, client, loginAs } = require('./helper');

test('바른 전화번호·PIN 이면 들어간다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const r = await c.call('/auth/login', { method: 'POST', body: { phone: '99000000', pin: '1234' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.me.role, 'admin');
  assert.ok(c.cookie.startsWith('htc_sess='), '세션 쿠키가 없다');
  app.close();
});

test('번호를 어떻게 적어도 같은 번호로 본다 (0901-2345, +976 …)', async () => {
  const app = makeApp();
  for (const phone of ['99000000', '9900-0000', '+976 9900 0000', '976-99000000']) {
    const c = client(app.base);
    const r = await c.call('/auth/login', { method: 'POST', body: { phone, pin: '1234' } });
    assert.strictEqual(r.status, 200, phone);
  }
  app.close();
});

test('PIN 이 틀리면 401, 없는 번호도 똑같이 401 (번호 떠보기 방지)', async () => {
  const app = makeApp();
  const c = client(app.base);
  const bad = await c.call('/auth/login', { method: 'POST', body: { phone: '99000000', pin: '9999' } });
  const none = await c.call('/auth/login', { method: 'POST', body: { phone: '70000000', pin: '1234' } });
  assert.strictEqual(bad.status, 401);
  assert.strictEqual(none.status, 401);
  assert.deepStrictEqual(bad.data, none.data);
  app.close();
});

test('다섯 번 틀리면 잠시 잠긴다 (PIN 이 4자리뿐이라)', async () => {
  const app = makeApp();
  const c = client(app.base);
  for (let i = 0; i < 5; i++) await c.call('/auth/login', { method: 'POST', body: { phone: '99000000', pin: '0000' } });
  const locked = await c.call('/auth/login', { method: 'POST', body: { phone: '99000000', pin: '1234' } });
  assert.strictEqual(locked.status, 429);
  assert.ok(locked.data.retry_after > 0);
  app.close();
});

test('휴면 회원은 들어갈 수 없다', async () => {
  const app = makeApp();
  app.db.prepare("UPDATE member SET status='dormant' WHERE id=?").run(app.memberId);
  const c = client(app.base);
  const r = await c.call('/auth/login', { method: 'POST', body: { phone: '88110044', pin: '1111' } });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.data.error, 'dormant');
  app.close();
});

test('쿠키가 있으면 다시 열어도 로그인 화면을 건너뛴다', async () => {
  const app = makeApp();
  const c = await loginAs(app.base, '88110044', '1111');
  const me = await c.call('/auth/me');
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.data.me.name, 'Батбаяр');
  app.close();
});

test('로그인 없이 회원용 자료를 보면 401', async () => {
  const app = makeApp();
  const c = client(app.base);
  for (const p of ['/members', '/events', '/dues/me', '/notices']) {
    assert.strictEqual((await c.call(p)).status, 401, p);
  }
  app.close();
});

test('본인 PIN 변경 — 지금 PIN 을 맞혀야 바뀐다', async () => {
  const app = makeApp();
  const c = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await c.call('/auth/pin', { method: 'POST', body: { current: '0000', new_pin: '2222' } })).status, 401);
  assert.strictEqual((await c.call('/auth/pin', { method: 'POST', body: { current: '1111', new_pin: '22' } })).status, 400);
  assert.strictEqual((await c.call('/auth/pin', { method: 'POST', body: { current: '1111', new_pin: '2222' } })).status, 200);

  const again = client(app.base);
  assert.strictEqual((await again.call('/auth/login', { method: 'POST', body: { phone: '88110044', pin: '2222' } })).status, 200);
  app.close();
});

test('로그아웃하면 세션이 끊긴다', async () => {
  const app = makeApp();
  const c = await loginAs(app.base, '99000000', '1234');
  await c.call('/auth/logout', { method: 'POST' });
  assert.strictEqual((await c.call('/auth/me')).status, 401);
  app.close();
});
