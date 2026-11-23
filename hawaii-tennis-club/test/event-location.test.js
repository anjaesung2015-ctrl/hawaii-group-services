// 일정 장소 — 저장·수정·반복 등록·목록에 나온다
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

const ev = (over = {}) => ({ title: '송년회', kind: 'event', event_date: '2026-12-16', start_time: '19:00', end_time: '23:00', courts: 1, ...over });

test('장소를 저장하고, 고치고, 비울 수 있다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/events', { method: 'POST', body: ev({ location: '  Kempinski Khan Palace  ' }) });
  assert.strictEqual(r.status, 200);
  const id = r.data.id;
  let one = await a.call(`/events/${id}`);
  assert.strictEqual(one.data.location, 'Kempinski Khan Palace');
  const list = await a.call('/events?month=2026-12');
  assert.strictEqual(list.data.find(e => e.id === id).location, 'Kempinski Khan Palace');
  // 장소를 안 보내고 메모만 고치면 장소는 그대로
  await a.call(`/events/${id}`, { method: 'PATCH', body: { memo: 'hi' } });
  one = await a.call(`/events/${id}`);
  assert.strictEqual(one.data.location, 'Kempinski Khan Palace');
  await a.call(`/events/${id}`, { method: 'PATCH', body: { location: '' } });
  one = await a.call(`/events/${id}`);
  assert.strictEqual(one.data.location, null);
  app.close();
});

test('반복 등록에도 장소가 들어간다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/events/bulk', { method: 'POST', body: { title: 'Lesson', kind: 'court', start_time: '20:00', end_time: '22:00', courts: 1, location: 'Hawaii Center', from: '2026-12-01', to: '2026-12-07', weekdays: [2] } });
  assert.strictEqual(r.status, 200);
  const rows = app.db.prepare('SELECT location FROM event').all();
  assert.ok(rows.length >= 1 && rows.every(x => x.location === 'Hawaii Center'));
  app.close();
});
