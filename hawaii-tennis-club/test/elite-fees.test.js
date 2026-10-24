// 선수반 수강료 — 선수별 금액(없으면 기본 800,000₮), 체크 시점 금액 고정, 선수는 내 것만
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { player } = require('./elite-fixtures');

async function setup(app) {
  const owner = await loginAs(app.base, '99000000', '1234');
  const a = (await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222', elite_fee: 700000 }) })).data.id;
  const b = (await owner.call('/elite/players', { method: 'POST', body: player({ name: 'Anu', phone: '77003344', elite_fee: '' }) })).data.id;
  return { owner, a, b, p: await loginAs(app.base, '77001122', '2222') };
}

test('현황표 — 선수별 금액, 비운 선수는 기본 800,000₮', async () => {
  const app = makeApp();
  const { owner, a, b } = await setup(app);
  const g = (await owner.call('/elite/fees/grid?month=2030-05')).data;
  assert.strictEqual(g.default_fee, 800000);
  assert.strictEqual(g.due_day, 20);
  assert.strictEqual(g.rows.find(r => r.member_id === a).amount, 700000);
  assert.strictEqual(g.rows.find(r => r.member_id === b).amount, 800000);
  assert.deepStrictEqual([g.summary.players, g.summary.paid, g.summary.unpaid], [2, 0, 2]);
  app.close();
});

test('체크하면 그때 금액으로 고정 — 나중에 금액을 바꿔도 낸 기록은 그대로', async () => {
  const app = makeApp();
  const { owner, a } = await setup(app);
  const r = await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, period: '2030-05', paid: true, method: 'transfer', paid_at: '2030-05-18' } });
  assert.deepStrictEqual([r.data.amount, r.data.method, r.data.paid_at], [700000, 'transfer', '2030-05-18']);
  await owner.call(`/elite/players/${a}`, { method: 'PATCH', body: { elite_fee: 900000 } });
  const row = (await owner.call('/elite/fees/grid?month=2030-05')).data.rows.find(x => x.member_id === a);
  assert.deepStrictEqual([row.amount, row.paid], [700000, true]);
  await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, period: '2030-05', paid: false } });
  assert.strictEqual((await owner.call('/elite/fees/grid?month=2030-05')).data.rows.find(x => x.member_id === a).paid, false);
  app.close();
});

test('선수는 내 수강료만 보고 체크는 못 한다, 동호인 회원은 403', async () => {
  const app = makeApp();
  const { owner, a, p } = await setup(app);
  await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, period: '2030-05', paid: true } });
  const me = (await p.call('/elite/fees/me')).data;
  assert.strictEqual(me.fee, 700000);
  assert.strictEqual(me.due_day, 20);
  assert.deepStrictEqual(me.rows.filter(r => r.period === '2030-05').map(r => [r.period, r.amount, !!r.paid_at]), [['2030-05', 700000, true]]);
  assert.strictEqual((await p.call('/elite/fees/grid')).status, 403);
  assert.strictEqual((await p.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, paid: true } })).status, 403);
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/elite/fees/me')).status, 403);
  app.close();
});

test('기본 수강료는 오너가 설정에서 바꾼다', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await owner.call('/settings', { method: 'PUT', body: { elite_fee: 850000 } })).data.elite_fee, 850000);
  assert.strictEqual((await owner.call('/settings', { method: 'PUT', body: { elite_fee: -1 } })).status, 400);
  app.close();
});


test('이번 달 줄이 없으면 선수 화면에 미납으로 나온다', async () => {
  const app = makeApp();
  const { p } = await setup(app);
  const me = (await p.call('/elite/fees/me')).data;
  const cur = me.rows.find(r => r.period === app.dbmod.thisMonth());
  assert.deepStrictEqual([cur.amount, cur.paid_at], [700000, null]);
  app.close();
});

test('메모를 비우면 지워지고, 미납 줄은 다시 체크할 때 새 금액', async () => {
  const app = makeApp();
  const { owner, a } = await setup(app);
  await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, period: '2030-06', paid: true, note: 'half' } });
  await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, period: '2030-06', paid: false, note: '' } });
  await owner.call(`/elite/players/${a}`, { method: 'PATCH', body: { elite_fee: 900000 } });
  const r = (await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, period: '2030-06', paid: true } })).data;
  assert.deepStrictEqual([r.note, r.amount], [null, 900000]);
  app.close();
});
