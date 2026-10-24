// 선수반 훈련 일정·출석
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { player } = require('./elite-fixtures');

const ses = (over = {}) => ({ title: 'Elite training', session_date: '2030-05-06', start_time: '16:00', end_time: '18:00', court: '1-2', ...over });

async function setup(app) {
  const owner = await loginAs(app.base, '99000000', '1234');
  const pid = (await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222' }) })).data.id;
  const p2 = (await owner.call('/elite/players', { method: 'POST', body: player({ name: 'Anu', phone: '77003344', pin: '2222' }) })).data.id;
  return { owner, pid, p2, p: await loginAs(app.base, '77001122', '2222') };
}

test('관리자가 훈련을 만들고, 선수는 다가오는 훈련을 본다 (만들기는 못 함)', async () => {
  const app = makeApp();
  const { owner, p } = await setup(app);
  const r = await owner.call('/elite/sessions', { method: 'POST', body: ses({ coach_id: app.adminId }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await owner.call('/elite/sessions', { method: 'POST', body: ses({ end_time: '15:00' }) })).status, 400);
  assert.strictEqual((await owner.call('/elite/sessions', { method: 'POST', body: ses({ coach_id: app.memberId }) })).status, 400, '선수반 코치가 아니면 담당 불가');
  const list = (await p.call('/elite/sessions')).data;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].coach_name, '대표');
  assert.strictEqual((await p.call('/elite/sessions', { method: 'POST', body: ses() })).status, 403);
  app.close();
});

test('요일 반복 등록 — 같은 제목·날짜·시간은 건너뛰고 120개 제한', async () => {
  const app = makeApp();
  const { owner } = await setup(app);
  const body = { ...ses(), from: '2030-05-06', to: '2030-05-19', weekdays: [1, 3, 5] };   // 월수금 2주 = 6회
  const r1 = (await owner.call('/elite/sessions/bulk', { method: 'POST', body })).data;
  assert.deepStrictEqual([r1.count, r1.skipped], [6, 0]);
  const r2 = (await owner.call('/elite/sessions/bulk', { method: 'POST', body })).data;
  assert.deepStrictEqual([r2.count, r2.skipped], [0, 6]);
  const big = await owner.call('/elite/sessions/bulk', { method: 'POST', body: { ...body, to: '2031-12-31', weekdays: [0, 1, 2, 3, 4, 5, 6] } });
  assert.strictEqual(big.status, 400);
  app.close();
});

test('출석 — 관리자가 ✓/✗ 를 남기고 지울 수 있다, 선수는 내 출석만 본다', async () => {
  const app = makeApp();
  const { owner, pid, p2, p } = await setup(app);
  const sid = (await owner.call('/elite/sessions', { method: 'POST', body: ses() })).data.id;
  await owner.call(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: pid, status: 'present' } });
  await owner.call(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: p2, status: 'absent' } });
  const one = (await owner.call(`/elite/sessions/${sid}`)).data;
  assert.deepStrictEqual(one.roster.map(r => [r.name, r.status]), [['Anu', 'absent'], ['Temuulen', 'present']]);
  await owner.call(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: p2, status: null } });
  assert.strictEqual((await owner.call(`/elite/sessions/${sid}`)).data.roster.find(r => r.id === p2).status, null);
  assert.strictEqual((await owner.call(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: app.memberId, status: 'present' } })).status, 404);
  const mine = (await p.call('/elite/sessions')).data[0];
  assert.strictEqual(mine.my_status, 'present');
  assert.strictEqual((await p.call(`/elite/sessions/${sid}`)).status, 403, '선수는 다른 선수 출석 명단을 못 본다');
  app.close();
});

test('지난 훈련은 ?past=1, 수정·삭제는 관리자만', async () => {
  const app = makeApp();
  const { owner, p } = await setup(app);
  const sid = (await owner.call('/elite/sessions', { method: 'POST', body: ses({ session_date: '2020-01-06' }) })).data.id;
  assert.strictEqual((await p.call('/elite/sessions')).data.length, 0);
  assert.strictEqual((await p.call('/elite/sessions?past=1')).data.length, 1);
  assert.strictEqual((await owner.call(`/elite/sessions/${sid}`, { method: 'PATCH', body: { court: '5' } })).status, 200);
  assert.strictEqual((await p.call(`/elite/sessions/${sid}`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await owner.call(`/elite/sessions/${sid}`, { method: 'DELETE' })).status, 200);
  app.close();
});

test('새 훈련 알림은 선수에게 (동호인은 안 받음)', async () => {
  const app = makeApp();
  const { owner, pid } = await setup(app);
  app.db.prepare("INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)").run(pid, 'https://fcm/elite', 'k', 'a');
  app.db.prepare("INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)").run(app.memberId, 'https://fcm/club', 'k', 'a');
  await owner.call('/elite/sessions', { method: 'POST', body: ses() });
  await app.settle();
  assert.deepStrictEqual(app.sent.map(s => s.endpoint), ['https://fcm/elite']);
  app.close();
});
