// 자유게시판 — 회원끼리 글·사진·댓글·좋아요
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeApp, client, loginAs } = require('./helper');

const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAADAAEAAQBPR+8AAAAASUVORK5CYII=';
const up = (app, p) => path.join(app.uploadDir, path.basename(p));

test('회원이 글을 쓰고 모두가 본다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await m.call('/posts', { method: 'POST', body: { body: '어제 경기 재미있었어요' } });
  assert.strictEqual(r.status, 200);

  const a = await loginAs(app.base, '99000000', '1234');
  const list = (await a.call('/posts')).data;
  assert.strictEqual(list.rows.length, 1);
  assert.strictEqual(list.rows[0].body, '어제 경기 재미있었어요');
  assert.strictEqual(list.rows[0].author, 'Батбаяр');
  assert.strictEqual(list.rows[0].comments, 0);
  assert.strictEqual(list.rows[0].likes, 0);
  app.close();
});

test('최신 글이 먼저 나온다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  for (const b of ['첫째', '둘째', '셋째']) await m.call('/posts', { method: 'POST', body: { body: b } });
  const rows = (await m.call('/posts')).data.rows;
  assert.deepStrictEqual(rows.map(r => r.body), ['셋째', '둘째', '첫째']);
  app.close();
});

test('글도 사진도 없으면 올릴 수 없다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await m.call('/posts', { method: 'POST', body: { body: '   ' } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'body_required');
  app.close();
});

test('사진만 올려도 된다 (글 없이)', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await m.call('/posts', { method: 'POST', body: { photos: [TINY] } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.photos.length, 1);
  assert.ok(fs.existsSync(up(app, r.data.photos[0])), '사진 파일이 없다');
  assert.match(r.data.photos[0], /^uploads\//, '경로 앞에 / 가 붙으면 하위 경로에서 깨진다');
  app.close();
});

test('사진 여러 장을 순서대로 붙인다 (최대 4장)', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await m.call('/posts', { method: 'POST', body: { body: '사진', photos: [TINY, TINY, TINY] } });
  const rows = (await m.call('/posts')).data.rows;
  assert.strictEqual(rows[0].photos.length, 3);

  const over = await m.call('/posts', { method: 'POST', body: { body: 'x', photos: [TINY, TINY, TINY, TINY, TINY] } });
  assert.strictEqual(over.status, 400);
  assert.strictEqual(over.data.error, 'too_many_photos');
  for (const p of r.data.photos) fs.rmSync(up(app, p), { force: true });
  app.close();
});

test('그림이 아닌 것을 사진이라고 보내면 거절한다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await m.call('/posts', { method: 'POST', body: { body: 'x', photos: ['data:text/html;base64,PHNjcmlwdD4='] } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'bad_photo');
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM post').get().c, 0, '글이 만들어지면 안 된다');
  app.close();
});

test('댓글을 달면 글 목록의 댓글 수가 올라간다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const id = (await m.call('/posts', { method: 'POST', body: { body: '라켓 줄 교체 어떤가요?' } })).data.id;

  const a = await loginAs(app.base, '99000000', '1234');
  await a.call(`/posts/${id}/comments`, { method: 'POST', body: { body: '저는 2주에 한 번 합니다' } });
  await m.call(`/posts/${id}/comments`, { method: 'POST', body: { body: '감사합니다' } });

  const rows = (await m.call('/posts')).data.rows;
  assert.strictEqual(rows[0].comments, 2);

  const d = (await m.call(`/posts/${id}`)).data;
  assert.deepStrictEqual(d.comments.map(c => c.author), ['대표', 'Батбаяр'], '쓴 순서대로 보여야 한다');
  app.close();
});

test('빈 댓글은 달 수 없다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const id = (await m.call('/posts', { method: 'POST', body: { body: 'x' } })).data.id;
  assert.strictEqual((await m.call(`/posts/${id}/comments`, { method: 'POST', body: { body: ' ' } })).status, 400);
  app.close();
});

test('좋아요는 한 사람이 한 번 (다시 누르면 취소)', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const id = (await m.call('/posts', { method: 'POST', body: { body: 'x' } })).data.id;

  let r = await m.call(`/posts/${id}/like`, { method: 'PUT', body: { on: true } });
  assert.deepStrictEqual([r.data.liked, r.data.likes], [true, 1]);
  r = await m.call(`/posts/${id}/like`, { method: 'PUT', body: { on: true } });
  assert.strictEqual(r.data.likes, 1, '같은 사람이 두 번 세어지면 안 된다');

  const a = await loginAs(app.base, '99000000', '1234');
  r = await a.call(`/posts/${id}/like`, { method: 'PUT', body: { on: true } });
  assert.strictEqual(r.data.likes, 2);

  r = await m.call(`/posts/${id}/like`, { method: 'PUT', body: { on: false } });
  assert.deepStrictEqual([r.data.liked, r.data.likes], [false, 1]);
  app.close();
});

test('내가 눌렀는지(liked)가 사람마다 다르게 나온다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const id = (await m.call('/posts', { method: 'POST', body: { body: 'x' } })).data.id;
  await m.call(`/posts/${id}/like`, { method: 'PUT', body: { on: true } });

  assert.strictEqual((await m.call('/posts')).data.rows[0].liked, true);
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/posts')).data.rows[0].liked, false);
  app.close();
});

test('내 글은 내가 고치고 지운다. 남의 글은 못 건드린다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const id = (await m.call('/posts', { method: 'POST', body: { body: '처음' } })).data.id;

  assert.strictEqual((await m.call(`/posts/${id}`, { method: 'PATCH', body: { body: '고침' } })).status, 200);
  assert.strictEqual((await m.call(`/posts/${id}`)).data.body, '고침');

  // 다른 일반회원을 하나 만들어 남의 글을 건드려 본다
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/members', { method: 'POST', body: { name: '남', phone: '95550001', pin: '1111' } });
  const other = await loginAs(app.base, '95550001', '1111');
  assert.strictEqual((await other.call(`/posts/${id}`, { method: 'PATCH', body: { body: '남이 고침' } })).status, 403);
  assert.strictEqual((await other.call(`/posts/${id}`, { method: 'DELETE' })).status, 403);

  assert.strictEqual((await m.call(`/posts/${id}`, { method: 'DELETE' })).status, 200);
  app.close();
});

test('관리자는 아무 글·댓글이나 지울 수 있다 (고치는 건 안 된다)', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const id = (await m.call('/posts', { method: 'POST', body: { body: 'x' } })).data.id;
  const cid = (await m.call(`/posts/${id}/comments`, { method: 'POST', body: { body: 'c' } })).data.id;

  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call(`/posts/${id}`, { method: 'PATCH', body: { body: 'y' } })).status, 403);
  assert.strictEqual((await a.call(`/posts/${id}/comments/${cid}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await a.call(`/posts/${id}`, { method: 'DELETE' })).status, 200);
  app.close();
});

test('글을 지우면 댓글·좋아요·사진이 함께 사라진다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const made = await m.call('/posts', { method: 'POST', body: { body: 'x', photos: [TINY] } });
  const id = made.data.id;
  await m.call(`/posts/${id}/comments`, { method: 'POST', body: { body: 'c' } });
  await m.call(`/posts/${id}/like`, { method: 'PUT', body: { on: true } });

  await m.call(`/posts/${id}`, { method: 'DELETE' });
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM comment').get().c, 0);
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM post_like').get().c, 0);
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM post_photo').get().c, 0);
  await new Promise(r => setTimeout(r, 60));
  assert.ok(!fs.existsSync(up(app, made.data.photos[0])), '사진 파일이 남았다');
  app.close();
});

test('회원을 지우면 그 사람 글·댓글도 사라진다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  await m.call('/posts', { method: 'POST', body: { body: 'x' } });
  const a = await loginAs(app.base, '99000000', '1234');
  const id = (await a.call('/posts')).data.rows[0].id;
  await a.call(`/posts/${id}/comments`, { method: 'POST', body: { body: '대표 댓글' } });

  await a.call(`/members/${app.memberId}`, { method: 'DELETE' });
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM post').get().c, 0);
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM comment').get().c, 0, '글이 사라지면 그 댓글도 사라진다');
  app.close();
});

test('로그인하지 않으면 게시판을 볼 수 없다', async () => {
  const app = makeApp();
  const c = client(app.base);
  assert.strictEqual((await c.call('/posts')).status, 401);
  assert.strictEqual((await c.call('/posts', { method: 'POST', body: { body: 'x' } })).status, 401);
  app.close();
});

test('더 보기 — 20개씩 끊어 내려온다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  for (let i = 1; i <= 23; i++) await m.call('/posts', { method: 'POST', body: { body: `글${i}` } });

  const first = (await m.call('/posts')).data;
  assert.strictEqual(first.rows.length, 20);
  assert.strictEqual(first.has_more, true);

  const next = (await m.call(`/posts?before=${first.rows[19].id}`)).data;
  assert.strictEqual(next.rows.length, 3);
  assert.strictEqual(next.has_more, false);
  assert.strictEqual(next.rows[0].body, '글3');
  app.close();
});

test('몽골어·한국어가 그대로 저장된다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const body = 'Өчигдрийн тэмцээн сайхан болсон 🎾\n어제 경기 좋았습니다';
  const id = (await m.call('/posts', { method: 'POST', body: { body } })).data.id;
  assert.strictEqual((await m.call(`/posts/${id}`)).data.body, body);
  app.close();
});
