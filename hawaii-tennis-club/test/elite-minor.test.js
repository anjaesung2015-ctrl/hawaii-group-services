// 선수반 마무리 — 사진 반 구분, 휴면 계정 쿠키, 휴면 선수의 수강료 기록
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { player } = require('./elite-fixtures');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const getFile = (app, c, file) => fetch(app.base.replace(/\/api$/, '/') + file, { headers: { cookie: c.cookie } }).then(r => r.status);

async function setup(app) {
  const owner = await loginAs(app.base, '99000000', '1234');
  const pid = (await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222' }) })).data.id;
  return { owner, pid, p: await loginAs(app.base, '77001122', '2222'), m: await loginAs(app.base, '88110044', '1111') };
}

test('사진 — 선수반 사진은 선수·관리자만, 동호인 사진은 동호인만, 선수는 코치 얼굴은 본다', async () => {
  const app = makeApp();
  const { owner, pid, p, m } = await setup(app);
  const elite = (await owner.call('/elite/notices', { method: 'POST', body: { title: 'Camp', body: 'x', photo_data: PNG } })).data.photo;
  const face = (await owner.call(`/elite/players/${pid}/photo`, { method: 'PUT', body: { photo_data: PNG } })).data.photo;
  const club = (await owner.call('/notices', { method: 'POST', body: { title: 'Club', body: 'y', photo_data: PNG } })).data.photo;
  const coach = (await owner.call('/auth/photo', { method: 'PUT', body: { photo_data: PNG } })).data.photo;
  assert.ok(elite && face && club && coach);
  assert.deepStrictEqual(await Promise.all([elite, face, club, coach].map(f => getFile(app, owner, f))), [200, 200, 200, 200]);
  assert.deepStrictEqual(await Promise.all([elite, face, club, coach].map(f => getFile(app, p, f))), [200, 200, 404, 200]);
  assert.deepStrictEqual(await Promise.all([elite, face, club].map(f => getFile(app, m, f))), [404, 404, 200]);
  app.close();
});

test('휴면으로 바꾸면 이미 로그인한 쿠키도 막힌다', async () => {
  const app = makeApp();
  const { owner, pid, p } = await setup(app);
  assert.strictEqual((await p.call('/elite/sessions')).status, 200);
  await owner.call(`/elite/players/${pid}`, { method: 'PATCH', body: { status: 'dormant' } });
  assert.strictEqual((await p.call('/elite/sessions')).status, 401);
  app.close();
});

test('휴면 선수도 그 달 낸 기록이 있으면 수강료표에 남는다', async () => {
  const app = makeApp();
  const { owner, pid } = await setup(app);
  await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: pid, period: '2030-05', paid: true } });
  await owner.call(`/elite/players/${pid}`, { method: 'PATCH', body: { status: 'dormant' } });
  const may = (await owner.call('/elite/fees/grid?month=2030-05')).data;
  assert.deepStrictEqual([may.summary.paid, may.summary.collected, may.rows[0].status], [1, 700000, 'dormant']);
  assert.strictEqual((await owner.call('/elite/fees/grid?month=2030-06')).data.rows.length, 0, '기록 없는 달에는 안 나온다');
  app.close();
});
