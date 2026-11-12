// 사진첩 · 캘린더(달별 일정) · 디렉터 보조 자리
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeApp, loginAs } = require('./helper');

const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAADAAEAAQBPR+8AAAAASUVORK5CYII=';
const up = (app, p) => path.join(app.uploadDir, path.basename(p));

test('회원이 사진 여러 장을 올리면 최신순으로 모두가 본다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await m.call('/gallery', { method: 'POST', body: { photos: [TINY, TINY, TINY], caption: '  11월 대회  ' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.ids.length, 3);

  const a = await loginAs(app.base, '99000000', '1234');
  const list = (await a.call('/gallery')).data;
  assert.strictEqual(list.total, 3);
  assert.deepStrictEqual(list.rows.map(x => x.id), [...r.data.ids].reverse());
  assert.strictEqual(list.rows[0].caption, '11월 대회');
  assert.strictEqual(list.rows[0].author, 'Батбаяр');
  assert.ok(/^uploads\//.test(list.rows[0].photo));
  for (const x of list.rows) assert.ok(fs.existsSync(up(app, x.photo)));

  // 사진 파일도 로그인한 회원에게 열린다
  const res = await fetch(app.base.replace('/api', '/') + list.rows[0].photo, { headers: { cookie: m.cookie } });
  assert.strictEqual(res.status, 200);
  app.close();
});

test('사진이 없거나 너무 많으면 거절, 잘못된 사진은 아무것도 남기지 않는다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/gallery', { method: 'POST', body: { photos: [] } })).status, 400);
  assert.strictEqual((await m.call('/gallery', { method: 'POST', body: { photos: Array(11).fill(TINY) } })).status, 400);
  assert.strictEqual((await m.call('/gallery', { method: 'POST', body: { photos: [TINY, 'data:text/plain;base64,aGk='] } })).status, 400);
  assert.strictEqual((await m.call('/gallery')).data.total, 0);
  const files = fs.existsSync(app.uploadDir) ? fs.readdirSync(app.uploadDir) : [];
  assert.deepStrictEqual(files, []);
  app.close();
});

test('지우기는 올린 사람과 운영진만, 지우면 파일도 사라진다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  const mine = (await a.call('/gallery', { method: 'POST', body: { photos: [TINY] } })).data.ids[0];
  const theirs = (await m.call('/gallery', { method: 'POST', body: { photos: [TINY] } })).data.ids[0];

  assert.strictEqual((await m.call(`/gallery/${mine}`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await m.call(`/gallery/${mine}`, { method: 'PATCH', body: { caption: 'x' } })).status, 403);

  const file = (await m.call('/gallery')).data.rows.find(x => x.id === theirs).photo;
  assert.strictEqual((await m.call(`/gallery/${theirs}`, { method: 'PATCH', body: { caption: '새 설명' } })).status, 200);
  assert.strictEqual((await a.call(`/gallery/${theirs}`, { method: 'DELETE' })).status, 200);   // 운영진은 남의 사진도
  await app.settle();
  assert.ok(!fs.existsSync(up(app, file)));
  assert.deepStrictEqual((await m.call('/gallery')).data.rows.map(x => x.id), [mine]);
  app.close();
});

test('사진첩은 로그인한 동호인만', async () => {
  const app = makeApp();
  const res = await fetch(app.base + '/gallery');
  assert.strictEqual(res.status, 401);
  app.close();
});

test('캘린더 — ?month= 로 그 달 일정을 지난 날까지 모두 받는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const mk = (title, event_date, kind = 'event') =>
    a.call('/events', { method: 'POST', body: { title, kind, event_date, start_time: '10:00', end_time: '12:00', courts: 2 } });
  await mk('지난 행사', '2020-03-05');
  await mk('같은 달 대회', '2020-03-28', 'tournament');
  await mk('다음 달', '2020-04-01');

  const m = await loginAs(app.base, '88110044', '1111');
  const rows = (await m.call('/events?month=2020-03')).data;
  assert.deepStrictEqual(rows.map(e => e.title), ['지난 행사', '같은 달 대회']);
  assert.ok(rows[0].counts);
  // 잘못된 month 는 무시하고 기본(오늘부터)
  assert.deepStrictEqual((await m.call('/events?month=2020-13')).data, []);
  app.close();
});

test('디렉터마다 보조 자리가 있고, 오너가 회원을 앉히면 배지가 붙는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const roles = (await a.call('/officers')).data.map(o => o.role);
  for (const d of ['match', 'event', 'external']) {
    assert.ok(roles.includes(`${d}_asst`), `${d}_asst 없음`);
    assert.strictEqual(roles.indexOf(`${d}_asst`) > roles.indexOf('external'), true);
  }
  assert.ok(roles.indexOf('external_asst') < roles.indexOf('honorary'), '보조는 명예직보다 앞');

  const r = await a.call('/officers/event_asst', { method: 'PUT', body: { member_id: app.memberId } });
  assert.strictEqual(r.status, 200);
  const o = (await a.call('/officers')).data.find(x => x.role === 'event_asst');
  assert.strictEqual(o.name, 'Батбаяр');

  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/officers/match_asst', { method: 'PUT', body: { person_name: 'x' } })).status, 403);
  const me = (await m.call('/members')).data.find(x => x.id === app.memberId);
  assert.strictEqual(me.officer_role, 'event_asst');
  app.close();
});
