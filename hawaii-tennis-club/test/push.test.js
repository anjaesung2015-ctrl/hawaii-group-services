// 폰 알림 — 구독 등록·해지와 "누구에게 가는가"
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, client, loginAs } = require('./helper');

const sub = (n = 1) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: 'key-p256dh-' + n, auth: 'key-auth-' + n },
});

test('구독을 등록하고 상태를 돌려준다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/push')).data.subscribed, false);

  assert.strictEqual((await m.call('/push', { method: 'POST', body: sub() })).status, 200);
  const d = (await m.call('/push')).data;
  assert.strictEqual(d.subscribed, true);
  assert.strictEqual(d.devices, 1);
  assert.ok(d.publicKey, '브라우저가 쓸 공개키가 없다');
  app.close();
});

test('기기를 두 대 등록할 수 있고, 같은 기기를 다시 등록하면 덮어쓴다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  await m.call('/push', { method: 'POST', body: sub(1) });
  await m.call('/push', { method: 'POST', body: sub(2) });
  await m.call('/push', { method: 'POST', body: sub(1) });
  assert.strictEqual((await m.call('/push')).data.devices, 2);
  app.close();
});

test('구독 정보가 엉터리면 거절한다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  for (const bad of [{}, { endpoint: 'not-a-url', keys: { p256dh: 'a', auth: 'b' } }, { endpoint: 'https://x/y' }]) {
    assert.strictEqual((await m.call('/push', { method: 'POST', body: bad })).status, 400);
  }
  app.close();
});

test('끄면 이 기기만, 또는 전부 해지된다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  await m.call('/push', { method: 'POST', body: sub(1) });
  await m.call('/push', { method: 'POST', body: sub(2) });

  await m.call('/push', { method: 'DELETE', body: { endpoint: sub(1).endpoint } });
  assert.strictEqual((await m.call('/push')).data.devices, 1);
  await m.call('/push', { method: 'DELETE' });
  assert.strictEqual((await m.call('/push')).data.subscribed, false);
  app.close();
});

test('로그인하지 않으면 구독할 수 없다', async () => {
  const app = makeApp();
  const c = client(app.base);
  assert.strictEqual((await c.call('/push')).status, 401);
  assert.strictEqual((await c.call('/push', { method: 'POST', body: sub() })).status, 401);
  app.close();
});

test('테스트 알림 — 켜져 있으면 가고, 기기가 없으면 알려준다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const none = await m.call('/push/test', { method: 'POST' });
  assert.strictEqual(none.status, 409);
  assert.strictEqual(none.data.error, 'no_device');

  await m.call('/push', { method: 'POST', body: sub() });
  const ok = await m.call('/push/test', { method: 'POST' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.sent, 1);
  assert.strictEqual(app.sent.length, 1);
  assert.match(app.sent[0].payload.body, /🎾|잘/);
  app.close();
});

// ---- 누구에게 가는가 ----

test('공지를 올리면 쓴 사람 빼고 모두에게 간다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  await a.call('/push', { method: 'POST', body: sub(1) });
  await m.call('/push', { method: 'POST', body: sub(2) });

  app.sent.length = 0;
  await a.call('/notices', { method: 'POST', body: { title: '11월 일정', body: '화·목 19시' } });
  await app.settle();

  assert.strictEqual(app.sent.length, 1, '쓴 사람에게도 가면 안 된다');
  assert.strictEqual(app.sent[0].endpoint, sub(2).endpoint);
  assert.match(app.sent[0].payload.title, /11월 일정/);
  assert.strictEqual(app.sent[0].payload.url, '#notices');
  app.close();
});

test('게시판 새 글도 쓴 사람 빼고 모두에게 간다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  await a.call('/push', { method: 'POST', body: sub(1) });
  await m.call('/push', { method: 'POST', body: sub(2) });

  app.sent.length = 0;
  await m.call('/posts', { method: 'POST', body: { body: '어제 경기 사진 올립니다' } });
  await app.settle();

  assert.strictEqual(app.sent.length, 1);
  assert.strictEqual(app.sent[0].endpoint, sub(1).endpoint, '대표에게 가야 한다');
  assert.match(app.sent[0].payload.title, /Батбаяр/);
  app.close();
});

test('댓글은 글쓴이에게만 간다 (내 글에 내가 달면 아무에게도 안 간다)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  await a.call('/push', { method: 'POST', body: sub(1) });
  await m.call('/push', { method: 'POST', body: sub(2) });

  const id = (await m.call('/posts', { method: 'POST', body: { body: '라켓 추천 좀' } })).data.id;
  await app.settle();

  app.sent.length = 0;
  await a.call(`/posts/${id}/comments`, { method: 'POST', body: { body: '저는 윌슨 씁니다' } });
  await app.settle();
  assert.strictEqual(app.sent.length, 1);
  assert.strictEqual(app.sent[0].endpoint, sub(2).endpoint, '글쓴이에게만');

  app.sent.length = 0;
  await m.call(`/posts/${id}/comments`, { method: 'POST', body: { body: '감사합니다' } });
  await app.settle();
  assert.strictEqual(app.sent.length, 0, '내 글에 내가 단 댓글은 알리지 않는다');
  app.close();
});

test('새 일정도 알림이 간다 (반복 등록은 한 번만)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  await m.call('/push', { method: 'POST', body: sub(2) });

  app.sent.length = 0;
  await a.call('/events', { method: 'POST', body: { title: '정기모임', kind: 'regular', event_date: '2026-11-03', start_time: '19:00', end_time: '21:00' } });
  await app.settle();
  assert.strictEqual(app.sent.length, 1);
  assert.strictEqual(app.sent[0].payload.url, '#schedule');

  app.sent.length = 0;
  await a.call('/events/bulk', {
    method: 'POST',
    body: { title: '주말모임', kind: 'regular', start_time: '09:00', end_time: '11:00', from: '2026-11-01', to: '2026-11-30', weekdays: [0, 6] },
  });
  await app.settle();
  assert.strictEqual(app.sent.length, 1, '여러 개를 만들어도 폰은 한 번만 울려야 한다');
  app.close();
});

test('가입 신청은 관리자에게만 간다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  await a.call('/push', { method: 'POST', body: sub(1) });
  await m.call('/push', { method: 'POST', body: sub(2) });

  app.sent.length = 0;
  const c = client(app.base);
  await c.call('/join', { method: 'POST', body: { name: 'Сарнай', phone: '95556677', pin: '2468', agree: true } });
  await app.settle();

  assert.strictEqual(app.sent.length, 1);
  assert.strictEqual(app.sent[0].endpoint, sub(1).endpoint, '관리자에게만');
  assert.match(app.sent[0].payload.body, /Сарнай/);
  app.close();
});

test('휴면 회원에게는 알림을 보내지 않는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  await m.call('/push', { method: 'POST', body: sub(2) });
  await a.call(`/members/${app.memberId}`, { method: 'PATCH', body: { status: 'dormant' } });

  app.sent.length = 0;
  await a.call('/notices', { method: 'POST', body: { title: 'x', body: 'y' } });
  await app.settle();
  assert.strictEqual(app.sent.length, 0);
  app.close();
});

test('구독이 만료되면(410) 그 기기를 지운다', async () => {
  const app = makeApp({ fail: 410 });
  const m = await loginAs(app.base, '88110044', '1111');
  await m.call('/push', { method: 'POST', body: sub() });
  await m.call('/push/test', { method: 'POST' });
  await app.settle();
  assert.strictEqual((await m.call('/push')).data.subscribed, false, '죽은 구독이 남아있다');
  app.close();
});

test('알림이 실패해도 글·공지는 그대로 올라간다', async () => {
  const app = makeApp({ fail: 500 });
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/push', { method: 'POST', body: sub(1) });
  const r = await a.call('/notices', { method: 'POST', body: { title: '중요', body: '내용' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await a.call('/notices')).data.length, 1);
  app.close();
});
