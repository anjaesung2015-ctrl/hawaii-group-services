// 선수반 가입 신청 — 신청·승인 방식은 동호인과 같고, 보고 승인하는 사람은 오너뿐
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const apply = (over = {}) => ({ program: 'elite', name: 'Temuulen', phone: '77001122', pin: '2468', birth_year: 2012,
  level: 'intermediate', parent_name: 'Bold', parent_phone: '99887766', privacy: true, ...over });
const post = (app, body) => fetch(app.base + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json() }));
const sub = (app, id, ep) => app.db.prepare('INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)').run(id, ep, 'k', 'a');

// 오너 + 동호인 임원(오너 아님) + 선수반 코치
async function people(app) {
  const owner = await loginAs(app.base, '99000000', '1234');
  const s = (await owner.call('/members', { method: 'POST', body: { name: 'Secretary', phone: '88004455', pin: '4444' } })).data.id;
  await owner.call(`/members/${s}`, { method: 'PATCH', body: { role: 'admin' } });
  const c = (await owner.call('/members', { method: 'POST', body: { name: 'Coach B', phone: '88002233', pin: '3333' } })).data.id;
  await owner.call(`/elite/coaches/${c}`, { method: 'PUT', body: { on: true } });
  return { owner, sid: s, cid: c, staff: await loginAs(app.base, '88004455', '4444'), coach: await loginAs(app.base, '88002233', '3333') };
}

test('선수반 신청 — 회칙 동의 없이 개인정보 동의만으로 되고, 알림은 오너에게만', async () => {
  const app = makeApp();
  const { sid, cid } = await people(app);
  sub(app, app.adminId, 'https://fcm/owner');
  sub(app, sid, 'https://fcm/secretary');
  sub(app, cid, 'https://fcm/coach');
  assert.strictEqual((await post(app, apply({ privacy: false }))).status, 400);
  assert.strictEqual((await post(app, apply({ birth_year: 1800 }))).status, 400);
  const r = await post(app, apply());
  assert.strictEqual(r.status, 200);
  await app.settle();
  assert.deepStrictEqual(app.sent.map(x => x.endpoint), ['https://fcm/owner']);
  assert.strictEqual((await post(app, apply())).status, 409, '같은 번호로 두 번 신청 불가');
  app.close();
});

test('동호인 임원·선수반 코치는 선수반 신청을 못 보고 못 건드린다, 오너는 본다', async () => {
  const app = makeApp();
  const { owner, staff, coach } = await people(app);
  const id = (await post(app, apply())).data.id;
  assert.strictEqual((await staff.call('/join')).data.rows.length, 0, 'Members 탭 대기 목록에는 동호인 신청만');
  assert.strictEqual((await staff.call('/join?program=elite')).status, 403);
  assert.strictEqual((await coach.call('/join?program=elite')).status, 403);
  assert.strictEqual((await staff.call(`/join/${id}/approve`, { method: 'POST' })).status, 403);
  assert.strictEqual((await staff.call(`/join/${id}/reject`, { method: 'POST' })).status, 403);
  const list = (await owner.call('/join?program=elite')).data;
  assert.deepStrictEqual([list.count, list.rows[0].birth_year, list.rows[0].parent_phone], [1, 2012, '99887766']);
  assert.strictEqual((await owner.call('/join')).data.count, 0, '오너의 Members 탭에도 동호인 신청만');
  app.close();
});

test('오너가 승인하면 선수 계정이 되고 신청한 PIN 으로 로그인, 입회비 줄은 없다', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  const id = (await post(app, apply())).data.id;
  const r = await owner.call(`/join/${id}/approve`, { method: 'POST' });
  assert.strictEqual(r.status, 200);
  const m = app.db.prepare('SELECT program, birth_year, parent_name, parent_phone, rules_agreed_at FROM member WHERE id=?').get(r.data.member_id);
  assert.deepStrictEqual(m, { program: 'elite', birth_year: 2012, parent_name: 'Bold', parent_phone: '99887766', rules_agreed_at: null });
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM due WHERE member_id=?').get(r.data.member_id).c, 0);
  const p = await loginAs(app.base, '77001122', '2468');
  assert.strictEqual((await p.call('/auth/me')).data.me.program, 'elite');
  app.close();
});

test('지난 신청 내역 — 동호인 임원에게는 선수반 신청이 안 나온다', async () => {
  const app = makeApp();
  const { owner, staff } = await people(app);
  const id = (await post(app, apply())).data.id;
  await owner.call(`/join/${id}/reject`, { method: 'POST' });
  assert.strictEqual((await staff.call('/join/history')).data.filter(h => h.id === id).length, 0);
  assert.strictEqual((await owner.call('/join/history')).data.filter(h => h.id === id).length, 1);
  app.close();
});

test('선수반 신청서 사진은 동호인 임원이 못 열고, 오너는 연다', async () => {
  const app = makeApp();
  const { owner, staff } = await people(app);
  await post(app, apply({ photo_data: PNG }));
  const photo = (await owner.call('/join?program=elite')).data.rows[0].photo;
  const get = (c) => fetch(app.base.replace(/\/api$/, '/') + photo, { headers: { cookie: c.cookie } }).then(r => r.status);
  assert.deepStrictEqual([await get(owner), await get(staff)], [200, 404]);
  app.close();
});

test('동호인 신청은 그대로 — program 을 안 보내면 동호인 (회칙 동의 필요)', async () => {
  const app = makeApp();
  const r = await post(app, { name: 'Bat', name_en: 'Bat', phone: '99223344', pin: '1234', shirt_size: 'M', privacy: true });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'agree_required');
  app.close();
});
