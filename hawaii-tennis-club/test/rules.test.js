// 회칙 — 읽기(누구나) · 개정(관리자) · 가입 동의 · 조직도
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, client, loginAs } = require('./helper');

const req = (over = {}) => ({ name: 'Сарнай', phone: '95556677', pin: '2468', agree: true, ...over });

test('회칙은 로그인 없이도 읽힌다 (가입 전에 읽어야 하니까)', async () => {
  const app = makeApp();
  const c = client(app.base);
  const r = await c.call('/docs/rules');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.version, 1);
  assert.match(r.data.body, /하와이 테니스 클럽 회칙/);
  app.close();
});

test('몽골어 회칙도 들어있다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const mn = (await c.call('/docs/rules?lang=mn')).data;
  assert.strictEqual(mn.lang, 'mn');
  assert.match(mn.body, /Хавайн теннисний клубын дүрэм/);
  app.close();
});

test('바뀐 규정이 들어있다 — 게스트 2회(추천 시), 휴회 제도 없음', async () => {
  const app = makeApp();
  const c = client(app.base);
  const ko = (await c.call('/docs/rules')).data.body;
  assert.match(ko, /추천을 받은 경우: 2회/);
  assert.match(ko, /추천 없이 본인이 신청하는 경우: 4회/);
  assert.ok(!/휴회/.test(ko), '휴회 조항이 남아있다');

  const mn = (await c.call('/docs/rules?lang=mn')).data.body;
  assert.match(mn, /2 удаа/);
  app.close();
});

test('조문 번호와 상호 참조가 맞다 (휴회를 빼고 당겼으므로)', async () => {
  const app = makeApp();
  const ko = (await client(app.base).call('/docs/rules')).data.body;
  assert.match(ko, /제9조 \(탈퇴와 자격 상실\)/);
  assert.match(ko, /제12조 \(미납\)/);
  assert.match(ko, /제31조 \(징계\)/);
  assert.match(ko, /회비 미납\(제12조\) 또는 활동 정지\(제31조\)/, '제7조4 참조가 안 맞다');
  assert.match(ko, /회원 코트 혜택\(제25조\)/, '제8조1 참조가 안 맞다');
  assert.match(ko, /제명된 경우\(제31조\)/, '제9조3 참조가 안 맞다');
  assert.ok(!/제32조/.test(ko), '없는 조문을 가리킨다');
  app.close();
});

test('관리자가 고치면 판 번호가 올라간다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const body = '제1조 (명칭) 본 클럽의 이름은 "하와이 테니스 클럽"이다. '.repeat(3);
  const r = await a.call('/docs/rules', { method: 'PUT', body: { lang: 'ko', body } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.version, 2);
  assert.strictEqual((await a.call('/docs/rules')).data.version, 2);
  app.close();
});

test('회원은 회칙을 고칠 수 없다 · 너무 짧은 글은 거절', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/docs/rules', { method: 'PUT', body: { lang: 'ko', body: 'x'.repeat(100) } })).status, 403);

  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/docs/rules', { method: 'PUT', body: { lang: 'ko', body: '짧음' } })).data.error, 'body_required');
  assert.strictEqual((await a.call('/docs/rules', { method: 'PUT', body: { lang: 'en', body: 'x'.repeat(100) } })).data.error, 'bad_lang');
  app.close();
});

// ---- 가입 동의 ----

test('회칙에 동의하지 않으면 가입 신청이 안 된다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const r = await c.call('/join', { method: 'POST', body: req({ agree: false }) });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'agree_required');
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM join_request').get().c, 0);
  app.close();
});

test('신청에 동의 시각과 판 번호가 남는다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const id = (await c.call('/join', { method: 'POST', body: req() })).data.id;
  const row = app.db.prepare('SELECT agreed_at, agreed_version FROM join_request WHERE id=?').get(id);
  assert.ok(row.agreed_at, '동의 시각이 없다');
  assert.strictEqual(row.agreed_version, 1);
  app.close();
});

test('승인하면 동의 기록이 회원에게 넘어간다', async () => {
  const app = makeApp();
  const c = client(app.base);
  const id = (await c.call('/join', { method: 'POST', body: req() })).data.id;
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call(`/join/${id}/approve`, { method: 'POST' });

  const m = app.db.prepare('SELECT rules_agreed_at, rules_version FROM member WHERE id=?').get(r.data.member_id);
  assert.ok(m.rules_agreed_at);
  assert.strictEqual(m.rules_version, 1);

  // 그 회원은 로그인했을 때 다시 동의를 요구받지 않는다
  const mine = await loginAs(app.base, '95556677', '2468');
  assert.strictEqual((await mine.call('/auth/me')).data.rules_agreed, true);
  app.close();
});

test('아직 동의하지 않은 기존 회원은 동의를 요구받고, 동의하면 끝난다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/auth/me')).data.rules_agreed, false);

  assert.strictEqual((await a.call('/auth/agree-rules', { method: 'POST' })).status, 200);
  assert.strictEqual((await a.call('/auth/me')).data.rules_agreed, true);
  app.close();
});

test('회칙이 개정되면 다시 동의를 받는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/auth/agree-rules', { method: 'POST' });
  assert.strictEqual((await a.call('/auth/me')).data.rules_agreed, true);

  await a.call('/docs/rules', { method: 'PUT', body: { lang: 'ko', body: '바뀐 회칙 '.repeat(20) } });
  assert.strictEqual((await a.call('/auth/me')).data.rules_agreed, false, '개정 뒤에는 다시 받아야 한다');

  await a.call('/auth/agree-rules', { method: 'POST' });
  assert.strictEqual((await a.call('/auth/me')).data.rules_agreed, true);
  app.close();
});

test('로그인하지 않으면 동의할 수 없다', async () => {
  const app = makeApp();
  assert.strictEqual((await client(app.base).call('/auth/agree-rules', { method: 'POST' })).status, 401);
  app.close();
});

// ---- 조직도 ----

test('조직도 자리가 회칙 제14조대로 만들어져 있다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const rows = (await m.call('/officers')).data;
  assert.deepStrictEqual(rows.map(r => r.role), [
    'owner', 'president', 'vice1', 'vice2', 'manager1', 'manager2',
    'match', 'event', 'external', 'honorary', 'advisor1', 'advisor2', 'advisor3',
  ]);
  assert.ok(rows.every(r => r.name === null), '처음에는 비어 있어야 한다');
  app.close();
});

test('관리자가 회원을 자리에 앉힌다 — 이름을 바꾸면 조직도도 따라 바뀐다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/officers/president', { method: 'PUT', body: { member_id: app.memberId, note: '회원 대표' } });

  let row = (await a.call('/officers')).data.find(r => r.role === 'president');
  assert.strictEqual(row.name, 'Батбаяр');
  assert.strictEqual(row.from_member, true);
  assert.strictEqual(row.note, '회원 대표');

  await a.call(`/members/${app.memberId}`, { method: 'PATCH', body: { name: '바트바야르' } });
  row = (await a.call('/officers')).data.find(r => r.role === 'president');
  assert.strictEqual(row.name, '바트바야르', '회원 이름을 바꿨는데 조직도가 옛 이름이다');
  app.close();
});

test('회원이 아닌 분은 이름만 적어 넣는다 (명예회장·고문)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/officers/honorary', { method: 'PUT', body: { person_name: '김후원', note: '클럽 대표 후원자' } });
  const row = (await a.call('/officers')).data.find(r => r.role === 'honorary');
  assert.strictEqual(row.name, '김후원');
  assert.strictEqual(row.from_member, false);
  app.close();
});

test('회원을 지정하면 적어둔 이름은 지워진다 (둘이 어긋나지 않게)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/officers/match', { method: 'PUT', body: { person_name: '손으로 적은 이름' } });
  await a.call('/officers/match', { method: 'PUT', body: { member_id: app.memberId } });
  const row = app.db.prepare("SELECT member_id, person_name FROM officer WHERE role='match'").get();
  assert.strictEqual(row.member_id, app.memberId);
  assert.strictEqual(row.person_name, null);
  app.close();
});

test('자리를 비울 수 있다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/officers/event', { method: 'PUT', body: { member_id: app.memberId } });
  await a.call('/officers/event', { method: 'PUT', body: {} });
  const row = (await a.call('/officers')).data.find(r => r.role === 'event');
  assert.strictEqual(row.name, null);
  app.close();
});

test('회원은 조직도를 볼 수만 있다 · 없는 자리는 404', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/officers')).status, 200);
  assert.strictEqual((await m.call('/officers/president', { method: 'PUT', body: { member_id: 1 } })).status, 403);

  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/officers/coach', { method: 'PUT', body: {} })).status, 404);
  assert.strictEqual((await a.call('/officers/president', { method: 'PUT', body: { member_id: 9999 } })).status, 404);
  app.close();
});

test('회원을 지우면 그 자리는 빈자리가 된다 (조직도가 깨지지 않는다)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call(`/members/${app.memberId}`, { method: 'PATCH', body: { role: 'admin' } });
  await a.call('/officers/vice1', { method: 'PUT', body: { member_id: app.memberId } });
  await a.call(`/members/${app.memberId}`, { method: 'DELETE' });

  const row = (await a.call('/officers')).data.find(r => r.role === 'vice1');
  assert.strictEqual(row.name, null);
  app.close();
});

test('로그인하지 않으면 조직도를 볼 수 없다', async () => {
  const app = makeApp();
  assert.strictEqual((await client(app.base).call('/officers')).status, 401);
  app.close();
});
