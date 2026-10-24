// 때 되면 알아서 보내는 알림 — 일정 하루 전, 회비 미납
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { createJobs } = require('../lib/jobs');

// '2026-11-02 18:30' (울란바토르 벽시계) 인 척하는 시계
const clock = (stamp) => () => new Date(stamp.replace(' ', 'T') + '+08:00');

const addSub = async (app, phone, pin, n) => {
  const c = await loginAs(app.base, phone, pin);
  await c.call('/push', { method: 'POST', body: { endpoint: `https://fcm/x/${n}`, keys: { p256dh: 'p' + n, auth: 'a' + n } } });
  return c;
};

test('내일 일정은 전날 저녁에 한 번만 알린다', async () => {
  const app = makeApp();
  await addSub(app, '88110044', '1111', 1);
  app.db.prepare(`INSERT INTO event (title, kind, event_date, start_time, end_time, courts)
                  VALUES ('정기모임','regular','2026-11-03','19:00','21:00',3)`).run();

  // 낮에는 아직 보내지 않는다
  let jobs = createJobs(app.db, app.notify, { now: clock('2026-11-02 14:00') });
  assert.strictEqual((await jobs.remindEvents()).sent, 0);
  assert.strictEqual(app.sent.length, 0);

  // 저녁 6시 이후에 보낸다
  jobs = createJobs(app.db, app.notify, { now: clock('2026-11-02 18:10') });
  const r = await jobs.remindEvents();
  assert.strictEqual(r.sent, 1);
  assert.match(app.sent[0].payload.title, /내일 19:00 정기모임/);
  assert.strictEqual(app.sent[0].payload.url, '#schedule');

  // 다시 깨어나도 또 보내지 않는다
  app.sent.length = 0;
  await jobs.remindEvents();
  assert.strictEqual(app.sent.length, 0, '같은 일정을 두 번 알렸다');
  assert.ok(app.db.prepare('SELECT reminded_at FROM event').get().reminded_at, '보낸 표시가 남아야 한다');
  app.close();
});

test('모레 일정은 아직 알리지 않는다', async () => {
  const app = makeApp();
  await addSub(app, '88110044', '1111', 1);
  app.db.prepare(`INSERT INTO event (title, kind, event_date, start_time, end_time, courts)
                  VALUES ('모레','regular','2026-11-04','19:00','21:00',1)`).run();
  const jobs = createJobs(app.db, app.notify, { now: clock('2026-11-02 20:00') });
  assert.strictEqual((await jobs.remindEvents()).sent, 0);
  app.close();
});

test('회비 알림은 5일(회칙 납부 기한) 아침 10시부터, 못 낸 사람에게만, 한 달에 한 번', async () => {
  const app = makeApp();
  await addSub(app, '99000000', '1234', 1);   // 대표 — 이번 달 납부 완료로 만들 것
  await addSub(app, '88110044', '1111', 2);   // 미납으로 남긴다
  const month = app.dbmod.thisMonth();
  app.db.prepare(`INSERT INTO due (member_id, kind, period, amount, paid_at, method)
                  VALUES (?,'monthly',?,200000,?, 'cash')`).run(app.adminId, month, month + '-05');

  // 4일에는 아직
  let jobs = createJobs(app.db, app.notify, { now: clock(`${month}-04 10:30`) });
  assert.strictEqual((await jobs.remindDues()).sent, 0);

  // 5일 아침 9시에도 아직 (10시부터)
  jobs = createJobs(app.db, app.notify, { now: clock(`${month}-05 09:30`) });
  assert.strictEqual((await jobs.remindDues()).sent, 0);

  // 5일 아침 10시 — 회칙의 납부 기한
  jobs = createJobs(app.db, app.notify, { now: clock(`${month}-05 10:30`) });
  const r = await jobs.remindDues();
  assert.strictEqual(r.unpaid, 1);
  assert.strictEqual(r.sent, 1);
  assert.strictEqual(app.sent.length, 1);
  assert.strictEqual(app.sent[0].endpoint, 'https://fcm/x/2', '낸 사람에게 보내면 안 된다');
  assert.match(app.sent[0].payload.body, /200,000/);
  assert.match(app.sent[0].payload.body, /5일/);

  // 다음 날 또 보내지 않는다
  app.sent.length = 0;
  jobs = createJobs(app.db, app.notify, { now: clock(`${month}-06 10:30`) });
  const again = await jobs.remindDues();
  assert.strictEqual(again.already, true);
  assert.strictEqual(app.sent.length, 0);
  app.close();
});

test('전원이 회비를 냈으면 아무에게도 안 보낸다', async () => {
  const app = makeApp();
  await addSub(app, '88110044', '1111', 1);
  const month = app.dbmod.thisMonth();
  for (const id of [app.adminId, app.memberId]) {
    app.db.prepare(`INSERT INTO due (member_id, kind, period, amount, paid_at, method)
                    VALUES (?,'monthly',?,200000,?,'cash')`).run(id, month, month + '-03');
  }
  const jobs = createJobs(app.db, app.notify, { now: clock(`${month}-05 11:00`) });
  const r = await jobs.remindDues();
  assert.strictEqual(r.unpaid, 0);
  assert.strictEqual(app.sent.length, 0);
  app.close();
});

test('알림이 실패해도 보낸 표시는 남아 무한 반복하지 않는다', async () => {
  const app = makeApp({ fail: 500 });
  await addSub(app, '88110044', '1111', 1);
  app.db.prepare(`INSERT INTO event (title, kind, event_date, start_time, end_time, courts)
                  VALUES ('정기모임','regular','2026-11-03','19:00','21:00',3)`).run();
  const jobs = createJobs(app.db, app.notify, { now: clock('2026-11-02 19:00') });
  await jobs.remindEvents();
  assert.ok(app.db.prepare('SELECT reminded_at FROM event').get().reminded_at);
  app.close();
});

test('tick 은 두 가지를 모두 돌리고 터지지 않는다', async () => {
  const app = makeApp();
  const jobs = createJobs(app.db, app.notify, { now: clock('2026-11-02 19:00') });
  await jobs.tick();
  app.close();
});
