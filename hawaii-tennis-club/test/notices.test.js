// 공지 — 관리자가 쓰고(사진·고정) 회원은 읽는다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeApp, loginAs } = require('./helper');

// 1x1 짜리 아주 작은 PNG (사진 저장 경로 확인용)
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAADAAEAAQBPR+8AAAAASUVORK5CYII=';

test('관리자가 공지를 쓰고 회원은 읽는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/notices', { method: 'POST', body: { title: '11월 일정', body: '화·목 19시' } });

  const m = await loginAs(app.base, '88110044', '1111');
  const list = (await m.call('/notices')).data;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, '11월 일정');
  assert.strictEqual(list[0].author, '대표');
  app.close();
});

test('회원은 공지를 쓰거나 고치거나 지울 수 없다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const id = (await a.call('/notices', { method: 'POST', body: { title: 't', body: 'b' } })).data.id;

  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/notices', { method: 'POST', body: { title: 'x', body: 'y' } })).status, 403);
  assert.strictEqual((await m.call(`/notices/${id}`, { method: 'PATCH', body: { title: 'x' } })).status, 403);
  assert.strictEqual((await m.call(`/notices/${id}`, { method: 'DELETE' })).status, 403);
  app.close();
});

test('고정한 공지가 맨 위로 온다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/notices', { method: 'POST', body: { title: '첫째', body: 'b' } });
  await a.call('/notices', { method: 'POST', body: { title: '둘째', body: 'b' } });
  await a.call('/notices', { method: 'POST', body: { title: '고정', body: 'b', pinned: true } });

  const list = (await a.call('/notices')).data;
  assert.strictEqual(list[0].title, '고정');
  assert.strictEqual(list[0].pinned, 1);
  app.close();
});

test('제목이나 내용이 비면 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/notices', { method: 'POST', body: { title: '', body: 'b' } })).data.error, 'title_required');
  assert.strictEqual((await a.call('/notices', { method: 'POST', body: { title: 't', body: ' ' } })).data.error, 'body_required');
  app.close();
});

test('사진을 붙이면 파일로 저장되고 주소가 돌아온다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/notices', { method: 'POST', body: { title: '사진', body: 'b', photo_data: TINY_PNG } });
  // 앞에 / 가 없어야 한다 — /club/ 처럼 하위 경로에 올려도 그대로 열리게
  assert.match(r.data.photo, /^uploads\/.+\.png$/);

  const file = path.join(__dirname, '..', 'uploads', path.basename(r.data.photo));
  assert.ok(fs.existsSync(file), '사진 파일이 없다');
  fs.rmSync(file, { force: true });
  app.close();
});

test('그림이 아닌 것을 사진이라고 보내면 거절한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/notices', { method: 'POST', body: { title: 't', body: 'b', photo_data: 'data:text/html;base64,PHNjcmlwdD4=' } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'bad_photo');
  app.close();
});

test('공지를 고치거나 지울 수 있다 (사진도 함께 지워진다)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const made = await a.call('/notices', { method: 'POST', body: { title: '옛 제목', body: 'b', photo_data: TINY_PNG } });

  await a.call(`/notices/${made.data.id}`, { method: 'PATCH', body: { title: '새 제목', pinned: true } });
  const after = (await a.call('/notices')).data[0];
  assert.strictEqual(after.title, '새 제목');
  assert.strictEqual(after.pinned, 1);
  assert.strictEqual(after.photo, made.data.photo, '사진은 그대로 있어야 한다');

  await a.call(`/notices/${made.data.id}`, { method: 'DELETE' });
  assert.deepStrictEqual((await a.call('/notices')).data, []);
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'uploads', path.basename(made.data.photo))), '사진 파일이 남았다');
  app.close();
});

test('사진만 빼기 (remove_photo)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const made = await a.call('/notices', { method: 'POST', body: { title: 't', body: 'b', photo_data: TINY_PNG } });
  const r = await a.call(`/notices/${made.data.id}`, { method: 'PATCH', body: { remove_photo: true } });
  assert.strictEqual(r.data.photo, null);
  app.close();
});

test('몽골어·한국어가 그대로 저장된다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const body = 'Сарын хураамж 200,000₮ — сар бүрийн 10-ны дотор.\n월회비는 매월 10일까지.';
  await a.call('/notices', { method: 'POST', body: { title: 'Хураамж · 회비', body } });
  assert.strictEqual((await a.call('/notices')).data[0].body, body);
  app.close();
});
