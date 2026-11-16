// 회원 생일(본인이 프로필에 월·일) + 홈 전광판(오늘 생일·운영진 문구·30일 안 행사 D-day)
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { today } = require('../lib/db');

const plus = (n) => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('생일 — 본인이 MM-DD 로 적고 지운다, 잘못된 날짜는 거절', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  for (const bad of ['13-01', '02-30', '1-5', '2024-03-05', 'abc']) {
    assert.strictEqual((await m.call('/auth/profile', { method: 'PATCH', body: { birthday: bad } })).data.error, 'bad_birthday', bad);
  }
  const r = await m.call('/auth/profile', { method: 'PATCH', body: { birthday: '02-29' } });
  assert.strictEqual(r.data.me.birthday, '02-29');
  assert.strictEqual((await m.call('/auth/me')).data.me.birthday, '02-29');
  const row = (await m.call('/members')).data.find(x => x.id === r.data.me.id);
  assert.strictEqual(row.birthday, '02-29');                  // 명단에도 (🎂 표시용)
  assert.strictEqual(row.phone, undefined);                    // 전화번호는 여전히 안 보인다
  assert.strictEqual((await m.call('/auth/profile', { method: 'PATCH', body: { birthday: '' } })).data.me.birthday, null);
  app.close();
});

test('전광판 — 오늘 생일, 운영진 문구(줄마다), 30일 안 행사·대회 D-day', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const a = await loginAs(app.base, '99000000', '1234');
  await m.call('/auth/profile', { method: 'PATCH', body: { birthday: today().slice(5) } });

  assert.strictEqual((await m.call('/ticker/text', { method: 'PUT', body: { text: 'x' } })).status, 403);
  await a.call('/ticker/text', { method: 'PUT', body: { text: '  송년회 신청 받아요 \n\n 11월 회비 마감  ' } });

  const ev = (title, kind, date) => app.db.prepare(`INSERT INTO event (title, kind, event_date, start_time, end_time) VALUES (?,?,?, '20:00','23:00')`).run(title, kind, date);
  ev('송년회', 'event', plus(5));
  ev('월례대회', 'tournament', today());
  ev('정기', 'regular', plus(1));          // 정기 운동은 안 나온다
  ev('먼 행사', 'event', plus(40));        // 30일 넘으면 안 나온다
  ev('지난 행사', 'event', plus(-1));

  const d = (await m.call('/ticker')).data;
  const myId = (await m.call("/auth/me")).data.me.id;
  assert.ok(d.birthdays.some(b => b.id === myId));
  assert.deepStrictEqual(d.messages, ['송년회 신청 받아요', '11월 회비 마감']);
  assert.deepStrictEqual(d.events.map(e => [e.title, e.days]), [['월례대회', 0], ['송년회', 5]]);
  assert.strictEqual((await fetch(app.base + '/ticker')).status, 401);
  app.close();
});
