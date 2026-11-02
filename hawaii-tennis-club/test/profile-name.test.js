// 회원 본인이 이름을 고친다 (☰ My profile)
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

test('회원이 자기 이름을 고친다 — 빈 이름·너무 긴 이름은 400, 공백은 정리', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await m.call('/auth/profile', { method: 'PATCH', body: { name: '  Bat   Erdene ' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.me.name, 'Bat Erdene');
  assert.strictEqual(app.db.prepare('SELECT name FROM member WHERE id=?').get(app.memberId).name, 'Bat Erdene');
  assert.strictEqual((await m.call('/auth/profile', { method: 'PATCH', body: { name: '   ' } })).status, 400);
  assert.strictEqual((await m.call('/auth/profile', { method: 'PATCH', body: { name: 'x'.repeat(41) } })).status, 400);
  // 남의 이름은 못 바꾼다 — 언제나 본인 줄만
  assert.notStrictEqual(app.db.prepare('SELECT name FROM member WHERE id=?').get(app.adminId).name, 'Bat Erdene');
  app.close();
});

test('선수반 선수도 이름은 고치지만 레벨은 못 바꾼다', async () => {
  const app = makeApp();
  app.db.prepare("UPDATE member SET program='elite' WHERE id=?").run(app.memberId);
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/auth/profile', { method: 'PATCH', body: { name: 'Player' } })).status, 200);
  assert.strictEqual((await m.call('/auth/profile', { method: 'PATCH', body: { level: 'advanced' } })).status, 403);
  app.close();
});
