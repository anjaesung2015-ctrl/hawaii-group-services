// 가입 신청 — 누구나 신청하고, 관리자가 승인해야 회원이 된다
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, client, loginAs } = require('./helper');

// 2026-10-16부터 회칙 동의(agree)가 있어야 신청된다 (회칙 제6조7)
const req = (over = {}) => ({ name: 'Сарнай', phone: '95556677', pin: '2468', level: 'beginner', agree: true, ...over });

test('로그인 없이 가입 신청할 수 있다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const r = await c.call('/join', { method: 'POST', body: req() });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.id);
  app.close();
});

test('신청만으로는 로그인되지 않는다 (승인 전)', async () => {
  const app = makeApp();
  const c = client(app.base);
  await c.call('/join', { method: 'POST', body: req() });
  const login = await c.call('/auth/login', { method: 'POST', body: { phone: '95556677', pin: '2468' } });
  assert.strictEqual(login.status, 401);
  app.close();
});

test('관리자가 승인하면 그때부터 신청할 때 정한 PIN 으로 들어온다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const made = await c.call('/join', { method: 'POST', body: req() });

  const a = await loginAs(app.base, '99000000', '1234');
  const ok = await a.call(`/join/${made.data.id}/approve`, { method: 'POST' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.name, 'Сарнай');

  const mine = await loginAs(app.base, '95556677', '2468');
  const me = await mine.call('/auth/me');
  assert.strictEqual(me.data.me.name, 'Сарнай');
  assert.strictEqual(me.data.me.role, 'member', '신청으로 들어온 사람은 일반회원이어야 한다');
  app.close();
});

test('승인하면 입회비 미납 한 줄이 함께 선다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const made = await c.call('/join', { method: 'POST', body: req() });
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call(`/join/${made.data.id}/approve`, { method: 'POST' });

  const due = app.db.prepare("SELECT * FROM due WHERE member_id=? AND kind='joining'").get(r.data.member_id);
  assert.ok(due, '입회비 줄이 없다');
  assert.strictEqual(due.amount, 300000);
  assert.strictEqual(due.paid_at, null);
  app.close();
});

test('거절하면 회원이 되지 않는다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const made = await c.call('/join', { method: 'POST', body: req() });
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call(`/join/${made.data.id}/reject`, { method: 'POST' })).status, 200);
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM member WHERE phone=?').get('95556677').c, 0);
  assert.strictEqual((await a.call('/join')).data.count, 0, '처리한 신청은 목록에서 빠진다');
  app.close();
});

test('처리한 신청은 다시 승인·거절할 수 없다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const made = await c.call('/join', { method: 'POST', body: req() });
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call(`/join/${made.data.id}/approve`, { method: 'POST' });
  assert.strictEqual((await a.call(`/join/${made.data.id}/approve`, { method: 'POST' })).status, 404);
  assert.strictEqual((await a.call(`/join/${made.data.id}/reject`, { method: 'POST' })).status, 404);
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM member WHERE phone=?').get('95556677').c, 1, '회원이 두 번 만들어지면 안 된다');
  app.close();
});

test('같은 번호로 두 번 신청할 수 없다', async () => {
  const app = makeApp();
  const c = client(app.base);
  await c.call('/join', { method: 'POST', body: req() });
  const again = await c.call('/join', { method: 'POST', body: req({ name: '다른이름' }) });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.data.error, 'already_requested');
  app.close();
});

test('이미 회원인 번호로는 신청할 수 없다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const r = await c.call('/join', { method: 'POST', body: req({ phone: '8811-0044' }) });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.data.error, 'already_member');
  app.close();
});

test('거절당한 사람은 다시 신청할 수 있다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const made = await c.call('/join', { method: 'POST', body: req() });
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call(`/join/${made.data.id}/reject`, { method: 'POST' });
  assert.strictEqual((await c.call('/join', { method: 'POST', body: req() })).status, 200);
  app.close();
});

test('이름·전화번호·PIN 이 제대로 안 들어오면 거절한다', async () => {
  const app = makeApp();
  const c = client(app.base);
  assert.strictEqual((await c.call('/join', { method: 'POST', body: req({ name: '' }) })).data.error, 'name_required');
  assert.strictEqual((await c.call('/join', { method: 'POST', body: req({ phone: '123' }) })).data.error, 'bad_phone');
  assert.strictEqual((await c.call('/join', { method: 'POST', body: req({ pin: '12' }) })).data.error, 'pin_4_digits');
  app.close();
});

test('한 아이피에서 너무 많이 신청하면 막는다', async () => {
  const app = makeApp();
  const c = client(app.base);
  for (let i = 0; i < 5; i++) {
    await c.call('/join', { method: 'POST', body: req({ phone: `9555000${i}`, name: `사람${i}` }) });
  }
  const over = await c.call('/join', { method: 'POST', body: req({ phone: '95551111', name: '여섯번째' }) });
  assert.strictEqual(over.status, 429);
  app.close();
});

test('신청 목록·승인·거절은 관리자만 (회원은 403, 비로그인은 401)', async () => {
  const app = makeApp();
  const c = client(app.base);
  const made = await c.call('/join', { method: 'POST', body: req() });

  assert.strictEqual((await c.call('/join')).status, 401);
  assert.strictEqual((await c.call(`/join/${made.data.id}/approve`, { method: 'POST' })).status, 401);

  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/join')).status, 403);
  assert.strictEqual((await m.call(`/join/${made.data.id}/approve`, { method: 'POST' })).status, 403);
  assert.strictEqual((await m.call(`/join/${made.data.id}/reject`, { method: 'POST' })).status, 403);
  app.close();
});

test('신청 목록에 이름·번호·레벨·신청일이 보인다', async () => {
  const app = makeApp();
  const c = client(app.base);
  await c.call('/join', { method: 'POST', body: req({ level: 'advanced' }) });
  const a = await loginAs(app.base, '99000000', '1234');
  const d = (await a.call('/join')).data;
  assert.strictEqual(d.count, 1);
  assert.strictEqual(d.rows[0].name, 'Сарнай');
  assert.strictEqual(d.rows[0].phone, '95556677');
  assert.strictEqual(d.rows[0].level, 'advanced');
  assert.ok(d.rows[0].created_at);
  assert.ok(!('pin_hash' in d.rows[0]), 'PIN 해시가 새어나갔다');
  app.close();
});

test('처리 내역을 따로 볼 수 있다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const made = await c.call('/join', { method: 'POST', body: req() });
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call(`/join/${made.data.id}/reject`, { method: 'POST' });
  const h = (await a.call('/join/history')).data;
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].status, 'rejected');
  assert.ok(h[0].decided_at);
  app.close();
});
