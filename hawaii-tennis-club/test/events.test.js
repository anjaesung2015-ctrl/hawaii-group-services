// 일정 — 등록(관리자) + 참석/불참/미정(회원)
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { today } = require('../lib/db');

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const sample = (over = {}) => ({
  title: '정기모임', kind: 'regular', event_date: addDays(today(), 2),
  start_time: '19:00', end_time: '21:00', courts: 3, memo: '라켓 준비', ...over,
});

test('관리자는 일정을 등록한다 (종류·코트 수·메모까지)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/events', { method: 'POST', body: sample({ kind: 'tournament', courts: 5 }) });
  assert.strictEqual(r.status, 200);

  const got = await a.call(`/events/${r.data.id}`);
  assert.strictEqual(got.data.kind, 'tournament');
  assert.strictEqual(got.data.courts, 5);
  assert.strictEqual(got.data.memo, '라켓 준비');
  app.close();
});

test('일반 회원은 일정을 만들거나 지울 수 없다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const made = await a.call('/events', { method: 'POST', body: sample() });

  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/events', { method: 'POST', body: sample() })).status, 403);
  assert.strictEqual((await m.call(`/events/${made.data.id}`, { method: 'PATCH', body: { title: 'x' } })).status, 403);
  assert.strictEqual((await m.call(`/events/${made.data.id}`, { method: 'DELETE' })).status, 403);
  app.close();
});

test('끝나는 시간이 시작보다 빠르면 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/events', { method: 'POST', body: sample({ start_time: '21:00', end_time: '19:00' }) });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'end_before_start');
  app.close();
});

test('빠진 칸·엉뚱한 값은 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const cases = [
    [{ title: '' }, 'title_required'],
    [{ kind: 'party' }, 'bad_kind'],
    [{ event_date: '2026/11/01' }, 'bad_date'],
    [{ start_time: '25:00' }, 'bad_time'],
  ];
  for (const [over, expected] of cases) {
    const r = await a.call('/events', { method: 'POST', body: sample(over) });
    assert.strictEqual(r.data.error, expected, JSON.stringify(over));
  }
  app.close();
});

test('참석을 고르면 집계에 바로 들어가고, 바꾸면 덮어쓴다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const id = (await a.call('/events', { method: 'POST', body: sample() })).data.id;

  const m = await loginAs(app.base, '88110044', '1111');
  let r = await m.call(`/events/${id}/rsvp`, { method: 'PUT', body: { answer: 'yes' } });
  assert.deepStrictEqual(r.data.counts, { yes: 1, no: 0, maybe: 0 });

  r = await m.call(`/events/${id}/rsvp`, { method: 'PUT', body: { answer: 'maybe' } });
  assert.deepStrictEqual(r.data.counts, { yes: 0, no: 0, maybe: 1 }, '같은 사람이 두 번 세어지면 안 된다');
  assert.strictEqual((await m.call(`/events/${id}`)).data.my_answer, 'maybe');
  app.close();
});

test('참석 명단에 이름이 뜬다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const id = (await a.call('/events', { method: 'POST', body: sample() })).data.id;
  const m = await loginAs(app.base, '88110044', '1111');
  await m.call(`/events/${id}/rsvp`, { method: 'PUT', body: { answer: 'yes' } });
  await a.call(`/events/${id}/rsvp`, { method: 'PUT', body: { answer: 'no' } });

  const d = (await a.call(`/events/${id}`)).data;
  assert.deepStrictEqual(d.roster.yes.map(p => p.name), ['Батбаяр']);
  assert.deepStrictEqual(d.roster.no.map(p => p.name), ['대표']);
  assert.deepStrictEqual(d.roster.maybe, []);
  app.close();
});

test('엉뚱한 응답은 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const id = (await a.call('/events', { method: 'POST', body: sample() })).data.id;
  assert.strictEqual((await a.call(`/events/${id}/rsvp`, { method: 'PUT', body: { answer: '참석' } })).status, 400);
  app.close();
});

test('다가오는 일정은 가까운 순으로 3개 (지난 일정은 안 섞인다)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  for (const d of [5, 1, 3, 9, -2]) {
    await a.call('/events', { method: 'POST', body: sample({ title: `D${d}`, event_date: addDays(today(), d) }) });
  }
  const up = (await a.call('/events/upcoming?limit=3')).data;
  assert.deepStrictEqual(up.map(e => e.title), ['D1', 'D3', 'D5']);
  app.close();
});

test('오늘 일정은 다가오는 일정에 남아있다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/events', { method: 'POST', body: sample({ title: '오늘', event_date: today() }) });
  const up = (await a.call('/events/upcoming')).data;
  assert.deepStrictEqual(up.map(e => e.title), ['오늘']);
  app.close();
});

test('지난 일정은 past=1 로 따로 본다 (최근 것부터)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/events', { method: 'POST', body: sample({ title: '어제', event_date: addDays(today(), -1) }) });
  await a.call('/events', { method: 'POST', body: sample({ title: '지난주', event_date: addDays(today(), -7) }) });
  await a.call('/events', { method: 'POST', body: sample({ title: '내일', event_date: addDays(today(), 1) }) });

  assert.deepStrictEqual((await a.call('/events')).data.map(e => e.title), ['내일']);
  assert.deepStrictEqual((await a.call('/events?past=1')).data.map(e => e.title), ['어제', '지난주']);
  app.close();
});

test('일정을 지우면 참석 기록도 함께 사라진다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const id = (await a.call('/events', { method: 'POST', body: sample() })).data.id;
  await a.call(`/events/${id}/rsvp`, { method: 'PUT', body: { answer: 'yes' } });
  await a.call(`/events/${id}`, { method: 'DELETE' });
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM rsvp WHERE event_id=?').get(id).c, 0);
  app.close();
});

test('일부만 보내서 고쳐도 나머지 값은 그대로다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const id = (await a.call('/events', { method: 'POST', body: sample() })).data.id;
  await a.call(`/events/${id}`, { method: 'PATCH', body: { title: '이름만 바꿈' } });
  const e = (await a.call(`/events/${id}`)).data;
  assert.strictEqual(e.title, '이름만 바꿈');
  assert.strictEqual(e.courts, 3);
  assert.strictEqual(e.start_time, '19:00');
  app.close();
});
