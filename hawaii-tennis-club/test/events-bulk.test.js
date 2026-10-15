// 반복 일정 등록 — "매주 화·목" 처럼 요일·기간을 주면 한 번에 여러 날이 생긴다
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

const base = (over = {}) => ({
  title: '정기모임', kind: 'regular', start_time: '19:00', end_time: '21:00',
  courts: 3, memo: '라켓 준비', from: '2026-11-01', to: '2026-11-30', weekdays: [2, 4], ...over,
});
const dow = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

test('고른 요일에만 일정이 생긴다 (2026년 11월 화·목)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/events/bulk', { method: 'POST', body: base() });
  assert.strictEqual(r.status, 200);

  // 2026-11 의 화요일 3·10·17·24 / 목요일 5·12·19·26 = 8개
  assert.strictEqual(r.data.count, 8, JSON.stringify(r.data.dates));
  assert.ok(r.data.dates.every(d => [2, 4].includes(dow(d))), '고르지 않은 요일이 섞였다');
  assert.deepStrictEqual(r.data.dates, [...r.data.dates].sort(), '날짜 순서가 아니다');
  app.close();
});

test('만들어진 일정에 제목·시간·코트·메모가 모두 들어간다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/events/bulk', { method: 'POST', body: base({ kind: 'tournament', courts: 5 }) });
  const rows = app.db.prepare('SELECT * FROM event ORDER BY event_date').all();
  assert.strictEqual(rows.length, 8);
  for (const e of rows) {
    assert.strictEqual(e.title, '정기모임');
    assert.strictEqual(e.kind, 'tournament');
    assert.strictEqual(e.start_time, '19:00');
    assert.strictEqual(e.end_time, '21:00');
    assert.strictEqual(e.courts, 5);
    assert.strictEqual(e.memo, '라켓 준비');
  }
  app.close();
});

test('기간 양 끝 날짜도 포함된다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  // 2026-11-03 은 화요일, 11-05 는 목요일
  const r = await a.call('/events/bulk', { method: 'POST', body: base({ from: '2026-11-03', to: '2026-11-05' }) });
  assert.deepStrictEqual(r.data.dates, ['2026-11-03', '2026-11-05']);
  app.close();
});

test('하루만 골라도 된다 (그날이 고른 요일이면)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/events/bulk', { method: 'POST', body: base({ from: '2026-11-03', to: '2026-11-03', weekdays: [2] }) });
  assert.strictEqual(r.data.count, 1);
  app.close();
});

test('두 번 눌러도 같은 일정이 겹쳐 쌓이지 않는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const first = await a.call('/events/bulk', { method: 'POST', body: base() });
  const again = await a.call('/events/bulk', { method: 'POST', body: base() });
  assert.strictEqual(first.data.count, 8);
  assert.strictEqual(again.data.count, 0);
  assert.strictEqual(again.data.skipped, 8);
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM event').get().c, 8);
  app.close();
});

test('기간을 늘려 다시 등록하면 새로 생긴 날짜만 추가된다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/events/bulk', { method: 'POST', body: base({ to: '2026-11-15' }) });   // 3·5·10·12 = 4개
  const more = await a.call('/events/bulk', { method: 'POST', body: base({ to: '2026-11-30' }) });
  assert.strictEqual(more.data.count, 4, '뒤쪽 4개만 새로 생겨야 한다');
  assert.strictEqual(more.data.skipped, 4);
  app.close();
});

test('요일을 고르지 않으면 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/events/bulk', { method: 'POST', body: base({ weekdays: [] }) })).data.error, 'weekdays_required');
  assert.strictEqual((await a.call('/events/bulk', { method: 'POST', body: base({ weekdays: [9] }) })).data.error, 'weekdays_required');
  app.close();
});

test('기간이 거꾸로면 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/events/bulk', { method: 'POST', body: base({ from: '2026-11-30', to: '2026-11-01' }) });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'bad_range');
  app.close();
});

test('기간·날짜 형식이 잘못되면 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  for (const over of [{ from: '2026/11/01' }, { to: '' }, { from: '2026-11-32' }]) {
    const r = await a.call('/events/bulk', { method: 'POST', body: base(over) });
    assert.strictEqual(r.status, 400, JSON.stringify(over));
  }
  app.close();
});

test('제목·시간이 잘못되면 한 개도 만들지 않는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/events/bulk', { method: 'POST', body: base({ title: '' }) })).data.error, 'title_required');
  assert.strictEqual((await a.call('/events/bulk', { method: 'POST', body: base({ end_time: '18:00' }) })).data.error, 'end_before_start');
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM event').get().c, 0);
  app.close();
});

test('한 번에 120개를 넘으면 거절한다 (실수로 몇 년치를 만드는 것 방지)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/events/bulk', {
    method: 'POST',
    body: base({ from: '2026-01-01', to: '2027-12-31', weekdays: [0, 1, 2, 3, 4, 5, 6] }),
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'too_many_dates');
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM event').get().c, 0, '하나도 만들지 않아야 한다');
  app.close();
});

test('기간 안에 해당 요일이 없으면 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  // 2026-11-02(월) ~ 11-02 에 화·목은 없다
  const r = await a.call('/events/bulk', { method: 'POST', body: base({ from: '2026-11-02', to: '2026-11-02' }) });
  assert.strictEqual(r.data.error, 'no_dates');
  app.close();
});

test('일반 회원은 반복 등록을 못 한다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/events/bulk', { method: 'POST', body: base() })).status, 403);
  app.close();
});

test('반복으로 만든 일정도 참석 응답과 명단이 정상이다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/events/bulk', { method: 'POST', body: base({ from: '2026-11-03', to: '2026-11-05' }) });
  const id = app.db.prepare('SELECT id FROM event ORDER BY event_date').pluck().get();

  const m = await loginAs(app.base, '88110044', '1111');
  await m.call(`/events/${id}/rsvp`, { method: 'PUT', body: { answer: 'yes' } });
  const d = (await a.call(`/events/${id}`)).data;
  assert.deepStrictEqual(d.counts, { yes: 1, no: 0, maybe: 0 });
  assert.deepStrictEqual(d.roster.yes.map(p => p.name), ['Батбаяр']);
  app.close();
});
