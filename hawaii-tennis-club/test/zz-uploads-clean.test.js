// 테스트 사진이 운영 uploads/ 에 새어 나가지 않는지 — 사진을 올리는 흐름을 한 번 돌리고 폴더를 비교한다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeApp, loginAs } = require('./helper');

const LIVE = path.join(__dirname, '..', 'uploads');
const list = () => (fs.existsSync(LIVE) ? fs.readdirSync(LIVE).sort() : []);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('공지·게시판 사진 테스트는 운영 uploads/ 가 아니라 임시 폴더에 저장한다', async () => {
  const before = list();
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const n = await a.call('/notices', { method: 'POST', body: { title: 't', body: 'b', photo_data: PNG } });
  const p = await a.call('/posts', { method: 'POST', body: { body: 'b', photos: [PNG] } });
  assert.strictEqual(n.status, 200);
  assert.strictEqual(p.status, 200);
  assert.ok(fs.existsSync(path.join(app.uploadDir, path.basename(n.data.photo))));
  assert.ok(fs.existsSync(path.join(app.uploadDir, path.basename(p.data.photos[0]))));
  assert.deepStrictEqual(list(), before, '운영 uploads/ 에 파일이 생겼다');
  app.close();
  assert.ok(!fs.existsSync(app.uploadDir), '임시 사진 폴더가 남았다');
});
