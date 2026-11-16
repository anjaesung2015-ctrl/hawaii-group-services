// 홈 피드 — 게시판 글·사진첩·공지·성적을 시간순으로 섞어 이어 받기(무한 스크롤)
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAADAAEAAQBPR+8AAAAASUVORK5CYII=';

// 올린 시각을 정해 둔다 (같은 초에 올라가면 순서를 시험할 수 없다)
const at = (app, table, id, stamp) => app.db.prepare(`UPDATE ${table} SET created_at=? WHERE id=?`).run(stamp, id);

async function seed(app) {
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  const post = (await m.call('/posts', { method: 'POST', body: { body: '오늘 랠리 재밌었어요', photos: [TINY] } })).data.id;
  const text = (await m.call('/posts', { method: 'POST', body: { body: '글만 있는 글' } })).data.id;
  const [g1] = (await m.call('/gallery', { method: 'POST', body: { photos: [TINY], caption: '단체 사진' } })).data.ids;
  const notice = (await a.call('/notices', { method: 'POST', body: { title: '코트 공사', body: '다음 주 화요일 코트 공사' } })).data.id;
  const result = (await a.call('/results', { method: 'POST', body: {
    title: '11월 월례대회', held_on: '2026-11-25', kind: 'monthly', division: 'Men doubles',
    entries: [{ place: 2, name: 'B' }, { place: 1, member_id: app.memberId }, { place: 1, name: 'Guest' }], photos: [TINY] } })).data.id;
  at(app, 'post', post, '2026-11-01 10:00:00');
  at(app, 'gallery_photo', g1, '2026-11-02 10:00:00');
  at(app, 'notice', notice, '2026-11-03 10:00:00');
  at(app, 'result', result, '2026-11-04 10:00:00');
  at(app, 'post', text, '2026-11-04 10:00:00');     // 성적과 같은 시각 — 그래도 순서가 정해진다
  return { a, m, post, text, g1, notice, result };
}

test('피드 — 네 종류가 최신순으로 섞여 오고, 카드에 사진·제목·작성자가 있다', async () => {
  const app = makeApp();
  const s = await seed(app);
  const d = (await s.m.call('/feed?lang=en')).data;
  assert.deepStrictEqual(d.rows.map(r => `${r.type}:${r.id}`),
    [`result:${s.result}`, `post:${s.text}`, `notice:${s.notice}`, `photo:${s.g1}`, `post:${s.post}`]);
  assert.strictEqual(d.next, null);

  const by = Object.fromEntries(d.rows.map(r => [`${r.type}:${r.id}`, r]));
  const p = by[`post:${s.post}`];
  assert.strictEqual(p.title, '오늘 랠리 재밌었어요');
  assert.strictEqual(p.title_tr, '[en] 오늘 랠리 재밌었어요');
  assert.strictEqual(p.author, 'Батбаяр');
  assert.ok(/^uploads\//.test(p.photo));
  assert.strictEqual(by[`post:${s.text}`].photo, null);
  assert.strictEqual(by[`photo:${s.g1}`].title, '단체 사진');
  assert.strictEqual(by[`notice:${s.notice}`].excerpt, '다음 주 화요일 코트 공사');
  assert.strictEqual(by[`notice:${s.notice}`].author, '대표');

  const r = by[`result:${s.result}`];
  assert.strictEqual(r.kind, 'monthly');
  assert.strictEqual(r.place, 1);
  assert.deepStrictEqual(r.winners, ['Батбаяр', 'Guest']);   // 1등만, 복식이면 둘 다
  assert.strictEqual(r.excerpt, 'Men doubles');
  assert.ok(r.photo);
  app.close();
});

test('피드 — before 커서로 이어 받으면 겹치거나 빠지는 카드가 없다, 종류별로도 받는다', async () => {
  const app = makeApp();
  const s = await seed(app);
  const all = [];
  let next = '';
  for (let i = 0; i < 10; i++) {
    const d = (await s.m.call(`/feed?limit=2${next ? `&before=${encodeURIComponent(next)}` : ''}`)).data;
    all.push(...d.rows.map(r => `${r.type}:${r.id}`));
    if (!d.next) break;
    next = d.next;
  }
  assert.strictEqual(all.length, 5);
  assert.strictEqual(new Set(all).size, 5);

  assert.deepStrictEqual((await s.m.call('/feed?kind=post')).data.rows.map(r => r.id), [s.text, s.post]);
  assert.deepStrictEqual((await s.m.call('/feed?kind=photo')).data.rows.map(r => r.type), ['photo']);
  assert.deepStrictEqual((await s.m.call('/feed?kind=result')).data.rows.map(r => r.title), ['11월 월례대회']);
  app.close();
});

test('피드 — 로그인한 동호인만', async () => {
  const app = makeApp();
  assert.strictEqual((await fetch(app.base + '/feed')).status, 401);
  app.close();
});
