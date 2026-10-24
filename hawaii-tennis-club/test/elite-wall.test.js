// 선수반 벽 — 선수 계정은 동호인 화면에 못 들어오고, 동호인 집계·알림에 안 섞인다
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

// 선수 하나를 DB 에 바로 넣는다 (선수 등록 API 는 Task 3)
function addPlayer(app, phone = '77001122', name = 'Temuulen') {
  return app.db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at, program)
                         VALUES (?,?,?,'member','advanced','active','2026-10-01','elite')`)
    .run(name, phone, app.dbmod.hashPin('2222')).lastInsertRowid;
}

test('선수 계정은 동호인 API 7곳에서 403, 내 정보·알림·설정·회칙은 된다', async () => {
  const app = makeApp();
  addPlayer(app);
  const p = await loginAs(app.base, '77001122', '2222');
  for (const path of ['/events', '/dues/me', '/notices', '/posts', '/members', '/officers', '/chat/rooms']) {
    assert.strictEqual((await p.call(path)).status, 403, path);
  }
  const me = (await p.call('/auth/me')).data.me;
  assert.strictEqual(me.program, 'elite');
  for (const path of ['/settings', '/docs/rules?lang=ko', '/push']) {
    assert.notStrictEqual((await p.call(path)).status, 403, path);
  }
  app.close();
});

test('선수는 동호인 명단·회비 현황표·미납자에 안 나온다', async () => {
  const app = makeApp();
  const pid = addPlayer(app);
  const a = await loginAs(app.base, '99000000', '1234');
  assert.ok(!(await a.call('/members')).data.some(m => m.id === pid));
  assert.ok(!(await a.call('/dues/grid')).data.rows.some(r => r.member_id === pid));
  assert.ok(!(await a.call('/dues/unpaid')).data.rows.some(r => r.member_id === pid));
  app.close();
});

test('동호인 임원은 선수를 고치거나 PIN 을 바꾸거나 지울 수 없다 (404)', async () => {
  const app = makeApp();
  const pid = addPlayer(app);
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call(`/members/${pid}`, { method: 'PATCH', body: { name: 'x' } })).status, 404);
  assert.strictEqual((await a.call(`/members/${pid}/pin`, { method: 'POST', body: { pin: '1234' } })).status, 404);
  assert.strictEqual((await a.call(`/members/${pid}`, { method: 'DELETE' })).status, 404);
  assert.strictEqual((await a.call('/dues/mark', { method: 'PUT', body: { member_id: pid, paid: true } })).status, 404);
  assert.strictEqual((await a.call('/chat/dm', { method: 'POST', body: { member_id: pid } })).status, 404);
  app.close();
});

test('동호인 공지 알림은 선수에게 안 간다', async () => {
  const app = makeApp();
  const pid = addPlayer(app);
  app.db.prepare("INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)").run(pid, 'https://fcm/elite', 'k', 'a');
  app.db.prepare("INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)").run(app.memberId, 'https://fcm/club', 'k', 'a');
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/notices', { method: 'POST', body: { title: 'Club night', body: 'Friday' } });
  await app.settle();
  assert.deepStrictEqual(app.sent.map(s => s.endpoint), ['https://fcm/club']);
  app.close();
});

module.exports = { addPlayer };

test("선수는 레벨·코치 표시를 스스로 못 바꾼다", async () => {
  const app = makeApp();
  addPlayer(app);
  const p = await loginAs(app.base, "77001122", "2222");
  assert.strictEqual((await p.call("/auth/profile", { method: "PATCH", body: { is_coach: true } })).status, 403);
  app.close();
});
