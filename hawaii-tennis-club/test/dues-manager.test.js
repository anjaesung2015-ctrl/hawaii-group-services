// 회비 담당 — 운영진이 아니어도 오너가 정하면 회비 현황표를 보고 납부 체크를 한다
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

test('회비 담당은 현황표·미납자·납부 체크를 하고, 다른 운영진 일은 못 한다', async () => {
  const app = makeApp();
  const [o, m] = await Promise.all([loginAs(app.base, '99000000', '1234'), loginAs(app.base, '88110044', '1111')]);

  // 지정 전 — 일반 회원
  assert.strictEqual((await m.call('/dues/grid')).status, 403);
  assert.strictEqual((await m.call('/dues/mark', { method: 'PUT', body: { member_id: app.adminId, paid: true } })).status, 403);

  // 오너가 지정
  const r = await o.call(`/members/${app.memberId}`, { method: 'PATCH', body: { dues_manager: '1' } });
  assert.strictEqual(r.status, 200);
  const me = (await m.call('/auth/me')).data;
  assert.strictEqual(me.me.dues_manager, true);

  assert.strictEqual((await m.call('/dues/grid')).status, 200);
  assert.strictEqual((await m.call('/dues/unpaid')).status, 200);
  const mk = await m.call('/dues/mark', { method: 'PUT', body: { member_id: app.memberId, paid: true, method: 'transfer' } });
  assert.strictEqual(mk.status, 200);
  assert.ok(mk.data.paid_at);

  // 운영진 일은 여전히 못 한다
  assert.strictEqual((await m.call('/join')).status, 403);
  assert.strictEqual((await m.call('/notices', { method: 'POST', body: { title: 'x', body: 'y' } })).status, 403);
  // 명단에 표시
  const row = (await m.call('/members')).data.find(x => x.id === app.memberId);
  assert.strictEqual(row.dues_manager, 1);

  // 회수
  await o.call(`/members/${app.memberId}`, { method: 'PATCH', body: { dues_manager: '0' } });
  assert.strictEqual((await m.call('/dues/grid')).status, 403);
  app.close();
});

test('회비 담당 지정은 오너만 — 운영진도 못 준다', async () => {
  const app = makeApp();
  const third = app.db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at)
                                VALUES ('Officer','95550009',?,'admin','beginner','active','2026-05-01')`)
    .run(app.dbmod.hashPin('3333')).lastInsertRowid;
  const a = await loginAs(app.base, '95550009', '3333');
  const r = await a.call(`/members/${app.memberId}`, { method: 'PATCH', body: { dues_manager: '1' } });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(app.db.prepare('SELECT dues_manager FROM member WHERE id=?').pluck().get(app.memberId), 0);
  // 운영진은 원래대로 회비 체크 가능
  assert.strictEqual((await a.call('/dues/grid')).status, 200);
  assert.ok(third);
  app.close();
});
