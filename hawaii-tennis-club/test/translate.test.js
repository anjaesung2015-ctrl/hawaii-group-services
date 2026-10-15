// 회원이 쓴 글 자동 번역 — 원문은 그대로 두고 '칸_tr' 을 덧붙인다.
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs, client } = require('./helper');
const { createTranslator, srcLang } = require('../lib/translate');

test('글의 언어를 알아본다 (한글 / 키릴 / 번역 불필요)', () => {
  assert.strictEqual(srcLang('오늘 모임 있습니다'), 'ko');
  assert.strictEqual(srcLang('Өнөөдөр цугларалт'), 'mn');
  assert.strictEqual(srcLang('Hawaiiclubday 19:00'), null, '영문·숫자는 번역할 것이 없다');
  assert.strictEqual(srcLang('🎾 !!'), null);
});

test('공지를 영어로 번역해 함께 보낸다 (원문은 그대로)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/notices', { method: 'POST', body: { title: '11월 일정', body: '화요일 저녁 7시' } });

  const plain = (await a.call('/notices')).data[0];
  assert.strictEqual(plain.title, '11월 일정');
  assert.ok(!('title_tr' in plain), 'lang 을 안 주면 번역하지 않는다');

  const en = (await a.call('/notices?lang=en')).data[0];
  assert.strictEqual(en.title, '11월 일정', '원문이 바뀌면 안 된다');
  assert.strictEqual(en.title_tr, '[en] 11월 일정');
  assert.strictEqual(en.body_tr, '[en] 화요일 저녁 7시');
  app.close();
});

test('게시판 글과 댓글도 번역된다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const id = (await m.call('/posts', { method: 'POST', body: { body: 'Өчигдрийн тэмцээн сайхан байлаа' } })).data.id;
  await m.call(`/posts/${id}/comments`, { method: 'POST', body: { body: '저도 재미있었어요' } });

  const list = (await m.call('/posts?lang=en')).data.rows;
  assert.strictEqual(list[0].body_tr, '[en] Өчигдрийн тэмцээн сайхан байлаа');

  const one = (await m.call(`/posts/${id}?lang=en`)).data;
  assert.strictEqual(one.body_tr, '[en] Өчигдрийн тэмцээн сайхан байлаа');
  assert.strictEqual(one.comments[0].body_tr, '[en] 저도 재미있었어요');
  app.close();
});

test('일정 제목·메모도 번역된다 (목록·다가오는·상세 모두)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const id = (await a.call('/events', { method: 'POST', body: {
    title: '정기모임', kind: 'regular', event_date: '2099-11-04',
    start_time: '19:00', end_time: '21:00', memo: '라켓 준비',
  } })).data.id;

  const list = (await a.call('/events?lang=en')).data;
  assert.strictEqual(list[0].title_tr, '[en] 정기모임');
  assert.strictEqual(list[0].memo_tr, '[en] 라켓 준비');

  const up = (await a.call('/events/upcoming?lang=en')).data;
  assert.strictEqual(up[0].title_tr, '[en] 정기모임');

  const one = (await a.call(`/events/${id}?lang=en`)).data;
  assert.strictEqual(one.title_tr, '[en] 정기모임');
  app.close();
});

test('영어·숫자만 쓴 글은 번역하지 않는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/events', { method: 'POST', body: {
    title: 'Hawaiiclubday', kind: 'regular', event_date: '2099-11-05', start_time: '19:00', end_time: '21:00',
  } });
  const e = (await a.call('/events?lang=en')).data.find(x => x.title === 'Hawaiiclubday');
  assert.ok(!('title_tr' in e), '번역할 필요가 없는 글에 번역문이 붙었다');
  app.close();
});

test('한 번 번역한 문장은 다시 번역기를 부르지 않는다 (DB 캐시)', async () => {
  const app = makeApp();
  let calls = 0;
  const tr = createTranslator(app.db, { translate: async (text) => { calls += 1; return '[en] ' + text; } });

  const rows1 = [{ body: '같은 문장입니다' }];
  const rows2 = [{ body: '같은 문장입니다' }, { body: '같은 문장입니다' }];
  await tr.attach(rows1, ['body'], 'en');
  await tr.attach(rows2, ['body'], 'en');
  assert.strictEqual(calls, 1, '같은 문장을 여러 번 번역했다');
  assert.strictEqual(rows2[1].body_tr, '[en] 같은 문장입니다');
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM tr').get().c, 1);
  app.close();
});

test('번역기가 죽어 있어도 글은 원문으로 보인다', async () => {
  const app = makeApp();
  const tr = createTranslator(app.db, { budgetMs: 300, translate: async () => { throw new Error('translator down'); } });
  const rows = [{ title: '정기모임' }];
  await tr.attach(rows, ['title'], 'en');
  assert.strictEqual(rows[0].title, '정기모임');
  assert.ok(!('title_tr' in rows[0]), '실패했는데 번역문이 붙었다');
  app.close();
});

test('번역이 오래 걸리면 기다리지 않고 원문을 보낸다 (다음에 열면 번역문)', async () => {
  const app = makeApp();
  let finished = null;
  const tr = createTranslator(app.db, {
    budgetMs: 150,
    translate: async (text) => { await new Promise(r => setTimeout(r, 400)); finished = text; return '[en] ' + text; },
  });

  const first = [{ title: '느린 번역' }];
  const started = Date.now();
  await tr.attach(first, ['title'], 'en');
  assert.ok(Date.now() - started < 350, '예산 시간보다 오래 기다렸다');
  assert.ok(!('title_tr' in first[0]), '아직 안 끝났으므로 원문만');

  // 뒤에서 끝난 번역은 캐시에 들어가므로 다음 요청에는 붙는다
  await new Promise(r => setTimeout(r, 400));
  assert.strictEqual(finished, '느린 번역');
  const second = [{ title: '느린 번역' }];
  await tr.attach(second, ['title'], 'en');
  assert.strictEqual(second[0].title_tr, '[en] 느린 번역');
  app.close();
});

test('너무 긴 글은 번역하지 않는다 (번역기가 토막 낸다)', async () => {
  const app = makeApp();
  let calls = 0;
  const tr = createTranslator(app.db, { translate: async (t) => { calls += 1; return '[en] ' + t; } });
  const rows = [{ body: '아주 긴 글입니다. '.repeat(200) }];   // 2000자 넘음
  await tr.attach(rows, ['body'], 'en');
  assert.strictEqual(calls, 0);
  assert.ok(!('body_tr' in rows[0]));
  app.close();
});

test('로그인하지 않으면 번역도 못 본다 (내용 자체가 안 내려간다)', async () => {
  const app = makeApp();
  const c = client(app.base);
  assert.strictEqual((await c.call('/notices?lang=en')).status, 401);
  assert.strictEqual((await c.call('/posts?lang=en')).status, 401);
  app.close();
});
