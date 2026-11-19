// 공지 — 사진 여러 장 (최대 10장), 고칠 때 남길 사진 + 새 사진
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeApp, loginAs } = require('./helper');

const IMG = (s) => 'data:image/jpeg;base64,' + Buffer.from(`fake-jpeg-${s}`).toString('base64');
const file = (app, p) => path.join(app.uploadDir, path.basename(p));
const gone = () => new Promise(r => setTimeout(r, 150));

test('공지에 사진 여러 장 — 순서대로, 첫 장은 photo 에도', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/notices', { method: 'POST', body: { title: '대회', body: '사진', photos_data: [IMG(1), IMG(2), IMG(3)] } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.photos.length, 3);
  assert.strictEqual(r.data.photo, r.data.photos[0]);
  r.data.photos.forEach(p => assert.match(p, /^uploads\//));
  assert.strictEqual(fs.readFileSync(file(app, r.data.photos[1]), 'utf8'), 'fake-jpeg-2');

  const list = (await a.call('/notices')).data;
  assert.deepStrictEqual(list[0].photos, r.data.photos);

  const feed = (await a.call('/feed?kind=notice')).data;
  assert.strictEqual((feed.rows || feed)[0].photos, 3, '홈 피드 사진 수');

  const over = await a.call('/notices', { method: 'POST', body: { title: 't', body: 'b', photos_data: Array(11).fill(IMG(9)) } });
  assert.strictEqual(over.status, 400);
  assert.strictEqual(over.data.error, 'too_many_photos');

  await a.call(`/notices/${r.data.id}`, { method: 'DELETE' });
  await gone();
  r.data.photos.forEach(p => assert.ok(!fs.existsSync(file(app, p)), '지우면 파일도'));
  app.close();
});

test('고치기 — 남길 사진(순서) + 새 사진, 뺀 사진 파일은 지운다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const made = (await a.call('/notices', { method: 'POST', body: { title: 't', body: 'b', photos_data: [IMG(1), IMG(2), IMG(3)] } })).data;
  const [p1, p2, p3] = made.photos;

  const r = await a.call(`/notices/${made.id}`, { method: 'PATCH', body: { photos_keep: [p3, p1, 'uploads/남의것.jpg'], photos_data: [IMG(4)] } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data.photos.slice(0, 2), [p3, p1], '남길 사진은 보낸 순서, 모르는 경로는 무시');
  assert.strictEqual(r.data.photos.length, 3);
  assert.strictEqual(r.data.photo, p3);
  await gone();
  assert.ok(!fs.existsSync(file(app, p2)), '뺀 사진 파일은 지움');
  assert.ok(fs.existsSync(file(app, p1)));

  // 글만 고치면 사진은 그대로
  const t2 = await a.call(`/notices/${made.id}`, { method: 'PATCH', body: { title: '새 제목' } });
  assert.deepStrictEqual(t2.data.photos, r.data.photos);

  // 다 빼기
  const none = await a.call(`/notices/${made.id}`, { method: 'PATCH', body: { photos_keep: [] } });
  assert.deepStrictEqual(none.data.photos, []);
  assert.strictEqual(none.data.photo, null);

  // 10장 넘게는 안 된다
  const many = await a.call(`/notices/${made.id}`, { method: 'PATCH', body: { photos_keep: [], photos_data: Array(11).fill(IMG(5)) } });
  assert.strictEqual(many.status, 400);
  app.close();
});
