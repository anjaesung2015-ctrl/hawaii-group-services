// 레벨 직접 고르기 + 코치 등록
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, client, loginAs } = require('./helper');

test('회원이 자기 레벨을 직접 바꾼다 (이상한 값은 400)', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await m.call('/auth/profile', { method: 'PATCH', body: { level: 'advanced' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.me.level, 'advanced');
  assert.strictEqual((await m.call('/auth/me')).data.me.level, 'advanced');
  assert.strictEqual((await m.call('/auth/profile', { method: 'PATCH', body: { level: 'pro' } })).status, 400);
  app.close();
});

test('회원이 코치를 직접 켜고 끈다 — 권한(role)은 못 바꾼다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  await m.call('/auth/profile', { method: 'PATCH', body: { is_coach: '1', role: 'admin' } });
  let me = (await m.call('/auth/me')).data.me;
  assert.strictEqual(me.is_coach, true);
  assert.strictEqual(me.role, 'member');
  await m.call('/auth/profile', { method: 'PATCH', body: { is_coach: '0' } });
  me = (await m.call('/auth/me')).data.me;
  assert.strictEqual(me.is_coach, false);
  assert.strictEqual((await m.call('/auth/profile', { method: 'PATCH', body: {} })).status, 400);
  app.close();
});

test('임원이 회원을 코치로 등록·해제하고, 명단에 누구나 코치 표시를 본다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const mid = (await a.call('/members')).data.find(x => x.phone === '88110044').id;
  assert.strictEqual((await a.call(`/members/${mid}`, { method: 'PATCH', body: { is_coach: '1' } })).status, 200);

  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/members')).data.find(x => x.id === mid).is_coach, 1);
  assert.strictEqual((await m.call('/auth/me')).data.me.is_coach, true);

  await a.call(`/members/${mid}`, { method: 'PATCH', body: { is_coach: '0' } });
  assert.strictEqual((await a.call('/members')).data.find(x => x.id === mid).is_coach, 0);
  app.close();
});

test('새 회원을 처음부터 코치로 넣을 수 있다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/members', { method: 'POST', body: { name: 'Coach B', phone: '89990001', is_coach: true } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await a.call('/members')).data.find(x => x.id === r.data.id).is_coach, 1);
  app.close();
});

test('코치로 가입 신청 → 승인하면 코치 회원이 된다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const made = await c.call('/join', { method: 'POST', body: {
    name: 'Тренер', phone: '95550000', pin: '2468', level: 'advanced', is_coach: '1', agree: true, privacy: true } });
  assert.strictEqual(made.status, 200);
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/join')).data.rows[0].is_coach, 1);
  await a.call(`/join/${made.data.id}/approve`, { method: 'POST' });
  const me = (await (await loginAs(app.base, '95550000', '2468')).call('/auth/me')).data.me;
  assert.strictEqual(me.is_coach, true);
  assert.strictEqual(me.level, 'advanced');
  app.close();
});
