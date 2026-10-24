// 선수반 공지 + 자동 알림
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { player } = require('./elite-fixtures');
const { createJobs } = require('../lib/jobs');

const clock = (stamp) => () => new Date(stamp.replace(' ', 'T') + '+08:00');
const sub = (app, id, ep) => app.db.prepare('INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)').run(id, ep, 'k', 'a');

async function setup(app) {
  const owner = await loginAs(app.base, '99000000', '1234');
  const pid = (await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222' }) })).data.id;
  return { owner, pid, p: await loginAs(app.base, '77001122', '2222') };
}

test('공지 — 관리자가 쓰고 선수가 읽는다, 동호인은 403, 알림은 선수에게만', async () => {
  const app = makeApp();
  const { owner, pid, p } = await setup(app);
  sub(app, pid, 'https://fcm/elite');
  sub(app, app.memberId, 'https://fcm/club');
  const r = await owner.call('/elite/notices', { method: 'POST', body: { title: 'Camp', body: 'Bring rackets', pinned: true } });
  assert.strictEqual(r.status, 200);
  await app.settle();
  assert.deepStrictEqual(app.sent.map(s => s.endpoint), ['https://fcm/elite']);
  assert.strictEqual((await p.call('/elite/notices')).data[0].title, 'Camp');
  assert.strictEqual((await p.call('/elite/notices', { method: 'POST', body: { title: 'x', body: 'y' } })).status, 403);
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/elite/notices')).status, 403);
  assert.strictEqual((await owner.call(`/elite/notices/${r.data.id}`, { method: 'PATCH', body: { title: 'Camp 2' } })).status, 200);
  assert.strictEqual((await owner.call(`/elite/notices/${r.data.id}`, { method: 'DELETE' })).status, 200);
  app.close();
});

test('훈련 하루 전 18시 알림 — 선수에게 한 번만', async () => {
  const app = makeApp();
  const { owner, pid } = await setup(app);
  sub(app, pid, 'https://fcm/elite');
  await owner.call('/elite/sessions', { method: 'POST', body: { title: 'Elite', session_date: '2030-05-07', start_time: '16:00', end_time: '18:00' } });
  await app.settle();
  app.sent.length = 0;
  let jobs = createJobs(app.db, app.notify, { now: clock('2030-05-06 17:00') });
  assert.strictEqual((await jobs.remindEliteSessions()).sent, 0);
  jobs = createJobs(app.db, app.notify, { now: clock('2030-05-06 18:10') });
  assert.strictEqual((await jobs.remindEliteSessions()).sent, 1);
  assert.strictEqual((await jobs.remindEliteSessions()).sent, 0);
  app.close();
});

test('수강료 알림 — 20일 10시부터, 안 낸 선수에게만, 한 달에 한 번', async () => {
  const app = makeApp();
  const { owner, pid } = await setup(app);
  const p2 = (await owner.call('/elite/players', { method: 'POST', body: player({ name: 'Anu', phone: '77003344' }) })).data.id;
  sub(app, pid, 'https://fcm/a');
  sub(app, p2, 'https://fcm/b');
  const month = app.dbmod.thisMonth();
  await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: p2, period: month, paid: true } });
  let jobs = createJobs(app.db, app.notify, { now: clock(`${month}-19 10:30`) });
  assert.strictEqual((await jobs.remindEliteFees()).sent, 0);
  jobs = createJobs(app.db, app.notify, { now: clock(`${month}-20 10:30`) });
  const r = await jobs.remindEliteFees();
  assert.deepStrictEqual([r.unpaid, r.sent], [1, 1]);
  assert.strictEqual(app.sent[0].endpoint, 'https://fcm/a');
  assert.match(app.sent[0].payload.body, /700,000/);
  jobs = createJobs(app.db, app.notify, { now: clock(`${month}-21 10:30`) });
  assert.strictEqual((await jobs.remindEliteFees()).already, true);
  app.close();
});
