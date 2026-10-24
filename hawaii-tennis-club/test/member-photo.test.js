// 회원 사진 — 본인은 ☰ 메뉴에서, 운영진은 회원 수정 창에서
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeApp, loginAs } = require('./helper');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const fileOf = (app, p) => path.join(app.uploadDir, path.basename(p));

test('본인이 사진을 올리면 /auth/me·명단·게시판에 보이고, 바꾸면 옛 파일은 지워진다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r1 = await m.call('/auth/photo', { method: 'PUT', body: { photo_data: PNG } });
  assert.strictEqual(r1.status, 200);
  assert.match(r1.data.photo, /^uploads\/.+\.png$/);
  assert.ok(fs.existsSync(fileOf(app, r1.data.photo)));
  assert.strictEqual((await m.call('/auth/me')).data.me?.photo ?? (await m.call('/auth/me')).data.photo, r1.data.photo);
  const list = (await m.call('/members')).data;
  assert.strictEqual(list.find(x => x.id === app.memberId).photo, r1.data.photo);

  await m.call('/posts', { method: 'POST', body: { body: 'hi' } });
  assert.strictEqual((await m.call('/posts')).data.rows[0].author_photo, r1.data.photo);

  const r2 = await m.call('/auth/photo', { method: 'PUT', body: { photo_data: PNG } });
  assert.notStrictEqual(r2.data.photo, r1.data.photo);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(!fs.existsSync(fileOf(app, r1.data.photo)));

  assert.strictEqual((await m.call('/auth/photo', { method: 'DELETE' })).status, 200);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(!fs.existsSync(fileOf(app, r2.data.photo)));
  assert.strictEqual((await m.call('/members')).data.find(x => x.id === app.memberId).photo, null);
  app.close();
});

test('사진이 아닌 것은 400', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/auth/photo', { method: 'PUT', body: { photo_data: 'data:text/plain;base64,aGk=' } })).status, 400);
  assert.strictEqual((await m.call('/auth/photo', { method: 'PUT', body: {} })).status, 400);
  app.close();
});

test('운영진은 다른 회원 사진을 넣고 지울 수 있고, 일반 회원은 못 한다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call(`/members/${app.adminId}/photo`, { method: 'PUT', body: { photo_data: PNG } })).status, 403);
  const r = await a.call(`/members/${app.memberId}/photo`, { method: 'PUT', body: { photo_data: PNG } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await a.call('/members/99999/photo', { method: 'PUT', body: { photo_data: PNG } })).status, 404);
  assert.strictEqual((await a.call(`/members/${app.memberId}/photo`, { method: 'DELETE' })).status, 200);
  app.close();
});

test('회원을 삭제하면 사진 파일도 지워진다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call(`/members/${app.memberId}/photo`, { method: 'PUT', body: { photo_data: PNG } });
  assert.strictEqual((await a.call(`/members/${app.memberId}`, { method: 'DELETE' })).status, 200);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(!fs.existsSync(fileOf(app, r.data.photo)));
  app.close();
});
